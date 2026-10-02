-- Phase 51 — 2026-10-02, בקשה מפורשת: חיבור הזמנות מאתר iconair.co.il
-- (WooCommerce) ישירות למערכת — טאב "הזמנות אתר" + התראה בזמן אמת.
--
-- זרימה: WooCommerce Webhook (Order created + Order updated)
--   → /api/woo-order (Vercel, אותו פריסה אוטומטית מ-GitHub)
--   → RPC ingest_woo_order (כאן) — אימות חתימת HMAC + upsert לפי מספר הזמנה.
--
-- אבטחה: הסוד המשותף עם WooCommerce יושב רק ב-Vault (woo_webhook_secret)
-- וב-WooCommerce. אין משתני סביבה חדשים ב-Vercel ואין service_role בשום מקום.
-- ה-RPC פתוח ל-anon, אבל בלי חתימה תקינה הוא זורק שגיאה ולא כותב כלום.
--
-- הרשאות: כל משתמש מחובר (מנהל + טכנאי) רואה הזמנות ויכול לעדכן רק את
-- סטטוס הטיפול/הערות פנימיות. נתוני ההזמנה עצמם נכתבים רק מהאתר.
-- מחיקה — מנהל בלבד.
--
-- הסוד נוצר פעם אחת בסוף הקובץ (אם לא קיים). לצפייה בערך כדי להדביק בווקומרס:
--   select decrypted_secret from vault.decrypted_secrets where name = 'woo_webhook_secret';

create table if not exists public.web_orders (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  woo_order_id bigint not null unique,
  order_number text,
  woo_status text not null,
  handling_status text not null default 'new'
    check (handling_status in ('new', 'in_progress', 'shipped', 'done', 'cancelled')),
  order_date timestamptz,
  customer_name text,
  phone text,
  email text,
  city text,
  address text,
  postcode text,
  shipping_method text,
  payment_method text,
  customer_note text,
  items jsonb not null default '[]'::jsonb,
  subtotal numeric(10, 2),
  shipping_total numeric(10, 2),
  discount_total numeric(10, 2),
  total numeric(10, 2) not null default 0,
  currency text default 'ILS',
  coupons text[],
  internal_notes text,
  handled_by uuid references public.profiles(id) on delete set null,
  notified_at timestamptz,
  raw jsonb
);

create index if not exists web_orders_order_date_idx on public.web_orders (order_date desc);
create index if not exists web_orders_handling_status_idx on public.web_orders (handling_status);

alter table public.web_orders enable row level security;

drop policy if exists web_orders_select on public.web_orders;
create policy web_orders_select on public.web_orders
  for select using (auth.uid() is not null);

drop policy if exists web_orders_update on public.web_orders;
create policy web_orders_update on public.web_orders
  for update using (auth.uid() is not null) with check (auth.uid() is not null);

drop policy if exists web_orders_delete on public.web_orders;
create policy web_orders_delete on public.web_orders
  for delete using (is_admin());

-- מהממשק אפשר לשנות רק את עמודות הטיפול — לא סכום, לא פרטי לקוח.
revoke insert, update on public.web_orders from anon, authenticated;
grant update (handling_status, internal_notes, handled_by) on public.web_orders to authenticated;

drop trigger if exists web_orders_set_updated_at on public.web_orders;
create trigger web_orders_set_updated_at
  before update on public.web_orders
  for each row execute function public.set_updated_at();

do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'web_orders') then
    alter publication supabase_realtime add table public.web_orders;
  end if;
end $$;

-- ---------------------------------------------------------------------
-- Push לכל מי שרשום להתראות (מנהלים + טכנאים) — אותה תשתית בדיוק כמו
-- notify_new_lead (phase41). כשל ב-push לא מפיל את קליטת ההזמנה.
-- ---------------------------------------------------------------------
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

  select jsonb_agg(jsonb_build_object('endpoint', endpoint, 'keys', jsonb_build_object('p256dh', p256dh, 'auth', auth)))
    into v_subs
    from public.push_subscriptions;

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

