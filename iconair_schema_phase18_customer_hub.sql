-- ---------------------------------------------------------------------
--  Phase 18 — כרטיס לקוח מאוחד (Customer Hub)
--
--  1. customer_sites.building_code — קוד כניסה לבניין/אתר, מה שהטכנאי
--     צריך בשטח ליד הכתובת עצמה.
--  2. devices.unit_price — מחיר ליחידה *למכשיר ספציפי* (לפני מע"מ),
--     אופציונלי. כשהוא ריק (NULL) המכשיר מתומחר לפי מחיר-הדגם של
--     הכתובת שלו (customer_site_model_prices, phase17); כשהוא מלא הוא
--     דורס את מחיר-הדגם רק עבור המכשיר הזה. כך יש גם תמחור "לכתובת"
--     (ברירת מחדל לפי דגם) וגם "למכשיר" (חריג ידני) — שני המסלולים
--     שהמשתמש ביקש, בלי שני מנגנונים סותרים.
--  3. Realtime — customers / customer_sites / customer_site_model_prices /
--     contracts לא היו בפרסום supabase_realtime בכלל, אז אף מנוי
--     postgres_changes עליהם (למשל חוזים בכרטיס הלקוח, או מסך המסלולים)
--     לא קיבל אירועים מעולם. זה מה שמאפשר "סנכרון רוחבי אוטומטי":
--     עריכה בכרטיס הלקוח מתעדכנת חי במסלולים ובשאר המסכים.
-- ---------------------------------------------------------------------

alter table public.customer_sites
  add column if not exists building_code text;

alter table public.devices
  add column if not exists unit_price numeric;

do $$
declare t text;
begin
  foreach t in array array['customers', 'customer_sites', 'customer_site_model_prices', 'contracts']
  loop
    if not exists (
      select 1 from pg_publication_tables
       where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;
