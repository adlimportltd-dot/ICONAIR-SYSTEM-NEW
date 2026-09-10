-- ---------------------------------------------------------------------
--  שלב 26 — "איפוס קו / תחילת עבודה": פותר בעיה אמיתית שהתגלתה במערכת
--  חדשה — כל מכשיר נוצר עם oil_level_pct=100 (ברירת המחדל של הטבלה),
--  אבל מכשיר שמעולם לא קיבל שירות בפועל לא באמת "מלא" — זו רק ברירת-
--  מחדל טכנית, לא תצפית אמיתית מהשטח. בגלל זה getRouteLoadPlan חישב
--  "0 מ״ל למילוי" לכל מכשיר, נכון מתמטית אבל לא נכון עסקית.
--
--  ⚠ למה זה *לא* סותר את הכלל "אף פעם לא לנחש/לאפס מפלס שמן אמיתי":
--  הפונקציה הזו נוגעת אך ורק במכשירים שמעולם לא קיבלו אף רשומת
--  oil_tracking — כלומר בדיוק אותה קבוצת "מכשירים חדשים" שכבר מוצגת
--  בנפרד ב"הכנה לקו" (newDevices ב-getRouteLoadPlan, queries.js). ברגע
--  שמכשיר מקבל ולו רישום שירות אמיתי אחד, הוא יוצא מהקבוצה הזו לצמיתות
--  ואף פעם לא ייגע בו שוב — הפונקציה מוודאת את זה בעצמה בצד השרת
--  (not exists בטבלת oil_tracking), לא סומכת רק על מה שהלקוח שלח.
--
--  גם זה לא UPDATE ישיר על devices.oil_level_pct: זה INSERT אמיתי
--  ל-oil_tracking (event_type='reading', 0 ליטר — לא "מילוי", רק
--  "קריאה" שמצהירה את מצב ההתחלה), עם notes ברור שמסביר שזו קריאת-
--  איפוס אוטומטית — כדי שההיסטוריה תישאר אמיתית ושקופה, לא "תיקון
--  שקט". הטריגר הקיים oil_tracking_sync_device הוא זה שבאמת מעדכן את
--  devices.oil_level_pct בעקבות זה, אותו מנגנון בדיוק כמו כל ביקור אמיתי.
-- ---------------------------------------------------------------------

create or replace function public.reset_route_initial_fill(p_device_ids uuid[])
returns integer
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_count integer;
begin
  if not public.is_admin() then
    raise exception 'רק מנהל יכול לאפס מצב התחלתי לקו';
  end if;

  with targets as (
    select d.id, d.scent_name
      from public.devices d
     where d.id = any(p_device_ids)
       and not exists (select 1 from public.oil_tracking ot where ot.device_id = d.id)
  ), inserted as (
    insert into public.oil_tracking
      (device_id, event_type, scent_name, liters_added, level_before_pct, level_after_pct, notes)
    select id, 'reading', scent_name, 0, 100, 0, 'איפוס התחלתי — הקו טרם עבד בפועל'
      from targets
    returning 1
  )
  select count(*) into v_count from inserted;

  return v_count;
end;
$$;
