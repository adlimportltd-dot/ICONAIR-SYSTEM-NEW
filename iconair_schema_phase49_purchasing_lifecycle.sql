-- ---------------------------------------------------------------------
--  שלב 49 — מחזור החיים הלוגיסטי של המלאי: רכש מ-ADL → מחסן → רכב טכנאי.
--  2026-09-28. להרצה ב-Supabase SQL Editor. בטוח להריץ שוב (idempotent).
--
--  שלב א׳ — רכש נטו:   purchase_orders + purchase_order_lines.
--                       create_purchase_order מחשב בשרת לכל שורה:
--                       לרכוש = max(0, יעד − מלאי במחסן − כבר בהזמנה פתוחה).
--  שלב ב׳ — קליטה:     receive_purchase_order מוסיף את מה שהגיע ל-warehouse_stock
--                       (כולל קליטה חלקית), ומסמן את ההזמנה "התקבלה".
--  שלב ג׳ — העמסה:     load_technician_vehicle מעביר כמה פריטים בבת אחת
--                       מהמחסן ל-technician_stock (מלאי נייד), אטומית.
--
--  ספר תנועות אחד: כל קליטה/הקצאה נרשמת ב-stock_movements (receive/allocate),
--  כולל הקליטה וההקצאה הידניות הקיימות (receive_stock / allocate_stock_to_technician
--  נשארות באותה חתימה בדיוק — רק מוסיפות רישום בספר).
--  לא נוגע ב-devices, oil_tracking, complete_visit, return/reset.
-- ---------------------------------------------------------------------

/* =============================== ספר התנועות =============================== */

alter table public.stock_movements alter column technician_id drop not null;  -- קליטה מספק אינה של טכנאי
alter table public.stock_movements
  add column if not exists po_line_id uuid,
  add column if not exists route_name text;

alter table public.stock_movements drop constraint if exists stock_movements_movement_type_check;
alter table public.stock_movements add constraint stock_movements_movement_type_check
  check (movement_type = any (array['allocate', 'return', 'field_use', 'reset', 'receive']));

/* =============================== הזמנות רכש =============================== */

create sequence if not exists public.purchase_order_seq;

create table if not exists public.purchase_orders (
  id           uuid primary key default gen_random_uuid(),
  po_number    text not null unique default ('PO-' || lpad(nextval('public.purchase_order_seq')::text, 4, '0')),
  supplier     text not null default 'ADL',
  status       text not null default 'draft'
               check (status in ('draft', 'ordered', 'partially_received', 'received', 'cancelled')),
  route_name   text,                 -- הקו שההזמנה חושבה עבורו (null = כל הקווים)
  notes        text not null default '',
  created_by   uuid references public.profiles (id) default auth.uid(),
  created_at   timestamptz not null default now(),
  ordered_at   timestamptz,
  received_at  timestamptz,
  updated_at   timestamptz not null default now()
);

create table if not exists public.purchase_order_lines (
  id            uuid primary key default gen_random_uuid(),
  po_id         uuid not null references public.purchase_orders (id) on delete cascade,
  item_kind     text not null check (item_kind in ('scent', 'model')),
  scent_name    text,
  model         text,
  target_qty    numeric(10,2) not null default 0 check (target_qty >= 0),   -- יעד הקו בזמן היצירה
  existing_qty  numeric(10,2) not null default 0 check (existing_qty >= 0), -- מחסן בזמן היצירה
  on_order_qty  numeric(10,2) not null default 0 check (on_order_qty >= 0), -- כבר בהזמנות פתוחות אחרות
  ordered_qty   numeric(10,2) not null check (ordered_qty > 0),             -- מה שמזמינים מ-ADL
  received_qty  numeric(10,2) not null default 0 check (received_qty >= 0),
  constraint purchase_order_lines_shape check (
    (item_kind = 'scent' and nullif(scent_name, '') is not null and model is null) or
    (item_kind = 'model' and nullif(model, '') is not null and scent_name is null)
  ),
  constraint purchase_order_lines_whole_units check (
    item_kind = 'scent' or (ordered_qty = trunc(ordered_qty) and received_qty = trunc(received_qty))
  )
);

