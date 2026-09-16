-- Phase 38 — 2026-09-16, בקשה מפורשת: מרכז מעקב + התראות להערות שטח
-- שהטכנאים מקלידים בזמן ביקור. ההערות עצמן כבר קיימות וכבר נשמרות
-- לצמיתות ב-oil_tracking.notes (יחד עם device_id/recorded_by/recorded_at,
-- שמהם נגזרים לקוח/קו/שעה/תאריך) — הטבלה הזו לא כפילה ולא נגעה בזה.
--
-- מה שחסר הוא רק מנגנון "טופל/לא טופל". טבלה נפרדת ומינימלית — לא
-- ALTER על oil_tracking, אין עמודה חדשה שם, שום שורה קיימת לא נוגעת.
-- שורה כאן = "ההערה הזו (לפי מזהה oil_tracking) כבר טופלה". העדר שורה =
-- "עדיין פתוחה". מחיקת השורה = פתיחה מחדש.
create table if not exists public.field_note_flags (
  oil_tracking_id uuid primary key references public.oil_tracking(id) on delete cascade,
  resolved_at timestamptz not null default now(),
  resolved_by uuid references public.profiles(id) default auth.uid()
);

alter table public.field_note_flags enable row level security;

drop policy if exists field_note_flags_select on public.field_note_flags;
create policy field_note_flags_select on public.field_note_flags for select using (true);

-- סימון-טופל/פתיחה-מחדש הן פעולות ניהוליות (טריאז' של הערות שטח) — מנהל בלבד.
drop policy if exists field_note_flags_insert on public.field_note_flags;
create policy field_note_flags_insert on public.field_note_flags for insert with check (is_admin());

drop policy if exists field_note_flags_update on public.field_note_flags;
create policy field_note_flags_update on public.field_note_flags for update using (is_admin()) with check (is_admin());

drop policy if exists field_note_flags_delete on public.field_note_flags;
create policy field_note_flags_delete on public.field_note_flags for delete using (is_admin());

do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'field_note_flags') then
    alter publication supabase_realtime add table public.field_note_flags;
  end if;
end $$;
