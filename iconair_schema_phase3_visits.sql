-- ---------------------------------------------------------------------
--  טיוטת סכימה — שלב 3: "סיום ביקור" אטומי + מלאי נייד לטכנאי.
--
--  ⚠ הצעה בלבד. לא רץ מעולם מול בסיס הנתונים. כמו הקבצים הקודמים —
--  קרא, אשר, ורק אז הרץ.
--
--  מה שכבר קיים ולא נוגעים בו: oil_tracking הוא כבר "יומן ביקור" —
--  כל insert אליו כבר מעדכן אוטומטית את המכשיר (טריגר
--  oil_tracking_sync_device, קיים). מה שחסר הוא: (1) ירידת מלאי
--  נייד באותה טרנזקציה, אטומית, כדי שלא יהיה מצב של רישום ביקור
--  בלי שהמלאי ירד, ו-(2) שיוגד. שני אלה — בקובץ הזה.
--
--  tenant_id: כמו בשלב 2 (routes) — לא בונה multi-tenant, רק מונע
--  migration כואבת אם יום אחד תרצה ארגון שני. ערך קבוע אחד להיום.
-- ---------------------------------------------------------------------

-- =====================================================================
--  1. מלאי נייד — כמה יחידות מכל דגם/ניחוח יש לטכנאי ברכב עכשיו.
--  לא ליטרים — יחידות (בלוני שמן/ניחוח שלמים). דיספאצ'ר טוען את
--  הרכב בבוקר ומזין כאן; הטכנאי רק צורך דרך complete_visit למטה,
--  אף פעם לא כותב לטבלה הזו ישירות.
-- =====================================================================

create table if not exists public.technician_stock (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null default '00000000-0000-0000-0000-000000000001',
  technician_id  uuid not null references public.profiles (id) on delete cascade,
  model          public.device_model not null,
  scent_name     text not null default '',   -- '' ולא null, כדי שהאינדקס הייחודי למטה יעבוד
  quantity       integer not null default 0 check (quantity >= 0),
  updated_at     timestamptz not null default now()
);

create unique index if not exists technician_stock_unique_idx
  on public.technician_stock (technician_id, model, scent_name);

alter table public.technician_stock enable row level security;

drop policy if exists technician_stock_select on public.technician_stock;
create policy technician_stock_select on public.technician_stock
  for select to authenticated
  using (technician_id = auth.uid() or public.is_admin());

-- טכנאי לא יוצר/מוחק שורות מלאי — רק דיספאצ'ר/מנהל טוען רכב.
drop policy if exists technician_stock_insert on public.technician_stock;
create policy technician_stock_insert on public.technician_stock
  for insert to authenticated with check (public.is_admin());

-- update כן פתוח לטכנאי על השורה שלו: complete_visit למטה מריץ
-- update על technician_stock בתור אותו משתמש (אין security definer),
-- אז ה-RLS הזו היא מה שבפועל מרשה לו לצרוך מהמלאי שלו.
drop policy if exists technician_stock_update on public.technician_stock;
create policy technician_stock_update on public.technician_stock
  for update to authenticated
  using (technician_id = auth.uid() or public.is_admin())
  with check (technician_id = auth.uid() or public.is_admin());

drop policy if exists technician_stock_delete on public.technician_stock;
create policy technician_stock_delete on public.technician_stock
  for delete to authenticated using (public.is_admin());


-- =====================================================================
--  2. complete_visit — "סיום ביקור" אטומי.
--
--  לא security definer במכוון: רץ בתור המשתמש שקרא לה, כדי ש-RLS
--  הרגיל על oil_tracking ו-technician_stock ימשיך לחול בדיוק כמו
--  היום. אם אין מספיק מלאי — הפונקציה זורקת שגיאה, וה-insert
--  ל-oil_tracking לא קורה בכלל (טרנזקציה אחת, הכול-או-כלום).
-- =====================================================================

create or replace function public.complete_visit(
  p_device_id        uuid,
  p_event_type       public.oil_event_type,
  p_scent_name       text,
  p_liters_added     numeric,
  p_level_before_pct smallint,
  p_level_after_pct  smallint,
  p_notes            text default null
)
returns public.oil_tracking
language plpgsql
as $$
declare
  v_model      public.device_model;
  v_scent_key  text := coalesce(p_scent_name, '');
  v_stock_row  public.technician_stock;
  v_entry      public.oil_tracking;
