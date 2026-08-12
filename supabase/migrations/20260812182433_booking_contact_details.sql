alter table public.bookings
  add column if not exists customer_phone text,
  add column if not exists customer_notes text;

alter table public.bookings alter column customer_email drop not null;

alter table public.bookings drop constraint if exists valid_booking_duration;
alter table public.bookings add constraint valid_booking_duration
  check (end_at <= start_at + interval '4 hours');

drop function if exists public.create_booking(uuid, timestamp, timestamp, smallint, public.payment_method);
drop function if exists public.admin_create_booking(uuid, timestamp, timestamp, text, text, smallint);

create or replace function public.create_booking(
  p_court_id uuid,
  p_start_at timestamp,
  p_end_at timestamp,
  p_customer_phone text,
  p_customer_notes text default null,
  p_party_size smallint default 2,
  p_payment_method public.payment_method default 'venue'
)
returns public.bookings
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_customer_name text;
  v_customer_email text;
  v_hourly_rate numeric(10,2);
  v_total numeric(10,2);
  v_booking public.bookings;
begin
  if v_user_id is null then raise exception 'Authentication required'; end if;
  if not exists (
    select 1 from public.staff_members as staff
    where staff.user_id = v_user_id and staff.role = 'admin'
  ) then raise exception 'Manager access required'; end if;
  if nullif(trim(p_customer_phone), '') is null then raise exception 'Customer phone is required'; end if;
  if length(trim(p_customer_phone)) > 40 then raise exception 'Customer phone is too long'; end if;
  if length(coalesce(p_customer_notes, '')) > 2000 then raise exception 'Customer notes are too long'; end if;
  if p_end_at <= p_start_at then raise exception 'Invalid time range'; end if;
  if p_end_at < p_start_at + interval '1 hour' then raise exception 'Minimum booking length is 1 hour'; end if;
  if p_end_at > p_start_at + interval '2 hours' then raise exception 'Maximum booking length is 2 hours'; end if;
  if p_start_at::time < time '07:00' or p_end_at::time > time '22:00' then raise exception 'Booking must be within opening hours'; end if;
  if p_start_at < timezone('America/Toronto', now()) - interval '5 minutes' then raise exception 'Cannot book a past time'; end if;
  if p_start_at > timezone('America/Toronto', now()) + interval '30 days' then raise exception 'Bookings open 30 days in advance'; end if;
  if p_party_size not between 1 and 8 then raise exception 'Party size must be between 1 and 8'; end if;
  if not exists (select 1 from public.courts where id = p_court_id and status = 'open') then raise exception 'Court is unavailable'; end if;

  select
    coalesce(
      nullif(trim(profile.display_name), ''),
      nullif(trim(auth_user.raw_user_meta_data->>'full_name'), ''),
      nullif(split_part(auth_user.email, '@', 1), ''),
      'Tiger guest'
    ),
    coalesce(auth_user.email, 'unknown@tiger.local')
  into v_customer_name, v_customer_email
  from auth.users as auth_user
  left join public.profiles as profile on profile.id = auth_user.id
  where auth_user.id = v_user_id;

  if v_customer_email is null then raise exception 'Authenticated user profile is unavailable'; end if;

  update public.bookings
     set status = 'expired'
   where status = 'held' and hold_expires_at <= now();

  v_hourly_rate := case when p_start_at::time >= time '17:00' then 36 else 28 end;
  v_total := round(v_hourly_rate * extract(epoch from (p_end_at - p_start_at)) / 3600, 2);

  begin
    insert into public.bookings (
      user_id, court_id, customer_name, customer_email, customer_phone, customer_notes,
      start_at, end_at, status, payment_status, payment_method,
      total_amount, party_size, hold_expires_at
    ) values (
      v_user_id, p_court_id, v_customer_name, v_customer_email,
      trim(p_customer_phone), nullif(trim(p_customer_notes), ''),
      p_start_at, p_end_at,
      case when p_payment_method = 'stripe' then 'held'::public.booking_status else 'confirmed'::public.booking_status end,
      case when p_payment_method = 'stripe' then 'pending'::public.payment_status else 'pay_at_venue'::public.payment_status end,
      p_payment_method, v_total, p_party_size,
      case when p_payment_method = 'stripe' then now() + interval '10 minutes' else null end
    ) returning * into v_booking;
  exception when exclusion_violation then
    raise exception using message = 'This court is already booked for that time', errcode = 'P0001';
  end;

  return v_booking;
end;
$$;

