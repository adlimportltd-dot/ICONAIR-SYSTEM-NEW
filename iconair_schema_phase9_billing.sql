-- ---------------------------------------------------------------------
--  טיוטת סכימה — שלב 9: שדות חיוב/גבייה על customers (סוג תשלום,
--  סכום לתשלום, שולם/לא שולם), כדי להחליף את מעקב הגבייה שהיה
--  בגוגל שיטס.
--
--  ⚠ הצעה בלבד. לא רץ מעולם מול בסיס הנתונים.
--
--  שדות חדשים בלבד, על טבלה קיימת עם נתונים אמיתיים — ADD COLUMN עם
--  ברירת מחדל לא נוגע ולא מוחק אף שורה קיימת; לקוחות קיימים פשוט
--  מקבלים ברירת מחדל (לא שולם, 0 ש"ח, מוזמן) עד שתעדכן אותם ידנית.
--
--  payment_type הוא enum, לא טבלת lookup כמו device_models/scents —
--  בכוונה: אלו 4 שיטות תשלום קבועות (אשראי / העברה / צ'ק / מוזמן),
--  לא רשימה שמנהל אמור להרחיב בעצמו. אם בעתיד כן תרצה להוסיף שיטות
--  תשלום דרך ה-UI, זו תהיה בדיוק אותה מיגרציה שכבר עשינו ל-device_model
--  (enum → טבלה) — תגיד לי ונבנה את זה.
--
--  לא נוגעים ב-RLS הקיים של customers (מי שיכול היום ליצור/לעדכן
--  לקוח יכול לעדכן גם את השדות האלה — לא הוספנו הגבלת "מנהל בלבד"
--  כי זה לא התבקש כאן, ו-RLS על Postgres הוא ברמת שורה, לא ברמת עמודה,
--  כך שלא ניתן להגביל רק את שדות הכסף בלי לוגיקת trigger נפרדת).
-- ---------------------------------------------------------------------

do $$ begin
  create type public.payment_type as enum ('credit_card', 'bank_transfer', 'check', 'deferred');
exception when duplicate_object then null; end $$;

alter table public.customers
  add column if not exists payment_type public.payment_type not null default 'deferred';

alter table public.customers
  add column if not exists amount_due numeric(10,2) not null default 0 check (amount_due >= 0);

alter table public.customers
  add column if not exists is_paid boolean not null default false;
