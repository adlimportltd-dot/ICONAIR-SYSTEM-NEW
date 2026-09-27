-- Phase 47 — קלרה: פרופיל מוצר מהקטלוג + פסקול לרילז + שיגור ישיר, 2026-09-28.
--
-- להרצה ב-Supabase SQL Editor אחרי phase46. בטוח להריץ שוב (idempotent).
-- תוספתי בלבד: עמודות חדשות (nullable) על טבלאות הקטלוג הקיימות — שום
-- עמודה קיימת לא משתנה, ומסך "ניהול מלאי" ממשיך לעבוד בדיוק כמו קודם.
--
-- למה: בקטלוג (scents / device_models) יש רק שמות. כדי שקלרה תכתוב על מוצר
-- אמיתי — ולא תמציא תווי ריח או שטחי כיסוי — יש לכל מוצר "פרופיל" שממלאים
-- פעם אחת (מתוך לשונית קלרה), והוא נשלף אוטומטית בכל יצירת תוכן.

/* ============================== פרופיל ריח ============================== */

alter table public.scents
  add column if not exists description text,          -- משפט-שניים בשפה שיווקית
  add column if not exists notes_top text,            -- תווי ראש (למשל: הדרים, ברגמוט)
  add column if not exists notes_heart text,          -- תווי לב
  add column if not exists notes_base text,           -- תווי בסיס
  add column if not exists mood text,                 -- אווירה (רענן / חם / יוקרתי ...)
  add column if not exists best_for text;             -- לאן מתאים (לובי, חנות אופנה, בית ...)

/* ============================== פרופיל דגם ============================== */

alter table public.device_models
  add column if not exists description text,
  add column if not exists coverage_m2 int check (coverage_m2 is null or coverage_m2 > 0),
  add column if not exists features text,             -- יכולות (טיימר, אפליקציה, שקט ...)
  add column if not exists best_for text;

/* ============================== משימה ותוכן ============================== */

alter table public.clara_batches
  add column if not exists scent_ids uuid[] not null default '{}',
  add column if not exists device_model_ids uuid[] not null default '{}',
  add column if not exists soundtrack text not null default 'calm';  -- preset id | none | URL של קובץ שהועלה

alter table public.clara_content
  add column if not exists soundtrack text not null default 'calm',
  add column if not exists scent_ids uuid[] not null default '{}',
  add column if not exists device_model_ids uuid[] not null default '{}';

-- קבצי שמע שמעלים לפסקול — אותו bucket ציבורי של קלרה (כבר מוגדר ב-phase46).
-- אין שינוי policies: העלאה מותרת לכל משתמש מחובר, מחיקה למנהל.
