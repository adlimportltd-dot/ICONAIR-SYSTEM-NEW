-- Phase 35 — 2026-09-14, בקשה מפורשת: לטכנאי צריכה להיות דרך לסמן
-- "העסק סגור / לא נמצא" בלי להיאלץ למלא נתוני שמן/מכשיר בכלל.
--
-- route_assignments.status כבר תמך ב-'skipped' מאז ה-CHECK constraint
-- המקורי (ר' route_assignments_status_check) — פשוט אף קוד לא כתב אליו
-- אף פעם עד היום (רק 'pending'/'done' קיימים בפועל בנתונים). לכן אין
-- כאן שינוי-constraint, רק עמודת ההערה החסרה.
alter table public.route_assignments add column if not exists closed_reason text;
