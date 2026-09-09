-- ---------------------------------------------------------------------
--  שלב 21 — דוחות שירות PDF אוטומטיים + התראות ניהוליות בזמן אמת.
--
--  כל שורה ב-service_reports נוצרת ע"י הדפדפן של הטכנאי מיד אחרי
--  ש-complete_visit/createOilEntry הצליחו: מייצר PDF ממותג (html2canvas
--  + jsPDF, בצד הלקוח — כדי שעברית/RTL ייצאו נכון בלי היתקלות בבעיות
--  shaping של פונט בשרת), מעלה ל-Storage, ורושם שורה כאן. שדות "תמונת
--  מצב" (customer_name, device_model וכו') משוכפלים בכוונה מהמקור —
--  כדי שדוח לא ישתנה בדיעבד אם הלקוח שינה שם/כתובת אחר כך, ושדוח לא
--  ייעלם אם המכשיר/לקוח נמחקו (on delete set null, לא cascade).
--
--  ⚠ שליחת מייל אוטומטית ללקוח: לא כלול כאן. אין בפרויקט הזה חשבון/
--  מפתח ל-שירות שליחת מייל אמיתי (Resend/SendGrid/SES וכו') — בניית
--  "שליחה" בלי ספק אמיתי הייתה בדיוק סוג ה-"אינטגרציה בדיונית" שכבר
--  הוחלט לא לבנות (ר' CLAUDE.md). ה-UI נותן קישור ציבורי אמיתי ל-PDF
--  + כפתור "פתח באימייל" (mailto: אמיתי, הטכנאי/מנהל שולח בעצמו).
-- ---------------------------------------------------------------------

create table if not exists public.service_reports (
  id uuid primary key default gen_random_uuid(),
  oil_tracking_id uuid not null references public.oil_tracking(id) on delete cascade,
  device_id uuid references public.devices(id) on delete set null,
  customer_id uuid references public.customers(id) on delete set null,
  technician_id uuid references public.profiles(id) on delete set null,

  customer_name text not null,
  customer_address text,
  customer_email text,
  device_model text,
  device_serial text,
  scent_name text,
  event_type public.oil_event_type not null,
  liters_added numeric not null default 0,
  level_before_pct smallint,
  level_after_pct smallint not null,
  notes text,
  technician_name text,

  file_path text not null,
  created_at timestamptz not null default now(),

  unique (oil_tracking_id)
);

create index if not exists service_reports_created_at_idx
  on public.service_reports (created_at desc);

alter table public.service_reports enable row level security;

drop policy if exists service_reports_select on public.service_reports;
create policy service_reports_select on public.service_reports
  for select using (is_admin() or technician_id = auth.uid());

drop policy if exists service_reports_insert on public.service_reports;
create policy service_reports_insert on public.service_reports
  for insert with check (technician_id = auth.uid() or is_admin());

drop policy if exists service_reports_delete on public.service_reports;
create policy service_reports_delete on public.service_reports
  for delete using (is_admin());

-- בזמן-אמת לפעמון ההתראות של המנהל — ר' listRecentServiceReports ב-queries.js
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
     where pubname = 'supabase_realtime' and tablename = 'service_reports'
  ) then
    alter publication supabase_realtime add table public.service_reports;
  end if;
end $$;

-- אותה תבנית בדיוק כמו contracts/branding: bucket ציבורי + נתיב לא-ניתן-לניחוש
-- (uuid/uuid.pdf) הוא שכבת ההגנה בפועל, לא ה-RLS על נתיב ה-public URL.
insert into storage.buckets (id, name, public)
values ('service-reports', 'service-reports', true)
on conflict (id) do nothing;

drop policy if exists service_reports_storage_insert on storage.objects;
create policy service_reports_storage_insert on storage.objects
  for insert with check (
    bucket_id = 'service-reports'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists service_reports_storage_select on storage.objects;
create policy service_reports_storage_select on storage.objects
  for select using (
    bucket_id = 'service-reports'
    and (is_admin() or (storage.foldername(name))[1] = auth.uid()::text)
  );

drop policy if exists service_reports_storage_delete on storage.objects;
create policy service_reports_storage_delete on storage.objects
  for delete using (bucket_id = 'service-reports' and is_admin());
