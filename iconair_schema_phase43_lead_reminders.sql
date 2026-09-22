-- Phase 43 — 2026-09-22, בקשה מפורשת: "ניהול תזכורות ופולו-אפ חכם"
-- במסך הלידים. עד עכשיו תאריך/שעה לחזרה ללקוח (למשל "לחזור אליו ב-24/9
-- בשעה 11:00") נכתב חופשי בתוך "הערות מעקב" — אין דרך לסנן/להבליט לפיו.
--
-- שני עמודות בלבד, שתיהן nullable (לא כל ליד צריך תזכורת) — לא נוגע
-- בשום שורה/עמודה קיימת ב-leads (ר' חוק הברזל: עבודה כירורגית בלבד).
alter table public.leads
  add column if not exists reminder_date date,
  add column if not exists reminder_time time;

-- שעה בלי תאריך היא מצב חסר-משמעות (למה שעה בלי יום?) — מונע קלט שגוי
-- מוקדם, ב-DB ולא רק בטופס.
alter table public.leads drop constraint if exists leads_reminder_time_requires_date;
alter table public.leads
  add constraint leads_reminder_time_requires_date
  check (reminder_time is null or reminder_date is not null);

-- אינדקס חלקי (רק שורות עם תזכורת בפועל) — לסינון/מיון מהיר ב"תזכורות
-- פעילות" במסך, בלי לנפח אינדקס על עמודה שרוב השורות בה NULL.
create index if not exists leads_reminder_date_idx
  on public.leads (reminder_date)
  where reminder_date is not null;
