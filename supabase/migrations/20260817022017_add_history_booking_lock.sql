alter table public.venue_settings
  add column if not exists lock_historical_bookings boolean not null default true;

comment on column public.venue_settings.lock_historical_bookings is
  'When true, managers cannot move or resize bookings that have already started or ended.';

alter table public.venue_events
  alter column blocks_booking set default true;

create or replace function private.enforce_future_booking_schedule()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_timezone text := 'America/Toronto';
  v_lock_historical boolean := true;
  v_now timestamp;
  v_is_manager boolean := false;
  v_history_editable boolean := false;
begin
  select
    coalesce(settings.timezone, v_timezone),
    coalesce(settings.lock_historical_bookings, true)
  into v_timezone, v_lock_historical
  from public.venue_settings as settings
  where settings.singleton;

  v_now := timezone(v_timezone, clock_timestamp());
  v_is_manager := exists (
    select 1
    from public.staff_members as staff
    where staff.user_id = auth.uid()
      and staff.role = 'admin'
  );
  v_history_editable := v_is_manager and not v_lock_historical;

  if new.status not in ('held', 'confirmed') then
    return new;
  end if;

  -- Creating a booking in the past is never allowed. Unlocking history only
  -- grants managers permission to correct an existing historical booking.
  if tg_op = 'INSERT' then
    if new.start_at <= v_now then
      raise exception using errcode = '22007', message = 'Booking start time must be in the future';
    end if;
    return new;
  end if;

  -- Group moves and swaps briefly park rows as cancelled. Managers may
  -- restore those existing rows in historical time only while history is
  -- explicitly unlocked.
  if old.status not in ('held', 'confirmed') then
    if new.start_at <= v_now and not v_history_editable then
      raise exception using errcode = '22007', message = 'Booking start time must be in the future';
    end if;
    return new;
  end if;

  if old.start_at <= v_now and v_history_editable then
    return new;
  end if;

  if old.end_at <= v_now then
    if new.court_id is distinct from old.court_id
       or new.start_at is distinct from old.start_at
       or new.end_at is distinct from old.end_at then
      raise exception using errcode = '22007', message = 'Booking has already ended';
    end if;
    return new;
  end if;

  if old.start_at <= v_now then
    if new.court_id is distinct from old.court_id
       or new.start_at is distinct from old.start_at then
      raise exception using errcode = '22007', message = 'Booking has already started; its start time and court are locked';
    end if;
    if new.end_at is distinct from old.end_at and new.end_at <= v_now then
      raise exception using errcode = '22007', message = 'In-progress booking must end after the current time';
    end if;
    return new;
  end if;

  if new.start_at <= v_now then
    raise exception using errcode = '22007', message = 'Booking start time must be in the future';
  end if;
  return new;
end;
$$;

create or replace function public.admin_update_venue_settings(p_settings jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := private.require_manager();
  v_row public.venue_settings;
begin
  if jsonb_typeof(coalesce(p_settings, '{}'::jsonb)) <> 'object' then
    raise exception 'Invalid venue settings';
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
    updated_by = v_actor_id
  where singleton
  returning * into v_row;

  return to_jsonb(v_row) - 'singleton';
end;
$$;

revoke all on function public.admin_update_venue_settings(jsonb) from public;
grant execute on function public.admin_update_venue_settings(jsonb) to authenticated;
