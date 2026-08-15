-- Keep the customer minimum independent from the venue grid size. Managers
-- retain the operational ability to create the smallest grid-aligned booking.

alter table public.venue_settings
  add column customer_min_minutes smallint not null default 60;

alter table public.venue_settings
  add constraint venue_settings_customer_min_minutes_check
    check (customer_min_minutes between 30 and 480),
  add constraint venue_settings_customer_duration_bounds_check
    check (customer_min_minutes <= customer_max_minutes);

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
    updated_by = v_actor_id
  where singleton
  returning * into v_row;

  return to_jsonb(v_row) - 'singleton';
end;
$$;

create or replace function private.enforce_venue_booking_rules()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_member_tier text;
  v_discount numeric := 0;
  v_max_duration interval;
  v_is_manager boolean;
  v_settings public.venue_settings;
  v_today date;
begin
  if new.status not in ('held', 'confirmed') then return new; end if;

  select exists (
    select 1 from public.staff_members staff
    where staff.user_id = auth.uid() and staff.role = 'admin'
  ) into v_is_manager;

  select * into v_settings
  from public.venue_settings settings
  where settings.singleton;

  if not v_is_manager
     and new.end_at < new.start_at + make_interval(mins => v_settings.customer_min_minutes) then
    raise exception 'Minimum customer booking length is % minutes', v_settings.customer_min_minutes;
  end if;

  v_max_duration := make_interval(mins => case when v_is_manager
    then v_settings.manager_max_minutes else v_settings.customer_max_minutes end);

  if not v_is_manager and (tg_op = 'INSERT' or new.start_at is distinct from old.start_at) then
    v_today := timezone(v_settings.timezone, clock_timestamp())::date;
    if new.start_at::date > v_today + (v_settings.booking_window_days - 1) then
      raise exception 'Booking is outside the configured booking window';
    end if;
  end if;

  perform private.assert_booking_window(new.start_at, new.end_at, v_max_duration);

  if not exists (
    select 1 from public.courts court
    where court.id = new.court_id and court.status = 'open'
  ) then
    raise exception 'Court is unavailable';
  end if;

  if exists (
    select 1
    from public.venue_events event
    where event.status = 'scheduled'
      and event.blocks_booking
      and event.starts_at < new.end_at
      and event.ends_at > new.start_at
      and (
        not exists (
          select 1 from public.venue_event_courts event_court
          where event_court.event_id = event.id
        )
        or exists (
          select 1 from public.venue_event_courts event_court
          where event_court.event_id = event.id and event_court.court_id = new.court_id
        )
      )
  ) then
    raise exception 'Court is blocked by a venue event';
  end if;

  select member.tier, member.discount_percent into v_member_tier, v_discount
  from public.venue_members member
  where member.status = 'active'
    and (member.expires_on is null or member.expires_on >= new.start_at::date)
    and (
      (new.customer_email is not null and member.email = lower(new.customer_email))
      or (new.customer_phone is not null and member.phone = new.customer_phone)
      or (member.auth_user_id is not null and member.auth_user_id = new.user_id)
    )
  order by (member.auth_user_id = new.user_id) desc, member.updated_at desc
  limit 1;

  new.total_amount := private.calculate_booking_amount(
    new.court_id, new.start_at, new.end_at, v_member_tier, v_discount
  );
  return new;
end;
$$;

create or replace function public.get_venue_booking_configuration(p_date date)
returns jsonb
language plpgsql
security definer
stable
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_email text;
  v_tier text;
  v_discount numeric := 0;
  v_result jsonb;
begin
  if v_user_id is null then
    raise exception 'Authentication required';
  end if;

  select lower(users.email) into v_email
  from auth.users users
  where users.id = v_user_id;

  select member.tier, member.discount_percent into v_tier, v_discount
  from public.venue_members member
  where member.status = 'active'
    and (member.expires_on is null or member.expires_on >= p_date)
    and (member.auth_user_id = v_user_id or member.email = v_email)
  order by (member.auth_user_id = v_user_id) desc
  limit 1;

  select jsonb_build_object(
    'version', 4,
    'settings', (select jsonb_build_object(
      'name_zh', settings.name_zh,
      'name_en', settings.name_en,
      'timezone', settings.timezone,
      'currency', settings.currency,
      'booking_window_days', settings.booking_window_days,
      'slot_minutes', settings.slot_minutes,
      'customer_min_minutes', settings.customer_min_minutes,
      'customer_max_minutes', settings.customer_max_minutes,
      'manager_max_minutes', settings.manager_max_minutes,
      'cancellation_notice_hours', settings.cancellation_notice_hours
    ) from public.venue_settings settings where settings.singleton),
    'opening_hours', (select jsonb_build_object(
      'day_of_week', hours.day_of_week,
      'open_minute', hours.open_minute,
      'close_minute', hours.close_minute,
      'is_closed', hours.is_closed,
      'label', hours.label
    ) from public.venue_opening_hours hours
      where hours.day_of_week = extract(dow from p_date)::smallint),
    'member', jsonb_build_object('tier', v_tier, 'discount_percent', v_discount),
    'pricing_rules', coalesce((select jsonb_agg(jsonb_build_object(
      'id', rule.id,
      'court_id', rule.court_id,
      'days_of_week', rule.days_of_week,
      'start_minute', rule.start_minute,
      'end_minute', rule.end_minute,
      'hourly_rate', rule.hourly_rate,
      'member_tier', rule.member_tier,
      'priority', rule.priority
    ) order by rule.priority desc, rule.created_at desc)
      from public.venue_pricing_rules rule
      where rule.is_active
        and (
          rule.days_of_week is null
          or extract(dow from p_date)::smallint = any(rule.days_of_week)
        )
        and (rule.valid_from is null or rule.valid_from <= p_date)
        and (rule.valid_to is null or rule.valid_to >= p_date)
        and (rule.member_tier is null or rule.member_tier = v_tier)
    ), '[]'::jsonb),
    'blocked_intervals', coalesce((select jsonb_agg(jsonb_build_object(
      'id', event.id,
      'title_zh', event.title_zh,
      'title_en', event.title_en,
      'start_at', event.starts_at,
      'end_at', event.ends_at,
      'court_ids', coalesce(courts.court_ids, '[]'::jsonb)
    ) order by event.starts_at)
      from public.venue_events event
      left join lateral (
        select jsonb_agg(event_court.court_id) as court_ids
        from public.venue_event_courts event_court
        where event_court.event_id = event.id
      ) courts on true
      where event.status = 'scheduled'
        and event.blocks_booking
        and event.starts_at < (p_date + 1)::timestamp
        and event.ends_at > p_date::timestamp
    ), '[]'::jsonb)
  ) into v_result;

  return v_result;
end;
$$;

comment on column public.venue_settings.customer_min_minutes is
  'Minimum customer-created booking length. Manager bookings still use the venue time step.';

notify pgrst, 'reload schema';
