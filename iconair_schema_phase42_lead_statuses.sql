-- Phase 42 — 2026-09-17, בקשה מפורשת: לאפשר להוסיף סטטוסים נוספים
-- לרשימת הלידים בלי צורך בשינוי קוד בכל פעם, ואפשרות מחיקת ליד.
--
-- 1) טבלת lead_statuses — אותו דפוס בדיוק כמו scents/device_models
-- (רשימה גלובלית ניתנת-להרחבה, name=מפתח פנימי + label=טקסט עברי,
-- active לביטול-זמינות בלי איבוד היסטוריה). ה-4 הסטטוסים הקיימים
-- (phase40) מוזרעים כאן כשורות רגילות בטבלה — לא נמחקים ולא משתנים,
-- רק "מועברים" ממקור-אמת קשיח בקוד למקור-אמת בבסיס הנתונים.
create table if not exists public.lead_statuses (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  label text not null,
  sort_order smallint not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

alter table public.lead_statuses enable row level security;

drop policy if exists lead_statuses_select on public.lead_statuses;
create policy lead_statuses_select on public.lead_statuses for select to authenticated using (true);

drop policy if exists lead_statuses_insert on public.lead_statuses;
create policy lead_statuses_insert on public.lead_statuses for insert to authenticated with check (is_admin());

drop policy if exists lead_statuses_update on public.lead_statuses;
create policy lead_statuses_update on public.lead_statuses for update to authenticated using (is_admin()) with check (is_admin());

drop policy if exists lead_statuses_delete on public.lead_statuses;
create policy lead_statuses_delete on public.lead_statuses for delete to authenticated using (is_admin());

insert into public.lead_statuses (name, label, sort_order) values
  ('new', 'חדש', 1),
  ('in_progress', 'בטיפול', 2),
  ('no_answer', 'אין מענה', 3),
  ('closed_paid', 'סגור - משולם', 4)
on conflict (name) do nothing;

do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'lead_statuses') then
    alter publication supabase_realtime add table public.lead_statuses;
  end if;
end $$;

-- 2) leads.status: מ-CHECK קשיח (phase40, רשימה סגורה בקוד ה-SQL עצמו)
-- לטריגר שמאמת מול lead_statuses בזמן אמת — כדי שסטטוס חדש שנוסף
-- מהאפליקציה יהיה תקף מיד, בלי migration נוספת. 'converted' נשאר מצב-
-- סיום אוטומטי קבוע (לא מנוהל בטבלה, לא נבחר ידנית מהתפריט — ר'
-- convert_lead_to_customer, phase37) ולכן מאושר במפורש כאן גם הוא.
-- בדקתי לפני ההרצה: כל הלידים הקיימים כרגע (status='new' על כולם)
-- תואמים לרשימה הזרועה למעלה — שום שורה לא נפגעת.
alter table public.leads drop constraint if exists leads_status_check;

create or replace function public.validate_lead_status()
returns trigger
language plpgsql
as $function$
begin
  if new.status <> 'converted' and not exists (
    select 1 from public.lead_statuses where name = new.status and active
  ) then
    raise exception 'סטטוס ליד לא תקין או לא פעיל: %', new.status;
  end if;
  return new;
end;
$function$;

drop trigger if exists leads_validate_status on public.leads;
create trigger leads_validate_status
  before insert or update of status on public.leads
  for each row execute function public.validate_lead_status();
