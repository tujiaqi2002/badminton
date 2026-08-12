alter table public.bookings
  add column if not exists booking_group_id uuid;

update public.bookings
set booking_group_id = id
where booking_group_id is null;

alter table public.bookings
  alter column booking_group_id set default gen_random_uuid(),
  alter column booking_group_id set not null;

create index if not exists bookings_group_idx
  on public.bookings (booking_group_id, start_at);

alter table public.bookings drop constraint if exists same_booking_day;

update public.courts
set name_zh = case sort_order
  when 1 then '一' when 2 then '二' when 3 then '三' when 4 then '四' when 5 then '五'
end,
name_en = 'Court ' || sort_order::text;

alter table private.booking_admin_actions
  add column if not exists operation_id uuid default gen_random_uuid() not null;

alter table private.booking_admin_actions
  drop constraint if exists booking_admin_actions_action_check;
alter table private.booking_admin_actions
  add constraint booking_admin_actions_action_check
  check (action in ('cancelled', 'created', 'rescheduled', 'details_updated', 'undone'));

create or replace function private.assert_booking_window(
  p_start_at timestamp,
  p_end_at timestamp,
  p_max_duration interval
)
returns void
language plpgsql
set search_path = ''
as $$
begin
  if p_end_at <= p_start_at then raise exception 'Invalid time range'; end if;
  if p_end_at < p_start_at + interval '1 hour' then raise exception 'Minimum booking length is 1 hour'; end if;
  if p_end_at > p_start_at + p_max_duration then raise exception 'Maximum booking length exceeded'; end if;
  if p_start_at::time < time '10:00'
     or p_end_at > date_trunc('day', p_start_at) + interval '1 day' then
    raise exception 'Booking must be within opening hours';
  end if;
end;
$$;

create or replace function public.create_multi_booking(
  p_court_ids uuid[],
  p_start_at timestamp,
  p_end_at timestamp,
  p_customer_phone text,
  p_customer_notes text default null,
  p_party_size smallint default 2,
  p_payment_method public.payment_method default 'venue'
)
returns setof public.bookings
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_customer_name text;
  v_customer_email text;
  v_court_ids uuid[];
  v_court_id uuid;
  v_group_id uuid := gen_random_uuid();
  v_booking public.bookings;
  v_hourly_rate numeric;
  v_total numeric;
begin
  if v_user_id is null then raise exception 'Authentication required'; end if;
  select array_agg(distinct id order by id) into v_court_ids from unnest(p_court_ids) as id;
  if coalesce(array_length(v_court_ids, 1), 0) < 1 or array_length(v_court_ids, 1) > 5 then
    raise exception 'Select between 1 and 5 courts';
  end if;
  if p_payment_method = 'stripe' and array_length(v_court_ids, 1) > 1 then
    raise exception 'Online payment is available for single-court bookings only';
  end if;
  perform private.assert_booking_window(p_start_at, p_end_at, interval '2 hours');
  if p_start_at < timezone('America/Toronto', now()) - interval '5 minutes' then raise exception 'Cannot book a past time'; end if;
  if p_start_at > timezone('America/Toronto', now()) + interval '30 days' then raise exception 'Bookings open 30 days in advance'; end if;
  if p_customer_phone is null or trim(p_customer_phone) = '' then raise exception 'Customer phone is required'; end if;
  if length(p_customer_phone) > 40 then raise exception 'Customer phone is too long'; end if;
  if length(coalesce(p_customer_notes, '')) > 2000 then raise exception 'Customer notes are too long'; end if;
  if p_party_size < 1 or p_party_size > 8 then raise exception 'Party size must be between 1 and 8'; end if;

  select coalesce(nullif(trim(p.display_name), ''), split_part(u.email, '@', 1), 'Tiger Guest'), u.email
    into v_customer_name, v_customer_email
  from auth.users u left join public.profiles p on p.id = u.id where u.id = v_user_id;

  if (select count(*) from public.courts where id = any(v_court_ids) and status = 'open') <> array_length(v_court_ids, 1) then
    raise exception 'One or more courts are unavailable';
  end if;
  v_hourly_rate := case when p_start_at::time >= time '17:00' then 36 else 28 end;
  v_total := round(v_hourly_rate * extract(epoch from (p_end_at - p_start_at)) / 3600, 2);

  foreach v_court_id in array v_court_ids loop
    begin
      insert into public.bookings (
        booking_group_id, user_id, court_id, customer_name, customer_email, customer_phone, customer_notes,
        start_at, end_at, status, payment_status, payment_method, total_amount, party_size, hold_expires_at
      ) values (
        v_group_id, v_user_id, v_court_id, v_customer_name, v_customer_email,
        trim(p_customer_phone), nullif(trim(p_customer_notes), ''), p_start_at, p_end_at,
        case when p_payment_method = 'stripe' then 'held'::public.booking_status else 'confirmed'::public.booking_status end,
        case when p_payment_method = 'stripe' then 'pending'::public.payment_status else 'pay_at_venue'::public.payment_status end,
        p_payment_method, v_total, p_party_size,
        case when p_payment_method = 'stripe' then now() + interval '10 minutes' else null end
      ) returning * into v_booking;
    exception when exclusion_violation then
      raise exception 'One or more selected courts are already booked';
    end;
    return next v_booking;
  end loop;
