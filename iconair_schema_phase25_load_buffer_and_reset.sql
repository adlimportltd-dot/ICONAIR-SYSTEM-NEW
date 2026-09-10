-- ---------------------------------------------------------------------
--  שלב 25 — שלוש הרחבות ללוגיקת "העמסת קו וניהול מלאי", לפי דרישה
--  מפורשת: (1) איפוס חד-פעמי למלאי-נוזל של טכנאי, לקראת המחזור הראשון
--  בלבד; (2) מרווח ביטחון אחוזי מעל החישוב המדויק של הכנה לקו, כדי
--  שטכנאי לא ייתקע בשטח אם לקוח צרך יותר ניחוח מהמתוכנן; (3) פעולת
--  "החזר הכול למחסן" — המערכת כבר יודעת בכל רגע בדיוק כמה נשאר ברכב
--  (technician_stock מנוכה חי בכל ביקור), אז זו רק עטיפה נוחה שמחזירה
--  את הכול בבת אחת, פר שורה, באותה לוגיקה מבוקרת של return_stock_to_warehouse.
--
--  ⚠ קו אדום שלא נחצה כאן, לפי בקשה מפורשת: שום דבר בקובץ הזה לא נוגע
--  ב-devices.oil_level_pct. זה תמיד נשאר המצב האמיתי בשטח, לא איפוס
--  מלאכותי — ר' ההבהרה של המשתמש. "איפוס" כאן = רק technician_stock
--  (הנוזל שמתועד כ"ברכב"), אף פעם לא מפלס שמן במכשיר אצל לקוח.
-- ---------------------------------------------------------------------

-- (2) מרווח ביטחון — אחוז קבוע-לעריכה מעל הכמות המדויקת, לפני המרה
-- לגלונים/בקבוקים. ברירת מחדל 15% — ניתן לעריכה במסך ההגדרות.
alter table public.notification_settings
  add column if not exists route_load_buffer_pct numeric not null default 15
    check (route_load_buffer_pct >= 0 and route_load_buffer_pct <= 100);

-- (1) 'reset' כסוג-תנועה מוכר בספר-החשבונות, נבדל מ-'return' האמיתי
-- (מלאי שחזר פיזית למחסן) — כדי שהיסטוריית המלאי תראה בבירור "כאן
-- אופס המונה לתחילת עבודה", לא "כאן הוחזר מלאי".
alter table public.stock_movements drop constraint if exists stock_movements_movement_type_check;
alter table public.stock_movements add constraint stock_movements_movement_type_check
  check (movement_type = any (array['allocate', 'return', 'field_use', 'reset']));

-- (1) איפוס מלאי-נוזל (לא יחידות-מכשיר!) לטכנאי — לתחילת כל מחזור חדש
-- (חודשי), לא רק פעם אחת. מנהל בלבד. מתעד כל שורה שאופסה כתנועת
-- 'reset' לפני האיפוס, כדי שהמספר הישן לעולם לא ילך לאיבוד.
create or replace function public.reset_technician_stock(p_technician_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_row public.technician_stock;
begin
  if not public.is_admin() then
    raise exception 'רק מנהל יכול לאפס מלאי טכנאי';
  end if;

  for v_row in
    select * from public.technician_stock
     where technician_id = p_technician_id and model is null and quantity > 0
     for update
  loop
    insert into public.stock_movements (movement_type, technician_id, model, scent_name, quantity, created_by)
    values ('reset', p_technician_id, null, v_row.scent_name, v_row.quantity, auth.uid());

    update public.technician_stock set quantity = 0, updated_at = now() where id = v_row.id;
  end loop;
end;
$$;

-- (3) מחזיר את כל מלאי הטכנאי (נוזל + יחידות-מכשיר) למחסן בבת אחת,
-- שורה-שורה, דרך return_stock_to_warehouse הקיימת (אותה בקרת-הרשאה,
-- אותו ספר-חשבונות 'return') — לא לוגיקה חדשה, רק נוחות.
--
-- ⚠ עמיד לשורה בודדת פגומה (התגלה בבדיקה: יש בפרודקשן שורה עם גם model
-- וגם scent_name מלאים ביחד — לא תואם לצורת ה-XOR התקנית; לא ניחשתי
-- איזה מהם נכון, לא נגעתי בה). שורה כזו נדחית ע"י return_stock_to_
-- warehouse עם שגיאה ברורה — התפיסה כאן רק מוודאת שזה מדלג על השורה
-- הבעייתית ורושם אזהרה, ולא מפיל את כל שאר ההחזרה התקינה של הטכנאי.
create or replace function public.return_all_stock_to_warehouse(p_technician_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_row public.technician_stock;
begin
  if not (public.is_admin() or auth.uid() = p_technician_id) then
    raise exception 'רק מנהל או הטכנאי עצמו יכולים לרשום החזרת מלאי';
  end if;

  for v_row in
    select * from public.technician_stock
     where technician_id = p_technician_id and quantity > 0
     for update
  loop
    begin
      perform public.return_stock_to_warehouse(p_technician_id, v_row.model, v_row.scent_name, v_row.quantity);
    exception when others then
      raise warning 'דולג על שורת מלאי לא-תקינה (technician_stock.id=%): %', v_row.id, sqlerrm;
    end;
  end loop;
end;
$$;
