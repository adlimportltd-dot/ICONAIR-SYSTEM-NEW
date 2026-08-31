-- ---------------------------------------------------------------------
--  טיוטת סכימה — שלב 6: מחסן ראשי (warehouse_stock) + הקצאה בטוחה
--  לטכנאים. בונה על technician_stock ו-device_models שכבר קיימים —
--  לא נוגע ולא מוחק שום שורה קיימת בשתיהן.
--
--  ⚠ הצעה בלבד. לא רץ מעולם מול בסיס הנתונים.
--
--  המצב היום: technician_stock הוא "מה יש ברכב", ומתעדכן רק בשתי
--  דרכים — טעינה ידנית ע"י מנהל (setTechnicianStock, קובע כמות
--  מוחלטת), או צריכה אוטומטית ביחידה אחת דרך complete_visit. אין שום
--  מושג של "מלאי ראשי" שממנו מחלקים לטכנאים — כל טעינה היא כתיבה
--  יש-מאין, בלי מעקב על מה שבאמת נרכש/נכנס למחסן.
--
--  הפתרון: טבלת warehouse_stock, זהה בצורתה ל-technician_stock (אותו
--  מפתח model+scent_name), ושתי פונקציות אטומיות בדיוק כמו complete_visit:
--    receive_stock              — קליטת סחורה חדשה למחסן (מוסיף, לא קובע)
--    allocate_stock_to_technician — מעביר יחידות מהמחסן לטכנאי ספציפי,
--                                   נועל את שורת המחסן כדי שלא יהיה מרוץ
--                                   בין שתי הקצאות בו-זמנית, ובודק מלאי
--                                   מספיק לפני שמוריד — הכול או כלום.
--
--  מלאי ברכב שכבר נטען בעבר (setTechnicianStock הישן) נשאר כמו שהוא —
--  הפונקציה הזו רק מוסיפה ערוץ נוסף, בטוח יותר, ולא מחליפה אותו.
-- ---------------------------------------------------------------------

-- =====================================================================
--  1. טבלת warehouse_stock — "כמה יש במחסן הראשי", לפי דגם+ניחוח,
--  באותו דפוס בדיוק כמו technician_stock.
-- =====================================================================

create table if not exists public.warehouse_stock (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null default '00000000-0000-0000-0000-000000000001',
  model      text not null references public.device_models (name),
  scent_name text not null default '',
  quantity   integer not null default 0 check (quantity >= 0),
  updated_at timestamptz not null default now()
);

create unique index if not exists warehouse_stock_unique_idx
  on public.warehouse_stock (model, scent_name);

alter table public.warehouse_stock enable row level security;

-- מנהל בלבד, בכל כיוון — המחסן הראשי הוא נתון ניהולי, לא רלוונטי
-- לטכנאי (הוא רואה רק מה שהוקצה לו דרך technician_stock).
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


-- =====================================================================
--  2. receive_stock — קליטת סחורה חדשה למחסן. מוסיף לכמות הקיימת
--  (רכש נוסף), לא קובע כמות מוחלטת — כדי שתיעוד "נכנסו 20 יחידות
--  היום" לא ימחק בטעות מה שכבר היה שם אם שתי קליטות קורות באותו יום.
-- =====================================================================

create or replace function public.receive_stock(
  p_model      text,
  p_scent_name text,
  p_quantity   integer
)
returns public.warehouse_stock
language plpgsql
as $$
declare
  v_scent_key text := coalesce(p_scent_name, '');
  v_row       public.warehouse_stock;
begin
  if not public.is_admin() then
    raise exception 'רק מנהל יכול לקלוט סחורה למחסן';
  end if;

  if p_quantity is null or p_quantity <= 0 then
    raise exception 'כמות לקליטה חייבת להיות גדולה מ-0';
  end if;

  insert into public.warehouse_stock (model, scent_name, quantity)
  values (p_model, v_scent_key, p_quantity)
  on conflict (model, scent_name)
  do update set quantity   = public.warehouse_stock.quantity + excluded.quantity,
                updated_at = now()
  returning * into v_row;

  return v_row;
end;
$$;

grant execute on function public.receive_stock(text, text, integer) to authenticated;


-- =====================================================================
--  3. allocate_stock_to_technician — מעביר יחידות מהמחסן לטכנאי,
--  אטומית: נועל את שורת המחסן (FOR UPDATE), מוודא שיש מספיק, מוריד
--  מהמחסן ומוסיף לטכנאי באותה טרנזקציה. אם אין מספיק — שגיאה, ושום
--  צד לא זז (בדיוק דפוס complete_visit הקיים).
-- =====================================================================

create or replace function public.allocate_stock_to_technician(
  p_technician_id uuid,
  p_model         text,
  p_scent_name    text,
  p_quantity      integer
)
returns public.technician_stock
language plpgsql
as $$
declare
  v_scent_key text := coalesce(p_scent_name, '');
  v_wh_row    public.warehouse_stock;
  v_tech_row  public.technician_stock;
begin
  if not public.is_admin() then
    raise exception 'רק מנהל יכול להקצות מלאי לטכנאי';
  end if;

  if p_quantity is null or p_quantity <= 0 then
    raise exception 'כמות להקצאה חייבת להיות גדולה מ-0';
  end if;

  select * into v_wh_row
    from public.warehouse_stock
   where model = p_model and scent_name = v_scent_key
   for update;

  if v_wh_row is null or v_wh_row.quantity < p_quantity then
    raise exception 'אין מספיק מלאי במחסן ל-% / % (יש %, נדרש %)',
      p_model, coalesce(nullif(p_scent_name, ''), 'ללא ניחוח'),
      coalesce(v_wh_row.quantity, 0), p_quantity;
  end if;

  update public.warehouse_stock
     set quantity = quantity - p_quantity, updated_at = now()
   where id = v_wh_row.id;

  insert into public.technician_stock (technician_id, model, scent_name, quantity)
  values (p_technician_id, p_model, v_scent_key, p_quantity)
  on conflict (technician_id, model, scent_name)
  do update set quantity   = public.technician_stock.quantity + excluded.quantity,
                updated_at = now()
  returning * into v_tech_row;

  return v_tech_row;
end;
$$;

grant execute on function public.allocate_stock_to_technician(uuid, text, text, integer) to authenticated;


-- =====================================================================
--  4. Realtime — בלי זה מסך המחסן לא יתעדכן בלייב בין שני מנהלים
--  שפתוחים במקביל, בדיוק כמו שהיה חסר ל-technician_stock לפני שלב 3ב.
-- =====================================================================

do $$ begin
  alter publication supabase_realtime add table public.warehouse_stock;
exception when duplicate_object then null; end $$;