create index if not exists purchase_orders_created_idx on public.purchase_orders (created_at desc);
create index if not exists purchase_order_lines_po_idx on public.purchase_order_lines (po_id);

alter table public.purchase_orders enable row level security;
alter table public.purchase_order_lines enable row level security;

drop policy if exists purchase_orders_admin on public.purchase_orders;
create policy purchase_orders_admin on public.purchase_orders
  for all to authenticated using (public.is_admin()) with check (public.is_admin());
drop policy if exists purchase_order_lines_admin on public.purchase_order_lines;
create policy purchase_order_lines_admin on public.purchase_order_lines
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

do $$
declare t text;
begin
  foreach t in array array['purchase_orders', 'purchase_order_lines', 'warehouse_stock', 'technician_stock'] loop
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = t) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;

/* =============================== ליבה: מחסן ↔ רכב =============================== */
-- שתי פונקציות פנימיות, מקור אמת יחיד לתנועת מלאי. הציבוריות (receive_stock,
-- allocate_stock_to_technician, receive_purchase_order, load_technician_vehicle)
-- כולן עוברות דרכן — כך שכל תנועה נרשמת בספר, בלי קשר מאיפה הגיעה.

create or replace function public._stock_receive(
  p_model text, p_scent_name text, p_quantity numeric, p_po_line_id uuid default null
) returns public.warehouse_stock
language plpgsql as $$
declare
  v_model text := nullif(trim(coalesce(p_model, '')), '');
  v_scent text := coalesce(nullif(trim(coalesce(p_scent_name, '')), ''), '');
  v_row   public.warehouse_stock;
begin
  if not public.is_admin() then raise exception 'רק מנהל יכול לקלוט סחורה למחסן'; end if;
  if p_quantity is null or p_quantity <= 0 then raise exception 'כמות לקליטה חייבת להיות גדולה מ-0'; end if;
  if (v_model is null) = (v_scent = '') then
    raise exception 'יש לבחור בדיוק אחד: דגם מכשיר, או ניחוח — לא שניהם ולא אף אחד';
  end if;
  if v_model is not null and p_quantity <> trunc(p_quantity) then
    raise exception 'כמות מכשירים חייבת להיות מספר יחידות שלם, קיבלתי %', p_quantity;
  end if;

  if v_model is not null then
    insert into public.warehouse_stock (model, scent_name, quantity) values (v_model, '', p_quantity)
    on conflict (model) where model is not null
    do update set quantity = public.warehouse_stock.quantity + excluded.quantity, updated_at = now()
    returning * into v_row;
  else
    insert into public.warehouse_stock (model, scent_name, quantity) values (null, v_scent, p_quantity)
    on conflict (scent_name) where scent_name <> ''
    do update set quantity = public.warehouse_stock.quantity + excluded.quantity, updated_at = now()
    returning * into v_row;
  end if;

  insert into public.stock_movements (movement_type, technician_id, model, scent_name, quantity, created_by, po_line_id)
  values ('receive', null, v_model, v_scent, p_quantity, auth.uid(), p_po_line_id);

  return v_row;
end $$;

create or replace function public._stock_allocate(
  p_technician_id uuid, p_model text, p_scent_name text, p_quantity numeric, p_route_name text default null
) returns public.technician_stock
language plpgsql as $$
declare
  v_model text := nullif(trim(coalesce(p_model, '')), '');
  v_scent text := coalesce(nullif(trim(coalesce(p_scent_name, '')), ''), '');
  v_wh    public.warehouse_stock;
  v_tech  public.technician_stock;
