-- ---------------------------------------------------------------------
--  הוספת technician_stock לפרסום ה-Realtime של Supabase.
--
--  ⚠ הצעה בלבד, לא רץ מעולם. בלי זה, גם אחרי שהקוד נטען מחדש, מסך
--  "מלאי נייד" לא יתעדכן בלייב כשטכנאי לוחץ "סיום ביקור" — הטבלה
--  קיימת ומוגנת ב-RLS, אבל שינויים בה לא משודרים ל-Realtime עד
--  שמוסיפים אותה לפרסום, בדיוק כמו ש-devices ו-service_calls כבר
--  נוספו ב-iconair_schema.sql.
-- ---------------------------------------------------------------------

do $$ begin
  alter publication supabase_realtime add table public.technician_stock;
exception when duplicate_object then null; end $$;
