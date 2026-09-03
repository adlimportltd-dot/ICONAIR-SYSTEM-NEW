-- =====================================================================
-- 1) route_assignments.updated_at לא התעדכן אף פעם בפועל (אין טריגר) —
--    זה מה שה-realtime feed של השלמת ביקורים ("מה הושלם ומתי") צריך
--    כדי לדעת למיין/לסנן לפי עדכניות.
-- =====================================================================
drop trigger if exists route_assignments_set_updated_at on public.route_assignments;
create trigger route_assignments_set_updated_at
  before update on public.route_assignments
  for each row execute function public.set_updated_at();

-- =====================================================================
-- 2) אכיפת קיבולת מיכל: liters_added לא יכול לחרוג מקיבולת הדגם של
--    המכשיר (עם סבילות 5% לשפיכה/עיגול) — חוסם בכל נתיב כתיבה
--    ל-oil_tracking (גם complete_visit וגם createOilEntry), כי זה
--    טריגר על הטבלה עצמה ולא רק בדיקה בתוך פונקציה אחת.
--    level_before/after_pct כבר חסומים ל-0..100 מקודם (CHECK קיים).
-- =====================================================================
create or replace function public.oil_tracking_enforce_capacity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_capacity_ml integer;
begin
  select dm.capacity_ml into v_capacity_ml
    from public.devices d
    join public.device_models dm on dm.name = d.model
   where d.id = new.device_id;

  if v_capacity_ml is not null and new.liters_added > (v_capacity_ml * 1.05 / 1000.0) then
    raise exception
      'הכמות שהוזנה (% ליטר) חורגת מקיבולת המכל של הדגם (% מ״ל)',
      new.liters_added, v_capacity_ml;
  end if;

  return new;
end;
$$;

drop trigger if exists oil_tracking_enforce_capacity on public.oil_tracking;
create trigger oil_tracking_enforce_capacity
  before insert or update on public.oil_tracking
  for each row execute function public.oil_tracking_enforce_capacity();

-- =====================================================================
-- 3) פרסום Realtime — route_assignments (עדכון סטטוס ביקור) ו-
--    oil_tracking (רישום שמן) חסרו מהפרסום, אז שינויים בהם לא הגיעו
--    בזמן אמת לאף מסך.
-- =====================================================================
alter publication supabase_realtime add table public.route_assignments;
alter publication supabase_realtime add table public.oil_tracking;
