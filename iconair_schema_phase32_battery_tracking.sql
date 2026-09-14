-- Phase 32 — 2026-09-14, בקשה מפורשת: מעקב החלפת סוללות לדגמים
-- שפועלים על סוללות (Icon 50 = 1 סוללה, Icon 70 = 3 סוללות,
-- Icon 90 = 4 סוללות). נשען על אותה תשתית קיימת של oil_tracking
-- (כבר "יומן הטיפול" של המכשיר, ר' listOilHistoryForDevices) במקום
-- טבלה מקבילה — ביקור יחיד יכול לכלול גם מילוי שמן וגם החלפת סוללות,
-- לא שני תהליכים נפרדים.
alter table public.oil_tracking add column if not exists batteries_replaced smallint;

-- battery_count = כמה סוללות בסך הכל יש לדגם (null/0 = לא פועל על
-- סוללות בכלל — ר' capacity_ml, שנקבע באותה צורה, ללא ממשק עריכה
-- ייעודי, כי אלה קבועים פיזיים של הדגם, לא נתון שמשתנה).
alter table public.device_models add column if not exists battery_count smallint;

update public.device_models set battery_count = 1 where name = 'Icon 50';
update public.device_models set battery_count = 3 where name = 'Icon 70';
update public.device_models set battery_count = 4 where name = 'Icon 90';

-- complete_visit מקבל עכשיו גם p_batteries_replaced (ברירת מחדל null,
-- לא שובר קריאות ישנות/מתור-אופליין). כמו ב-upsert_route_stop
-- (phase29) — CREATE OR REPLACE עם פרמטר חדש יוצר עומס-יתר, לא מחליף
-- את הישן, אז חובה DROP מפורש אחריו.
create or replace function public.complete_visit(
  p_device_id uuid, p_event_type oil_event_type, p_scent_name text, p_liters_added numeric,
  p_level_before_pct smallint, p_level_after_pct smallint, p_notes text default null,
  p_batteries_replaced smallint default null
)
returns oil_tracking
language plpgsql
as $function$
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
    (device_id, event_type, scent_name, liters_added, level_before_pct, level_after_pct, notes, batteries_replaced)
  values
    (p_device_id, p_event_type, p_scent_name, p_liters_added, p_level_before_pct, p_level_after_pct, p_notes, p_batteries_replaced)
  returning * into v_entry;

  return v_entry;
end;
$function$;

drop function if exists public.complete_visit(uuid, oil_event_type, text, numeric, smallint, smallint, text);