begin
  if not public.is_admin() then raise exception 'רק מנהל יכול להעביר מלאי לרכב טכנאי'; end if;
  if p_technician_id is null then raise exception 'יש לבחור טכנאי'; end if;
  if p_quantity is null or p_quantity <= 0 then raise exception 'כמות להעברה חייבת להיות גדולה מ-0'; end if;
  if (v_model is null) = (v_scent = '') then
    raise exception 'יש לבחור בדיוק אחד: דגם מכשיר, או ניחוח — לא שניהם ולא אף אחד';
  end if;
  if v_model is not null and p_quantity <> trunc(p_quantity) then
    raise exception 'כמות מכשירים חייבת להיות מספר יחידות שלם, קיבלתי %', p_quantity;
  end if;

  if v_model is not null then
    select * into v_wh from public.warehouse_stock where model = v_model and scent_name = '' for update;
  else
    select * into v_wh from public.warehouse_stock where scent_name = v_scent and model is null for update;
  end if;

  if v_wh is null or v_wh.quantity < p_quantity then
    raise exception 'אין מספיק במחסן ל-% (יש %, נדרש %)', coalesce(v_model, v_scent), coalesce(v_wh.quantity, 0), p_quantity;
  end if;

  update public.warehouse_stock set quantity = quantity - p_quantity, updated_at = now() where id = v_wh.id;

  if v_model is not null then
    insert into public.technician_stock (technician_id, model, scent_name, quantity) values (p_technician_id, v_model, '', p_quantity)
    on conflict (technician_id, model, scent_name)
    do update set quantity = public.technician_stock.quantity + excluded.quantity, updated_at = now()
    returning * into v_tech;
  else
    insert into public.technician_stock (technician_id, model, scent_name, quantity) values (p_technician_id, null, v_scent, p_quantity)
    on conflict (technician_id, scent_name) where scent_name <> '' and model is null
    do update set quantity = public.technician_stock.quantity + excluded.quantity, updated_at = now()
    returning * into v_tech;
  end if;

  insert into public.stock_movements (movement_type, technician_id, model, scent_name, quantity, created_by, route_name)
  values ('allocate', p_technician_id, v_model, v_scent, p_quantity, auth.uid(), nullif(trim(coalesce(p_route_name, '')), ''));

  return v_tech;
end $$;

-- הפונקציות הקיימות — אותה חתימה ואותה התנהגות, עכשיו גם נרשמות בספר.
create or replace function public.receive_stock(p_model text, p_scent_name text, p_quantity numeric)
returns public.warehouse_stock language sql as $$
  select public._stock_receive(p_model, p_scent_name, p_quantity, null);
$$;

create or replace function public.allocate_stock_to_technician(
  p_technician_id uuid, p_model text, p_scent_name text, p_quantity numeric
) returns public.technician_stock language sql as $$
  select public._stock_allocate(p_technician_id, p_model, p_scent_name, p_quantity, null);
$$;

/* =============================== שלב א׳: הזמנת רכש נטו =============================== */

-- כמה כבר בדרך (הזמנות טיוטה/הוזמנו/התקבלו חלקית) — כדי לא להזמין פעמיים.
create or replace function public._on_order_qty(p_kind text, p_key text, p_exclude_po uuid default null)
returns numeric language sql stable as $$
  select coalesce(sum(greatest(l.ordered_qty - l.received_qty, 0)), 0)
    from public.purchase_order_lines l
    join public.purchase_orders o on o.id = l.po_id
   where o.status in ('draft', 'ordered', 'partially_received')
     and (p_exclude_po is null or o.id <> p_exclude_po)
     and l.item_kind = p_kind
     and (case when p_kind = 'scent' then l.scent_name else l.model end) = p_key;
$$;

-- p_lines: [{ "kind": "scent"|"model", "item": "דלתא", "target": 120, "qty"?: 90 }]
-- השרת מחשב לכל שורה: לרכוש = max(0, target − מחסן − בהזמנה פתוחה).
-- "qty" (אופציונלי) = עקיפה ידנית של המנהל. שורות שיוצאות 0 לא נכנסות.
create or replace function public.create_purchase_order(
  p_lines jsonb, p_route_name text default null, p_supplier text default 'ADL', p_notes text default ''
) returns public.purchase_orders
language plpgsql as $$
declare
  v_po       public.purchase_orders;
  v_line     jsonb;
  v_kind     text;
  v_key      text;
  v_target   numeric;
  v_existing numeric;
  v_on_order numeric;
  v_qty      numeric;
  v_count    int := 0;
