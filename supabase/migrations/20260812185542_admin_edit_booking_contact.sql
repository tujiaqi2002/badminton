alter table private.booking_admin_actions
  drop constraint if exists booking_admin_actions_action_check;

alter table private.booking_admin_actions
  add constraint booking_admin_actions_action_check
  check (action in ('cancelled', 'created', 'rescheduled', 'details_updated'));

create or replace function public.admin_update_booking_details(
  p_booking_id uuid,
  p_customer_email text default null,
  p_customer_phone text default null,
  p_customer_notes text default null
)
returns public.bookings
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := auth.uid();
  v_previous public.bookings;
  v_booking public.bookings;
begin
  if v_actor_id is null then raise exception 'Authentication required'; end if;
  if not exists (
    select 1 from public.staff_members as staff
    where staff.user_id = v_actor_id and staff.role = 'admin'
  ) then raise exception 'Manager access required'; end if;
  if nullif(trim(p_customer_email), '') is not null and position('@' in p_customer_email) < 2 then
    raise exception 'Customer email is invalid';
  end if;
  if length(coalesce(p_customer_email, '')) > 320 then raise exception 'Customer email is too long'; end if;
  if length(coalesce(p_customer_phone, '')) > 40 then raise exception 'Customer phone is too long'; end if;
  if length(coalesce(p_customer_notes, '')) > 2000 then raise exception 'Customer notes are too long'; end if;

  select * into v_previous
  from public.bookings
  where id = p_booking_id
  for update;

  if v_previous.id is null then raise exception 'Booking not found'; end if;

  update public.bookings
     set customer_email = lower(nullif(trim(p_customer_email), '')),
         customer_phone = nullif(trim(p_customer_phone), ''),
         customer_notes = nullif(trim(p_customer_notes), '')
   where id = p_booking_id
  returning * into v_booking;

  insert into private.booking_admin_actions (
    booking_id, actor_id, action, previous_status, new_status,
    previous_court_id, new_court_id, previous_start_at, previous_end_at,
    new_start_at, new_end_at
  ) values (
    v_booking.id, v_actor_id, 'details_updated', v_previous.status, v_booking.status,
    v_previous.court_id, v_booking.court_id, v_previous.start_at, v_previous.end_at,
    v_booking.start_at, v_booking.end_at
  );

  return v_booking;
end;
$$;

revoke execute on function public.admin_update_booking_details(uuid, text, text, text)
  from public, anon, authenticated;
grant execute on function public.admin_update_booking_details(uuid, text, text, text)
  to authenticated;

notify pgrst, 'reload schema';
