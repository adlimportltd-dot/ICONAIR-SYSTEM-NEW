-- Phase 34 — 2026-09-14, המשך ישיר לבקשת ה-Push (phase33): "תאחד גם
-- את המייל לסיכום אחד לביקור". אותה בעיה בדיוק — מייל נשלח על כל
-- service_reports (per device), עכשיו גם הוא זז לנקודת "סיום ביקור"
-- (route_assignments status→done), באותו טריגר notify_visit_completed
-- שכבר בנוי שם (לא טריגר שני נפרד).
--
-- דוחות-הביקור המרוכזים לאימייל נאספים לפי devices ששייכים לאותו
-- site_id/customer_id של העצירה שהושלמה *ונוצרו היום* — לא כל
-- ה"היסטוריה" של אותם מכשירים. שימוש ב-devices.site_id (לא רק
-- customer_id) חשוב כדי לא לערבב בטעות דוחות מאתר אחר של אותו לקוח
-- רב-אתרים (למשל אוורסט) שטופל באותו יום.
--
-- המייל *הבודד* (send_service_report_email, per-device) הופך ל-no-op:
-- הפונקציה עצמה לא נמחקת (הטריגר על service_reports עדיין קיים ותקין
-- מבחינת מבנה) כדי לא לגעת בטריגר עצמו, אבל תוכנה מתרוקן — כל שליחת
-- המייל האמיתית קורית עכשיו רק דרך notify_visit_completed.
create or replace function public.send_service_report_email()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  -- 2026-09-14 (phase34): המייל-הבודד-לכל-מכשיר בוטל בכוונה — עבר
  -- לסיכום אחד לביקור שלם, ר' notify_visit_completed().
  return new;
end;
$$;

create or replace function public.notify_visit_completed()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_settings public.notification_settings;
  v_private_key text;
  v_subs jsonb;
  v_customer_name text;
  v_address text;
  v_technician_name text;
  v_device_ids uuid[];
  v_rows_html text;