end;
$$;

create or replace function public.admin_create_multi_booking(
  p_court_ids uuid[],
  p_start_at timestamp,
  p_end_at timestamp,
  p_customer_name text,
  p_customer_email text default null,
  p_party_size smallint default 2,
  p_customer_phone text default null,
  p_customer_notes text default null
)
returns setof public.bookings
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := auth.uid();
  v_court_ids uuid[];
  v_court_id uuid;
  v_group_id uuid := gen_random_uuid();
  v_operation_id uuid := gen_random_uuid();
  v_booking public.bookings;
  v_hourly_rate numeric;
  v_total numeric;
begin
  if v_actor_id is null then raise exception 'Authentication required'; end if;
  if not exists (select 1 from public.staff_members s where s.user_id = v_actor_id and s.role = 'admin') then
    raise exception 'Manager access required';
  end if;
  select array_agg(distinct id order by id) into v_court_ids from unnest(p_court_ids) as id;
  if coalesce(array_length(v_court_ids, 1), 0) < 1 or array_length(v_court_ids, 1) > 5 then
    raise exception 'Select between 1 and 5 courts';
  end if;
  perform private.assert_booking_window(p_start_at, p_end_at, interval '4 hours');
  if trim(coalesce(p_customer_name, '')) = '' then raise exception 'Customer name is required'; end if;
  if nullif(trim(p_customer_email), '') is not null and position('@' in p_customer_email) < 2 then raise exception 'Customer email is invalid'; end if;
  if length(coalesce(p_customer_email, '')) > 320 then raise exception 'Customer email is too long'; end if;
  if length(coalesce(p_customer_phone, '')) > 40 then raise exception 'Customer phone is too long'; end if;
  if length(coalesce(p_customer_notes, '')) > 2000 then raise exception 'Customer notes are too long'; end if;
  if p_party_size < 1 or p_party_size > 8 then raise exception 'Party size must be between 1 and 8'; end if;
  if (select count(*) from public.courts where id = any(v_court_ids) and status = 'open') <> array_length(v_court_ids, 1) then
    raise exception 'One or more courts are unavailable';
  end if;

  v_hourly_rate := case when p_start_at::time >= time '17:00' then 36 else 28 end;
  v_total := round(v_hourly_rate * extract(epoch from (p_end_at - p_start_at)) / 3600, 2);
  foreach v_court_id in array v_court_ids loop
    begin
      insert into public.bookings (
        booking_group_id, user_id, court_id, customer_name, customer_email, customer_phone, customer_notes,
        start_at, end_at, status, payment_status, payment_method, total_amount, party_size
      ) values (
        v_group_id, v_actor_id, v_court_id, trim(p_customer_name), lower(nullif(trim(p_customer_email), '')),
        nullif(trim(p_customer_phone), ''), nullif(trim(p_customer_notes), ''), p_start_at, p_end_at,
        'confirmed', 'pay_at_venue', 'venue', v_total, p_party_size
      ) returning * into v_booking;
    exception when exclusion_violation then
      raise exception 'One or more selected courts are already booked';
    end;
    insert into private.booking_admin_actions (
      booking_id, actor_id, action, operation_id, previous_status, new_status,
      new_court_id, new_start_at, new_end_at
    ) values (
      v_booking.id, v_actor_id, 'created', v_operation_id, v_booking.status, v_booking.status,
      v_booking.court_id, v_booking.start_at, v_booking.end_at
    );
    return next v_booking;
  end loop;
