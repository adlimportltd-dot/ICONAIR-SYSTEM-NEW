-- Phase 30 — 2026-09-14, בעקבות תקלה אמיתית: תחנות היום (2026-09-14)
-- נוצרו עם sub_route_id=null וסדר אלפביתי, למרות ש-phase29 כבר תוקן
-- ונפרס בהצלחה (אומת בבנדל החי). הסבר סביר: מכשיר/טאב שנשאר פתוח
-- מאתמול המשיך להריץ קוד JS ישן בזיכרון (SPA לא מרענן סקריפטים בלי
-- ניווט/רענון בפועל) וקרא ל-upsert_route_stop בלי p_sub_route_id.
--
-- התיקון ב-phase29 הסתמך על שהקליינט (JS) תמיד ישלח את הערכים הנכונים
-- — תלות שברירית מול מכשירים שלא התרעננו. הפתרון החזק יותר: להעביר את
-- ברירת המחדל ל-DB עצמו, ברמת טריגר על route_assignments — כך שכל
-- הכנסה חדשה (מכל קליינט, ישן או חדש, מהטלפון או מהמחשב) תקבל את
-- השיוך/הסדר הקבועים מהלקוח/האתר, בלי תלות בגרסת הקוד שרצה בדפדפן.
--
-- פועל רק על INSERT חדש (לא UPDATE) — לא נוגע בשינוי-יומי מכוון (כמו
-- הסרת שיוך דרך assignStopToSubRoute), רק בברירת המחדל של שורה חדשה.
create or replace function public.seed_route_assignment_defaults()
returns trigger
language plpgsql
as $function$
declare
  v_sub_route_id uuid;
  v_position smallint;
begin
  if new.site_id is not null then
    select sub_route_id, route_position into v_sub_route_id, v_position
    from public.customer_sites where id = new.site_id;
  else
    select sub_route_id, route_position into v_sub_route_id, v_position
    from public.customers where id = new.customer_id;
  end if;

  if new.sub_route_id is null and v_sub_route_id is not null then
    new.sub_route_id := v_sub_route_id;
  end if;

  if v_position is not null then
    new.stop_order := v_position;
  end if;

  return new;
end;
$function$;

drop trigger if exists route_assignments_seed_defaults on public.route_assignments;
create trigger route_assignments_seed_defaults
  before insert on public.route_assignments
  for each row execute function public.seed_route_assignment_defaults();
