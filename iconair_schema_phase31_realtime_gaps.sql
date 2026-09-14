-- Phase 31 — 2026-09-14, בעקבות בקשה מפורשת: "כל מה שאני מוסיף/מעדכן
-- שיתעדכן גם במחשב וגם בטלפון, קריטי". בדקתי את כל טבלאות ה-DB מול
-- מסך publication הקיים ומצאתי שתי טבלאות עריכה אמיתיות שהוחסרו:
--
-- - device_change_requests: טכנאי ששולח בקשת שינוי ניחוח/דגם מהטלפון —
--   המנהל במחשב לא ראה אותה עד רענון ידני של מסך המסלולים.
-- - scents / device_models: קטלוג ניחוחות/דגמים (CatalogScreen) —
--   ניחוח/דגם חדש שמנהל מוסיף לא הופיע ברשימות הבחירה (מסלולים/מעקב
--   שמנים/מכשירים) במכשיר אחר עד רענון.
--
-- שתי הטבלאות האלה הן בדיוק המקרה שהמשתמש תיאר: תוכן שנוסף לא נעלם
-- באמת (השרת שומר אותו נכון), אבל בלי realtime הוא לא מגיע חי למכשיר
-- השני — מרגיש כמו "לא התעדכן". שאר טבלאות התוכן הפעיל כבר היו
-- ברשימה (customers/customer_sites/devices/oil_tracking/
-- route_assignments/sub_routes/contracts/service_calls/service_reports/
-- technician_stock/warehouse_stock/customer_site_model_prices).
--
-- לא נוספו (במכוון, נתונים תצורתיים/היסטוריים שלא צריכים refetch חי):
-- city_routes, routes, profiles, push_subscriptions, notification_settings,
-- stock_movements, contract_events.
do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and tablename='device_change_requests') then
    alter publication supabase_realtime add table public.device_change_requests;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and tablename='scents') then
    alter publication supabase_realtime add table public.scents;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and tablename='device_models') then
    alter publication supabase_realtime add table public.device_models;
  end if;
end $$;
