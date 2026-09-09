-- ---------------------------------------------------------------------
--  שלב 22 — שליחת מייל אוטומטית אמיתית (Resend) לדוחות שירות.
--
--  ⚠ ארכיטקטורה מכוונת: טריגר ב-Postgres (AFTER INSERT על service_reports)
--  שקורא ל-Resend ישירות דרך pg_net — לא Edge Function. הסיבה:
--  1. אין לי גישה ל-Supabase CLI/access token מהסביבה הזו כדי לפרוס
--     Edge Function (ר' ההערה הכנה ב-supabase/functions/visit-notify) —
--     טריגר ב-DB הוא היחיד שאני יכול לפרוס בעצמי, עם pg_net שכבר מותקן.
--  2. pg_net הוא אסינכרוני מטבעו (מכניס בקשה לתור ומחזיר מיד) — זה בדיוק
--     מה שדרישה #4 מבקשת: הטכנאי בשטח לא ממתין לקריאת HTTP ל-Resend
--     ולא נתקע אם אין קליטה רגעית/Resend איטי, כי ה-INSERT עצמו (שהוא
--     מה ש-createServiceReport מחכה לו) מסתיים לפני שהמייל בכלל נשלח.
--
--  ⚠ המפתח (RESEND_API_KEY) לעולם לא נכתב כאן בקוד ולא ב-Vercel — הוא
--  מאוחסן מוצפן ב-Supabase Vault (supabase_vault, כבר מותקן בפרויקט)
--  ונקרא רק מתוך הטריגר בצד השרת. הוא אף פעם לא מגיע לדפדפן/ל-bundle
--  של Vercel בכלל, ולכן אין צורך במשתנה סביבה ב-Vercel לפיצ'ר הזה.
--  איך מזינים את המפתח בעצמכם — ר' ההוראות שנשלחו בנפרד בצ'אט.
--
--  ⚠ מצורף לינק ל-PDF במייל, לא קובץ מצורף (attachment) בפועל: pg_net
--  מחזיר גוף תשובה כ-text (לא bytea), ומשיכת קובץ בינארי (PDF) לתוכו
--  מסתכנת בשיבוש התוכן (בייטים לא-UTF8 תקינים). קישור לדף ה-PDF הציבורי
--  (אותו bucket ציבורי כמו contracts) הוא הפתרון האמין היחיד בלי
--  Edge Function שיודע לטפל בבינארי כמו שצריך.
-- ---------------------------------------------------------------------

create table if not exists public.notification_settings (
  id boolean primary key default true check (id),
  admin_email text,
  from_address text not null default 'ICON AIR <onboarding@resend.dev>'
);

insert into public.notification_settings (id, admin_email)
values (true, 'Adlimportltd25@gmail.com')
on conflict (id) do nothing;

alter table public.notification_settings enable row level security;

drop policy if exists notification_settings_select on public.notification_settings;
create policy notification_settings_select on public.notification_settings
  for select using (is_admin());

drop policy if exists notification_settings_update on public.notification_settings;
create policy notification_settings_update on public.notification_settings
  for update using (is_admin()) with check (is_admin());

create or replace function public.send_service_report_email()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_api_key  text;
  v_settings public.notification_settings;
  v_pdf_url  text;
  v_event_label text;
  v_to  text[];
  v_bcc text[];
  v_html text;
  v_body jsonb;
begin
  select decrypted_secret into v_api_key
    from vault.decrypted_secrets
   where name = 'resend_api_key'
   limit 1;

  -- אין עדיין מפתח מוגדר ב-Vault — לא שגיאה, פשוט לא שולחים. הדוח/הביקור
  -- עצמם כבר נשמרו בהצלחה לפני שהטריגר הזה בכלל רץ.
  if v_api_key is null or v_api_key = '' then
    return new;
  end if;

  select * into v_settings from public.notification_settings where id = true;

  if new.customer_email is not null and new.customer_email <> '' then
    v_to := array[new.customer_email];
    if v_settings.admin_email is not null and v_settings.admin_email <> '' then
      v_bcc := array[v_settings.admin_email];
    end if;
  elsif v_settings.admin_email is not null and v_settings.admin_email <> '' then
    v_to := array[v_settings.admin_email];
  else
    return new; -- אין בכלל למי לשלוח (לא ללקוח ולא למנהל)
  end if;

  v_pdf_url := 'https://hvpjsiylnmdqjgxdyspz.supabase.co/storage/v1/object/public/service-reports/' || new.file_path;

  v_event_label := case new.event_type
    when 'refill' then 'מילוי'
    when 'replacement' then 'החלפת מכל'
    when 'reading' then 'קריאת מד'
    else new.event_type::text
  end;

  v_html := format(
    '<div dir="rtl" style="font-family:Arial,sans-serif;font-size:15px;color:#0f172a;line-height:1.6">' ||
    '<h2 style="color:#0f172a;margin-bottom:4px">דוח שירות ICON AIR</h2>' ||
    '<p style="color:#64748b;margin-top:0">עודכן אוטומטית בסיום ביקור בשטח</p>' ||
    '<p><b>לקוח:</b> %s</p>' ||
    '<p><b>סוג פעולה:</b> %s</p>' ||
    '<p><b>מכשיר:</b> %s</p>' ||
    '<p><b>ניחוח:</b> %s</p>' ||
    '<p><b>טכנאי מבצע:</b> %s</p>' ||
    '<p style="margin-top:22px">' ||
    '<a href="%s" style="background:#D97706;color:#ffffff;padding:11px 20px;border-radius:8px;text-decoration:none;font-weight:bold">פתח את דוח ה-PDF</a>' ||
    '</p>' ||
    '<p style="color:#94a3b8;font-size:12.5px;margin-top:28px">הופק אוטומטית ע״י מערכת ICON AIR</p>' ||
    '</div>',
    new.customer_name, v_event_label, coalesce(new.device_model, '—'), coalesce(new.scent_name, 'ללא ניחוח'),
    coalesce(new.technician_name, '—'), v_pdf_url
  );

  v_body := jsonb_build_object(
    'from', v_settings.from_address,
    'to', to_jsonb(v_to),
    'subject', 'דוח שירות ICON AIR — ' || new.customer_name,
    'html', v_html
  );
  if v_bcc is not null then
    v_body := v_body || jsonb_build_object('bcc', to_jsonb(v_bcc));
  end if;

  perform net.http_post(
    url := 'https://api.resend.com/emails',
    headers := jsonb_build_object('Authorization', 'Bearer ' || v_api_key, 'Content-Type', 'application/json'),
    body := v_body
  );

  return new;
exception when others then
  -- כשל שליחה (מפתח לא תקין, Resend זמנית לא זמין וכו') לעולם לא הופך
  -- לכשל בשמירת הדוח עצמו — ר' דרישה מפורשת #4. רק נרשם לאזהרה.
  raise warning 'send_service_report_email נכשל עבור service_reports.id=%: %', new.id, sqlerrm;
  return new;
end;
$$;

drop trigger if exists service_reports_send_email on public.service_reports;
create trigger service_reports_send_email
  after insert on public.service_reports
  for each row execute function public.send_service_report_email();
