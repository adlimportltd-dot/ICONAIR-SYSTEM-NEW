-- Phase 44 — 2026-09-22, בקשה מפורשת: "מודול הפקת הצעות מחיר מתקדם"
-- מתוך כרטיס הליד. אותה תבנית בדיוק כמו service_reports (phase21) —
-- PDF ממותג נוצר בדפדפן (html2canvas+jsPDF), מועלה ל-Storage, ונרשם
-- כאן. items/subtotal/vat_amount/total הם "תמונת מצב" בכוונה (כמו
-- customer_name וכו' ב-service_reports) — כדי שהצעה שכבר נשלחה לא
-- תשתנה בדיעבד אם מודל/מחיר עתידי משתנה, ושתישאר קריאה גם אם הליד עצמו נמחק.
create table if not exists public.lead_quotes (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid references public.leads(id) on delete set null,
  created_by uuid references public.profiles(id) on delete set null,

  lead_name text not null,
  items jsonb not null default '[]'::jsonb,
  subtotal numeric not null default 0,
  vat_amount numeric not null default 0,
  total numeric not null default 0,

  file_path text not null,
  created_at timestamptz not null default now()
);

create index if not exists lead_quotes_lead_id_idx on public.lead_quotes (lead_id);
create index if not exists lead_quotes_created_at_idx on public.lead_quotes (created_at desc);

alter table public.lead_quotes enable row level security;

-- מחירים/הצעות הן מידע עסקי — בכוונה מחמירים יותר מ-leads_select עצמה
-- (שפתוחה גם ל-anon, ר' phase36), ל-authenticated בלבד, כמו רוב שאר המערכת.
drop policy if exists lead_quotes_select on public.lead_quotes;
create policy lead_quotes_select on public.lead_quotes for select to authenticated using (true);

drop policy if exists lead_quotes_insert on public.lead_quotes;
create policy lead_quotes_insert on public.lead_quotes for insert to authenticated with check (created_by = auth.uid());

drop policy if exists lead_quotes_delete on public.lead_quotes;
create policy lead_quotes_delete on public.lead_quotes for delete to authenticated using (is_admin());

-- אותה תבנית בדיוק כמו service-reports/contracts: bucket ציבורי + נתיב
-- לא-ניתן-לניחוש (uuid/uuid.pdf) הוא ההגנה בפועל, לא ה-RLS על ה-URL עצמו.
insert into storage.buckets (id, name, public)
values ('lead-quotes', 'lead-quotes', true)
on conflict (id) do nothing;

drop policy if exists lead_quotes_storage_insert on storage.objects;
create policy lead_quotes_storage_insert on storage.objects
  for insert with check (
    bucket_id = 'lead-quotes'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists lead_quotes_storage_select on storage.objects;
create policy lead_quotes_storage_select on storage.objects
  for select using (
    bucket_id = 'lead-quotes'
    and (is_admin() or (storage.foldername(name))[1] = auth.uid()::text)
  );

drop policy if exists lead_quotes_storage_delete on storage.objects;
create policy lead_quotes_storage_delete on storage.objects
  for delete using (bucket_id = 'lead-quotes' and is_admin());
