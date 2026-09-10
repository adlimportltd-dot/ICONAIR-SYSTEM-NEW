-- ---------------------------------------------------------------------
--  שלב 27 — "איפוס לתחילת מחזור חדש": מרחיב את reset_route_initial_fill
--  (phase26) ממכשירים-שמעולם-לא-טופלו-בלבד לכלל המכשירים בהיקף שנבחר
--  (קו יחיד או "כל הקווים"). לפי בקשה מפורשת של המשתמש: "בתחילת חודש
--  הכל ריק ודורש מילוי מלא" — ברמת הביזנס הזה, מחזור חדש = כל מכשיר
--  נחשב ריק לצורך תכנון ההעמסה, ללא קשר למה שנצפה בו בפועל במחזור
--  הקודם. זה בכוונה *הופך* את הכלל של phase25/26 ("מכשיר שכבר טופל
--  פעם אחת לעולם לא יאופס שוב") — לא טעות, שינוי מדיניות עסקית מפורש.
--
--  ⚠ עדיין לא UPDATE ישיר על devices.oil_level_pct: בדיוק כמו phase26,
--  זה INSERT אמיתי ל-oil_tracking (event_type='reading', 0 ליטר, לא
--  "מילוי") — כדי שההיסטוריה תישאר שקופה ("כאן בוצע איפוס מחזור ע"י
--  מנהל", לא "המכשיר סתם ירד ל-0% בלי הסבר"). level_before_pct נשמר
--  כמה שהיה בפועל לפני האיפוס, לא נמחק. הטריגר הקיים
--  oil_tracking_sync_device מעדכן את devices.oil_level_pct מכאן, אותו
--  מנגנון בדיוק כמו כל ביקור אמיתי.
--
--  reset_route_initial_fill (phase26) נשארת כפי שהיא, לא נמחקת — פשוט
--  אין קורא לה יותר מה-UI (הוחלפה בפונקציה הזו, שהיא סופרסט שלה: כל
--  מה שהפונקציה הישנה הייתה מאפסת, גם הפונקציה הזו מאפסת, ועוד).
-- ---------------------------------------------------------------------

create or replace function public.reset_route_cycle(p_device_ids uuid[])
returns integer
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_count integer;
begin
  if not public.is_admin() then
    raise exception 'רק מנהל יכול לאפס מחזור עבודה';
  end if;

  with targets as (
    select d.id, d.scent_name, d.oil_level_pct
      from public.devices d
     where d.id = any(p_device_ids)
       and d.status <> 'uninstalled'
  ), inserted as (
    insert into public.oil_tracking
      (device_id, event_type, scent_name, liters_added, level_before_pct, level_after_pct, notes)
    select id, 'reading', scent_name, 0, oil_level_pct, 0,
           'איפוס תחילת מחזור חודשי — המכשיר נחשב ריק עד הביקור הבא בפועל'
      from targets
    returning 1
  )
  select count(*) into v_count from inserted;

  return v_count;
end;
$$;

grant execute on function public.reset_route_cycle(uuid[]) to authenticated;
