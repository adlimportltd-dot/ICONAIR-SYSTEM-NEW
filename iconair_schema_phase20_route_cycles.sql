-- ---------------------------------------------------------------------
--  שלב 20 — מחזוריות קווים חודשית: כל קו רץ מה-1 לחודש עד יום-סיום
--  קבוע (10–12), עם התראת "הכנה לקו" מחושבת (לא cron) לקראת המחזור הבא.
--
--  ⚠ למה לא pg_cron: הבדיקה הראתה שההרחבה קיימת אבל לא מותקנת בפרויקט
--  הזה. אפשר להתקין ולתזמן job, אבל זה מוסיף רכיב-רקע נוסף לניטור,
--  רגיש לאזור-זמן (pg_cron רץ ב-UTC כברירת מחדל), ודורש טבלת-התראות
--  נוספת + לוגיקת "קריאה/לא-נקרא". התראה מחושבת בזמן טעינה (היום ≥ 25
--  בחודש → מציגים באנר) נותנת בדיוק את אותה תוצאה למשתמש — "המערכת
--  מתריעה" — בלי הרכיב הנוסף, ולא יכולה "לפספס" הרצה כמו job שנתקע.
-- ---------------------------------------------------------------------

alter table public.routes
  add column if not exists cycle_start_day smallint not null default 1,
  add column if not exists cycle_end_day smallint not null default 12;

alter table public.routes
  drop constraint if exists routes_cycle_days_check;
alter table public.routes
  add constraint routes_cycle_days_check
  check (cycle_start_day between 1 and 28 and cycle_end_day between cycle_start_day and 28);