begin
  if new.status is distinct from 'done' or old.status = 'done' then
    return new;
  end if;

  if new.site_id is not null then
    select c.name || ' — ' || cs.label, cs.city into v_customer_name, v_address
      from public.customer_sites cs join public.customers c on c.id = cs.customer_id
     where cs.id = new.site_id;
    select array_agg(id) into v_device_ids from public.devices where site_id = new.site_id;
  else
    select name, address into v_customer_name, v_address from public.customers where id = new.customer_id;
    select array_agg(id) into v_device_ids from public.devices where customer_id = new.customer_id and site_id is null;
  end if;

  select full_name into v_technician_name from public.profiles where id = auth.uid();

  select * into v_settings from public.notification_settings where id = true;

  -- ---- Push (ר' phase33, לא שונה) ----
  if v_settings.vapid_public_key is not null and v_settings.vapid_public_key <> '' then
    select decrypted_secret into v_private_key
      from vault.decrypted_secrets where name = 'vapid_private_key' limit 1;

    if v_private_key is not null and v_private_key <> '' then
      select jsonb_agg(jsonb_build_object('endpoint', endpoint, 'keys', jsonb_build_object('p256dh', p256dh, 'auth', auth)))
        into v_subs
        from public.push_subscriptions ps
        join public.profiles p on p.id = ps.user_id
       where p.role = 'admin';

      if v_subs is not null and jsonb_array_length(v_subs) > 0 then
        perform net.http_post(
          url := 'https://iconair-system-new.vercel.app/api/send-push',
          headers := jsonb_build_object('Content-Type', 'application/json'),
          body := jsonb_build_object(
            'subscriptions', v_subs,
            'vapidPublicKey', v_settings.vapid_public_key,
            'vapidPrivateKey', v_private_key,
            'vapidSubject', coalesce(v_settings.vapid_subject, 'mailto:iconairisrael@gmail.com'),
            'title', 'ICON AIR — ביקור הושלם',
            'body', format(
              'הטכנאי %s סיים ביקור אצל %s%s',
              coalesce(v_technician_name, 'טכנאי'),
              coalesce(v_customer_name, 'לקוח'),
              case when v_address is not null and v_address <> '' then format(' (%s)', v_address) else '' end
            ),
            'url', '/'
          )
        );
      end if;
    end if;
  end if;

  -- ---- מייל מסכם אחד לביקור (phase34) ----
  if v_settings.admin_email is not null and v_settings.admin_email <> '' then
    begin
      select string_agg(
        format(
          '<tr>' ||
          '<td style="padding:8px 10px;border-bottom:1px solid #e2e8f0">%s</td>' ||
          '<td style="padding:8px 10px;border-bottom:1px solid #e2e8f0">%s</td>' ||
          '<td style="padding:8px 10px;border-bottom:1px solid #e2e8f0">%s</td>' ||
          '<td style="padding:8px 10px;border-bottom:1px solid #e2e8f0">%s מ״ל</td>' ||
          '<td style="padding:8px 10px;border-bottom:1px solid #e2e8f0">%s%% ← %s%%</td>' ||
          '<td style="padding:8px 10px;border-bottom:1px solid #e2e8f0">' ||
            '<a href="%s" style="color:#B45309">PDF</a></td>' ||
          '</tr>',
          coalesce(sr.device_model, '—'),
          coalesce(sr.scent_name, 'ללא ניחוח'),
          case sr.event_type
            when 'refill' then 'מילוי' when 'replacement' then 'החלפת מכל'
            when 'reading' then 'קריאת מד' else sr.event_type::text
          end,
          coalesce(round(coalesce(sr.liters_added, 0) * 1000)::text, '0'),
          coalesce(sr.level_before_pct::text, '—'), coalesce(sr.level_after_pct::text, '—'),
          'https://hvpjsiylnmdqjgxdyspz.supabase.co/storage/v1/object/public/service-reports/' || sr.file_path
        ),
        ''
        order by sr.created_at
      )
        into v_rows_html
        from public.service_reports sr
       where sr.device_id = any(coalesce(v_device_ids, array[]::uuid[]))
         and sr.created_at::date = current_date;

      begin
        perform public.send_resend_email(
          array[v_settings.admin_email],
          null,
          format('ביקור הושלם ICON AIR — %s', coalesce(v_customer_name, 'לקוח')),
          format(
            '<div dir="rtl" style="font-family:Arial,sans-serif;font-size:15px;color:#0f172a;line-height:1.6">' ||
            '<h2 style="color:#0f172a;margin-bottom:4px">ביקור הושלם</h2>' ||
            '<p style="color:#64748b;margin-top:0">סיכום כל המכשירים שטופלו בביקור הזה</p>' ||
            '<p><b>לקוח:</b> %s</p>' ||
            '<p><b>כתובת:</b> %s</p>' ||
            '<p><b>טכנאי מבצע:</b> %s</p>' ||
            '%s' ||
            '<p style="color:#94a3b8;font-size:12.5px;margin-top:28px">הופק אוטומטית ע״י מערכת ICON AIR</p>' ||
            '</div>',
            coalesce(v_customer_name, '—'),
            coalesce(v_address, '—'),
            coalesce(v_technician_name, '—'),
            case when v_rows_html is not null and v_rows_html <> '' then
              format(
                '<table style="width:100%%;border-collapse:collapse;margin-top:14px;font-size:14px">' ||
                '<thead><tr style="text-align:right;color:#64748b;font-size:12.5px">' ||
                '<th style="padding:8px 10px;border-bottom:2px solid #cbd5e1">דגם</th>' ||
                '<th style="padding:8px 10px;border-bottom:2px solid #cbd5e1">ניחוח</th>' ||
                '<th style="padding:8px 10px;border-bottom:2px solid #cbd5e1">פעולה</th>' ||
                '<th style="padding:8px 10px;border-bottom:2px solid #cbd5e1">כמות</th>' ||
                '<th style="padding:8px 10px;border-bottom:2px solid #cbd5e1">מפלס</th>' ||
                '<th style="padding:8px 10px;border-bottom:2px solid #cbd5e1">דוח</th>' ||
                '</tr></thead><tbody>%s</tbody></table>',
                v_rows_html
              )
            else
              '<p style="color:#94a3b8;margin-top:14px">לא נמצאו דוחות-מכשיר מפורטים לביקור הזה.</p>'
            end
          )
        );
      exception when others then
        raise warning 'notify_visit_completed (mail) נכשל עבור route_assignments.id=%: %', new.id, sqlerrm;
      end;
    end;
  end if;

  return new;
exception when others then
  raise warning 'notify_visit_completed נכשל עבור route_assignments.id=%: %', new.id, sqlerrm;
  return new;
end;
$$;
