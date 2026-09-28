-- ---------------------------------------------------------------------
--  שלב 50 — התקנות חדשות כמשימה (כמו קריאת שירות). 2026-09-28, בקשה מפורשת.
--  להרצה ב-Supabase SQL Editor. בטוח להריץ שוב (idempotent).
--
--  הזרימה:
--   1. create_installation  — פותח קריאה מסוג 'installation' ב-service_calls
--      (לקוח קיים או חדש, דגם, ניחוח, קו, טכנאי). המכשיר עוד לא נוצר, ולכן
--      הוא לא מופיע בקווים. נשלחת התראת פוש לטכנאי המשויך ולמנהלים.
--   2. complete_installation — "הותקן": יוצר את המכשיר אצל הלקוח, משייך
--      את הלקוח לקו, רושם מילוי ראשון ב-oil_tracking, ומוריד מהמלאי הנייד
--      של הטכנאי המשויך יחידת מכשיר אחת + ליטרי השמן. הכול אטומי.
--  לא נוגע בקריאות שירות רגילות (call_type='service' כברירת מחדל).
-- ---------------------------------------------------------------------

alter table public.service_calls
  add column if not exists call_type             text not null default 'service',
  add column if not exists install_model         text,
  add column if not exists install_scent         text,
  add column if not exists install_route         text,
  add column if not exists install_location_note text,
  -- בלי FK בכוונה: FK שני ל-devices היה שובר את ה-embed device:devices(...) במסך הקריאות (PGRST201)
  add column if not exists installed_device_id   uuid;

alter table public.service_calls drop constraint if exists service_calls_call_type_check;
alter table public.service_calls add constraint service_calls_call_type_check
  check (call_type in ('service', 'installation'));

create index if not exists service_calls_type_status_idx on public.service_calls (call_type, status);

/* ============================ 1. פתיחת התקנה ============================ */

create or replace function public.create_installation(
  p_customer_id   uuid,
  p_new_customer  jsonb,          -- { name, phone, address, city } כשאין p_customer_id
  p_model         text,
  p_scent         text,
  p_route         text,
  p_assigned_to   uuid default null,
  p_scheduled_at  timestamptz default null,
  p_location_note text default null,
  p_notes         text default null
) returns public.service_calls
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_customer_id uuid := p_customer_id;
  v_name        text;
  v_route       text := nullif(trim(coalesce(p_route, '')), '');
  v_call        public.service_calls;
begin
  if auth.uid() is null then raise exception 'יש להתחבר למערכת'; end if;
  if nullif(trim(coalesce(p_model, '')), '') is null then raise exception 'יש לבחור דגם מכשיר'; end if;
  if not exists (select 1 from public.device_models where name = p_model) then
    raise exception 'דגם לא מוכר: %', p_model;
  end if;
  if nullif(trim(coalesce(p_scent, '')), '') is null then raise exception 'יש לבחור ניחוח'; end if;

  if v_customer_id is null then
    v_name := nullif(trim(coalesce(p_new_customer->>'name', '')), '');
    if v_name is null then raise exception 'יש לבחור לקוח קיים או להזין שם ללקוח חדש'; end if;
    insert into public.customers (name, phone, address, city, route_name, status, created_by)
    values (
      v_name,
      nullif(trim(coalesce(p_new_customer->>'phone', '')), ''),
      nullif(trim(coalesce(p_new_customer->>'address', '')), ''),
      nullif(trim(coalesce(p_new_customer->>'city', '')), ''),
      v_route, 'active', auth.uid()
    )
    returning id into v_customer_id;
  else
    select name into v_name from public.customers where id = v_customer_id;
    if v_name is null then raise exception 'הלקוח לא נמצא'; end if;
  end if;

  insert into public.service_calls
    (customer_id, title, description, severity, status, assigned_to, scheduled_at, created_by,
     call_type, install_model, install_scent, install_route, install_location_note)
  values
    (v_customer_id,
     format('התקנה חדשה · %s · %s', p_model, trim(p_scent)),
     nullif(trim(coalesce(p_notes, '')), ''),
     'sched', 'open', p_assigned_to, p_scheduled_at, auth.uid(),
     'installation', p_model, trim(p_scent), v_route, nullif(trim(coalesce(p_location_note, '')), ''))
  returning * into v_call;

  return v_call;
end $$;

/* ============================ 2. "הותקן" ============================ */

create or replace function public.complete_installation(
  p_call_id uuid,
  p_liters  numeric,              -- מילוי ראשון בליטרים (ברירת המחדל במסך = קיבולת הדגם)
  p_notes   text default null
) returns public.service_calls
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_call   public.service_calls;
  v_cust   public.customers;
  v_tech   uuid;
  v_stock  public.technician_stock;
  v_device public.devices;
  v_liters numeric := round(coalesce(p_liters, 0), 2);
