create or replace function public.admin_swap_booking_schedule(
  p_source_booking_id uuid,
  p_target_court_id uuid,
  p_target_start_at timestamp
)
returns setof public.bookings
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := auth.uid();
  v_actor_email text;
  v_operation_id uuid := gen_random_uuid();
  v_source public.bookings;
  v_source_after public.bookings;
  v_target public.bookings;
  v_target_after public.bookings;
  v_target_rows public.bookings[] := array[]::public.bookings[];
  v_target_ids uuid[] := array[]::uuid[];
  v_target_end_at timestamp;
  v_cursor timestamp;
  v_duration interval;
  v_target_count integer := 0;
begin
  if v_actor_id is null then raise exception 'Authentication required'; end if;
  if not exists (
    select 1 from public.staff_members staff
    where staff.user_id = v_actor_id and staff.role = 'admin'
  ) then raise exception 'Manager access required'; end if;

  -- Every swap uses the same advisory lock. This keeps concurrent 1-to-many
  -- swaps deterministic; the exclusion constraint remains the final guard
  -- against ordinary reschedules occurring at the same moment.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('tiger.admin_booking_swap', 0)
  );

  select booking.* into v_source
  from public.bookings booking
  where booking.id = p_source_booking_id
  for update;

  if v_source.id is null then raise exception 'Booking not found'; end if;
  if v_source.status not in ('held', 'confirmed') then
    raise exception 'Only active bookings can be swapped';
  end if;
  if not exists (
    select 1 from public.courts court
    where court.id = p_target_court_id and court.status = 'open'
  ) then raise exception 'Court is unavailable'; end if;

  v_duration := v_source.end_at - v_source.start_at;
  v_target_end_at := p_target_start_at + v_duration;
  perform private.assert_booking_window(p_target_start_at, v_target_end_at, interval '4 hours');

  if v_source.court_id = p_target_court_id
     and v_source.start_at = p_target_start_at
     and v_source.end_at = v_target_end_at then
    return next v_source;
    return;
  end if;

  v_cursor := p_target_start_at;
  for v_target in
    select booking.*
    from public.bookings booking
    where booking.id <> v_source.id
      and booking.court_id = p_target_court_id
      and booking.status in ('held', 'confirmed')
      and booking.start_at < v_target_end_at
      and booking.end_at > p_target_start_at
    order by booking.start_at, booking.id
    for update
  loop
    v_target_count := v_target_count + 1;
    if v_target.start_at <> v_cursor
       or v_target.end_at <= v_target.start_at
       or v_target.end_at > v_target_end_at then
      raise exception 'Destination bookings only partially cover the swap interval';
    end if;
    v_target_rows := array_append(v_target_rows, v_target);
    v_target_ids := array_append(v_target_ids, v_target.id);
    v_cursor := v_target.end_at;
  end loop;

  if v_target_count = 0 then
    raise exception 'No destination bookings found for swap';
  end if;
  if v_cursor <> v_target_end_at then
    raise exception 'Destination bookings must exactly fill the source duration';
  end if;

  select users.email into v_actor_email
  from auth.users users
  where users.id = v_actor_id;

  -- Park every participating row outside the active exclusion constraint.
  -- Audit capture is suppressed until each row reaches its final state.
  perform set_config('app.audit_suppress', 'true', true);
  update public.bookings booking
     set status = 'cancelled'
   where booking.id = v_source.id
      or booking.id = any(v_target_ids);

  begin
    update public.bookings booking
       set court_id = p_target_court_id,
           start_at = p_target_start_at,
           end_at = v_target_end_at,
           status = v_source.status,
           cancelled_at = v_source.cancelled_at
     where booking.id = v_source.id
     returning booking.* into v_source_after;
  exception when exclusion_violation then
    raise exception 'The swap destination is no longer available';
  end;

  insert into private.app_audit_events (
    transaction_id, operation_id, event_type, entity_type, entity_id,
    actor_id, actor_email, actor_kind, source, before_state, after_state,
    changed_fields, metadata
  ) values (
    txid_current(), v_operation_id::text, 'booking.rescheduled', 'booking', v_source_after.id::text,
    v_actor_id, v_actor_email, 'manager', 'manager_ui', to_jsonb(v_source), to_jsonb(v_source_after),
    array['court_id', 'start_at', 'end_at', 'total_amount', 'system_calculated_amount']::text[],
    jsonb_build_object('schema_version', 1, 'swap', true, 'swap_source_booking_id', v_source.id, 'destination_booking_count', v_target_count)
  );

  insert into private.booking_admin_actions (
    booking_id, actor_id, action, operation_id, previous_status, new_status,
    previous_court_id, new_court_id, previous_start_at, previous_end_at,
    new_start_at, new_end_at
  ) values (
    v_source_after.id, v_actor_id, 'rescheduled', v_operation_id, v_source.status, v_source_after.status,
    v_source.court_id, v_source_after.court_id, v_source.start_at, v_source.end_at,
    v_source_after.start_at, v_source_after.end_at
  );
  return next v_source_after;

  v_cursor := v_source.start_at;
  foreach v_target in array v_target_rows loop
    begin
      update public.bookings booking
         set court_id = v_source.court_id,
             start_at = v_cursor,
             end_at = v_cursor + (v_target.end_at - v_target.start_at),
             status = v_target.status,
             cancelled_at = v_target.cancelled_at
       where booking.id = v_target.id
       returning booking.* into v_target_after;
    exception when exclusion_violation then
      raise exception 'The original source interval is no longer available';
    end;

    insert into private.app_audit_events (
      transaction_id, operation_id, event_type, entity_type, entity_id,
      actor_id, actor_email, actor_kind, source, before_state, after_state,
      changed_fields, metadata
    ) values (
      txid_current(), v_operation_id::text, 'booking.rescheduled', 'booking', v_target_after.id::text,
      v_actor_id, v_actor_email, 'manager', 'manager_ui', to_jsonb(v_target), to_jsonb(v_target_after),
      array['court_id', 'start_at', 'end_at', 'total_amount', 'system_calculated_amount']::text[],
      jsonb_build_object('schema_version', 1, 'swap', true, 'swap_source_booking_id', v_source.id, 'destination_booking_count', v_target_count)
    );

    insert into private.booking_admin_actions (
      booking_id, actor_id, action, operation_id, previous_status, new_status,
      previous_court_id, new_court_id, previous_start_at, previous_end_at,
      new_start_at, new_end_at
    ) values (
      v_target_after.id, v_actor_id, 'rescheduled', v_operation_id, v_target.status, v_target_after.status,
      v_target.court_id, v_target_after.court_id, v_target.start_at, v_target.end_at,
      v_target_after.start_at, v_target_after.end_at
    );

    v_cursor := v_target_after.end_at;
    return next v_target_after;
  end loop;

  perform set_config('app.audit_suppress', 'false', true);
end;
$$;

revoke all on function public.admin_swap_booking_schedule(uuid, uuid, timestamp)
  from public, anon, authenticated;
grant execute on function public.admin_swap_booking_schedule(uuid, uuid, timestamp)
  to authenticated;

comment on function public.admin_swap_booking_schedule(uuid, uuid, timestamp) is
  'Atomically swaps one active booking with one or more contiguous active bookings of exactly equal total duration.';

notify pgrst, 'reload schema';