-- ---------------------------------------------------------------------
-- קליטת הזמנה מ-WooCommerce. p_raw = גוף הבקשה המקורי בדיוק כפי שהגיע
-- (נדרש לאימות החתימה), p_signature = הכותרת X-WC-Webhook-Signature.
-- WooCommerce חותם: base64( HMAC-SHA256(body, secret) ).
-- ---------------------------------------------------------------------
create or replace function public.ingest_woo_order(p_raw text, p_signature text, p_topic text default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'extensions'
as $function$
declare
  v_secret text;
  v_expected text;
  o jsonb;
  b jsonb;
  s jsonb;
  v_use_shipping boolean;
  v_items jsonb;
  v_coupons text[];
  v_status text;
  v_row public.web_orders;
  v_is_real boolean;
begin
  select decrypted_secret into v_secret
    from vault.decrypted_secrets where name = 'woo_webhook_secret' limit 1;
  if v_secret is null or v_secret = '' then
    raise exception 'woo_webhook_secret לא מוגדר ב-Vault' using errcode = '28000';
  end if;

  v_expected := encode(extensions.hmac(convert_to(p_raw, 'UTF8'), convert_to(v_secret, 'UTF8'), 'sha256'), 'base64');
  if p_signature is null or p_signature <> v_expected then
    raise exception 'חתימה לא תקינה' using errcode = '28000';
  end if;

  o := p_raw::jsonb;
  if jsonb_typeof(o) <> 'object' or not (o ? 'id') or not (o ? 'line_items') then
    return jsonb_build_object('ok', true, 'skipped', 'not an order payload');
  end if;

  b := coalesce(o->'billing', '{}'::jsonb);
  s := coalesce(o->'shipping', '{}'::jsonb);
  v_use_shipping := coalesce(nullif(trim(s->>'address_1'), ''), '') <> '';
  v_status := coalesce(o->>'status', 'pending');

  select coalesce(jsonb_agg(jsonb_build_object(
           'name', li->>'name',
           'quantity', coalesce((li->>'quantity')::numeric, 0),
           'total', round(coalesce((li->>'total')::numeric, 0) + coalesce((li->>'total_tax')::numeric, 0), 2),
           'sku', nullif(li->>'sku', ''),
           'product_id', (li->>'product_id')::bigint,
           'variation_id', nullif((li->>'variation_id')::bigint, 0),
           'options', (
             select coalesce(jsonb_agg(jsonb_build_object(
                      'key', coalesce(m->>'display_key', m->>'key'),
                      'value', coalesce(m->>'display_value', m->>'value'))), '[]'::jsonb)
               from jsonb_array_elements(coalesce(li->'meta_data', '[]'::jsonb)) m
              where left(coalesce(m->>'key', ''), 1) <> '_'
                and jsonb_typeof(coalesce(m->'display_value', m->'value')) in ('string', 'number')
           )
         ) order by (li->>'id')::bigint), '[]'::jsonb)
    into v_items
    from jsonb_array_elements(o->'line_items') li;

  select array_agg(c->>'code')
    into v_coupons
    from jsonb_array_elements(coalesce(o->'coupon_lines', '[]'::jsonb)) c;

  insert into public.web_orders as w (
    woo_order_id, order_number, woo_status, order_date,
    customer_name, phone, email, city, address, postcode,
    shipping_method, payment_method, customer_note,
    items, subtotal, shipping_total, discount_total, total, currency, coupons, raw
  ) values (
    (o->>'id')::bigint,
    coalesce(o->>'number', o->>'id'),
    v_status,
    coalesce(nullif(o->>'date_created_gmt', '') || 'Z', null)::timestamptz,
    nullif(trim(concat_ws(' ', b->>'first_name', b->>'last_name')), ''),
    coalesce(nullif(b->>'phone', ''), nullif(s->>'phone', '')),
    nullif(b->>'email', ''),
    nullif(trim(case when v_use_shipping then s->>'city' else b->>'city' end), ''),
    nullif(trim(concat_ws(' ',
      case when v_use_shipping then s->>'address_1' else b->>'address_1' end,
      case when v_use_shipping then s->>'address_2' else b->>'address_2' end)), ''),
    nullif(case when v_use_shipping then s->>'postcode' else b->>'postcode' end, ''),
    (select string_agg(sl->>'method_title', ', ') from jsonb_array_elements(coalesce(o->'shipping_lines', '[]'::jsonb)) sl),
    nullif(o->>'payment_method_title', ''),
    nullif(o->>'customer_note', ''),
    v_items,
    (select round(sum(coalesce((li->>'subtotal')::numeric, 0) + coalesce((li->>'subtotal_tax')::numeric, 0)), 2)
       from jsonb_array_elements(o->'line_items') li),
    round(coalesce((o->>'shipping_total')::numeric, 0) + coalesce((o->>'shipping_tax')::numeric, 0), 2),
    round(coalesce((o->>'discount_total')::numeric, 0) + coalesce((o->>'discount_tax')::numeric, 0), 2),
    coalesce((o->>'total')::numeric, 0),
    coalesce(nullif(o->>'currency', ''), 'ILS'),
    v_coupons,
    o
  )
  on conflict (woo_order_id) do update set
    order_number   = excluded.order_number,
    woo_status     = excluded.woo_status,
    order_date     = coalesce(excluded.order_date, w.order_date),
    customer_name  = excluded.customer_name,
    phone          = excluded.phone,
    email          = excluded.email,
    city           = excluded.city,
    address        = excluded.address,
    postcode       = excluded.postcode,
    shipping_method = excluded.shipping_method,
    payment_method = excluded.payment_method,
    customer_note  = excluded.customer_note,
    items          = excluded.items,
    subtotal       = excluded.subtotal,
    shipping_total = excluded.shipping_total,
    discount_total = excluded.discount_total,
    total          = excluded.total,
    currency       = excluded.currency,
    coupons        = excluded.coupons,
    raw            = excluded.raw,
    -- הזמנה שבוטלה/הוחזרה באתר ועוד לא טופלה — נסגרת אוטומטית גם כאן.
    handling_status = case
      when excluded.woo_status in ('cancelled', 'refunded', 'failed') and w.handling_status = 'new' then 'cancelled'
      else w.handling_status
    end
  returning * into v_row;

  -- "הזמנה אמיתית" = שולמה או ממתינה להעברה בנקאית/ביט/מזומן באיסוף.
  -- הזמנות "ממתין לתשלום" (נטישה בעמוד האשראי) נשמרות אבל לא מקפיצות התראה.
  v_is_real := v_row.woo_status in ('processing', 'on-hold', 'completed');

  if v_is_real and v_row.notified_at is null then
    update public.web_orders set notified_at = now() where id = v_row.id returning * into v_row;
    perform public.notify_new_web_order(v_row);
  end if;

  return jsonb_build_object('ok', true, 'id', v_row.id, 'order', v_row.order_number, 'status', v_row.woo_status);
end;
$function$;

revoke all on function public.ingest_woo_order(text, text, text) from public;
grant execute on function public.ingest_woo_order(text, text, text) to anon, authenticated;

revoke all on function public.notify_new_web_order(public.web_orders) from public, anon, authenticated;

-- סוד ה-Webhook (נוצר פעם אחת בלבד, אם עוד לא קיים)
do $$
begin
  if not exists (select 1 from vault.secrets where name = 'woo_webhook_secret') then
    perform vault.create_secret(encode(extensions.gen_random_bytes(24), 'hex'), 'woo_webhook_secret');
  end if;
end $$;
