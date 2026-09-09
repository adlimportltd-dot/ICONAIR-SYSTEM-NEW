-- ---------------------------------------------------------------------
--  שלב 19 — סנכרון מדויק בין "סיום ביקור" בשטח למלאי הנייד, + החזרה
--  עצמאית של טכנאי בסוף יום. תיקון לבאג קיים בפרודקשן, לא תוסף חדש.
--
--  ⚠ הרקע (חשוב להבין לפני שמריצים): complete_visit נכתב בשלב 3, לפני
--  ששלבים 7+8 שינו את צורת technician_stock פעמיים — מ"יחידה אחת קבועה
--  לפי model+scent יחד" ל"כמות מדויקת (כולל ליטרים) לפי scent בלבד,
--  model=NULL". שני השלבים ההם כבר תיעדו את זה במפורש (⚠⚠ בקבצים
--  phase7/phase8) וביקשו אישור לתקן בנפרד — זה התיקון הזה, לפי בקשה
--  מפורשת עכשיו. התוצאה בפועל עד כה: כל קריאה חיה ל-complete_visit
--  נכשלת (כי אף שורת technician_stock לא תואמת model+scent יחד), אז
--  ה-UI כבר נופל בשקט ל-createOilEntry (ר' RoutesScreen/OilScreen) —
--  הביקור נרשם, אבל המלאי הנייד מעולם לא ירד באמת. זה בדיוק מה שתוקן כאן.
-- ---------------------------------------------------------------------

-- =====================================================================
--  1. complete_visit — נכתב מחדש: מנכה לפי scent בלבד (model is null,
--  תואם את allocate_stock_to_technician/return_stock_to_warehouse
--  הקיימים), ואת הכמות המדויקת p_liters_added — לא "1" קבוע.
--
--  אם p_liters_added <= 0 (בדיקת מפלס בלי מילוי בפועל, event_type
--  'reading') — לא נוגעים במלאי בכלל, רק רושמים. אם יש מילוי אבל בלי
--  ניחוח מצוין, נופלים לניחוח הנוכחי של המכשיר (כמו הטריגר הקיים
--  oil_tracking_sync_device). אם עדיין אין ניחוח לשייך את הצריכה אליו —
--  לא חוסמים את רישום הביקור, פשוט לא מנכים (אי אפשר לנכות "משהו").
--
--  ⚠ נשאר בכוונה לא security definer — בדיוק כמו שהיה: רץ בתור הטכנאי
--  שקרא לו, כך שה-RLS הרגילה על oil_tracking/technician_stock ממשיכה
--  לחול בדיוק כמו היום (טכנאי יכול לגעת רק בשורות של עצמו).
-- =====================================================================

create or replace function public.complete_visit(
  p_device_id        uuid,
  p_event_type       public.oil_event_type,
  p_scent_name       text,
  p_liters_added     numeric,
  p_level_before_pct smallint,
  p_level_after_pct  smallint,
  p_notes            text default null
)
returns public.oil_tracking
language plpgsql
as $$
declare
  v_scent_key text;
  v_stock_row public.technician_stock;
  v_entry     public.oil_tracking;
begin
  if not exists (select 1 from public.devices where id = p_device_id) then
    raise exception 'מכשיר לא נמצא: %', p_device_id;
  end if;

  if p_liters_added is not null and p_liters_added > 0 then
    v_scent_key := nullif(coalesce(nullif(p_scent_name, ''),
                    (select scent_name from public.devices where id = p_device_id)), '');

    if v_scent_key is not null then
      -- נועל את שורת המלאי כדי שלא יקרה מרוץ בין שני ביקורים שנרשמים
      -- באותו רגע (לא סביר לטכנאי אחד, אבל בטוח שלא כואב).
      select * into v_stock_row
        from public.technician_stock
       where technician_id = auth.uid() and model is null and scent_name = v_scent_key
       for update;

      if v_stock_row is null or v_stock_row.quantity < p_liters_added then
        raise exception 'אין מלאי נייד ל-% (יש %, נדרש %) — לא ניתן לסיים ביקור',
          v_scent_key, coalesce(v_stock_row.quantity, 0), p_liters_added;
      end if;

      update public.technician_stock
         set quantity = quantity - p_liters_added, updated_at = now()
       where id = v_stock_row.id;

      insert into public.stock_movements
        (movement_type, technician_id, model, scent_name, quantity, device_id, created_by)
      values
        ('field_use', auth.uid(), null, v_scent_key, p_liters_added, p_device_id, auth.uid());
    end if;
  end if;

  insert into public.oil_tracking
    (device_id, event_type, scent_name, liters_added, level_before_pct, level_after_pct, notes)
  values
    (p_device_id, p_event_type, p_scent_name, p_liters_added, p_level_before_pct, p_level_after_pct, p_notes)
  returning * into v_entry;

  -- הטריגרים הקיימים על oil_tracking (enforce_capacity, sync_device)
  -- כבר רצים אוטומטית — לא כתוב כאן.

  return v_entry;
end;
$$;

grant execute on function public.complete_visit(
  uuid, public.oil_event_type, text, numeric, smallint, smallint, text
) to authenticated;


-- =====================================================================
--  2. stock_movements — עמודת device_id (מקשרת תנועת "צריכה בשטח" ישר
--  לכתובת/ללקוח, בלי לעבור דרך oil_tracking), וסוג תנועה חדש 'field_use'.
-- =====================================================================

-- on delete set null (לא cascade/restrict): מחיקת מכשיר בעתיד (כמו ב-
-- service_calls.device_id) לא צריכה להיחסם או למחוק היסטוריית מלאי אמיתית.
alter table public.stock_movements
  add column if not exists device_id uuid references public.devices (id) on delete set null;

create index if not exists stock_movements_device_idx
  on public.stock_movements (device_id, created_at desc);

alter table public.stock_movements
  drop constraint if exists stock_movements_movement_type_check;
alter table public.stock_movements
  add constraint stock_movements_movement_type_check
  check (movement_type = any (array['allocate', 'return', 'field_use']));

-- INSERT: עדיין מנהל-בלבד לתנועות allocate/return (ללא שינוי), + עכשיו
-- גם טכנאי על שורת 'field_use' של עצמו בלבד — זה מה ש-complete_visit
-- (לא security definer) צריך כדי לרשום את תנועת הצריכה שלו.
drop policy if exists stock_movements_insert on public.stock_movements;
create policy stock_movements_insert on public.stock_movements
  for insert to authenticated
  with check (
    public.is_admin()
    or (movement_type = 'field_use' and technician_id = auth.uid() and created_by = auth.uid())
  );


-- =====================================================================
--  3. return_stock_to_warehouse — הופך ל-security definer כדי שטכנאי
--  יוכל לדווח בעצמו על החזרה בסוף יום (warehouse_stock הוא נתון ניהולי,
--  RLS חוסם טכנאי מלכתוב אליו ישירות — בדיוק כמו שצריך; הפונקציה
--  עצמה היא שער-הכניסה היחיד, עם בדיקת בעלות מפורשת לפני כל דבר).
--  ⚠ בניגוד ל-complete_visit: זה בכוונה כן security definer, כי כאן
--  יש צורך אמיתי לחצות מ"מותר לטכנאי" ל"מותר למנהל בלבד" (warehouse_stock).
-- =====================================================================

create or replace function public.return_stock_to_warehouse(p_technician_id uuid, p_model text, p_scent_name text, p_quantity numeric)
 returns warehouse_stock
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_model     text := nullif(p_model, '');
  v_scent_key text := coalesce(nullif(p_scent_name, ''), '');
  v_tech_row  public.technician_stock;
  v_wh_row    public.warehouse_stock;
begin
  if not (public.is_admin() or auth.uid() = p_technician_id) then
    raise exception 'רק מנהל או הטכנאי עצמו יכולים לרשום החזרת מלאי';
  end if;

  if p_quantity is null or p_quantity <= 0 then
    raise exception 'כמות להחזרה חייבת להיות גדולה מ-0';
  end if;

  if (v_model is null) = (v_scent_key = '') then
    raise exception 'יש לבחור בדיוק אחד: דגם מכשיר, או ניחוח — לא שניהם ולא אף אחד';
  end if;

  select * into v_tech_row
    from public.technician_stock
   where technician_id = p_technician_id
     and coalesce(model, '') = coalesce(v_model, '')
     and scent_name = v_scent_key
   for update;

  if v_tech_row is null or v_tech_row.quantity < p_quantity then
    raise exception 'לטכנאי אין מספיק מלאי להחזיר (יש %, מבוקש להחזיר %)',
      coalesce(v_tech_row.quantity, 0), p_quantity;
  end if;

  update public.technician_stock set quantity = quantity - p_quantity, updated_at = now() where id = v_tech_row.id;

  if v_model is not null then
    insert into public.warehouse_stock (model, scent_name, quantity)
    values (v_model, '', p_quantity)
    on conflict (model) where model is not null
    do update set quantity = public.warehouse_stock.quantity + excluded.quantity, updated_at = now()
    returning * into v_wh_row;
  else
    insert into public.warehouse_stock (model, scent_name, quantity)
    values (null, v_scent_key, p_quantity)
    on conflict (scent_name) where scent_name <> ''
    do update set quantity = public.warehouse_stock.quantity + excluded.quantity, updated_at = now()
    returning * into v_wh_row;
  end if;

  insert into public.stock_movements (movement_type, technician_id, model, scent_name, quantity, created_by)
  values ('return', p_technician_id, v_model, v_scent_key, p_quantity, auth.uid());

  return v_wh_row;
end;
$function$;

grant execute on function public.return_stock_to_warehouse(uuid, text, text, numeric) to authenticated;
