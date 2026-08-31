-- =====================================================================
--  ICON AIR — סכימת בסיס נתונים ל-Supabase
--  customers · devices · oil_tracking · service_calls · profiles
--  + הרשאות מדורגות: טכנאי מול מנהל
--
--  להרצה: SQL Editor → New query → הדבק הכול → Run
--  אפשר להריץ שוב בבטחה; הסקריפט לא ידרוס נתונים או שורות קיימות.
-- =====================================================================

create extension if not exists pgcrypto;


-- ---------------------------------------------------------------------
--  1. טיפוסים
--  enum ולא טקסט חופשי: "Icon 700 " עם רווח בסוף נדחה כאן,
--  ולא הופך לשורה נפרדת בדוח בעוד חצי שנה.
-- ---------------------------------------------------------------------

do $$ begin
  create type public.device_model as enum ('Icon 300', 'Icon 500', 'Icon 700');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.device_status as enum ('active', 'offline', 'maintenance', 'uninstalled');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.customer_status as enum ('active', 'onboarding', 'paused', 'churned');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.call_severity as enum ('crit', 'warn', 'norm', 'sched');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.call_status as enum ('open', 'in_progress', 'resolved', 'cancelled');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.oil_event_type as enum ('refill', 'replacement', 'reading');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.user_role as enum ('admin', 'technician');
exception when duplicate_object then null; end $$;


-- ---------------------------------------------------------------------
--  2. עדכון אוטומטי של updated_at
-- ---------------------------------------------------------------------

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;


-- ---------------------------------------------------------------------
--  3. profiles — תפקיד המשתמש (admin / technician)
--  נשמר בטבלה ולא ב-JWT, כדי ששינוי הרשאה ייכנס לתוקף מיד בלי
--  שהמשתמש יצטרך להתנתק ולהתחבר מחדש.
-- ---------------------------------------------------------------------

create table if not exists public.profiles (
  id         uuid primary key references auth.users (id) on delete cascade,
  full_name  text,
  role       public.user_role not null default 'technician',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- כל משתמש שנרשם מקבל שורת profile אוטומטית עם role='technician'.
-- קידום למנהל נעשה בעדכון ידני (ראה בסוף הקובץ) — לא דרך ה-API.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, full_name, role)
  values (new.id, new.raw_user_meta_data ->> 'full_name', 'technician')
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- בדיקת "האם מנהל?" חייבת security definer: היא קוראת מ-profiles,
-- ו-profiles עצמה מוגנת ב-RLS שקוראת שוב לפונקציה הזו — בלי
-- security definer זו לולאה אינסופית.
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
     where id = auth.uid() and role = 'admin'
  );
$$;


-- ---------------------------------------------------------------------
--  4. customers — לקוחות
-- ---------------------------------------------------------------------

