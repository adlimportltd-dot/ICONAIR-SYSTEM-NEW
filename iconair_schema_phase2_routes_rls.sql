-- ---------------------------------------------------------------------
--  RLS ל-routes ו-route_assignments — טרם רץ, כמו הקובץ הקודם.
--
--  ⚠ הכרחי להריץ את זה לפני שהקוד המחובר בפועל (RoutesScreen.jsx)
--  יכול לעבוד בבטחה. בלי RLS, שתי הטבלאות פתוחות לגמרי לכל משתמש
--  מאומת — בניגוד לשאר הסכימה, שבה customers/devices כבר מוגנות.
--  זה לא היה מכוון: בקובץ היצירה (iconair_schema_phase2_routes.sql)
--  השארתי RLS בכוונה בחוץ, כדי לא להחליט על ההרשאות בלי לשאול.
--
--  החלטה אחת שכן קיבלתי בשמך, ושונה מהדפוס הקיים ב-devices/customers:
--  עדכון route_assignments (סדר עצירות + סטטוס בוצע/לא-בוצע) פתוח
--  לכל טכנאי מאומת, לא רק ליוצר הרשומה. הנימוק: זה אובייקט תפעולי
--  משותף — מוקד קובע סדר, נהג מסמן בוצע — לא רשומה בבעלות אישית
--  כמו מכשיר. אם תרצה להגביל בחזרה ליוצר/מנהל בלבד, תגיד ואשנה
--  שורה אחת (ה-using/with check של route_assignments_update).
-- ---------------------------------------------------------------------

alter table public.routes enable row level security;
alter table public.route_assignments enable row level security;

-- --- routes: כולם רואים ומוסיפים קו חדש (נוצר אוטומטית מהאפליקציה
-- בפעם הראשונה שקו נפתח); רק מנהל עורך/מוחק. ---

drop policy if exists routes_select on public.routes;
create policy routes_select on public.routes
  for select to authenticated using (true);

drop policy if exists routes_insert on public.routes;
create policy routes_insert on public.routes
  for insert to authenticated with check (true);

drop policy if exists routes_update on public.routes;
create policy routes_update on public.routes
  for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists routes_delete on public.routes;
create policy routes_delete on public.routes
  for delete to authenticated using (public.is_admin());

-- --- route_assignments ---

drop policy if exists route_assignments_select on public.route_assignments;
create policy route_assignments_select on public.route_assignments
  for select to authenticated using (true);

drop policy if exists route_assignments_insert on public.route_assignments;
create policy route_assignments_insert on public.route_assignments
  for insert to authenticated with check (created_by = auth.uid());

drop policy if exists route_assignments_update on public.route_assignments;
create policy route_assignments_update on public.route_assignments
  for update to authenticated using (true) with check (true);

drop policy if exists route_assignments_delete on public.route_assignments;
create policy route_assignments_delete on public.route_assignments
  for delete to authenticated using (public.is_admin());
