-- ---------------------------------------------------------------------
--  טיוטת סכימה — רשימת ניחוחות גלובלית וקבועה.
--
--  ⚠ הצעה בלבד. לא רץ מעולם מול בסיס הנתונים.
--
--  למה טבלה ולא רשימה קבועה בקוד (כמו DEVICE_MODELS): ביקשת אפשרות
--  ניהולית להוסיף ניחוח חדש בלי לגעת בקוד. דגמי המכשירים הם enum
--  ב-Postgres (משתנה רק במיגרציה); ניחוחות הם טבלה רגילה כדי שהוספה
--  תהיה insert, לא deploy.
--
--  ⚠ שים לב לפני שתריץ — נתונים היסטוריים לא תואמים בול:
--  שדה scent_name בטבלאות devices / oil_tracking / technician_stock
--  נשאר טקסט חופשי כמו שהוא (לא FK לטבלה הזו) — כדי לא לשבור רשומות
--  קיימות. אבל ארבעה ניחוחות שכבר בשימוש בפועל בנתונים שייבאנו
--  *לא* מופיעים ברשימה הרשמית שנתת:
--    - "אמבר קומבי"       — קרוב מאוד ל"אמברקומבי" ברשימה שלך (בלי
--                            רווח). כנראה אותו ניחוח, איות שונה בלבד.
--    - "אקסרגוף", "טלק בייבי", "בוטיק- פור סיזן" — לא דומים לשום דבר
--                            ברשימה, כתובים ג'נרית ע"י המנהל/טכנאי.
--  לא הוספתי אותם לרשימה הרשמית ולא שיניתי היסטוריה — זו החלטה שלך.
--  אחרי שהמסך "ניהול ניחוחות" עולה, קל להוסיף אותם משם אם תרצה.
-- ---------------------------------------------------------------------

create table if not exists public.scents (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null default '00000000-0000-0000-0000-000000000001',
  name       text not null unique,
  active     boolean not null default true,
  created_at timestamptz not null default now()
);

alter table public.scents enable row level security;

drop policy if exists scents_select on public.scents;
create policy scents_select on public.scents
  for select to authenticated using (true);

-- הוספה/עריכה/מחיקה ניהוליות בלבד — זה בדיוק מה שביקשת ("אפשרות ניהולית").
drop policy if exists scents_insert on public.scents;
create policy scents_insert on public.scents
  for insert to authenticated with check (public.is_admin());

drop policy if exists scents_update on public.scents;
create policy scents_update on public.scents
  for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists scents_delete on public.scents;
create policy scents_delete on public.scents
  for delete to authenticated using (public.is_admin());


-- =====================================================================
--  זריעת 30 הניחוחות הרשמיים. idempotent — הרצה חוזרת לא יוצרת כפילות.
-- =====================================================================

insert into public.scents (name) values
  ('בראשית'), ('מלון בוטיק'), ('פתאל'), ('כרמים'), ('רויאל ביץ'),
  ('הילטון'), ('אסטוריה'), ('קדמא'), ('ספורט'), ('ויקטוריה'),
  ('דלתא'), ('קסטרו'), ('נאוטיקה'), ('אמברקומבי'), ('דיור'),
  ('סרג׳וף'), ('סקסי'), ('לטינו'), ('דולצ׳ה'), ('קריד'),
  ('תומס 4'), ('טופ פורד'), ('מוסטנג'), ('בלאק ונילה'), ('פצ׳ולי'),
  ('בלאק יסמין'), ('לבנדר'), ('מאסק'), ('גרין תה'), ('לנור')
on conflict (name) do nothing;