begin
  select * into v_call from public.service_calls where id = p_call_id for update;
  if v_call is null or v_call.call_type <> 'installation' then raise exception 'משימת ההתקנה לא נמצאה'; end if;
  if v_call.status not in ('open', 'in_progress') then raise exception 'ההתקנה כבר סגורה'; end if;
  if not (public.is_admin() or v_call.assigned_to = auth.uid() or v_call.assigned_to is null) then
    raise exception 'רק הטכנאי המשויך או מנהל יכולים לסמן התקנה כבוצעה';
  end if;
  if v_liters < 0 then raise exception 'כמות שמן לא תקינה'; end if;

  -- המלאי יורד מהרכב של הטכנאי המשויך (ואם לא שובץ — ממי שמסמן "הותקן")
  v_tech := coalesce(v_call.assigned_to, auth.uid());

  -- מכשיר אחד מהמלאי הנייד
  select * into v_stock from public.technician_stock
   where technician_id = v_tech and model = v_call.install_model and coalesce(scent_name, '') = ''
   for update;
  if v_stock is null or v_stock.quantity < 1 then
    raise exception 'אין % במלאי הנייד של הטכנאי — יש להעביר מכשיר לרכב (מלאי נייד ← שלב ג׳) ואז לסמן הותקן',
      v_call.install_model;
  end if;
  update public.technician_stock set quantity = quantity - 1, updated_at = now() where id = v_stock.id;
  insert into public.stock_movements (movement_type, technician_id, model, scent_name, quantity, created_by)
  values ('field_use', v_tech, v_call.install_model, '', 1, auth.uid());

  -- שמן למילוי הראשון מהמלאי הנייד
  if v_liters > 0 then
    select * into v_stock from public.technician_stock
     where technician_id = v_tech and model is null and scent_name = v_call.install_scent
     for update;
    if v_stock is null or v_stock.quantity < v_liters then
      raise exception 'אין מספיק % במלאי הנייד של הטכנאי (יש %, נדרש %)',
        v_call.install_scent, coalesce(v_stock.quantity, 0), v_liters;
    end if;
    update public.technician_stock set quantity = quantity - v_liters, updated_at = now() where id = v_stock.id;
  end if;

  -- שיוך הלקוח לקו שנבחר בהתקנה → המכשיר מופיע בקו הנכון
  select * into v_cust from public.customers where id = v_call.customer_id for update;
  if v_call.install_route is not null then
    update public.customers set route_name = v_call.install_route, status = 'active', updated_at = now()
     where id = v_cust.id;
  end if;

  insert into public.devices (model, customer_id, status, scent_name, oil_level_pct, location_note, installed_at, created_by)
  values (v_call.install_model, v_call.customer_id, 'active', v_call.install_scent, 100,
          v_call.install_location_note, current_date, v_tech)
  returning * into v_device;

  if v_liters > 0 then
    insert into public.stock_movements (movement_type, technician_id, model, scent_name, quantity, device_id, created_by)
    values ('field_use', v_tech, null, v_call.install_scent, v_liters, v_device.id, auth.uid());
  end if;

  insert into public.oil_tracking (device_id, event_type, scent_name, liters_added, level_before_pct, level_after_pct, recorded_by, notes)
  values (v_device.id, 'refill', v_call.install_scent, v_liters, 0, 100, v_tech,
          coalesce(nullif(trim(coalesce(p_notes, '')), ''), 'מילוי ראשון בהתקנה'));

  update public.service_calls
     set status = 'resolved', closed_at = now(), updated_at = now(),
         installed_device_id = v_device.id, device_id = v_device.id,
         resolution = coalesce(nullif(trim(coalesce(p_notes, '')), ''), 'הותקן בשטח') || format(' · %s · %s ל׳ %s', v_device.serial, v_liters, v_call.install_scent)
   where id = v_call.id
  returning * into v_call;

  return v_call;
end $$;

revoke all on function public.create_installation(uuid, jsonb, text, text, text, uuid, timestamptz, text, text) from public, anon;
revoke all on function public.complete_installation(uuid, numeric, text) from public, anon;
grant execute on function public.create_installation(uuid, jsonb, text, text, text, uuid, timestamptz, text, text) to authenticated;
grant execute on function public.complete_installation(uuid, numeric, text) to authenticated;

/* ============================ 3. התראת פוש ============================ */
-- אותו דפוס כמו notify_new_lead (phase41): לטכנאי המשויך + למנהלים.

create or replace function public.notify_new_installation()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_settings    public.notification_settings;
  v_private_key text;
  v_subs        jsonb;
  v_customer    public.customers;
begin
  if new.call_type <> 'installation' then return new; end if;

  select * into v_settings from public.notification_settings where id = true;
  if v_settings.vapid_public_key is null or v_settings.vapid_public_key = '' then return new; end if;

  select decrypted_secret into v_private_key from vault.decrypted_secrets where name = 'vapid_private_key' limit 1;
  if v_private_key is null or v_private_key = '' then return new; end if;

  select jsonb_agg(jsonb_build_object('endpoint', ps.endpoint, 'keys', jsonb_build_object('p256dh', ps.p256dh, 'auth', ps.auth)))
    into v_subs
    from public.push_subscriptions ps
    join public.profiles p on p.id = ps.user_id
   where p.role = 'admin' or ps.user_id = new.assigned_to;

  if v_subs is null or jsonb_array_length(v_subs) = 0 then return new; end if;

  select * into v_customer from public.customers where id = new.customer_id;

  perform net.http_post(
    url := 'https://iconair-system-new.vercel.app/api/send-push',
    headers := jsonb_build_object('Content-Type', 'application/json'),
    body := jsonb_build_object(
      'subscriptions', v_subs,
      'vapidPublicKey', v_settings.vapid_public_key,
      'vapidPrivateKey', v_private_key,
      'vapidSubject', coalesce(v_settings.vapid_subject, 'mailto:iconairltd@gmail.com'),
      'title', 'ICONAIR — התקנה חדשה',
      'body', format('%s · %s · %s%s',
        coalesce(v_customer.name, 'לקוח'), new.install_model, new.install_scent,
        case when new.install_route is not null then ' · ' || new.install_route else '' end),
      'url', '/'
    )
  );
  return new;
exception when others then
  raise warning 'notify_new_installation נכשל עבור service_calls.id=%: %', new.id, sqlerrm;
  return new;
end $$;

drop trigger if exists service_calls_notify_installation on public.service_calls;
create trigger service_calls_notify_installation
  after insert on public.service_calls
  for each row execute function public.notify_new_installation();
