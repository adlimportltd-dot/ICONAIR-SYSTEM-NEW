-- ---------------------------------------------------------------------
--  טיוטת סכימה — הופכת את device_model מ-enum לטבלה ניתנת-לניהול,
--  באותו דפוס בדיוק כמו scents (iconair_schema_phase4_scents.sql).
--
--  ⚠ הצעה בלבד. לא רץ מעולם מול בסיס הנתונים.
--
--  למה זה בכלל נחוץ: דגמי מכשירים היום הם public.device_model — enum
--  אמיתי ב-Postgres. אי אפשר "להוסיף שורה" לenum משום ממשק — צריך
--  ALTER TYPE, שהוא DDL שרק אתה יכול להריץ ב-SQL Editor, ואי אפשר
--  להריץ אותו מהאפליקציה (מפתח anon/authenticated לא מורשה ל-DDL,
--  וגם אם היה מורשה — Postgres אוסר להשתמש בערך enum חדש באותה
--  טרנזקציה שבה הוא נוצר, בדיוק הבעיה שכבר פגשנו עם הייבוא). כלומר
--  "מנהל מוסיף דגם והוא זמין מיד בכל התפריטים" פשוט לא אפשרי כל עוד
--  model הוא enum — לא משנה כמה יפה יהיה מסך הניהול.
--
--  הפתרון: להפוך את model לעמודת text עם FK לטבלת device_models,
--  בדיוק כמו scent_name מול scents. זה בטוח יותר ממה שנשמע: ל-enum
--  יש בדיוק 10 ערכים אפשריים (זה כל מה שיכול להיות ב-devices.model
--  ו-technician_stock.model כרגע — enum מבטיח את זה במבנה), אז אחרי
--  שנזרע את אותם 10 ב-device_models, ה-FK יאמת בהצלחה על 100% מהשורות
--  הקיימות. שום ערך לא משתנה — 'Icon 500' כ-enum הופך ל-'Icon 500'
--  כטקסט, אותה מחרוזת בדיוק. שום שורה לא נמחקת ושום נתון לא משתנה.
--
--  ה-enum הישן (public.device_model) לא נמחק בקובץ הזה — פשוט מפסיקים
--  להשתמש בו. מחיקתו היא ניקיון אופציונלי, לא נחוץ לתפקוד.
-- ---------------------------------------------------------------------

-- =====================================================================
--  1. טבלת device_models — זהה בצורתה ל-scents.
-- =====================================================================

create table if not exists public.device_models (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null default '00000000-0000-0000-0000-000000000001',
  name       text not null unique,
  active     boolean not null default true,
  created_at timestamptz not null default now()
);

alter table public.device_models enable row level security;

drop policy if exists device_models_select on public.device_models;
create policy device_models_select on public.device_models
  for select to authenticated using (true);

-- הוספה/עריכה/מחיקה ניהוליות בלבד.
drop policy if exists device_models_insert on public.device_models;
create policy device_models_insert on public.device_models
  for insert to authenticated with check (public.is_admin());

drop policy if exists device_models_update on public.device_models;
create policy device_models_update on public.device_models
  for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists device_models_delete on public.device_models;
create policy device_models_delete on public.device_models
  for delete to authenticated using (public.is_admin());


-- =====================================================================
--  2. זריעת 10 הדגמים הקיימים — בדיוק מה שה-enum כבר מכיר. סדר לא
--  משנה; ה-name הוא הזיהוי היחיד שהאפליקציה משתמשת בו.
-- =====================================================================

insert into public.device_models (name) values
  ('Icon 50'), ('Icon 70'), ('Icon 80'), ('Icon 90'), ('Icon 150'),
  ('Icon 300'), ('Icon 400'), ('Icon 500'), ('Icon 600'), ('Icon 700')
on conflict (name) do nothing;


-- =====================================================================
--  3. המרת devices.model ו-technician_stock.model מ-enum לטקסט+FK.
--
--  ⚠ הרץ את שלב 2 (הזריעה) לפני זה. ה-FK למטה נכשל אם device_models
--  עוד ריקה בזמן שה-devices/technician_stock הקיימות כבר יש להן ערכים.
-- =====================================================================

alter table public.devices
  alter column model type text using model::text;

alter table public.devices
  add constraint devices_model_fkey
  foreign key (model) references public.device_models (name);

alter table public.technician_stock
  alter column model type text using model::text;

alter table public.technician_stock
  add constraint technician_stock_model_fkey
  foreign key (model) references public.device_models (name);


-- =====================================================================
--  4. complete_visit הכריז על v_model כ-public.device_model — עכשיו
--  שהעמודה עצמה טקסט, המשתנה חייב להיות טקסט גם הוא, אחרת ההשוואה
--  ל-technician_stock.model (גם הוא עכשיו טקסט) תיכשל על type mismatch.
--  שאר גוף הפונקציה זהה למה שכבר רץ אצלך.
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
  v_model      text;
  v_scent_key  text := coalesce(p_scent_name, '');
  v_stock_row  public.technician_stock;
  v_entry      public.oil_tracking;
begin
  select model into v_model from public.devices where id = p_device_id;
  if v_model is null then
    raise exception 'מכשיר לא נמצא: %', p_device_id;
  end if;

  select * into v_stock_row
    from public.technician_stock
   where technician_id = auth.uid() and model = v_model and scent_name = v_scent_key
   for update;

  if v_stock_row is null or v_stock_row.quantity < 1 then
    raise exception 'אין מלאי נייד ל-% / % — לא ניתן לסיים ביקור', v_model, coalesce(nullif(p_scent_name, ''), 'ללא ניחוח');
  end if;

  update public.technician_stock
     set quantity = quantity - 1, updated_at = now()
   where id = v_stock_row.id;

  insert into public.oil_tracking
    (device_id, event_type, scent_name, liters_added, level_before_pct, level_after_pct, notes)
  values
    (p_device_id, p_event_type, p_scent_name, p_liters_added, p_level_before_pct, p_level_after_pct, p_notes)
  returning * into v_entry;

  return v_entry;
end;
$$;

grant execute on function public.complete_visit(
  uuid, public.oil_event_type, text, numeric, smallint, smallint, text
) to authenticated;
