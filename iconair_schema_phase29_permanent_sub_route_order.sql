-- Phase 29 — 2026-09-13, בקשה מפורשת: חלוקת קו חיפה (68 עצירות) לתתי-קווים
-- "רשמית", לא רק להיום.
--
-- הבעיה שהתגלתה: sub_route_id ו-stop_order גרים על route_assignments,
-- שהוא שכבת-עריכה *לפי visit_date* (ר' upsert_route_stop) — כל תאריך
-- שנפתח לראשונה מקבל שורות חדשות עם sub_route_id=null וסדר שרירותי
-- (alphabetical מ-listStopsByRoute). בפועל: 23 עצירות ששויכו ל"חיפה-דרום"
-- ב-09-11/09-12 כבר אופסו ל-null בתאריך 09-13 בלי שום שינוי קוד נוסף —
-- זה לא היה תקלה חד-פעמית, זו ההתנהגות המתוכננת של route_assignments.
--
-- הפתרון: sub_route_id + route_position הופכים לתכונה *קבועה* של הלקוח/
-- האתר (בדיוק כמו customers.route_name הקבוע) — לא עוד "עריכה יומית".
-- route_assignments עדיין קיים ועדיין ניתן לעריכה יומית (גרירה/מיון/
-- Google-optimize ממשיכים לעבוד בדיוק כמו קודם, ר' queries.js), אבל כל
-- תאריך *חדש* עכשיו נזרע מהערך הקבוע במקום מברירת מחדל שרירותית —
-- כך שהחלוקה שנקבעת פעם אחת ממשיכה לחול בכל יום, גם בלי גרירה מחדש.
create extension if not exists pgcrypto;

alter table public.customers
  add column if not exists sub_route_id uuid references public.sub_routes(id) on delete set null,
  add column if not exists route_position smallint;

alter table public.customer_sites
  add column if not exists sub_route_id uuid references public.sub_routes(id) on delete set null,
  add column if not exists route_position smallint;

-- upsert_route_stop מקבל עכשיו גם p_sub_route_id (ברירת מחדל null, לא
-- שובר קריאות קיימות) — נזרע רק ב-INSERT הראשוני; ב-conflict (השורה כבר
-- קיימת) לא נוגעים ב-sub_route_id, בדיוק כמו ש-status לא נוגע היום,
-- כדי לא לדרוס שיוך יומי-ספציפי שכבר נעשה ידנית לתאריך הזה.
--
-- חשוב: create or replace עם חתימה שונה (פרמטר חדש) לא מחליף את
-- הפונקציה הישנה ב-Postgres — הוא יוצר עומס-יתר (overload) חדש לצידה,
-- מה ש-PostgREST/Supabase RPC עלול לפתור בעמימות. יש להריץ אחריו:
--   drop function if exists public.upsert_route_stop(uuid, uuid, uuid, date, smallint);
-- כדי שתישאר גרסה יחידה (6 פרמטרים) — כך הוחל בפועל ב-2026-09-13.
create or replace function public.upsert_route_stop(
  p_customer_id uuid,
  p_site_id uuid,
  p_route_id uuid,
  p_visit_date date,
  p_stop_order smallint,
  p_sub_route_id uuid default null
)
returns route_assignments
language plpgsql
as $function$
declare
  v_row public.route_assignments;
begin
  if p_site_id is null then
    insert into public.route_assignments (customer_id, site_id, route_id, visit_date, stop_order, status, sub_route_id)
    values (p_customer_id, null, p_route_id, p_visit_date, p_stop_order, 'pending', p_sub_route_id)
    on conflict (customer_id, visit_date) where site_id is null
    do update set stop_order = excluded.stop_order, route_id = excluded.route_id
    returning * into v_row;
  else
    insert into public.route_assignments (customer_id, site_id, route_id, visit_date, stop_order, status, sub_route_id)
    values (p_customer_id, p_site_id, p_route_id, p_visit_date, p_stop_order, 'pending', p_sub_route_id)
    on conflict (site_id, visit_date) where site_id is not null
    do update set stop_order = excluded.stop_order, route_id = excluded.route_id
    returning * into v_row;
  end if;

  return v_row;
end;
$function$;
