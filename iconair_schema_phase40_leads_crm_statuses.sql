-- Phase 40 — 2026-09-17, בקשה מפורשת: שדרוג טאב הלידים ל"מערכת CRM
-- ניהולית" — סטטוסים שמשקפים תהליך מכירה אמיתי, לא רק "התקבל/הומר".
--
-- מחליף את רשימת הסטטוסים הישנה (new/contacted/converted/archived)
-- ברשימה שהוגדרה במפורש: new/in_progress/no_answer/closed_paid,
-- ומשאיר את 'converted' כמצב-סיום אוטומטי נפרד (נקבע רק ע"י
-- convert_lead_to_customer, phase37 — לא נבחר ידנית מהתפריט, בדיוק
-- כמו קודם). בדקתי לפני ההרצה: יש כרגע ליד אמיתי אחד בטבלה
-- (Lior Kahanski, status='new') — נשאר תקין תחת האילוץ החדש, שום
-- שורה לא נמחקת/משתנה.
alter table public.leads drop constraint if exists leads_status_check;
alter table public.leads add constraint leads_status_check
  check (status in ('new', 'in_progress', 'no_answer', 'closed_paid', 'converted'));
