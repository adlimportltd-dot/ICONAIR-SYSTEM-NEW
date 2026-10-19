-- ---------------------------------------------------------------------
-- שלב 77 — התקנה חדשה בכתובת ספציפית של לקוח ריבוי-כתובות (כמו אוורסט).
-- 2026-10-20, בקשה מפורשת: בהתקנה ללקוח קיים אפשר לבחור גם בניין/כתובת
-- (customer_sites), ובסימון "הותקן" המכשיר נרשם על הכתובת הזו.
-- הורץ ב-Supabase של אייקון ב-20.10.26. בטוח להריץ שוב (idempotent).
--
-- תואם לאחור: p_site_id הוא פרמטר אחרון עם ברירת מחדל null.
-- כשההתקנה על כתובת: הקו נקבע לפי עיר הכתובת (city_routes) כמו לכל
-- אתר, ולכן לא משנים את route_name של הלקוח הראשי.
-- ---------------------------------------------------------------------

alter table public.service_calls
  add column if not exists install_site_id uuid references public.customer_sites (id) on delete set null;

drop function if exists public.create_installation(uuid, jsonb, text, text, text, uuid, timestamptz, text, text);

create or replace function public.create_installation(
  p_customer_id uuid,
  p_new_customer jsonb,
  p_model text,
  p_scent text,
  p_route text,
  p_assigned_to uuid default null,
  p_scheduled_at timestamptz default null,
  p_location_note text default null,
  p_notes text default null,
  p_site_id uuid default null
) returns public.service_calls
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_customer_id uuid := p_customer_id;
  v_name text;
  v_route text := nullif(trim(coalesce(p_route, '')), '');
  v_call public.service_calls;
begin
  if auth.uid() is null then raise exception 'יש להתחבר למערכת'; end if;
  if nullif(trim(coalesce(p_model, '')), '') is null then raise exception 'יש לבחור דגם מכשיר'; end if;
  if not exists (select 1 from public.device_models where name = p_model) then
    raise exception 'דגם לא מוכר: %', p_model;
  end if;
  if nullif(trim(coalesce(p_scent, '')), '') is null then raise exception 'יש לבחור ניחוח'; end if;

  if v_customer_id is null then
    if p_site_id is not null then raise exception 'כתובת אפשר לבחור רק ללקוח קיים'; end if;
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
    if p_site_id is not null and not exists (
      select 1 from public.customer_sites where id = p_site_id and customer_id = v_customer_id
    ) then
      raise exception 'הכתובת שנבחרה לא שייכת ללקוח הזה';
    end if;
  end if;

  insert into public.service_calls
    (customer_id, title, description, severity, status, assigned_to, scheduled_at, created_by,
     call_type, install_model, install_scent, install_route, install_location_note, install_site_id)
  values
    (v_customer_id,
     format('התקנה חדשה · %s · %s', p_model, trim(p_scent)),
     nullif(trim(coalesce(p_notes, '')), ''),
     'sched', 'open', p_assigned_to, p_scheduled_at, auth.uid(),
     'installation', p_model, trim(p_scent), v_route, nullif(trim(coalesce(p_location_note, '')), ''),
     p_site_id)
  returning * into v_call;

  return v_call;
end $$;

-- complete_installation: כמו phase50, בשינוי אחד: אם install_site_id קיים —
-- המכשיר נוצר עם site_id ולא מעדכנים customers.route_name.
-- notify_new_installation: גוף ההתראה כולל את שם הכתובת.
-- (הגרסה המלאה שהורצה — ר' הקובץ שצורף בצ'אט ב-20.10.26)
