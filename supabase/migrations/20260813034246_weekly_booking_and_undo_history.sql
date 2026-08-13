alter table public.bookings
  add column if not exists recurrence_series_id uuid,
  add column if not exists recurrence_week smallint;

create index if not exists bookings_recurrence_series_idx
  on public.bookings (recurrence_series_id, recurrence_week)
  where recurrence_series_id is not null;

create or replace function public.admin_preview_weekly_booking(
  p_court_ids uuid[],
  p_start_at timestamp,
  p_end_at timestamp,
  p_week_count smallint
)
returns table (
  occurrence_start_at timestamp,
  unavailable_court_ids uuid[]
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := auth.uid();
  v_court_ids uuid[];
  v_week integer;
  v_start timestamp;
  v_end timestamp;
  v_unavailable uuid[];
begin
  if v_actor_id is null then raise exception 'Authentication required'; end if;
  if not exists (
    select 1 from public.staff_members s
    where s.user_id = v_actor_id and s.role = 'admin'
  ) then raise exception 'Manager access required'; end if;

  select array_agg(distinct id order by id) into v_court_ids
  from unnest(p_court_ids) as id;
  if coalesce(array_length(v_court_ids, 1), 0) < 1
     or array_length(v_court_ids, 1) > 5 then
    raise exception 'Select between 1 and 5 courts';
  end if;
  if p_week_count < 2 or p_week_count > 12 then
    raise exception 'Weekly bookings must repeat between 2 and 12 weeks';
  end if;
  perform private.assert_booking_window(p_start_at, p_end_at, interval '4 hours');

  for v_week in 0..p_week_count - 1 loop
    v_start := p_start_at + make_interval(weeks => v_week);
    v_end := p_end_at + make_interval(weeks => v_week);

    select array_agg(c.id order by c.sort_order)
      into v_unavailable
    from public.courts c
    where c.id = any(v_court_ids)
      and (
        c.status <> 'open'
        or exists (
          select 1
          from public.bookings b
          where b.court_id = c.id
            and b.status in ('held', 'confirmed')
            and b.start_at < v_end
            and b.end_at > v_start
        )
      );

    if coalesce(array_length(v_unavailable, 1), 0) > 0 then
      occurrence_start_at := v_start;
      unavailable_court_ids := v_unavailable;
      return next;
    end if;
  end loop;
end;
$$;

create or replace function public.admin_create_weekly_booking(
  p_court_ids uuid[],
  p_start_at timestamp,
  p_end_at timestamp,
  p_week_count smallint,
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
  v_series_id uuid := gen_random_uuid();
  v_group_id uuid;
  v_operation_id uuid := gen_random_uuid();
  v_booking public.bookings;
  v_conflict record;
  v_week integer;
  v_start timestamp;
  v_end timestamp;
  v_hourly_rate numeric;
  v_total numeric;
begin
  if v_actor_id is null then raise exception 'Authentication required'; end if;
  if not exists (
    select 1 from public.staff_members s
    where s.user_id = v_actor_id and s.role = 'admin'
  ) then raise exception 'Manager access required'; end if;

  select array_agg(distinct id order by id) into v_court_ids
  from unnest(p_court_ids) as id;
  if coalesce(array_length(v_court_ids, 1), 0) < 1
     or array_length(v_court_ids, 1) > 5 then
    raise exception 'Select between 1 and 5 courts';
  end if;
  if p_week_count < 2 or p_week_count > 12 then
    raise exception 'Weekly bookings must repeat between 2 and 12 weeks';
  end if;
  perform private.assert_booking_window(p_start_at, p_end_at, interval '4 hours');
  if trim(coalesce(p_customer_name, '')) = '' then raise exception 'Customer name is required'; end if;
  if nullif(trim(p_customer_email), '') is not null and position('@' in p_customer_email) < 2 then
    raise exception 'Customer email is invalid';
  end if;
  if length(coalesce(p_customer_email, '')) > 320 then raise exception 'Customer email is too long'; end if;
  if length(coalesce(p_customer_phone, '')) > 40 then raise exception 'Customer phone is too long'; end if;
  if length(coalesce(p_customer_notes, '')) > 2000 then raise exception 'Customer notes are too long'; end if;
  if p_party_size < 1 or p_party_size > 8 then raise exception 'Party size must be between 1 and 8'; end if;

  select * into v_conflict
  from public.admin_preview_weekly_booking(v_court_ids, p_start_at, p_end_at, p_week_count)
  limit 1;
  if v_conflict.occurrence_start_at is not null then
    raise exception 'One or more weekly occurrences are unavailable';
  end if;

  for v_week in 0..p_week_count - 1 loop
    v_group_id := gen_random_uuid();
    v_start := p_start_at + make_interval(weeks => v_week);
    v_end := p_end_at + make_interval(weeks => v_week);
    v_hourly_rate := case when v_start::time >= time '17:00' then 36 else 28 end;
    v_total := round(v_hourly_rate * extract(epoch from (v_end - v_start)) / 3600, 2);

    foreach v_court_id in array v_court_ids loop
      begin
        insert into public.bookings (
          booking_group_id, recurrence_series_id, recurrence_week,
          user_id, court_id, customer_name, customer_email, customer_phone, customer_notes,
          start_at, end_at, status, payment_status, payment_method, total_amount, party_size
        ) values (
          v_group_id, v_series_id, v_week + 1,
          v_actor_id, v_court_id, trim(p_customer_name), lower(nullif(trim(p_customer_email), '')),
          nullif(trim(p_customer_phone), ''), nullif(trim(p_customer_notes), ''),
          v_start, v_end, 'confirmed', 'pay_at_venue', 'venue', v_total, p_party_size
        ) returning * into v_booking;
      exception when exclusion_violation then
        raise exception 'One or more weekly occurrences are unavailable';
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
  end loop;
end;
$$;

create or replace function public.admin_cancel_booking(p_booking_id uuid)
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
begin
  if v_actor_id is null then raise exception 'Authentication required'; end if;
  if not exists (
    select 1 from public.staff_members s
    where s.user_id = v_actor_id and s.role = 'admin'
  ) then raise exception 'Manager access required'; end if;

  select * into v_previous from public.bookings where id = p_booking_id for update;
  if v_previous.id is null then raise exception 'Booking not found'; end if;
  if v_previous.status not in ('held', 'confirmed') then raise exception 'Booking is no longer active'; end if;

  update public.bookings
  set status = 'cancelled', cancelled_at = now()
  where id = p_booking_id
  returning * into v_booking;

  insert into private.booking_admin_actions (
    booking_id, actor_id, action, operation_id, previous_status, new_status,
    previous_court_id, new_court_id, previous_start_at, previous_end_at,
    new_start_at, new_end_at
  ) values (
    v_booking.id, v_actor_id, 'cancelled', v_operation_id, v_previous.status, v_booking.status,
    v_previous.court_id, v_booking.court_id, v_previous.start_at, v_previous.end_at,
    v_booking.start_at, v_booking.end_at
  );
  return v_booking;
end;
$$;

create or replace function public.admin_undo_last_booking_action()
returns setof public.bookings
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := auth.uid();
  v_operation_id uuid;
  v_action_name text;
  v_action private.booking_admin_actions;
  v_current public.bookings;
  v_booking public.bookings;
  v_hourly_rate numeric;
begin
  if v_actor_id is null then raise exception 'Authentication required'; end if;
  if not exists (
    select 1 from public.staff_members s
    where s.user_id = v_actor_id and s.role = 'admin'
  ) then raise exception 'Manager access required'; end if;

  select a.operation_id, a.action
    into v_operation_id, v_action_name
  from private.booking_admin_actions a
  where a.actor_id = v_actor_id
    and a.action in ('created', 'rescheduled', 'cancelled')
    and not exists (
      select 1 from private.booking_admin_actions undone
      where undone.operation_id = a.operation_id and undone.action = 'undone'
    )
  order by a.created_at desc, a.id desc
  limit 1;

  if v_operation_id is null then raise exception 'No booking action available to undo'; end if;

  for v_action in
    select a.*
    from private.booking_admin_actions a
    where a.operation_id = v_operation_id
      and a.action = v_action_name
      and a.id = (
        select max(latest.id)
        from private.booking_admin_actions latest
        where latest.operation_id = a.operation_id
          and latest.action = a.action
          and latest.booking_id = a.booking_id
      )
    order by a.id
    for update
  loop
    select * into v_current from public.bookings where id = v_action.booking_id for update;

    if v_action_name = 'created' then
      update public.bookings
      set status = 'cancelled', cancelled_at = now()
      where id = v_action.booking_id
      returning * into v_booking;
    elsif v_action_name = 'cancelled' then
      begin
        update public.bookings
        set status = v_action.previous_status, cancelled_at = null
        where id = v_action.booking_id
        returning * into v_booking;
      exception when exclusion_violation then
        raise exception 'The original time is no longer available';
      end;
    else
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
    end if;

    insert into private.booking_admin_actions (
      booking_id, actor_id, action, operation_id, previous_status, new_status,
      previous_court_id, new_court_id, previous_start_at, previous_end_at,
      new_start_at, new_end_at
    ) values (
      v_booking.id, v_actor_id, 'undone', v_operation_id, v_current.status, v_booking.status,
      v_current.court_id, v_booking.court_id, v_current.start_at, v_current.end_at,
      v_booking.start_at, v_booking.end_at
    );
    return next v_booking;
  end loop;
end;
$$;

revoke execute on function public.admin_preview_weekly_booking(uuid[],timestamp,timestamp,smallint)
  from public, anon, authenticated;
revoke execute on function public.admin_create_weekly_booking(uuid[],timestamp,timestamp,smallint,text,text,smallint,text,text)
  from public, anon, authenticated;
revoke execute on function public.admin_undo_last_booking_action()
  from public, anon, authenticated;
revoke execute on function public.admin_cancel_booking(uuid)
  from public, anon, authenticated;

grant execute on function public.admin_preview_weekly_booking(uuid[],timestamp,timestamp,smallint)
  to authenticated;
grant execute on function public.admin_create_weekly_booking(uuid[],timestamp,timestamp,smallint,text,text,smallint,text,text)
  to authenticated;
grant execute on function public.admin_undo_last_booking_action()
  to authenticated;
grant execute on function public.admin_cancel_booking(uuid)
  to authenticated;

notify pgrst, 'reload schema';
