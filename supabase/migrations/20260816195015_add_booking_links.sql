alter table public.bookings
  add column if not exists booking_link_id uuid;

create index if not exists bookings_link_idx
  on public.bookings (booking_link_id, start_at)
  where booking_link_id is not null;

comment on column public.bookings.booking_link_id is
  'Business-level relationship between otherwise independent booking groups. Unlike booking_group_id, linked bookings do not move or resize together.';

create or replace function public.admin_link_booking_groups(
  p_source_booking_id uuid,
  p_target_booking_id uuid
)
returns table (
  booking_link_id uuid,
  linked_booking_count integer,
  linked_group_count integer
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := auth.uid();
  v_source_group_id uuid;
  v_target_group_id uuid;
  v_source_link_id uuid;
  v_target_link_id uuid;
  v_link_id uuid;
  v_operation_id text := gen_random_uuid()::text;
begin
  if v_actor_id is null then
    raise exception 'Authentication required';
  end if;

  if not exists (
    select 1
    from public.staff_members as staff
    where staff.user_id = v_actor_id
      and staff.role = 'admin'
  ) then
    raise exception 'Manager access required';
  end if;

  if p_source_booking_id = p_target_booking_id then
    raise exception 'Choose a different booking to link';
  end if;

  select booking.booking_group_id, booking.booking_link_id
    into v_source_group_id, v_source_link_id
  from public.bookings as booking
  where booking.id = p_source_booking_id
    and booking.status in ('held', 'confirmed');

  select booking.booking_group_id, booking.booking_link_id
    into v_target_group_id, v_target_link_id
  from public.bookings as booking
  where booking.id = p_target_booking_id
    and booking.status in ('held', 'confirmed');

  if v_source_group_id is null or v_target_group_id is null then
    raise exception 'One or both bookings are unavailable';
  end if;

  if v_source_group_id = v_target_group_id then
    raise exception 'These bookings already belong to the same reservation';
  end if;

  if v_source_link_id is not null and v_source_link_id = v_target_link_id then
    raise exception 'These bookings are already linked';
  end if;

  v_link_id := coalesce(v_source_link_id, v_target_link_id, gen_random_uuid());

  perform set_config('app.audit_operation_id', v_operation_id, true);
  perform set_config('app.audit_event_type', 'booking.linked', true);
  perform set_config('app.audit_source', 'manager_schedule', true);

  update public.bookings as booking
     set booking_link_id = v_link_id
   where booking.booking_group_id in (v_source_group_id, v_target_group_id)
      or (v_source_link_id is not null and booking.booking_link_id = v_source_link_id)
      or (v_target_link_id is not null and booking.booking_link_id = v_target_link_id);

  return query
  select
    v_link_id,
    count(*)::integer,
    count(distinct booking.booking_group_id)::integer
  from public.bookings as booking
  where booking.booking_link_id = v_link_id;
end;
$$;

revoke execute on function public.admin_link_booking_groups(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.admin_link_booking_groups(uuid, uuid)
  to authenticated;
