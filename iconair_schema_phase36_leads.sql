-- Phase 36 — 2026-09-14, בקשה מפורשת: טאב ניהול לידים (פניות מקמפיין
-- פייסבוק) בתוך המערכת הקיימת, בלי מערכת נפרדת.
--
-- הרשאות במכוון תואמות ל-customers (לא admin-בלבד לגמרי): כל משתמש
-- מחובר יכול ליצור/לראות ליד (טכנאי בשטח עשוי לפגוש ליד פוטנציאלי
-- בעצמו), אבל עדכון/מחיקה — היוצר עצמו או מנהל, מחיקה מלאה רק מנהל.
-- אין כאן שום אינטגרציה אוטומטית עם Meta/Facebook — זו טבלה+ממשק
-- ידניים בלבד (ר' CLAUDE.md: לא בונים "טריגר" לאינטגרציה שלא קיימת).
create table if not exists public.leads (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  full_name text not null,
  phone text,
  city text,
  status text not null default 'new' check (status in ('new', 'contacted', 'converted', 'archived')),
  notes text,
  converted_customer_id uuid references public.customers(id) on delete set null,
  created_by uuid references public.profiles(id)
);

create index if not exists leads_status_idx on public.leads (status);
create index if not exists leads_created_at_idx on public.leads (created_at desc);

alter table public.leads enable row level security;

drop policy if exists leads_select on public.leads;
create policy leads_select on public.leads for select using (true);

drop policy if exists leads_insert on public.leads;
create policy leads_insert on public.leads for insert with check (created_by = auth.uid());

drop policy if exists leads_update on public.leads;
create policy leads_update on public.leads for update
  using (created_by = auth.uid() or is_admin())
  with check (created_by = auth.uid() or is_admin());

drop policy if exists leads_delete on public.leads;
create policy leads_delete on public.leads for delete using (is_admin());

drop trigger if exists leads_set_updated_at on public.leads;
create trigger leads_set_updated_at
  before update on public.leads
  for each row execute function public.set_updated_at();

do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'leads') then
    alter publication supabase_realtime add table public.leads;
  end if;
end $$;
