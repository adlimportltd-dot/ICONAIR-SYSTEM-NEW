-- ---------------------------------------------------------------------
--  Phase 15 — מחיקת לקוח מלאה (RPC)
--
--  devices.customer_id ו-service_calls.customer_id הם on delete restrict
--  בכוונה (ר' iconair_schema.sql) — מונע מחיקה "בשוגג" של לקוח עם
--  מכשירים/היסטוריית קריאות מותקנת. הפיצ'ר הזה הוא המחיקה *המכוונת*:
--  מנהל שמאשר פעמיים בממשק (ר' CustomerFormModal.jsx) יכול למחוק לקוח
--  לגמרי, כולל כל המכשירים וקריאות השירות שלו.
--
--  contracts / customer_sites / route_assignments כבר on delete cascade
--  ברמת ה-DB, אז אין צורך למחוק אותם כאן במפורש — הם נעלמים אוטומטית
--  כשהלקוח נמחק בסוף.
--
--  security invoker (ברירת המחדל, לא security definer): הפונקציה
--  רצה בהרשאות המשתמש שקורא לה, אז ה-RLS הרגיל על כל טבלה
--  (customers_delete/devices_delete/service_calls_delete: is_admin())
--  עדיין חל בכל שורה. ה-is_admin() כאן בתחילת הפונקציה הוא רק כדי
--  לתת הודעת שגיאה ברורה במקום שגיאת RLS גנרית.
-- ---------------------------------------------------------------------

create or replace function public.delete_customer_cascade(p_customer_id uuid)
returns void
language plpgsql
security invoker
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'רק מנהל יכול למחוק לקוח';
  end if;

  delete from public.devices where customer_id = p_customer_id;
  delete from public.service_calls where customer_id = p_customer_id;
  delete from public.customers where id = p_customer_id;
end;
$$;

grant execute on function public.delete_customer_cascade(uuid) to authenticated;
