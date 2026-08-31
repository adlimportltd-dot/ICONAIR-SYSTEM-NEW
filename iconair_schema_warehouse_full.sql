-- ---------------------------------------------------------------------
--  סקריפט מאוחד ובטוח להרצה חוזרת — מחסן ראשי, הקצאה לטכנאים,
--  יחידות מול ליטרים, ובחירה בלעדית מכשיר/שמן. מכיל את כל שלבי
--  6+7+8 במקום אחד, כדי שלא תצטרך לעקוב מה כבר רץ ומה לא.
--  בטוח להריץ גם אם חלק מזה כבר רץ אצלך בעבר.
-- ---------------------------------------------------------------------

-- =====================================================================
--  1. warehouse_stock
-- =====================================================================

create table if not exists public.warehouse_stock (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null default '00000000-0000-0000-0000-000000000001',
  model      text references public.device_models (name),
  scent_name text not null default '',
  quantity   numeric(10,2) not null default 0 check (quantity >= 0),
  updated_at timestamptz not null default now()
);

alter table public.warehouse_stock alter column model drop not null;
alter table public.warehouse_stock alter column quantity type numeric(10,2) using quantity::numeric(10,2);

alter table public.warehouse_stock enable row level security;

drop policy if exists warehouse_stock_select on public.warehouse_stock;
create policy warehouse_stock_select on public.warehouse_stock
  for select to authenticated using (public.is_admin());

drop policy if exists warehouse_stock_insert on public.warehouse_stock;
create policy warehouse_stock_insert on public.warehouse_stock
  for insert to authenticated with check (public.is_admin());

drop policy if exists warehouse_stock_update on public.warehouse_stock;
create policy warehouse_stock_update on public.warehouse_stock
  for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists warehouse_stock_delete on public.warehouse_stock;
create policy warehouse_stock_delete on public.warehouse_stock
  for delete to authenticated using (public.is_admin());

drop index if exists public.warehouse_stock_unique_idx;

alter table public.warehouse_stock drop constraint if exists warehouse_stock_item_shape;
alter table public.warehouse_stock
  add constraint warehouse_stock_item_shape
  check (
    (model is not null and scent_name = '') or
    (model is null and scent_name <> '')
  );

alter table public.warehouse_stock drop constraint if exists warehouse_stock_device_whole_qty;
alter table public.warehouse_stock
  add constraint warehouse_stock_device_whole_qty
  check (model is null or quantity = trunc(quantity));

create unique index if not exists warehouse_stock_model_unique_idx
  on public.warehouse_stock (model) where model is not null;

create unique index if not exists warehouse_stock_scent_unique_idx
  on public.warehouse_stock (scent_name) where scent_name <> '';

do $$ begin
  alter publication supabase_realtime add table public.warehouse_stock;
exception when duplicate_object then null; end $$;


-- =====================================================================
--  2. technician_stock — טבלה קיימת עם נתונים אמיתיים. רק הרחבות
--  בטוחות: quantity הופך numeric, model הופך nullable. לא נוגעים
--  ולא מוחקים שום שורה קיימת.
-- =====================================================================

alter table public.technician_stock alter column quantity type numeric(10,2) using quantity::numeric(10,2);
alter table public.technician_stock alter column model drop not null;

alter table public.technician_stock drop constraint if exists technician_stock_device_whole_qty;
alter table public.technician_stock
  add constraint technician_stock_device_whole_qty
  check (scent_name <> '' or quantity = trunc(quantity));

create unique index if not exists technician_stock_scent_only_unique_idx
  on public.technician_stock (technician_id, scent_name)
  where scent_name <> '' and model is null;


-- =====================================================================
--  3. receive_stock — קליטת סחורה למחסן. בדיוק אחד מ-(דגם, ניחוח),
--  לעולם לא שניהם ולא אף אחד. מכשירים ביחידות שלמות, שמנים בליטרים.
-- =====================================================================

drop function if exists public.receive_stock(text, text, integer);

create or replace function public.receive_stock(
  p_model      text,
  p_scent_name text,
  p_quantity   numeric
)
returns public.warehouse_stock
language plpgsql
as $$
declare
  v_model     text := nullif(p_model, '');
  v_scent_key text := coalesce(nullif(p_scent_name, ''), '');
  v_row       public.warehouse_stock;