begin
  select model into v_model from public.devices where id = p_device_id;
  if v_model is null then
    raise exception 'מכשיר לא נמצא: %', p_device_id;
  end if;

  -- נועל את שורת המלאי כדי שלא יקרה מרוץ בין שני ביקורים שנרשמים
  -- באותו רגע (לא סביר לטכנאי אחד, אבל בטוח שלא כואב).
  select * into v_stock_row
    from public.technician_stock
   where technician_id = auth.uid() and model = v_model and scent_name = v_scent_key
   for update;

  if v_stock_row is null or v_stock_row.quantity < 1 then
    raise exception 'אין מלאי נייד ל-% / % — לא ניתן לסיים ביקור', v_model, coalesce(nullif(p_scent_name, ''), 'ללא ניחוח');
  end if;

  update public.technician_stock
     set quantity = quantity - 1, updated_at = now()
   where id = v_stock_row.id;

  insert into public.oil_tracking
    (device_id, event_type, scent_name, liters_added, level_before_pct, level_after_pct, notes)
  values
    (p_device_id, p_event_type, p_scent_name, p_liters_added, p_level_before_pct, p_level_after_pct, p_notes)
  returning * into v_entry;

  -- הטריגר הקיים oil_tracking_sync_device כבר רץ אוטומטית ומעדכן
  -- את המכשיר (oil_level_pct, scent_name, last_seen_at) — לא כתוב כאן.

  return v_entry;
end;
$$;

grant execute on function public.complete_visit(
  uuid, public.oil_event_type, text, numeric, smallint, smallint, text
) to authenticated;


-- =====================================================================
--  3. התראה לאדמין — טריגר על oil_tracking שקורא ל-Edge Function דרך
--  webhook. הערוץ הראשי כבר קיים ועובד: useRealtime ב-App מאזין ל-
--  'devices' ו-'service_calls'; מסך אדמין שיאזין גם ל-'oil_tracking'
--  יקבל את זה מיידית בלי שום דבר נוסף. הטריגר הזה הוא בשביל ערוץ
--  שני — וואטסאפ — שדורש קפיצה החוצה מ-Postgres.
--
--  ⚠ שני מילויים לפני שזה עובד:
--    1. הרחב את pg_net (Database → Extensions → pg_net, בלוח הבקרה
--       של Supabase — לא ניתן מ-SQL Editor רגיל בכל התוכניות).
--    2. מלא את שני ה-placeholder-ים למטה: כתובת ה-Edge Function
--       שתפרוס (סעיף 4), וסוד משותף לאימות הקריאה. לא ניחשתי כלום
--       — אין לי את הכתובת או את הסוד שלך.
-- =====================================================================

create extension if not exists pg_net;

create or replace function public.notify_visit_webhook()
returns trigger
language plpgsql
as $$
declare
  v_payload jsonb;
begin
  select jsonb_build_object(
    'oil_tracking_id', new.id,
    'device_id',        new.device_id,
    'device_serial',    d.serial,
    'customer_name',    c.name,
    'technician_name',  p.full_name,
    'event_type',       new.event_type,
    'scent_name',       new.scent_name,
    'level_after_pct',  new.level_after_pct,
    'recorded_at',      new.recorded_at
  )
  into v_payload
  from public.devices d
  join public.customers c on c.id = d.customer_id
  left join public.profiles p on p.id = new.recorded_by
  where d.id = new.device_id;

  perform net.http_post(
    url     := 'REPLACE_ME_EDGE_FUNCTION_URL',      -- למשל https://<project>.supabase.co/functions/v1/visit-notify
    headers := jsonb_build_object(
                 'Content-Type', 'application/json',
                 'Authorization', 'Bearer REPLACE_ME_SHARED_SECRET'
               ),
    body    := v_payload
  );

  return new;
end;
$$;

drop trigger if exists oil_tracking_notify_webhook on public.oil_tracking;
create trigger oil_tracking_notify_webhook
  after insert on public.oil_tracking
  for each row execute function public.notify_visit_webhook();