end;
$$;

create or replace function public.admin_reschedule_booking_group(
  p_booking_id uuid,
  p_start_at timestamp,
  p_end_at timestamp
)
returns setof public.bookings
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := auth.uid();
  v_group_id uuid;
  v_operation_id uuid := gen_random_uuid();
  v_previous public.bookings;
  v_booking public.bookings;
  v_hourly_rate numeric;
begin
  if v_actor_id is null then raise exception 'Authentication required'; end if;
  if not exists (select 1 from public.staff_members s where s.user_id = v_actor_id and s.role = 'admin') then
    raise exception 'Manager access required';
  end if;
  perform private.assert_booking_window(p_start_at, p_end_at, interval '4 hours');
  select booking_group_id into v_group_id from public.bookings where id = p_booking_id;
  if v_group_id is null then raise exception 'Booking not found'; end if;
  v_hourly_rate := case when p_start_at::time >= time '17:00' then 36 else 28 end;

  for v_previous in
    select * from public.bookings
    where booking_group_id = v_group_id and status in ('held', 'confirmed')
    order by court_id for update
  loop
    begin
      update public.bookings
      set start_at = p_start_at,
          end_at = p_end_at,
          total_amount = round(v_hourly_rate * extract(epoch from (p_end_at - p_start_at)) / 3600, 2)
      where id = v_previous.id
      returning * into v_booking;
    exception when exclusion_violation then
      raise exception 'One or more selected courts are already booked';
    end;
    insert into private.booking_admin_actions (
      booking_id, actor_id, action, operation_id, previous_status, new_status,
      previous_court_id, new_court_id, previous_start_at, previous_end_at, new_start_at, new_end_at
    ) values (
      v_booking.id, v_actor_id, 'rescheduled', v_operation_id, v_previous.status, v_booking.status,
      v_previous.court_id, v_booking.court_id, v_previous.start_at, v_previous.end_at, v_booking.start_at, v_booking.end_at
    );
    return next v_booking;
  end loop;
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
  v_previous public.bookings;
  v_booking public.bookings;
  v_operation_id uuid := gen_random_uuid();
  v_hourly_rate numeric;
begin
  if v_actor_id is null then raise exception 'Authentication required'; end if;
  if not exists (select 1 from public.staff_members s where s.user_id = v_actor_id and s.role = 'admin') then
    raise exception 'Manager access required';
  end if;
  perform private.assert_booking_window(p_start_at, p_end_at, interval '4 hours');
  if not exists (select 1 from public.courts where id = p_court_id and status = 'open') then
    raise exception 'Court is unavailable';
  end if;
  select * into v_previous from public.bookings where id = p_booking_id for update;
  if v_previous.id is null then raise exception 'Booking not found'; end if;
  if v_previous.status not in ('held', 'confirmed') then raise exception 'Only active bookings can be rescheduled'; end if;
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
    raise exception 'This court is already booked for that time';
  end;
  insert into private.booking_admin_actions (
    booking_id, actor_id, action, operation_id, previous_status, new_status,
    previous_court_id, new_court_id, previous_start_at, previous_end_at, new_start_at, new_end_at
  ) values (
    v_booking.id, v_actor_id, 'rescheduled', v_operation_id, v_previous.status, v_booking.status,
    v_previous.court_id, v_booking.court_id, v_previous.start_at, v_previous.end_at, v_booking.start_at, v_booking.end_at
  );
  return v_booking;