begin
  if not public.is_admin() then
    raise exception 'רק מנהל יכול לקלוט סחורה למחסן';
  end if;

  if p_quantity is null or p_quantity <= 0 then
    raise exception 'כמות לקליטה חייבת להיות גדולה מ-0';
  end if;

  if (v_model is null) = (v_scent_key = '') then
    raise exception 'יש לבחור בדיוק אחד: דגם מכשיר, או ניחוח — לא שניהם ולא אף אחד';
  end if;

  if v_model is not null and p_quantity <> trunc(p_quantity) then
    raise exception 'כמות מכשירים חייבת להיות מספר יחידות שלם, קיבלתי %', p_quantity;
  end if;

  if v_model is not null then
    insert into public.warehouse_stock (model, scent_name, quantity)
    values (v_model, '', p_quantity)
    on conflict (model) where model is not null
    do update set quantity   = public.warehouse_stock.quantity + excluded.quantity,
                  updated_at = now()
    returning * into v_row;
  else
    insert into public.warehouse_stock (model, scent_name, quantity)
    values (null, v_scent_key, p_quantity)
    on conflict (scent_name) where scent_name <> ''
    do update set quantity   = public.warehouse_stock.quantity + excluded.quantity,
                  updated_at = now()
    returning * into v_row;
  end if;

  return v_row;
end;
$$;

grant execute on function public.receive_stock(text, text, numeric) to authenticated;


-- =====================================================================
--  4. allocate_stock_to_technician — מעביר מהמחסן לטכנאי, אטומית.
-- =====================================================================

drop function if exists public.allocate_stock_to_technician(uuid, text, text, integer);

create or replace function public.allocate_stock_to_technician(
  p_technician_id uuid,
  p_model         text,
  p_scent_name    text,
  p_quantity      numeric
)
returns public.technician_stock
language plpgsql
as $$
declare
  v_model     text := nullif(p_model, '');
  v_scent_key text := coalesce(nullif(p_scent_name, ''), '');
  v_wh_row    public.warehouse_stock;
  v_tech_row  public.technician_stock;
begin
  if not public.is_admin() then
    raise exception 'רק מנהל יכול להקצות מלאי לטכנאי';
  end if;

  if p_quantity is null or p_quantity <= 0 then
    raise exception 'כמות להקצאה חייבת להיות גדולה מ-0';
  end if;

  if (v_model is null) = (v_scent_key = '') then
    raise exception 'יש לבחור בדיוק אחד: דגם מכשיר, או ניחוח — לא שניהם ולא אף אחד';
  end if;

  if v_model is not null and p_quantity <> trunc(p_quantity) then
    raise exception 'כמות מכשירים חייבת להיות מספר יחידות שלם, קיבלתי %', p_quantity;
  end if;

  if v_model is not null then
    select * into v_wh_row
      from public.warehouse_stock
     where model = v_model and scent_name = ''
     for update;
  else
    select * into v_wh_row
      from public.warehouse_stock
     where scent_name = v_scent_key and model is null
     for update;
  end if;

  if v_wh_row is null or v_wh_row.quantity < p_quantity then
    raise exception 'אין מספיק מלאי במחסן ל-% (יש %, נדרש %)',
      coalesce(v_model, v_scent_key), coalesce(v_wh_row.quantity, 0), p_quantity;
  end if;

  update public.warehouse_stock
     set quantity = quantity - p_quantity, updated_at = now()
   where id = v_wh_row.id;

  if v_model is not null then
    insert into public.technician_stock (technician_id, model, scent_name, quantity)
    values (p_technician_id, v_model, '', p_quantity)
    on conflict (technician_id, model, scent_name)
    do update set quantity   = public.technician_stock.quantity + excluded.quantity,
                  updated_at = now()
    returning * into v_tech_row;
  else
    insert into public.technician_stock (technician_id, model, scent_name, quantity)
    values (p_technician_id, null, v_scent_key, p_quantity)
    on conflict (technician_id, scent_name) where scent_name <> '' and model is null
    do update set quantity   = public.technician_stock.quantity + excluded.quantity,
                  updated_at = now()
    returning * into v_tech_row;
  end if;

  return v_tech_row;
end;
$$;

grant execute on function public.allocate_stock_to_technician(uuid, text, text, numeric) to authenticated;
