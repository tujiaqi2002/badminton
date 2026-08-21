alter table public.venue_settings
  add column if not exists multi_court_drag_mode text not null default 'group';

alter table public.venue_settings
  drop constraint if exists venue_settings_multi_court_drag_mode_check;

alter table public.venue_settings
  add constraint venue_settings_multi_court_drag_mode_check
  check (multi_court_drag_mode in ('group', 'single'));

comment on column public.venue_settings.multi_court_drag_mode is
  'Venue-wide manager schedule behavior for multi-court booking groups: group moves the full group, single moves only the selected court row.';

create or replace function public.admin_update_venue_settings(p_settings jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := private.require_manager();
  v_drag_mode text := nullif(trim(p_settings ->> 'multi_court_drag_mode'), '');
  v_row public.venue_settings;
begin
  if jsonb_typeof(coalesce(p_settings, '{}'::jsonb)) <> 'object' then
    raise exception 'Invalid venue settings';
  end if;

  if v_drag_mode is not null and v_drag_mode not in ('group', 'single') then
    raise exception 'Invalid multi-court drag mode';
  end if;

  update public.venue_settings set
    name_zh = coalesce(nullif(trim(p_settings ->> 'name_zh'), ''), name_zh),
    name_en = coalesce(nullif(trim(p_settings ->> 'name_en'), ''), name_en),
    timezone = coalesce(nullif(trim(p_settings ->> 'timezone'), ''), timezone),
    currency = upper(coalesce(nullif(trim(p_settings ->> 'currency'), ''), currency)),
    booking_window_days = coalesce((p_settings ->> 'booking_window_days')::smallint, booking_window_days),
    slot_minutes = coalesce((p_settings ->> 'slot_minutes')::smallint, slot_minutes),
    customer_min_minutes = coalesce((p_settings ->> 'customer_min_minutes')::smallint, customer_min_minutes),
    customer_max_minutes = coalesce((p_settings ->> 'customer_max_minutes')::smallint, customer_max_minutes),
    manager_max_minutes = coalesce((p_settings ->> 'manager_max_minutes')::smallint, manager_max_minutes),
    cancellation_notice_hours = coalesce((p_settings ->> 'cancellation_notice_hours')::smallint, cancellation_notice_hours),
    lock_historical_bookings = coalesce((p_settings ->> 'lock_historical_bookings')::boolean, lock_historical_bookings),
    multi_court_drag_mode = coalesce(v_drag_mode, multi_court_drag_mode),
    updated_by = v_actor_id
  where singleton
  returning * into v_row;

  return to_jsonb(v_row) - 'singleton';
end;
$$;

create or replace function public.admin_get_booking_relationship(p_booking_id uuid)
returns jsonb
language plpgsql
security definer
stable
set search_path = ''
as $$
declare
  v_group_id uuid;
  v_link_id uuid;
  v_result jsonb;
begin
  perform private.require_manager();

  select booking.booking_group_id, booking.booking_link_id
    into v_group_id, v_link_id
  from public.bookings as booking
  where booking.id = p_booking_id;

  if v_group_id is null then
    raise exception 'Booking not found';
  end if;

  with eligible as (
    select booking.*
    from public.bookings as booking
    where booking.status in ('held', 'confirmed')
      and (
        (v_link_id is not null and booking.booking_link_id = v_link_id)
        or (v_link_id is null and booking.booking_group_id = v_group_id)
      )
  ), grouped as (
    select
      booking.booking_group_id,
      (array_agg(booking.id order by booking.start_at, booking.court_id, booking.id))[1] as primary_booking_id,
      min(booking.customer_name) as customer_name,
      min(booking.start_at) as starts_at,
      max(booking.end_at) as ends_at,
      array_agg(booking.id order by booking.start_at, booking.court_id, booking.id) as booking_ids,
      array_agg(booking.court_id order by booking.start_at, booking.court_id, booking.id) as court_ids,
      round(sum(booking.total_amount), 2) as subtotal,
      max(booking.currency) as currency,
      count(*)::integer as booking_count,
      count(*) filter (where booking.payment_status = 'paid')::integer as paid_count,
      case
        when bool_and(booking.payment_status = 'paid') then 'paid'
        when bool_or(booking.payment_status = 'paid') then 'partial'
        else 'unpaid'
      end as payment_summary
    from eligible as booking
    group by booking.booking_group_id
  )
  select jsonb_build_object(
    'booking_link_id', v_link_id,
    'selected_group_id', v_group_id,
    'group_count', count(*)::integer,
    'linked_total', coalesce(round(sum(grouped.subtotal), 2), 0),
    'currency', coalesce(max(grouped.currency), 'CAD'),
    'paid_group_count', count(*) filter (where grouped.payment_summary = 'paid')::integer,
    'partially_paid', coalesce(bool_or(grouped.payment_summary = 'partial'), false),
    'groups', coalesce(jsonb_agg(to_jsonb(grouped) order by grouped.starts_at, grouped.booking_group_id), '[]'::jsonb)
  )
  into v_result
  from grouped;

  return v_result;
end;
$$;

create or replace function public.admin_unlink_booking_group(p_booking_id uuid)
returns table (
  previous_booking_link_id uuid,
  unlinked_group_id uuid,
  affected_booking_count integer,
  remaining_group_count integer
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_group_id uuid;
  v_link_id uuid;
  v_group_count integer;
  v_remaining integer;
  v_affected integer := 0;
  v_changed integer := 0;
  v_operation_id text := gen_random_uuid()::text;
begin
  perform private.require_manager();

  select booking.booking_group_id, booking.booking_link_id
    into v_group_id, v_link_id
  from public.bookings as booking
  where booking.id = p_booking_id
  for update;

  if v_group_id is null then
    raise exception 'Booking not found';
  end if;

  if v_link_id is null then
    raise exception 'Booking is not linked';
  end if;

  perform 1
  from public.bookings as booking
  where booking.booking_link_id = v_link_id
  order by booking.id
  for update;

  select count(distinct booking.booking_group_id)::integer
    into v_group_count
  from public.bookings as booking
  where booking.booking_link_id = v_link_id
    and booking.status in ('held', 'confirmed');

  perform set_config('app.audit_operation_id', v_operation_id, true);
  perform set_config('app.audit_event_type', 'booking.unlinked', true);
  perform set_config('app.audit_source', 'manager_schedule', true);

  if v_group_count <= 2 then
    update public.bookings as booking
       set booking_link_id = null
     where booking.booking_link_id = v_link_id;
    get diagnostics v_affected = row_count;
    v_remaining := 0;
  else
    update public.bookings as booking
       set booking_link_id = null
     where booking.booking_link_id = v_link_id
       and booking.booking_group_id = v_group_id;
    get diagnostics v_affected = row_count;

    select count(distinct booking.booking_group_id)::integer
      into v_remaining
    from public.bookings as booking
    where booking.booking_link_id = v_link_id
      and booking.status in ('held', 'confirmed');

    if v_remaining <= 1 then
      update public.bookings as booking
         set booking_link_id = null
       where booking.booking_link_id = v_link_id;
      get diagnostics v_changed = row_count;
      v_affected := v_affected + v_changed;
      v_remaining := 0;
    end if;
  end if;

  return query select v_link_id, v_group_id, v_affected, v_remaining;
end;
$$;

create or replace function public.admin_mark_booking_paid(
  p_booking_id uuid,
  p_scope text default 'linked'
)
returns table (
  booking_link_id uuid,
  updated_booking_count integer,
  updated_group_count integer,
  linked_total numeric
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_group_id uuid;
  v_link_id uuid;
  v_updated integer := 0;
  v_group_count integer := 0;
  v_total numeric := 0;
  v_operation_id text := gen_random_uuid()::text;
begin
  perform private.require_manager();

  if p_scope not in ('linked', 'group') then
    raise exception 'Invalid payment scope';
  end if;

  select booking.booking_group_id, booking.booking_link_id
    into v_group_id, v_link_id
  from public.bookings as booking
  where booking.id = p_booking_id
  for update;

  if v_group_id is null then
    raise exception 'Booking not found';
  end if;

  if p_scope = 'linked' and v_link_id is null then
    raise exception 'Booking is not linked';
  end if;

  perform 1
  from public.bookings as booking
  where booking.status in ('held', 'confirmed')
    and (
      (p_scope = 'linked' and booking.booking_link_id = v_link_id)
      or (p_scope = 'group' and booking.booking_group_id = v_group_id)
    )
  order by booking.id
  for update;

  perform set_config('app.audit_operation_id', v_operation_id, true);
  perform set_config('app.audit_event_type', 'booking.payment_updated', true);
  perform set_config('app.audit_source', 'manager_schedule', true);

  update public.bookings as booking
     set payment_status = 'paid'
   where booking.status in ('held', 'confirmed')
     and booking.payment_status <> 'paid'
     and (
       (p_scope = 'linked' and booking.booking_link_id = v_link_id)
       or (p_scope = 'group' and booking.booking_group_id = v_group_id)
     );
  get diagnostics v_updated = row_count;

  select
    count(distinct booking.booking_group_id)::integer,
    coalesce(round(sum(booking.total_amount), 2), 0)
  into v_group_count, v_total
  from public.bookings as booking
  where booking.status in ('held', 'confirmed')
    and (
      (p_scope = 'linked' and booking.booking_link_id = v_link_id)
      or (p_scope = 'group' and booking.booking_group_id = v_group_id)
    );

  return query select v_link_id, v_updated, v_group_count, v_total;
end;
$$;

revoke all on function public.admin_update_venue_settings(jsonb) from public, anon, authenticated;
revoke all on function public.admin_get_booking_relationship(uuid) from public, anon, authenticated;
revoke all on function public.admin_unlink_booking_group(uuid) from public, anon, authenticated;
revoke all on function public.admin_mark_booking_paid(uuid, text) from public, anon, authenticated;

grant execute on function public.admin_update_venue_settings(jsonb) to authenticated;
grant execute on function public.admin_get_booking_relationship(uuid) to authenticated;
grant execute on function public.admin_unlink_booking_group(uuid) to authenticated;
grant execute on function public.admin_mark_booking_paid(uuid, text) to authenticated;

notify pgrst, 'reload schema';
