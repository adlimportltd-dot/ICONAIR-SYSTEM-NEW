-- Phase 52 — 2026-10-02, בקשה מפורשת: "רק מנהלים (אדמין) יכולים לראות
-- הזמנות — לא טכנאים". מחליף את ההרשאות של phase51 (שאיפשרו לכל משתמש
-- מחובר לראות ולעדכן): צפייה, עדכון ומחיקה — מנהל בלבד. גם התראת ה-Push
-- נשלחת עכשיו רק למנויים של מנהלים (כמו notify_new_lead, phase41).
-- קליטת ההזמנות מהאתר (ingest_woo_order) לא משתנה — היא security definer.

drop policy if exists web_orders_select on public.web_orders;
create policy web_orders_select on public.web_orders
  for select using (is_admin());

drop policy if exists web_orders_update on public.web_orders;
create policy web_orders_update on public.web_orders
  for update using (is_admin()) with check (is_admin());

drop policy if exists web_orders_delete on public.web_orders;
create policy web_orders_delete on public.web_orders
  for delete using (is_admin());

create or replace function public.notify_new_web_order(o public.web_orders)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_settings public.notification_settings;
  v_private_key text;
  v_subs jsonb;
begin
  select * into v_settings from public.notification_settings where id = true;
  if v_settings.vapid_public_key is null or v_settings.vapid_public_key = '' then
    return;
  end if;

  select decrypted_secret into v_private_key
    from vault.decrypted_secrets where name = 'vapid_private_key' limit 1;
  if v_private_key is null or v_private_key = '' then
    return;
  end if;

  select jsonb_agg(jsonb_build_object('endpoint', ps.endpoint, 'keys', jsonb_build_object('p256dh', ps.p256dh, 'auth', ps.auth)))
    into v_subs
    from public.push_subscriptions ps
    join public.profiles p on p.id = ps.user_id
   where p.role = 'admin';

  if v_subs is null or jsonb_array_length(v_subs) = 0 then
    return;
  end if;

  perform net.http_post(
    url := 'https://iconair-system-new.vercel.app/api/send-push',
    headers := jsonb_build_object('Content-Type', 'application/json'),
    body := jsonb_build_object(
      'subscriptions', v_subs,
      'vapidPublicKey', v_settings.vapid_public_key,
      'vapidPrivateKey', v_private_key,
      'vapidSubject', coalesce(v_settings.vapid_subject, 'mailto:iconairltd@gmail.com'),
      'title', format('ICONAIR — הזמנה חדשה מהאתר #%s', coalesce(o.order_number, o.woo_order_id::text)),
      'body', format(
        '%s%s · ₪%s',
        coalesce(nullif(o.customer_name, ''), 'לקוח'),
        case when coalesce(o.city, '') <> '' then format(' · %s', o.city) else '' end,
        to_char(o.total, 'FM999,990.00')
      ),
      'url', '/?tab=web_orders'
    )
  );
exception when others then
  raise warning 'notify_new_web_order נכשל עבור web_orders.id=%: %', o.id, sqlerrm;
end;
$function$;

revoke all on function public.notify_new_web_order(public.web_orders) from public, anon, authenticated;
