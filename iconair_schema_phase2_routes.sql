-- ---------------------------------------------------------------------
--  טיוטת סכימה — שלב 2 של ניהול מסלולים (routes / route_assignments).
--
--  ⚠ זו הצעה בלבד. הקובץ הזה לא רץ מעולם מול בסיס הנתונים ולא נבדק
--  מול Postgres חי. אל תריץ אותו לפני שאישרת את המבנה — הוא כתוב כדי
--  לתמוך במסך RoutesScreen.jsx הקיים (שכרגע מנהל הכול בזיכרון, בלי
--  שמירה), לא כשינוי שכבר שולב בקוד.
--
--  tenant_id בכל טבלה: לא בונה multi-tenant עכשיו, רק מונע migration
--  כואבת אם המערכת תשמש ארגון נוסף בעתיד. ערך קבוע אחד להיום.
-- ---------------------------------------------------------------------

create table if not exists public.routes (
  id                 uuid primary key default gen_random_uuid(),
  tenant_id          uuid not null default '00000000-0000-0000-0000-000000000001',
  name               text not null unique,           -- "קו חיפה והסביבה", תואם customers.route_name
  region             text,                            -- לסינון/תצוגה בלבד, לא לוגיקה
  default_driver_id  uuid references auth.users (id) on delete set null,
  active             boolean not null default true,
  created_at         timestamptz not null default now()
);

create table if not exists public.route_assignments (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null default '00000000-0000-0000-0000-000000000001',
  customer_id  uuid not null references public.customers (id) on delete cascade,
  route_id     uuid references public.routes (id) on delete set null,
  driver_id    uuid references auth.users (id) on delete set null,
  visit_date   date not null,
  stop_order   smallint not null,      -- מה ש-RoutesScreen מנהל היום רק ב-state מקומי
  status       text not null default 'pending'
               check (status in ('pending', 'done', 'skipped')),
  created_by   uuid references auth.users (id) on delete set null default auth.uid(),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),

  unique (customer_id, visit_date)
);

create index if not exists route_assignments_driver_date_idx
  on public.route_assignments (driver_id, visit_date);
create index if not exists route_assignments_route_idx
  on public.route_assignments (route_id);

-- RLS: לא כתוב בקובץ הזה במכוון — ר' iconair_schema_phase2_routes_rls.sql,
-- קובץ נפרד שכבר רץ בהצלחה.
