-- ---------------------------------------------------------------------
--  טיוטת סכימה — שלב 7: מכשירים ביחידות שלמות, שמנים בליטרים.
--
--  ⚠ הצעה בלבד. לא רץ מעולם מול בסיס הנתונים. דורש ששלב 6
--  (iconair_schema_phase6_warehouse.sql) כבר רץ בהצלחה קודם.
--
--  המצב עד עכשיו: warehouse_stock.quantity ו-technician_stock.quantity
--  היו integer — טוב למכשירים (יחידות שלמות), לא נכון לשמנים (שרוכשים
--  ומקצים בליטרים, כולל שברים — 5.5 ל', 10 ל' וכו').
--
--  הפתרון: quantity הופך ל-numeric בשתי הטבלאות (numeric תומך גם
--  בשלמים וגם בעשרוניים — לא צריך עמודה נפרדת לכל סוג), ומתווסף
--  CHECK שאוכף שורת "מכשיר" (scent_name = '') תישאר מספר שלם — רק
--  שורת "שמן" (scent_name לא ריק) יכולה להכיל שבר. שום ערך קיים לא
--  משתנה במעבר מ-integer ל-numeric (5 נשאר 5, רק הטיפוס משתנה).
--
--  שתי הפונקציות (receive_stock, allocate_stock_to_technician) חייבות
--  DROP לפני CREATE כי טיפוס הפרמטר האחרון משתנה מ-integer ל-numeric —
--  CREATE OR REPLACE לא תומך בשינוי טיפוס פרמטר, רק בגוף הפונקציה.
--
--  ⚠ complete_visit לא נגע כאן. הוא עדיין מוריד "יחידה 1" קבועה
--  מ-technician_stock בכל סיום ביקור (ר' iconair_schema_phase3_visits.sql).
--  זה עדיין נכון למכשירים, אבל לא לשורות שמן שעכשיו נמדדות בליטרים —
--  ביקור שצרך 2.3 ליטר יוריד רק "1" מהמלאי, לא 2.3. הפונקציה כבר
--  מקבלת p_liters_added כפרמטר ופשוט לא משתמשת בו לניכוי המלאי. זה
--  לא תוקן כאן במכוון — זה שינוי התנהגות בפונקציה שכבר רצה אצלך
--  בפרודקשן, ולא התבקש במפורש. תגיד לי אם לתקן את זה בנפרד.
-- ---------------------------------------------------------------------

-- =====================================================================
--  1. quantity: integer → numeric, בשתי הטבלאות.
-- =====================================================================

alter table public.warehouse_stock
  alter column quantity type numeric(10,2) using quantity::numeric(10,2);

alter table public.technician_stock
  alter column quantity type numeric(10,2) using quantity::numeric(10,2);


-- =====================================================================
--  2. אכיפה: שורת "מכשיר" (בלי ניחוח) חייבת להישאר מספר יחידות שלם.
--  שורת "שמן" (עם ניחוח) מותרת עם שבר עשרוני (ליטרים).
-- =====================================================================

alter table public.warehouse_stock
  drop constraint if exists warehouse_stock_device_whole_qty;
alter table public.warehouse_stock
  add constraint warehouse_stock_device_whole_qty
  check (scent_name <> '' or quantity = trunc(quantity));

alter table public.technician_stock
  drop constraint if exists technician_stock_device_whole_qty;
alter table public.technician_stock
  add constraint technician_stock_device_whole_qty
  check (scent_name <> '' or quantity = trunc(quantity));


-- =====================================================================
--  3. receive_stock — הפרמטר האחרון עובר ל-numeric, ומתווספת בדיקה
--  מפורשת: אם זו שורת מכשיר (בלי ניחוח), הכמות חייבת להיות שלמה.
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
  v_scent_key text := coalesce(p_scent_name, '');
  v_row       public.warehouse_stock;
begin
  if not public.is_admin() then
    raise exception 'רק מנהל יכול לקלוט סחורה למחסן';
  end if;

  if p_quantity is null or p_quantity <= 0 then
    raise exception 'כמות לקליטה חייבת להיות גדולה מ-0';
  end if;

  if v_scent_key = '' and p_quantity <> trunc(p_quantity) then
    raise exception 'כמות מכשירים (ללא ניחוח) חייבת להיות מספר יחידות שלם, קיבלתי %', p_quantity;
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

grant execute on function public.receive_stock(text, text, numeric) to authenticated;


-- =====================================================================
--  4. allocate_stock_to_technician — אותו עיקרון: numeric + בדיקת
--  שלמות למכשירים, לפני שנועלים ומעבירים.
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

  if v_scent_key = '' and p_quantity <> trunc(p_quantity) then
    raise exception 'כמות מכשירים (ללא ניחוח) חייבת להיות מספר יחידות שלם, קיבלתי %', p_quantity;
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

grant execute on function public.allocate_stock_to_technician(uuid, text, text, numeric) to authenticated;
