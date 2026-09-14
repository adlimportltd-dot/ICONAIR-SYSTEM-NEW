-- Phase 37 — 2026-09-14, המשך פיצ'ר הלידים (ר' phase36): פעולת "הפוך
-- ללקוח במסלול" חייבת להיות אטומית (יצירת הלקוח + סימון הליד כ-converted
-- ביחד) כדי שרענון-דף/כשל-רשת בין שני השלבים לא ישאיר ליד "converted"
-- בלי לקוח בפועל, או לקוח כפול מלחיצה כפולה. security invoker במפורש
-- (ברירת המחדל) — הפונקציה רצה בהרשאות הקורא, כך שאותם חוקי RLS של
-- customers/leads חלים כרגיל (טכנאי בשטח יכול ליצור לקוח בעצמו, ר'
-- customers_insert policy — with check (created_by = auth.uid())).
create or replace function public.convert_lead_to_customer(p_lead_id uuid, p_route_name text default null)
returns customers
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_lead leads%rowtype;
  v_customer customers%rowtype;
begin
  select * into v_lead from leads where id = p_lead_id for update;

  if not found then
    raise exception 'ליד לא נמצא';
  end if;

  if v_lead.converted_customer_id is not null then
    raise exception 'הליד כבר הומר ללקוח';
  end if;

  insert into customers (name, phone, city, route_name, notes)
  values (v_lead.full_name, v_lead.phone, v_lead.city, nullif(trim(p_route_name), ''), v_lead.notes)
  returning * into v_customer;

  update leads
  set status = 'converted', converted_customer_id = v_customer.id
  where id = p_lead_id;

  return v_customer;
end;
$$;

grant execute on function public.convert_lead_to_customer(uuid, text) to authenticated;

alter table public.leads alter column created_by set default auth.uid();
