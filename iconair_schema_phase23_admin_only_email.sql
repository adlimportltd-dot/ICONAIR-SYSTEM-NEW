-- ---------------------------------------------------------------------
--  שלב 23 — עצירת שליחה אוטומטית ללקוח, שליחה אוטומטית רק לכתובת
--  הניהולית המרכזית, ויכולת "שלח ידנית ללקוח" מהממשק לפי דרישה.
--
--  מפצל את לוגיקת שליחת המייל לשני בלוקים משותפים (send_resend_email +
--  build_service_report_html) כדי שהטריגר האוטומטי וה-RPC הידני
--  ישתמשו באותה לוגיקה בדיוק ולא ישוכפלו — פחות משטח לטעויות.
-- ---------------------------------------------------------------------

update public.notification_settings
   set admin_email = 'iconairisrael@gmail.com'
 where id = true;

create or replace function public.build_service_report_html(r public.service_reports)
returns text
language sql
stable
as $$
  select format(
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
    r.customer_name,
    case r.event_type
      when 'refill' then 'מילוי'
      when 'replacement' then 'החלפת מכל'
      when 'reading' then 'קריאת מד'
      else r.event_type::text
    end,
    coalesce(r.device_model, '—'),
    coalesce(r.scent_name, 'ללא ניחוח'),
    coalesce(r.technician_name, '—'),
    'https://hvpjsiylnmdqjgxdyspz.supabase.co/storage/v1/object/public/service-reports/' || r.file_path
  );
$$;

-- שולח בפועל דרך Resend. משותף לטריגר האוטומטי ול-RPC הידני. לא בולע
-- שגיאות בעצמו (מי שקורא לו מחליט אם לתפוס אותן) — הטריגר תופס כדי לא
-- לחסום את שמירת הדוח, וה-RPC הידני מעביר הלאה כדי שהמנהל יראה הודעת
-- שגיאה ברורה בממשק אם השליחה נכשלה.
create or replace function public.send_resend_email(p_to text[], p_bcc text[], p_subject text, p_html text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_api_key text;
  v_from text;
  v_body jsonb;
begin
  select decrypted_secret into v_api_key from vault.decrypted_secrets where name = 'resend_api_key' limit 1;
  if v_api_key is null or v_api_key = '' then
    raise exception 'לא הוגדר מפתח Resend (resend_api_key) ב-Supabase Vault — לא ניתן לשלוח מייל';
  end if;

  select from_address into v_from from public.notification_settings where id = true;

  v_body := jsonb_build_object(
    'from', coalesce(v_from, 'ICON AIR <onboarding@resend.dev>'),
    'to', to_jsonb(p_to),
    'subject', p_subject,
    'html', p_html
  );
  if p_bcc is not null and array_length(p_bcc, 1) > 0 then
    v_body := v_body || jsonb_build_object('bcc', to_jsonb(p_bcc));
  end if;

  perform net.http_post(
    url := 'https://api.resend.com/emails',
    headers := jsonb_build_object('Authorization', 'Bearer ' || v_api_key, 'Content-Type', 'application/json'),
    body := v_body
  );
end;
$$;

-- הטריגר האוטומטי: אך ורק לכתובת הניהולית המרכזית — לא ללקוח, לעולם.
create or replace function public.send_service_report_email()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_settings public.notification_settings;
begin
  select * into v_settings from public.notification_settings where id = true;

  if v_settings.admin_email is null or v_settings.admin_email = '' then
    return new; -- אין כתובת ניהולית מוגדרת — לא שולחים כלום אוטומטית
  end if;

  begin
    perform public.send_resend_email(
      array[v_settings.admin_email],
      null,
      'דוח שירות ICON AIR — ' || new.customer_name,
      public.build_service_report_html(new)
    );
  exception when others then
    -- כשל שליחה לעולם לא הופך לכשל בשמירת הדוח עצמו.
    raise warning 'send_service_report_email נכשל עבור service_reports.id=%: %', new.id, sqlerrm;
  end;

  return new;
end;
$$;

-- שליחה ידנית ללקוח, ביוזמת מנהל בלבד, מהממשק — כשהלקוח מבקש את הדוח
-- במפורש. לא רץ אוטומטית משום מקום.
create or replace function public.send_service_report_to_customer(p_report_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_report public.service_reports;
begin
  if not public.is_admin() then
    raise exception 'רק מנהל יכול לשלוח דוח שירות ידנית ללקוח';
  end if;

  select * into v_report from public.service_reports where id = p_report_id;
  if v_report is null then
    raise exception 'דוח שירות לא נמצא: %', p_report_id;
  end if;
  if v_report.customer_email is null or v_report.customer_email = '' then
    raise exception 'ללקוח הזה אין כתובת מייל רשומה בכרטיס הלקוח';
  end if;

  perform public.send_resend_email(
    array[v_report.customer_email],
    null,
    'דוח שירות ICON AIR — ' || v_report.customer_name,
    public.build_service_report_html(v_report)
  );
end;
$$;
