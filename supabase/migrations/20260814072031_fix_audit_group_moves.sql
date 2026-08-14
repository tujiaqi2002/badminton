create or replace function public.admin_move_booking_group(
  p_booking_id uuid,
  p_anchor_court_id uuid,
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
  v_actor_email text;
  v_group_id uuid;
  v_anchor_order integer;
  v_source_order integer;
  v_min_order integer;
  v_max_order integer;
  v_offset integer;
  v_operation_id uuid := gen_random_uuid();
  v_previous_rows public.bookings[];
  v_previous public.bookings;
  v_booking public.bookings;
  v_target_court_id uuid;
  v_hourly_rate numeric;
begin
  if v_actor_id is null then raise exception 'Authentication required'; end if;
  if not exists (
    select 1 from public.staff_members as staff
    where staff.user_id = v_actor_id and staff.role = 'admin'
  ) then raise exception 'Manager access required'; end if;
  perform private.assert_booking_window(p_start_at, p_end_at, interval '4 hours');
  select users.email into v_actor_email from auth.users as users where users.id = v_actor_id;

  select booking.booking_group_id, court.sort_order into v_group_id, v_source_order
  from public.bookings as booking
  join public.courts as court on court.id = booking.court_id
  where booking.id = p_booking_id and booking.status in ('held', 'confirmed');
  select court.sort_order into v_anchor_order
  from public.courts as court
  where court.id = p_anchor_court_id and court.status = 'open';
  if v_group_id is null or v_anchor_order is null then
    raise exception 'Booking or target court not found';
  end if;

  select min(court.sort_order), max(court.sort_order) into v_min_order, v_max_order
  from public.bookings as booking
  join public.courts as court on court.id = booking.court_id
  where booking.booking_group_id = v_group_id and booking.status in ('held', 'confirmed');
  v_offset := v_anchor_order - v_source_order;
  if v_min_order + v_offset < 1 or v_max_order + v_offset > 5 then
    raise exception 'The selected group does not fit from that court';
  end if;

  select array_agg(booking order by court.sort_order) into v_previous_rows
  from public.bookings as booking
  join public.courts as court on court.id = booking.court_id
  where booking.booking_group_id = v_group_id and booking.status in ('held', 'confirmed');
  if coalesce(array_length(v_previous_rows, 1), 0) = 0 then
    raise exception 'No active bookings found';
  end if;

  -- The group is parked only to avoid colliding with itself while shifting.
  -- Suppress row triggers for this internal state and write one accurate audit
  -- event per final booking using the snapshots captured above.
  perform set_config('app.audit_suppress', 'true', true);
  update public.bookings
     set status = 'cancelled'
   where booking_group_id = v_group_id and status in ('held', 'confirmed');

  v_hourly_rate := case when p_start_at::time >= time '17:00' then 36 else 28 end;
  foreach v_previous in array v_previous_rows loop
    select target.id into v_target_court_id
    from public.courts as source
    join public.courts as target
      on target.sort_order = source.sort_order + v_offset
     and target.status = 'open'
    where source.id = v_previous.court_id;

    begin
      update public.bookings
         set court_id = v_target_court_id,
             start_at = p_start_at,
             end_at = p_end_at,
             status = v_previous.status,
             cancelled_at = v_previous.cancelled_at,
             total_amount = round(
               v_hourly_rate * extract(epoch from (p_end_at - p_start_at)) / 3600,
               2
             )
       where id = v_previous.id
       returning * into v_booking;
    exception when exclusion_violation then
      raise exception 'One or more selected courts are already booked';
    end;

    insert into private.app_audit_events (
      transaction_id, operation_id, event_type, entity_type, entity_id,
      actor_id, actor_email, actor_kind, source, before_state, after_state,
      changed_fields, metadata
    ) values (
      txid_current(), v_operation_id::text, 'booking.rescheduled', 'booking', v_booking.id::text,
      v_actor_id, v_actor_email, 'manager', 'manager_ui', to_jsonb(v_previous), to_jsonb(v_booking),
      array['court_id', 'start_at', 'end_at', 'total_amount']::text[],
      jsonb_build_object('schema_version', 1, 'group_move', true)
    );

    insert into private.booking_admin_actions (
      booking_id, actor_id, action, operation_id, previous_status, new_status,
      previous_court_id, new_court_id, previous_start_at, previous_end_at,
      new_start_at, new_end_at
    ) values (
      v_booking.id, v_actor_id, 'rescheduled', v_operation_id, v_previous.status, v_booking.status,
      v_previous.court_id, v_booking.court_id, v_previous.start_at, v_previous.end_at,
      v_booking.start_at, v_booking.end_at
    );
    return next v_booking;
  end loop;
  perform set_config('app.audit_suppress', 'false', true);
end;
$$;

revoke execute on function public.admin_move_booking_group(uuid,uuid,timestamp,timestamp)
  from public, anon, authenticated;
grant execute on function public.admin_move_booking_group(uuid,uuid,timestamp,timestamp)
  to authenticated;

notify pgrst, 'reload schema';