create table if not exists public.customers (
  id           uuid primary key default gen_random_uuid(),
  name         text not null,
  contact_name text,
  phone        text,
  email        text,
  address      text,
  city         text,
  route_name   text,                                    -- "קו מרכז", "קו צפון"
  status       public.customer_status not null default 'active',
  notes        text,
  created_by   uuid references auth.users (id) on delete set null default auth.uid(),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- מריצים בהרצה חוזרת על טבלה שכבר קיימת משלב קודם.
alter table public.customers
  add column if not exists created_by uuid references auth.users (id) on delete set null;
alter table public.customers alter column created_by set default auth.uid();

create index if not exists customers_status_idx     on public.customers (status);
create index if not exists customers_route_idx      on public.customers (route_name);
create index if not exists customers_name_idx       on public.customers (name);
create index if not exists customers_created_by_idx on public.customers (created_by);


-- ---------------------------------------------------------------------
--  5. devices — מכשירים בשטח
--  on delete restrict: אי אפשר למחוק לקוח שיש לו מכשירים מותקנים.
--  מחיקה כזו הייתה מוחקת בשקט את כל היסטוריית השמן שלהם.
-- ---------------------------------------------------------------------

create sequence if not exists public.device_serial_seq start 1;

create table if not exists public.devices (
  id                  uuid primary key default gen_random_uuid(),
  serial              text not null unique,             -- ICN-700-0142, נוצר אוטומטית
  model               public.device_model  not null,
  customer_id         uuid not null references public.customers (id) on delete restrict,
  status              public.device_status not null default 'active',
  scent_name          text,                             -- "Signature Gold"
  oil_level_pct       smallint not null default 100
                      check (oil_level_pct between 0 and 100),
  estimated_days_left smallint check (estimated_days_left >= 0),
  location_note       text,                             -- "לובי ראשי", "אזור המשקולות"
  installed_at        date        not null default current_date,
  last_seen_at        timestamptz not null default now(),
  created_by          uuid references auth.users (id) on delete set null default auth.uid(),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

alter table public.devices
  add column if not exists created_by uuid references auth.users (id) on delete set null;
alter table public.devices alter column created_by set default auth.uid();

create index if not exists devices_customer_idx   on public.devices (customer_id);
create index if not exists devices_status_idx     on public.devices (status);
create index if not exists devices_model_idx      on public.devices (model);
create index if not exists devices_oil_idx        on public.devices (oil_level_pct);
create index if not exists devices_created_by_idx on public.devices (created_by);

-- מספר סידורי נוצר בבסיס הנתונים ולא בפרונט:
-- שני טכנאים שרושמים מכשיר באותה שנייה לא יקבלו את אותו מספר.
create or replace function public.devices_fill_serial()
returns trigger
language plpgsql
as $$
begin
  if new.serial is null or btrim(new.serial) = '' then
    new.serial := 'ICN-'
                  || split_part(new.model::text, ' ', 2)
                  || '-'
                  || lpad(nextval('public.device_serial_seq')::text, 4, '0');
  end if;
  return new;
end;
$$;

drop trigger if exists devices_fill_serial on public.devices;
create trigger devices_fill_serial
  before insert on public.devices
  for each row execute function public.devices_fill_serial();


-- ---------------------------------------------------------------------
--  6. oil_tracking — מעקב שמנים
--  זו האמת ההיסטורית. devices.oil_level_pct הוא רק המצב הנוכחי,
--  והוא מתעדכן מכאן בטריגר — כדי שהיומן והמכשיר לא יוכלו לסתור זה את זה.
--  recorded_by הוא גם עמודת ה"בעלות" של הטכנאי לצורך ה-RLS למטה.
-- ---------------------------------------------------------------------

create table if not exists public.oil_tracking (
  id               uuid primary key default gen_random_uuid(),
  device_id        uuid not null references public.devices (id) on delete cascade,
  event_type       public.oil_event_type not null default 'refill',
  scent_name       text,
  liters_added     numeric(8, 3) not null default 0 check (liters_added >= 0),
  level_before_pct smallint check (level_before_pct between 0 and 100),
  level_after_pct  smallint not null check (level_after_pct between 0 and 100),
  recorded_by      uuid references public.profiles (id) on delete set null default auth.uid(),
  recorded_at      timestamptz not null default now(),
  notes            text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

alter table public.oil_tracking alter column recorded_by set default auth.uid();

-- recorded_by חייב להצביע על profiles ולא ישר על auth.users: PostgREST
-- (ה-API של Supabase) בונה embed כמו recorder:profiles(...) רק כשיש FK
-- ישיר בין שתי הטבלאות. הרצה ראשונה יוצרת את זה נכון; הרצה על בסיס
-- שכבר קיים (עם FK ישן ל-auth.users) מתקנת אותו כאן.
alter table public.oil_tracking drop constraint if exists oil_tracking_recorded_by_fkey;
alter table public.oil_tracking
  add constraint oil_tracking_recorded_by_fkey
  foreign key (recorded_by) references public.profiles (id) on delete set null;

create index if not exists oil_tracking_device_idx      on public.oil_tracking (device_id);
create index if not exists oil_tracking_date_idx        on public.oil_tracking (recorded_at desc);
create index if not exists oil_tracking_recorded_by_idx on public.oil_tracking (recorded_by);

create or replace function public.oil_tracking_sync_device()
returns trigger
language plpgsql
as $$
begin
  update public.devices
     set oil_level_pct = new.level_after_pct,
         scent_name    = coalesce(new.scent_name, scent_name),
         last_seen_at  = greatest(last_seen_at, new.recorded_at)
   where id = new.device_id;
  return new;
end;
$$;

drop trigger if exists oil_tracking_sync_device on public.oil_tracking;
create trigger oil_tracking_sync_device
  after insert on public.oil_tracking
  for each row execute function public.oil_tracking_sync_device();


-- ---------------------------------------------------------------------
--  7. service_calls — קריאות שירות
--  created_by = מי פתח את הקריאה. assigned_to = מי מטפל בה כרגע —
--  לא תמיד אותו אדם, ושניהם רשאים לעדכן את הקריאה (ראו RLS למטה).
-- ---------------------------------------------------------------------

create sequence if not exists public.service_call_seq start 1001;

create table if not exists public.service_calls (
  id           uuid primary key default gen_random_uuid(),
  code         text not null unique
               default ('SC-' || lpad(nextval('public.service_call_seq')::text, 4, '0')),
  customer_id  uuid not null references public.customers (id) on delete restrict,
  device_id    uuid          references public.devices (id)   on delete set null,
  title        text not null,
  description  text,
  severity     public.call_severity not null default 'norm',
  status       public.call_status   not null default 'open',
  assigned_to  uuid references public.profiles (id) on delete set null,
  created_by   uuid references auth.users (id) on delete set null default auth.uid(),
  opened_at    timestamptz not null default now(),
  scheduled_at timestamptz,
  closed_at    timestamptz,
  resolution   text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),

  -- קריאה סגורה חייבת מועד סגירה, וקריאה פתוחה לא יכולה להחזיק אחד.
  -- בלי זה חישוב זמן הסגירה הממוצע משקר בשקט.
  constraint service_calls_closed_at_matches_status check (
    (status in ('resolved', 'cancelled') and closed_at is not null)
    or
    (status in ('open', 'in_progress')   and closed_at is null)
  )
);

alter table public.service_calls
  add column if not exists created_by uuid references auth.users (id) on delete set null;
alter table public.service_calls alter column created_by set default auth.uid();

-- אותו תיקון כמו ב-oil_tracking: assigned_to חייב FK ישיר ל-profiles כדי ש-
-- assignee:profiles(...) יעבוד דרך ה-API. created_by לא מוצג ב-embed באף
-- שאילתה, אז נשאר מצביע על auth.users — אין צורך לשנות אותו.
alter table public.service_calls drop constraint if exists service_calls_assigned_to_fkey;
alter table public.service_calls
  add constraint service_calls_assigned_to_fkey
  foreign key (assigned_to) references public.profiles (id) on delete set null;

create index if not exists service_calls_customer_idx   on public.service_calls (customer_id);
create index if not exists service_calls_device_idx     on public.service_calls (device_id);
create index if not exists service_calls_status_idx     on public.service_calls (status);
create index if not exists service_calls_opened_idx     on public.service_calls (opened_at desc);
create index if not exists service_calls_created_by_idx on public.service_calls (created_by);
create index if not exists service_calls_assigned_idx   on public.service_calls (assigned_to);


-- ---------------------------------------------------------------------
--  8. טריגרי updated_at — על כל חמש הטבלאות, כולל profiles
-- ---------------------------------------------------------------------

do $$
declare t text;
begin
  foreach t in array array['profiles', 'customers', 'devices', 'oil_tracking', 'service_calls']
  loop
    execute format('drop trigger if exists set_updated_at on public.%I', t);
    execute format(
      'create trigger set_updated_at before update on public.%I
       for each row execute function public.set_updated_at()', t);
  end loop;
end $$;


-- =====================================================================
--  9. ROW LEVEL SECURITY — הרשאות מדורגות
--
--  ה-anon key גלוי לכל מי שפותח DevTools. מה שמונע ממנו לשאוב את
--  בסיס הנתונים זה מה שכתוב מכאן ומטה — ולא סודיות המפתח.
--
--  הכלל בכל הטבלאות:
--    • לא מחובר (anon)     — 0 גישה, לא לקריאה ולא לכתיבה.
--    • טכנאי (authenticated) — רואה הכול, מזין נתונים חדשים,
--        ומעדכן/מתקן רק את מה שהוא עצמו יצר (created_by / recorded_by).
--        בקריאות שירות מותר גם למי שמשויך אליו כרגע (assigned_to).
--    • מנהל (role='admin' ב-profiles) — הכול, כולל מחיקה ועדכון
--        של רשומות שאינן שלו.
-- =====================================================================

alter table public.profiles      enable row level security;
alter table public.customers     enable row level security;
alter table public.devices       enable row level security;
alter table public.oil_tracking  enable row level security;
alter table public.service_calls enable row level security;

-- --- profiles: כולם רואים (כדי להציג שם משויך/מתעד בטבלאות),
-- אבל את התפקיד עצמו רק מנהל יכול לשנות. ---

drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles
  for select to authenticated using (true);

drop policy if exists profiles_update on public.profiles;
create policy profiles_update on public.profiles
  for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists profiles_delete on public.profiles;
create policy profiles_delete on public.profiles
  for delete to authenticated using (public.is_admin());

-- --- customers ---

drop policy if exists customers_select on public.customers;
create policy customers_select on public.customers
  for select to authenticated using (true);

drop policy if exists customers_insert on public.customers;
create policy customers_insert on public.customers
  for insert to authenticated with check (created_by = auth.uid());

drop policy if exists customers_update on public.customers;
create policy customers_update on public.customers
  for update to authenticated
  using (created_by = auth.uid() or public.is_admin())
  with check (created_by = auth.uid() or public.is_admin());

drop policy if exists customers_delete on public.customers;
create policy customers_delete on public.customers
  for delete to authenticated using (public.is_admin());

-- --- devices ---

drop policy if exists devices_select on public.devices;
create policy devices_select on public.devices
  for select to authenticated using (true);

drop policy if exists devices_insert on public.devices;
create policy devices_insert on public.devices
  for insert to authenticated with check (created_by = auth.uid());

drop policy if exists devices_update on public.devices;
create policy devices_update on public.devices
  for update to authenticated
  using (created_by = auth.uid() or public.is_admin())
  with check (created_by = auth.uid() or public.is_admin());

drop policy if exists devices_delete on public.devices;
create policy devices_delete on public.devices
  for delete to authenticated using (public.is_admin());

-- --- oil_tracking (recorded_by = עמודת הבעלות) ---

drop policy if exists oil_tracking_select on public.oil_tracking;
create policy oil_tracking_select on public.oil_tracking
  for select to authenticated using (true);

drop policy if exists oil_tracking_insert on public.oil_tracking;
create policy oil_tracking_insert on public.oil_tracking
  for insert to authenticated with check (recorded_by = auth.uid());

drop policy if exists oil_tracking_update on public.oil_tracking;
create policy oil_tracking_update on public.oil_tracking
  for update to authenticated
  using (recorded_by = auth.uid() or public.is_admin())
  with check (recorded_by = auth.uid() or public.is_admin());

drop policy if exists oil_tracking_delete on public.oil_tracking;
create policy oil_tracking_delete on public.oil_tracking
  for delete to authenticated using (public.is_admin());

-- --- service_calls (created_by = פתח את הקריאה, assigned_to = מטפל בה כרגע) ---

drop policy if exists service_calls_select on public.service_calls;
create policy service_calls_select on public.service_calls
  for select to authenticated using (true);

drop policy if exists service_calls_insert on public.service_calls;
create policy service_calls_insert on public.service_calls
  for insert to authenticated with check (created_by = auth.uid());

drop policy if exists service_calls_update on public.service_calls;
create policy service_calls_update on public.service_calls
  for update to authenticated
  using (created_by = auth.uid() or assigned_to = auth.uid() or public.is_admin())
  with check (created_by = auth.uid() or assigned_to = auth.uid() or public.is_admin());

drop policy if exists service_calls_delete on public.service_calls;
create policy service_calls_delete on public.service_calls
  for delete to authenticated using (public.is_admin());


-- =====================================================================
--  10. Realtime (אופציונלי) — קריאה חדשה מהשטח מופיעה אצל המנהל בלי רענון
-- =====================================================================

do $$ begin
  alter publication supabase_realtime add table public.service_calls;
exception when duplicate_object then null; end $$;

do $$ begin
  alter publication supabase_realtime add table public.devices;
exception when duplicate_object then null; end $$;


-- =====================================================================
--  11. הפיכת שני המנהלים למנהלים בפועל
--
--  כל מי שנרשם מקבל אוטומטית role='technician' (טריגר handle_new_user
--  למעלה). אחרי שאתה והשותף שלך נרשמתם למערכת פעם אחת דרך מסך ההתחברות,
--  הריצו כאן — עם כתובות האימייל האמיתיות שלכם — כדי לקבל הרשאת מנהל:
-- =====================================================================

update public.profiles set role = 'admin'
  where id = (select id from auth.users where email = 'Adlimportltd25@gmail.com');

update public.profiles set role = 'admin'
  where id = (select id from auth.users where email = 'Adlimportltd@gmail.com');
