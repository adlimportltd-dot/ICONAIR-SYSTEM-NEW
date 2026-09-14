-- Phase 33 — 2026-09-14, בקשה מפורשת: התראת Push הייתה נשלחת על כל
-- דוח-שירות (service_reports) שנוצר — ודוח נוצר על כל שמירת מכשיר
-- בודד (גם "שמור מילוי" החלקי, לא רק "סיום ביקור"). לקוח עם 4 מכשירים
-- בקומות שונות = 4 Push נפרדות למנהל, "הצפה" בדיוק כמו שתואר.
--
-- הפתרון: להזיז את שליחת ה-Push מהטריגר על service_reports (per-device)
-- לטריגר חדש על route_assignments — יורה רק כש-status עובר ל-'done'
-- (בדיוק הרגע של כפתור "סיום ביקור ✓", ר' RoutesScreen.jsx markDone),
-- לא על עדכון-ביניים. תוכן ההתראה תואר עכשיו את מה שהוא באמת אומר:
-- ביקור *שלם* בכתובת, לא מכשיר בודד.
--
-- מייל (send_service_report_email, per-device) לא נגע כאן במכוון —
-- זה עדיין תיעוד-לרשומה של כל דוח PDF בנפרד, לא "התראה" שמפריעה
-- באמצע היום כמו Push לטלפון. אם גם המייל מציף, זו בקשה נפרדת.

-- מסיר את שליחת ה-Push מהטריגר הקיים על service_reports — נשאר רק המייל.
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

  if v_settings.admin_email is not null and v_settings.admin_email <> '' then
    begin
      perform public.send_resend_email(
        array[v_settings.admin_email],
        null,
        'דוח שירות ICON AIR — ' || new.customer_name,
        public.build_service_report_html(new)
      );
    exception when others then
      raise warning 'send_service_report_email (mail) נכשל עבור service_reports.id=%: %', new.id, sqlerrm;
    end;
  end if;

  return new;
end;
$$;

-- Push חדש: יורה רק במעבר-אמיתי ל-'done' (לא ב-INSERT הראשוני של השורה
-- ולא בעדכון אחר, כמו גרירה מחדש שרק משנה stop_order/sub_route_id).
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
begin
  if new.status is distinct from 'done' or old.status = 'done' then
    return new;
  end if;

  if new.site_id is not null then
    select c.name || ' — ' || cs.label, cs.city into v_customer_name, v_address
      from public.customer_sites cs join public.customers c on c.id = cs.customer_id
     where cs.id = new.site_id;
  else
    select name, address into v_customer_name, v_address from public.customers where id = new.customer_id;
  end if;

  select full_name into v_technician_name from public.profiles where id = auth.uid();

  select * into v_settings from public.notification_settings where id = true;
  if v_settings.vapid_public_key is null or v_settings.vapid_public_key = '' then
    return new;
  end if;

  select decrypted_secret into v_private_key
    from vault.decrypted_secrets where name = 'vapid_private_key' limit 1;
  if v_private_key is null or v_private_key = '' then
    return new;
  end if;

  select jsonb_agg(jsonb_build_object('endpoint', endpoint, 'keys', jsonb_build_object('p256dh', p256dh, 'auth', auth)))
    into v_subs
    from public.push_subscriptions ps
    join public.profiles p on p.id = ps.user_id
   where p.role = 'admin';

  if v_subs is null or jsonb_array_length(v_subs) = 0 then
    return new;
  end if;

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

  return new;
exception when others then
  raise warning 'notify_visit_completed נכשל עבור route_assignments.id=%: %', new.id, sqlerrm;
  return new;
end;
$$;

drop trigger if exists route_assignments_notify_visit_completed on public.route_assignments;
create trigger route_assignments_notify_visit_completed
  after update on public.route_assignments
  for each row execute function public.notify_visit_completed();
