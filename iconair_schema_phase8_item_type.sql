-- ---------------------------------------------------------------------
--  טיוטת סכימה — שלב 8: מתקן את הבאג שחייב לבחור גם דגם וגם ניחוח
--  יחד בטופס קליטת סחורה. מעכשיו: מכשיר = דגם בלבד (בלי ניחוח),
--  שמן = ניחוח בלבד (בלי דגם) — שני סוגי פריט בלעדיים, לא תלויים זה בזה.
--
--  ⚠ הצעה בלבד. לא רץ מעולם. דורש ששלבים 6 ו-7 כבר רצו.
--
--  הבאג בפועל: warehouse_stock.model הוגדר "not null references
--  device_models" מאז שלב 6 — כלומר כל שורה, כולל שורת שמן, חייבת
--  דגם. זו בדיוק הסיבה שה-UI (וגם ה-RPC מתחתיו) דרשו את שניהם.
--
--  הפתרון ב-warehouse_stock (טבלה חדשה, בלי היסטוריה — בטוח לשנות
--  אותה בחופשיות): model הופך nullable, ומתווסף CHECK שאוכף "בדיוק
--  אחד מהשניים" — model+scent_name ריק, או model ריק+scent_name.
--
--  ⚠ ב-technician_stock (טבלה עם נתונים אמיתיים מהעבר!) אנחנו לא
--  מוסיפים את אותו CHECK — שורות ישנות שכבר קיימות (דגם+ניחוח יחד,
--  לדוגמה "Icon 500"+"וניל") ייכשלו על CHECK כזה ונמחוק כלום. רק
--  מרפים את ה-NOT NULL על model (פעולה תמיד בטוחה, אף פעם לא נכשלת
--  על נתונים קיימים), כדי שהקצאה של "שמן בלי דגם" תוכל להיכנס לשם
--  בלי לשבור שום שורה ישנה.
--
--  ⚠⚠ תוצאת לוואי חשובה שאתה חייב לדעת: complete_visit (סיום ביקור)
--  מחפש מלאי נייד לפי model+scent יחד (v_model חובה, אף פעם לא null).
--  שמן שיוקצה מעכשיו "בלי דגם" (model=null) לעולם לא יימצא על ידי
--  complete_visit — הפונקציה תמיד תחפש שורה עם דגם ספציפי. כלומר:
--  ברגע שתתחיל להקצות שמן ללא דגם, טכנאים לא יוכלו "לצרוך" אותו
--  אוטומטית בסיום ביקור, עד שנעדכן גם את complete_visit בנפרד. זה לא
--  תוקן כאן בכוונה — זה שינוי להתנהגות שכבר בפרודקשן, ולא התבקש
--  במפורש בהודעה הזו. תגיד לי אם לתקן.
-- ---------------------------------------------------------------------

-- =====================================================================
--  1. warehouse_stock — model הופך nullable, מתווסף CHECK "בדיוק אחד".
-- =====================================================================

alter table public.warehouse_stock
  alter column model drop not null;

drop index if exists public.warehouse_stock_unique_idx;

alter table public.warehouse_stock
  drop constraint if exists warehouse_stock_item_shape;
alter table public.warehouse_stock
  add constraint warehouse_stock_item_shape
  check (
    (model is not null and scent_name = '') or
    (model is null and scent_name <> '')
  );

create unique index if not exists warehouse_stock_model_unique_idx
  on public.warehouse_stock (model) where model is not null;

create unique index if not exists warehouse_stock_scent_unique_idx
  on public.warehouse_stock (scent_name) where scent_name <> '';


-- =====================================================================
--  2. technician_stock — רק מרפים את ה-NOT NULL על model. לא מוסיפים
--  CHECK (יכשל על שורות ישנות עם דגם+ניחוח יחד). לא נוגעים באינדקס
--  הישן technician_stock_unique_idx — עדיין נחוץ לשורות הישנות
--  ול-complete_visit. מוסיפים אינדקס ייחודי נוסף, חלקי, רק לשורות
--  שמן-בלי-דגם, כדי שהקצאה חוזרת לאותו טכנאי+ניחוח תצטבר ולא תשוכפל.
-- =====================================================================

alter table public.technician_stock
  alter column model drop not null;

create unique index if not exists technician_stock_scent_only_unique_idx
  on public.technician_stock (technician_id, scent_name)
  where scent_name <> '' and model is null;


-- =====================================================================
--  3. receive_stock — מקבל בדיוק אחד מהשניים; שגיאה ברורה אם קיבל
--  את שניהם, או אף אחד. שני נתיבי upsert נפרדים (אין אינדקס אחד
--  שמכסה את שתי הצורות יחד, אז אי אפשר ON CONFLICT משותף).
-- =====================================================================

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
--  4. allocate_stock_to_technician — אותו עיקרון: בדיוק אחד, שני
--  נתיבים (דגם או שמן), כל אחד נועל ומעביר מהמחסן המתאים.
-- =====================================================================

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