begin
  if not public.is_admin() then raise exception 'רק מנהל יכול ליצור הזמנת רכש'; end if;
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'אין שורות להזמנה';
  end if;

  insert into public.purchase_orders (supplier, route_name, notes)
  values (coalesce(nullif(trim(p_supplier), ''), 'ADL'), nullif(trim(coalesce(p_route_name, '')), ''), coalesce(p_notes, ''))
  returning * into v_po;

  for v_line in select * from jsonb_array_elements(p_lines) loop
    v_kind   := v_line->>'kind';
    v_key    := nullif(trim(coalesce(v_line->>'item', '')), '');
    v_target := greatest(coalesce((v_line->>'target')::numeric, 0), 0);
    if v_kind not in ('scent', 'model') or v_key is null then
      raise exception 'שורת הזמנה לא תקינה: %', v_line;
    end if;

    if v_kind = 'scent' then
      select coalesce(sum(quantity), 0) into v_existing from public.warehouse_stock where scent_name = v_key and model is null;
    else
      select coalesce(sum(quantity), 0) into v_existing from public.warehouse_stock where model = v_key and scent_name = '';
    end if;
    v_on_order := public._on_order_qty(v_kind, v_key, v_po.id);

    v_qty := coalesce(nullif(v_line->>'qty', '')::numeric, greatest(v_target - v_existing - v_on_order, 0));
    v_qty := round(v_qty, 2);
    if v_kind = 'model' then v_qty := ceil(v_qty); end if;
    continue when v_qty <= 0;

    insert into public.purchase_order_lines
      (po_id, item_kind, scent_name, model, target_qty, existing_qty, on_order_qty, ordered_qty)
    values
      (v_po.id, v_kind, case when v_kind = 'scent' then v_key end, case when v_kind = 'model' then v_key end,
       v_target, v_existing, v_on_order, v_qty);
    v_count := v_count + 1;
  end loop;

  if v_count = 0 then
    raise exception 'אין מה להזמין — המחסן וההזמנות הפתוחות כבר מכסים את היעד';
  end if;
  return v_po;
end $$;

-- טיוטה → הוזמנה, או ביטול (רק לפני שהתחילה קליטה).
create or replace function public.set_purchase_order_status(p_po_id uuid, p_status text)
returns public.purchase_orders
language plpgsql as $$
declare v_po public.purchase_orders;
begin
  if not public.is_admin() then raise exception 'רק מנהל יכול לעדכן הזמנת רכש'; end if;
  select * into v_po from public.purchase_orders where id = p_po_id for update;
  if v_po is null then raise exception 'ההזמנה לא נמצאה'; end if;

  if p_status = 'ordered' and v_po.status = 'draft' then
    update public.purchase_orders set status = 'ordered', ordered_at = now(), updated_at = now() where id = p_po_id returning * into v_po;
  elsif p_status = 'cancelled' and v_po.status in ('draft', 'ordered') then
    update public.purchase_orders set status = 'cancelled', updated_at = now() where id = p_po_id returning * into v_po;
  else
    raise exception 'אי אפשר להעביר הזמנה מ-% ל-%', v_po.status, p_status;
  end if;
  return v_po;
end $$;

/* =============================== שלב ב׳: קליטה למחסן =============================== */

-- p_received: [{ "line_id": "...", "qty": 90 }] — מה שהגיע בפועל. null = כל היתרה.
-- כל כמות נכנסת ל-warehouse_stock דרך _stock_receive (ונרשמת בספר עם po_line_id).
create or replace function public.receive_purchase_order(p_po_id uuid, p_received jsonb default null)
returns public.purchase_orders
language plpgsql as $$
declare
  v_po    public.purchase_orders;
  v_line  public.purchase_order_lines;
  v_qty   numeric;
  v_total numeric := 0;
