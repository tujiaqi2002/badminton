drop function if exists public.admin_update_booking_details(uuid, text, text, text);

create or replace function public.admin_update_booking_details(
  p_booking_id uuid,
  p_customer_name text,
  p_customer_email text default null,
  p_customer_phone text default null,
  p_customer_notes text default null,
  p_payment_status public.payment_status default 'pay_at_venue'
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
    select 1
    from public.staff_members as staff
    where staff.user_id = v_actor_id and staff.role = 'admin'
  ) then
    raise exception 'Manager access required';
  end if;
  if nullif(trim(p_customer_name), '') is null then raise exception 'Customer name is required'; end if;
  if length(p_customer_name) > 120 then raise exception 'Customer name is too long'; end if;
  if nullif(trim(p_customer_email), '') is not null and position('@' in p_customer_email) < 2 then
    raise exception 'Customer email is invalid';
  end if;
  if length(coalesce(p_customer_email, '')) > 320 then raise exception 'Customer email is too long'; end if;
  if length(coalesce(p_customer_phone, '')) > 40 then raise exception 'Customer phone is too long'; end if;
  if length(coalesce(p_customer_notes, '')) > 2000 then raise exception 'Customer notes are too long'; end if;
  select *
    into v_previous
  from public.bookings
  where id = p_booking_id
  for update;

  if v_previous.id is null then raise exception 'Booking not found'; end if;
  if p_payment_status = 'pending' and v_previous.payment_method <> 'stripe' then
    raise exception 'Venue payments use pay-at-venue status';
  end if;
  if p_payment_status = 'pay_at_venue' and v_previous.payment_method <> 'venue' then
    raise exception 'Online payments use pending status';
  end if;

  update public.bookings as booking
     set customer_name = trim(p_customer_name),
         customer_email = lower(nullif(trim(p_customer_email), '')),
         customer_phone = nullif(trim(p_customer_phone), ''),
         customer_notes = nullif(trim(p_customer_notes), ''),
         payment_status = p_payment_status
   where booking.booking_group_id = v_previous.booking_group_id
      or (v_previous.booking_group_id is null and booking.id = v_previous.id);

  select *
    into v_booking
  from public.bookings
  where id = p_booking_id;

  insert into private.booking_admin_actions (
    booking_id, actor_id, action, previous_status, new_status,
    previous_court_id, new_court_id, previous_start_at, previous_end_at,
    new_start_at, new_end_at
  )
  select
    booking.id, v_actor_id, 'details_updated', booking.status, booking.status,
    booking.court_id, booking.court_id, booking.start_at, booking.end_at,
    booking.start_at, booking.end_at
  from public.bookings as booking
  where booking.booking_group_id = v_previous.booking_group_id
     or (v_previous.booking_group_id is null and booking.id = v_previous.id);

  return v_booking;
end;
$$;

revoke execute on function public.admin_update_booking_details(uuid, text, text, text, text, public.payment_status)
  from public, anon, authenticated;
grant execute on function public.admin_update_booking_details(uuid, text, text, text, text, public.payment_status)
  to authenticated;

create or replace function private.enforce_future_booking_schedule()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status in ('held', 'confirmed')
     and new.start_at <= timezone('America/Toronto', clock_timestamp()) then
    raise exception using
      errcode = '22007',
      message = 'Booking start time must be in the future';
  end if;
  return new;
end;
$$;

drop trigger if exists bookings_require_future_schedule on public.bookings;
create trigger bookings_require_future_schedule
before insert or update of court_id, start_at, end_at, status
on public.bookings
for each row
execute function private.enforce_future_booking_schedule();

notify pgrst, 'reload schema';