create or replace function public.admin_create_booking(
  p_court_id uuid,
  p_start_at timestamp,
  p_end_at timestamp,
  p_customer_name text,
  p_customer_email text default null,
  p_party_size smallint default 2,
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
  v_hourly_rate numeric(10,2);
  v_total numeric(10,2);
  v_booking public.bookings;
begin
  if v_actor_id is null then raise exception 'Authentication required'; end if;
  if not exists (
    select 1 from public.staff_members as staff
    where staff.user_id = v_actor_id and staff.role = 'admin'
  ) then raise exception 'Manager access required'; end if;
  if nullif(trim(p_customer_name), '') is null then raise exception 'Customer name is required'; end if;
  if nullif(trim(p_customer_email), '') is not null and position('@' in p_customer_email) < 2 then raise exception 'Customer email is invalid'; end if;
  if length(coalesce(p_customer_phone, '')) > 40 then raise exception 'Customer phone is too long'; end if;
  if length(coalesce(p_customer_notes, '')) > 2000 then raise exception 'Customer notes are too long'; end if;
  if p_end_at <= p_start_at then raise exception 'Invalid time range'; end if;
  if p_end_at < p_start_at + interval '1 hour' then raise exception 'Minimum booking length is 1 hour'; end if;
  if p_end_at > p_start_at + interval '4 hours' then raise exception 'Maximum booking length is 4 hours'; end if;
  if p_start_at::date <> p_end_at::date then raise exception 'Booking must end on the same day'; end if;
  if p_start_at::time < time '07:00' or p_end_at::time > time '22:00' then raise exception 'Booking must be within opening hours'; end if;
  if p_party_size not between 1 and 8 then raise exception 'Party size must be between 1 and 8'; end if;
  if not exists (select 1 from public.courts where id = p_court_id and status = 'open') then raise exception 'Court is unavailable'; end if;

  v_hourly_rate := case when p_start_at::time >= time '17:00' then 36 else 28 end;
  v_total := round(v_hourly_rate * extract(epoch from (p_end_at - p_start_at)) / 3600, 2);

  begin
    insert into public.bookings (
      user_id, court_id, customer_name, customer_email, customer_phone, customer_notes,
      start_at, end_at, status, payment_status, payment_method, total_amount, party_size
    ) values (
      v_actor_id, p_court_id, trim(p_customer_name), lower(nullif(trim(p_customer_email), '')),
      nullif(trim(p_customer_phone), ''), nullif(trim(p_customer_notes), ''),
      p_start_at, p_end_at, 'confirmed', 'pay_at_venue', 'venue', v_total, p_party_size
    ) returning * into v_booking;
  exception when exclusion_violation then
    raise exception using message = 'This court is already booked for that time', errcode = 'P0001';
  end;

  insert into private.booking_admin_actions (
    booking_id, actor_id, action, previous_status, new_status,
    new_court_id, new_start_at, new_end_at
  ) values (
    v_booking.id, v_actor_id, 'created', v_booking.status, v_booking.status,
    v_booking.court_id, v_booking.start_at, v_booking.end_at
  );
  return v_booking;
end;
$$;

create or replace function public.admin_reschedule_booking(
  p_booking_id uuid,
  p_court_id uuid,
  p_start_at timestamp,
  p_end_at timestamp
)
returns public.bookings
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := auth.uid();
  v_booking public.bookings;
  v_previous public.bookings;
  v_hourly_rate numeric(10,2);
begin
  if v_actor_id is null then raise exception 'Authentication required'; end if;
  if not exists (
    select 1 from public.staff_members as staff
    where staff.user_id = v_actor_id and staff.role = 'admin'
  ) then raise exception 'Manager access required'; end if;
  if p_end_at <= p_start_at then raise exception 'Invalid time range'; end if;
  if p_end_at < p_start_at + interval '1 hour' then raise exception 'Minimum booking length is 1 hour'; end if;
  if p_end_at > p_start_at + interval '4 hours' then raise exception 'Maximum booking length is 4 hours'; end if;
  if p_start_at::date <> p_end_at::date then raise exception 'Booking must end on the same day'; end if;
  if p_start_at::time < time '07:00' or p_end_at::time > time '22:00' then raise exception 'Booking must be within opening hours'; end if;
  if not exists (select 1 from public.courts where id = p_court_id and status = 'open') then raise exception 'Court is unavailable'; end if;

  select * into v_previous from public.bookings where id = p_booking_id for update;
  if v_previous.id is null then raise exception 'Booking not found'; end if;
  if v_previous.status not in ('held', 'confirmed') then raise exception 'Booking is no longer active'; end if;

  v_hourly_rate := case when p_start_at::time >= time '17:00' then 36 else 28 end;
  begin
    update public.bookings
       set court_id = p_court_id,
           start_at = p_start_at,
           end_at = p_end_at,
           total_amount = round(v_hourly_rate * extract(epoch from (p_end_at - p_start_at)) / 3600, 2)
     where id = p_booking_id
    returning * into v_booking;
  exception when exclusion_violation then
    raise exception using message = 'This court is already booked for that time', errcode = 'P0001';
  end;

  insert into private.booking_admin_actions (
    booking_id, actor_id, action, previous_status, new_status,
    previous_court_id, new_court_id, previous_start_at, previous_end_at,
    new_start_at, new_end_at
  ) values (
    v_booking.id, v_actor_id, 'rescheduled', v_previous.status, v_booking.status,
    v_previous.court_id, v_booking.court_id, v_previous.start_at, v_previous.end_at,
    v_booking.start_at, v_booking.end_at
  );
  return v_booking;
end;
$$;

revoke execute on function public.create_booking(uuid, timestamp, timestamp, text, text, smallint, public.payment_method) from public, anon, authenticated;
revoke execute on function public.admin_create_booking(uuid, timestamp, timestamp, text, text, smallint, text, text) from public, anon, authenticated;
revoke execute on function public.admin_reschedule_booking(uuid, uuid, timestamp, timestamp) from public, anon, authenticated;

grant execute on function public.create_booking(uuid, timestamp, timestamp, text, text, smallint, public.payment_method) to authenticated;
grant execute on function public.admin_create_booking(uuid, timestamp, timestamp, text, text, smallint, text, text) to authenticated;
grant execute on function public.admin_reschedule_booking(uuid, uuid, timestamp, timestamp) to authenticated;

notify pgrst, 'reload schema';
