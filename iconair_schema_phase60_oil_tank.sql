-- phase60: מיכל בצי החכם (עמודת מיכל + התראת מיכל נמוך/ריק). הורץ ב-Supabase ב-12.10.2026 — תיעוד בלבד.
-- מד מיכל קיים כש-ojiShowType = 1 (כרגע Icon 400). פוש מתחת ל-15% וב-0%, פעם אחת; איפוס ב-20%+. מכשירי ניסוי לא מתריעים.

alter table public.iot_devices add column if not exists has_oil_gauge boolean generated always as (coalesce(raw->>'ojiShowType','') = '1') stored, add column if not exists oil_alert_level text, add column if not exists oil_alert_sent_at timestamptz;

-- הפונקציה public.iot_check_oil_alerts(p_include_test boolean default false) נוצרה ב-Supabase (ראו pg_get_functiondef).

select cron.alter_job(job_id := (select jobid from cron.job where jobname = 'iot-offline-alerts'), command := 'select public.iot_check_offline_alerts(); select public.iot_check_clock_alerts(); select public.iot_check_oil_alerts();');
