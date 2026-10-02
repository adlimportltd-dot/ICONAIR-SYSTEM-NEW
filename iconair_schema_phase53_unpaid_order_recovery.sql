-- Phase 53 — 2026-10-02, בקשה מפורשת ודחופה: "הזמנות מתבטלות ואנחנו
-- מפסידים כסף — לטפל מהשורש". אבחון (יוני–אוקטובר): 15 מתוך 36 הזמנות
-- (42%) בוטלו אוטומטית כי לא הושלם תשלום בעמוד iCredit; רק 4 לקוחות
-- חזרו לבד. כאן — מנגנון הצלה:
--   1. pay_url: קישור "השלמת תשלום" של WooCommerce לכל הזמנה (נגזר מ-raw).
--   2. alert_unpaid_web_orders(): כל דקה (pg_cron) — הזמנה שלא שולמה
--      10 דקות → התראת Push למנהלים + unpaid_alerted_at (התראה אחת בלבד).
--   3. האפליקציה מציגה פאנל "ממתינות לתשלום — להתקשר עכשיו" עם חיוג
--      ווואטסאפ עם קישור התשלום, וטוסט + צליל ברגע ההתראה.

alter table public.web_orders
  add column if not exists pay_url text,
  add column if not exists unpaid_alerted_at timestamptz;

-- קישור תשלום: https://iconair.co.il/checkout/order-pay/<id>/?pay_for_order=true&key=<order_key>
create or replace function public.web_orders_set_pay_url()
returns trigger
language plpgsql
as $function$
begin
  if new.raw ? 'order_key' and coalesce(new.raw->>'order_key', '') <> '' then
    new.pay_url := format(
      'https://iconair.co.il/checkout/order-pay/%s/?pay_for_order=true&key=%s',
      new.woo_order_id, new.raw->>'order_key'
    );
  end if;
  return new;
end;
$function$;

drop trigger if exists web_orders_pay_url on public.web_orders;
create trigger web_orders_pay_url
  before insert or update of raw on public.web_orders
  for each row execute function public.web_orders_set_pay_url();

update public.web_orders
   set pay_url = format('https://iconair.co.il/checkout/order-pay/%s/?pay_for_order=true&key=%s', woo_order_id, raw->>'order_key')
 where pay_url is null and coalesce(raw->>'order_key', '') <> '';

create index if not exists web_orders_unpaid_idx
  on public.web_orders (woo_status, notified_at, unpaid_alerted_at);

-- ---------------------------------------------------------------------
-- סורק הזמנות שלא שולמו. רץ כל דקה. "לא שולמה" = woo_status='pending'
-- ואף פעם לא הוכרזה כאמיתית (notified_at ריק). חלון: 10 דקות עד 48 שעות
-- מרגע ההזמנה — אחרי 48 שעות כבר לא מתריעים.
-- ---------------------------------------------------------------------
create or replace function public.alert_unpaid_web_orders()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_settings public.notification_settings;
  v_private_key text;
  v_subs jsonb;
  r public.web_orders;
  v_count integer := 0;
begin
  select * into v_settings from public.notification_settings where id = true;
  select decrypted_secret into v_private_key
    from vault.decrypted_secrets where name = 'vapid_private_key' limit 1;

  select jsonb_agg(jsonb_build_object('endpoint', ps.endpoint, 'keys', jsonb_build_object('p256dh', ps.p256dh, 'auth', ps.auth)))
    into v_subs
    from public.push_subscriptions ps
    join public.profiles p on p.id = ps.user_id
   where p.role = 'admin';

  for r in
    update public.web_orders w
       set unpaid_alerted_at = now()
     where w.woo_status = 'pending'
       and w.notified_at is null
       and w.unpaid_alerted_at is null
       and w.handling_status = 'new'
       and coalesce(w.order_date, w.created_at) < now() - interval '10 minutes'
       and coalesce(w.order_date, w.created_at) > now() - interval '48 hours'
    returning w.*
  loop
    v_count := v_count + 1;

    if v_settings.vapid_public_key is not null and v_settings.vapid_public_key <> ''
       and v_private_key is not null and v_private_key <> ''
       and v_subs is not null and jsonb_array_length(v_subs) > 0 then
      begin
        perform net.http_post(
          url := 'https://iconair-system-new.vercel.app/api/send-push',
          headers := jsonb_build_object('Content-Type', 'application/json'),
          body := jsonb_build_object(
            'subscriptions', v_subs,
            'vapidPublicKey', v_settings.vapid_public_key,
            'vapidPrivateKey', v_private_key,
            'vapidSubject', coalesce(v_settings.vapid_subject, 'mailto:iconairltd@gmail.com'),
            'title', format('⚠ הזמנה #%s לא שולמה — להתקשר עכשיו', coalesce(r.order_number, r.woo_order_id::text)),
            'body', format(
              '%s%s · ₪%s',
              coalesce(nullif(r.customer_name, ''), 'לקוח'),
              case when coalesce(r.phone, '') <> '' then format(' · %s', r.phone) else '' end,
              to_char(r.total, 'FM999,990.00')
            ),
            'url', '/?tab=web_orders'
          )
        );
      exception when others then
        raise warning 'alert_unpaid_web_orders push נכשל עבור %: %', r.id, sqlerrm;
      end;
    end if;
  end loop;

  return v_count;
end;
$function$;

revoke all on function public.alert_unpaid_web_orders() from public, anon, authenticated;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'web-orders-unpaid-alert') then
    perform cron.unschedule('web-orders-unpaid-alert');
  end if;
  perform cron.schedule('web-orders-unpaid-alert', '* * * * *', 'select public.alert_unpaid_web_orders()');
end $$;
