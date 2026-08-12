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
  v_group_id uuid;
  v_anchor_order integer;
  v_source_order integer;
  v_min_order integer;
  v_max_order integer;
  v_offset integer;
  v_operation_id uuid := gen_random_uuid();
  v_previous public.bookings;
  v_booking public.bookings;
  v_target_court_id uuid;
  v_hourly_rate numeric;
begin
  if v_actor_id is null then raise exception 'Authentication required'; end if;
  if not exists (select 1 from public.staff_members s where s.user_id = v_actor_id and s.role = 'admin') then raise exception 'Manager access required'; end if;
  perform private.assert_booking_window(p_start_at, p_end_at, interval '4 hours');
  select booking_group_id, c.sort_order into v_group_id, v_source_order
  from public.bookings b join public.courts c on c.id = b.court_id
  where b.id = p_booking_id;
  select sort_order into v_anchor_order from public.courts where id = p_anchor_court_id and status = 'open';
  if v_group_id is null or v_anchor_order is null then raise exception 'Booking or target court not found'; end if;
  select min(c.sort_order), max(c.sort_order) into v_min_order, v_max_order
  from public.bookings b join public.courts c on c.id = b.court_id
  where b.booking_group_id = v_group_id and b.status in ('held', 'confirmed');
  v_offset := v_anchor_order - v_source_order;
  if v_min_order + v_offset < 1 or v_max_order + v_offset > 5 then raise exception 'The selected group does not fit from that court'; end if;
  v_hourly_rate := case when p_start_at::time >= time '17:00' then 36 else 28 end;

  for v_previous in
    select b.* from public.bookings b join public.courts c on c.id=b.court_id
    where b.booking_group_id=v_group_id and b.status in ('held','confirmed') order by c.sort_order for update
  loop
    select id into v_target_court_id from public.courts
    where sort_order = (select sort_order from public.courts where id=v_previous.court_id) + v_offset and status='open';
    begin
      update public.bookings set court_id=v_target_court_id, start_at=p_start_at, end_at=p_end_at,
        total_amount=round(v_hourly_rate*extract(epoch from(p_end_at-p_start_at))/3600,2)
      where id=v_previous.id returning * into v_booking;
    exception when exclusion_violation then raise exception 'One or more selected courts are already booked'; end;
    insert into private.booking_admin_actions (
      booking_id,actor_id,action,operation_id,previous_status,new_status,previous_court_id,new_court_id,
      previous_start_at,previous_end_at,new_start_at,new_end_at
    ) values (
      v_booking.id,v_actor_id,'rescheduled',v_operation_id,v_previous.status,v_booking.status,v_previous.court_id,v_booking.court_id,
      v_previous.start_at,v_previous.end_at,v_booking.start_at,v_booking.end_at
    );
    return next v_booking;
  end loop;
end;
$$;

revoke execute on function public.admin_move_booking_group(uuid,uuid,timestamp,timestamp) from public,anon,authenticated;
grant execute on function public.admin_move_booking_group(uuid,uuid,timestamp,timestamp) to authenticated;
notify pgrst, 'reload schema';