end;
$$;

create or replace function public.admin_undo_booking_change(p_booking_id uuid)
returns setof public.bookings
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := auth.uid();
  v_operation_id uuid;
  v_action private.booking_admin_actions;
  v_current public.bookings;
  v_booking public.bookings;
  v_undo_operation uuid := gen_random_uuid();
  v_hourly_rate numeric;
begin
  if v_actor_id is null then raise exception 'Authentication required'; end if;
  if not exists (select 1 from public.staff_members s where s.user_id = v_actor_id and s.role = 'admin') then
    raise exception 'Manager access required';
  end if;
  select operation_id into v_operation_id
  from private.booking_admin_actions
  where booking_id = p_booking_id and action = 'rescheduled'
  order by created_at desc, id desc limit 1;
  if v_operation_id is null then raise exception 'No booking change available to undo'; end if;

  for v_action in
    select * from private.booking_admin_actions
    where operation_id = v_operation_id and action = 'rescheduled'
    order by id for update
  loop
    select * into v_current from public.bookings where id = v_action.booking_id for update;
    v_hourly_rate := case when v_action.previous_start_at::time >= time '17:00' then 36 else 28 end;
    begin
      update public.bookings
      set court_id = v_action.previous_court_id,
          start_at = v_action.previous_start_at,
          end_at = v_action.previous_end_at,
          total_amount = round(v_hourly_rate * extract(epoch from (v_action.previous_end_at - v_action.previous_start_at)) / 3600, 2)
      where id = v_action.booking_id
      returning * into v_booking;
    exception when exclusion_violation then
      raise exception 'The original time is no longer available';
    end;
    insert into private.booking_admin_actions (
      booking_id, actor_id, action, operation_id, previous_status, new_status,
      previous_court_id, new_court_id, previous_start_at, previous_end_at, new_start_at, new_end_at
    ) values (
      v_booking.id, v_actor_id, 'undone', v_undo_operation, v_current.status, v_booking.status,
      v_current.court_id, v_booking.court_id, v_current.start_at, v_current.end_at, v_booking.start_at, v_booking.end_at
    );
    return next v_booking;
  end loop;
end;
$$;

revoke execute on function public.create_multi_booking(uuid[], timestamp, timestamp, text, text, smallint, public.payment_method) from public, anon, authenticated;
revoke execute on function public.admin_create_multi_booking(uuid[], timestamp, timestamp, text, text, smallint, text, text) from public, anon, authenticated;
revoke execute on function public.admin_reschedule_booking_group(uuid, timestamp, timestamp) from public, anon, authenticated;
revoke execute on function public.admin_undo_booking_change(uuid) from public, anon, authenticated;
revoke execute on function public.admin_reschedule_booking(uuid, uuid, timestamp, timestamp) from public, anon, authenticated;
grant execute on function public.create_multi_booking(uuid[], timestamp, timestamp, text, text, smallint, public.payment_method) to authenticated;
grant execute on function public.admin_create_multi_booking(uuid[], timestamp, timestamp, text, text, smallint, text, text) to authenticated;
grant execute on function public.admin_reschedule_booking_group(uuid, timestamp, timestamp) to authenticated;
grant execute on function public.admin_undo_booking_change(uuid) to authenticated;
grant execute on function public.admin_reschedule_booking(uuid, uuid, timestamp, timestamp) to authenticated;

notify pgrst, 'reload schema';