begin
  if not public.is_admin() then raise exception 'רק מנהל יכול לקלוט סחורה'; end if;
  select * into v_po from public.purchase_orders where id = p_po_id for update;
  if v_po is null then raise exception 'ההזמנה לא נמצאה'; end if;
  if v_po.status not in ('draft', 'ordered', 'partially_received') then
    raise exception 'ההזמנה במצב % — אין מה לקלוט', v_po.status;
  end if;

  for v_line in select * from public.purchase_order_lines where po_id = p_po_id order by id for update loop
    if p_received is null then
      v_qty := greatest(v_line.ordered_qty - v_line.received_qty, 0);
    else
      select coalesce(max((e->>'qty')::numeric), 0) into v_qty
        from jsonb_array_elements(p_received) e where (e->>'line_id')::uuid = v_line.id;
    end if;
    continue when coalesce(v_qty, 0) <= 0;
    if v_line.item_kind = 'model' and v_qty <> trunc(v_qty) then
      raise exception 'כמות מכשירים חייבת להיות שלמה (%)', v_line.model;
    end if;

    perform public._stock_receive(v_line.model, v_line.scent_name, v_qty, v_line.id);
    update public.purchase_order_lines set received_qty = received_qty + v_qty where id = v_line.id;
    v_total := v_total + v_qty;
  end loop;

  if v_total = 0 then raise exception 'לא סומנה אף כמות לקליטה'; end if;

  update public.purchase_orders o
     set status = case when not exists (
                    select 1 from public.purchase_order_lines l where l.po_id = o.id and l.received_qty < l.ordered_qty
                  ) then 'received' else 'partially_received' end,
         received_at = case when not exists (
                    select 1 from public.purchase_order_lines l where l.po_id = o.id and l.received_qty < l.ordered_qty
                  ) then now() else o.received_at end,
         ordered_at = coalesce(o.ordered_at, now()),
         updated_at = now()
   where o.id = p_po_id
  returning * into v_po;
  return v_po;
end $$;

/* =============================== שלב ג׳: העמסה לרכב =============================== */

-- p_items: [{ "kind": "scent"|"model", "item": "דלתא", "qty": 12.5 }]
-- הכול-או-כלום: אם לפריט אחד אין מספיק במחסן, שום דבר לא זז.
create or replace function public.load_technician_vehicle(
  p_technician_id uuid, p_items jsonb, p_route_name text default null
) returns jsonb
language plpgsql as $$
declare
  v_item  jsonb;
  v_kind  text;
  v_key   text;
  v_qty   numeric;
  v_count int := 0;
  v_total numeric := 0;
begin
  if not public.is_admin() then raise exception 'רק מנהל יכול להעמיס לרכב טכנאי'; end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' then raise exception 'אין פריטים להעמסה'; end if;

  for v_item in select * from jsonb_array_elements(p_items) loop
    v_kind := v_item->>'kind';
    v_key  := nullif(trim(coalesce(v_item->>'item', '')), '');
    v_qty  := round(coalesce((v_item->>'qty')::numeric, 0), 2);
    continue when v_qty <= 0;
    if v_kind not in ('scent', 'model') or v_key is null then raise exception 'פריט לא תקין: %', v_item; end if;

    perform public._stock_allocate(
      p_technician_id,
      case when v_kind = 'model' then v_key end,
      case when v_kind = 'scent' then v_key else '' end,
      v_qty,
      p_route_name
    );
    v_count := v_count + 1;
    v_total := v_total + v_qty;
  end loop;

  if v_count = 0 then raise exception 'אין כמויות להעמסה'; end if;
  return jsonb_build_object('items', v_count, 'total', v_total);
end $$;

/* =============================== הרשאות =============================== */

-- הפנימיות רצות בתור המשתמש המחובר (לא security definer) ובודקות is_admin() בעצמן.
revoke all on function public._stock_receive(text, text, numeric, uuid) from public, anon;
revoke all on function public._stock_allocate(uuid, text, text, numeric, text) from public, anon;
revoke all on function public._on_order_qty(text, text, uuid) from public, anon;
grant execute on function public._stock_receive(text, text, numeric, uuid) to authenticated;
grant execute on function public._stock_allocate(uuid, text, text, numeric, text) to authenticated;
grant execute on function public._on_order_qty(text, text, uuid) to authenticated;
grant execute on function public.receive_stock(text, text, numeric) to authenticated;
grant execute on function public.allocate_stock_to_technician(uuid, text, text, numeric) to authenticated;
grant execute on function public.create_purchase_order(jsonb, text, text, text) to authenticated;
grant execute on function public.set_purchase_order_status(uuid, text) to authenticated;
grant execute on function public.receive_purchase_order(uuid, jsonb) to authenticated;
grant execute on function public.load_technician_vehicle(uuid, jsonb, text) to authenticated;

notify pgrst, 'reload schema';
