create table if not exists public.device_change_requests (
  id uuid primary key default gen_random_uuid(),
  device_id uuid not null references public.devices(id) on delete cascade,
  field text not null check (field in ('scent_name', 'model')),
  old_value text,
  new_value text not null,
  note text,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  requested_by uuid not null default auth.uid() references public.profiles(id),
  requested_at timestamptz not null default now(),
  reviewed_by uuid references public.profiles(id),
  reviewed_at timestamptz,
  review_note text
);

alter table public.device_change_requests enable row level security;

drop policy if exists device_change_requests_insert on public.device_change_requests;
create policy device_change_requests_insert on public.device_change_requests
  for insert to authenticated
  with check (requested_by = auth.uid());

drop policy if exists device_change_requests_select on public.device_change_requests;
create policy device_change_requests_select on public.device_change_requests
  for select to authenticated
  using (requested_by = auth.uid() or public.is_admin());

-- אין UPDATE ישיר מה-client — אישור/דחייה עוברים דרך ה-RPC למטה בלבד,
-- כדי שהעדכון בפועל של devices יקרה תמיד יחד עם סימון הבקשה כטופלה
-- (לא שני שינויים נפרדים שיכולים להיפרד).

create or replace function public.review_device_change_request(
  p_request_id uuid,
  p_approve boolean,
  p_review_note text default null
)
returns public.device_change_requests
language plpgsql
security definer
set search_path = public
as $$
declare
  req public.device_change_requests;
begin
  if not public.is_admin() then
    raise exception 'רק מנהל יכול לאשר או לדחות בקשות שינוי';
  end if;

  select * into req from public.device_change_requests where id = p_request_id for update;
  if not found then
    raise exception 'הבקשה לא נמצאה';
  end if;
  if req.status <> 'pending' then
    raise exception 'הבקשה כבר טופלה';
  end if;

  if p_approve then
    if req.field = 'scent_name' then
      update public.devices set scent_name = req.new_value where id = req.device_id;
    elsif req.field = 'model' then
      update public.devices set model = req.new_value where id = req.device_id;
    end if;
  end if;

  update public.device_change_requests
     set status = case when p_approve then 'approved' else 'rejected' end,
         reviewed_by = auth.uid(),
         reviewed_at = now(),
         review_note = p_review_note
   where id = p_request_id
   returning * into req;

  return req;
end;
$$;
