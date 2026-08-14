-- Make Operations Center configuration authoritative for new and rescheduled
-- bookings. Existing historical amounts remain untouched until a schedule or
-- customer identity field is intentionally changed.

create index venue_pricing_rules_court_idx on public.venue_pricing_rules (court_id) where court_id is not null;
create index venue_events_updated_by_idx on public.venue_events (updated_by) where updated_by is not null;
create index venue_members_auth_user_idx on public.venue_members (auth_user_id) where auth_user_id is not null;
create index venue_members_updated_by_idx on public.venue_members (updated_by) where updated_by is not null;
create index venue_opening_hours_updated_by_idx on public.venue_opening_hours (updated_by) where updated_by is not null;
create index venue_pricing_rules_updated_by_idx on public.venue_pricing_rules (updated_by) where updated_by is not null;

create policy venue_settings_rpc_only on public.venue_settings for all to authenticated using (false) with check (false);
create policy venue_opening_hours_rpc_only on public.venue_opening_hours for all to authenticated using (false) with check (false);
create policy venue_pricing_rules_rpc_only on public.venue_pricing_rules for all to authenticated using (false) with check (false);
create policy venue_events_rpc_only on public.venue_events for all to authenticated using (false) with check (false);
create policy venue_event_courts_rpc_only on public.venue_event_courts for all to authenticated using (false) with check (false);
create policy venue_members_rpc_only on public.venue_members for all to authenticated using (false) with check (false);

create or replace function private.calculate_booking_amount(
  p_court_id uuid,
  p_start_at timestamp,
  p_end_at timestamp,
  p_member_tier text default null,
  p_discount_percent numeric default 0
)
returns numeric
language plpgsql
security definer
stable
set search_path = ''
as $$
declare
  v_slot_minutes smallint;
  v_amount numeric;
begin
  select settings.slot_minutes into v_slot_minutes
  from public.venue_settings settings where settings.singleton;

  select sum(segment.hourly_rate * v_slot_minutes / 60.0)
  into v_amount
  from generate_series(
    p_start_at,
    p_end_at - make_interval(mins => v_slot_minutes),
    make_interval(mins => v_slot_minutes)
  ) segment_start
  cross join lateral (
    select rule.hourly_rate
    from public.venue_pricing_rules rule
    where rule.is_active
      and (rule.court_id is null or rule.court_id = p_court_id)
      and (rule.day_of_week is null or rule.day_of_week = extract(dow from segment_start)::smallint)
      and (rule.member_tier is null or rule.member_tier = p_member_tier)
      and (rule.valid_from is null or rule.valid_from <= segment_start::date)
      and (rule.valid_to is null or rule.valid_to >= segment_start::date)
      and (extract(hour from segment_start)::integer * 60 + extract(minute from segment_start)::integer) >= rule.start_minute
      and (extract(hour from segment_start)::integer * 60 + extract(minute from segment_start)::integer) < rule.end_minute
    order by rule.priority desc,
      (rule.court_id is not null) desc,
      (rule.member_tier is not null) desc,
      (rule.day_of_week is not null) desc,
      rule.created_at desc
    limit 1
  ) segment;

  if v_amount is null then raise exception 'No pricing rule covers this booking'; end if;
  return round(v_amount * (1 - least(greatest(coalesce(p_discount_percent, 0), 0), 100) / 100), 2);
end;
$$;

create or replace function private.assert_booking_window(
  p_start_at timestamp,
  p_end_at timestamp,
  p_max_duration interval
)
returns void
language plpgsql
security definer
stable
set search_path = ''
as $$
declare
  v_hours public.venue_opening_hours;
  v_slot_minutes smallint;
  v_start_minute integer;
  v_end_minute integer;
begin
  if p_end_at <= p_start_at then raise exception 'Invalid time range'; end if;
  if p_end_at < p_start_at + interval '30 minutes' then raise exception 'Minimum booking length is 30 minutes'; end if;
  if p_end_at > p_start_at + p_max_duration then raise exception 'Maximum booking length exceeded'; end if;

  select settings.slot_minutes into v_slot_minutes
  from public.venue_settings settings where settings.singleton;
  if (extract(epoch from (p_end_at - p_start_at)) / 60)::integer % v_slot_minutes <> 0
     or (extract(hour from p_start_at)::integer * 60 + extract(minute from p_start_at)::integer) % v_slot_minutes <> 0 then
    raise exception 'Booking time must align to the venue time step';
  end if;

  select * into v_hours from public.venue_opening_hours hours
  where hours.day_of_week = extract(dow from p_start_at)::smallint;
  if v_hours.id is null or v_hours.is_closed then raise exception 'Venue is closed on this day'; end if;

  v_start_minute := extract(hour from p_start_at)::integer * 60 + extract(minute from p_start_at)::integer;
  if p_end_at::date = p_start_at::date then
    v_end_minute := extract(hour from p_end_at)::integer * 60 + extract(minute from p_end_at)::integer;
  elsif p_end_at = date_trunc('day', p_start_at) + interval '1 day' then
    v_end_minute := 1440;
  else
    raise exception 'Booking must end on the booking day';
  end if;
  if v_start_minute < v_hours.open_minute or v_end_minute > v_hours.close_minute then
    raise exception 'Booking must be within opening hours';
  end if;
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
begin
  if new.status not in ('held', 'confirmed') then return new; end if;

  select case when exists (
    select 1 from public.staff_members staff where staff.user_id = auth.uid() and staff.role = 'admin'
  ) then make_interval(mins => settings.manager_max_minutes)
  else make_interval(mins => settings.customer_max_minutes) end
  into v_max_duration
  from public.venue_settings settings where settings.singleton;
  perform private.assert_booking_window(new.start_at, new.end_at, v_max_duration);

  if not exists (select 1 from public.courts court where court.id = new.court_id and court.status = 'open') then
    raise exception 'Court is unavailable';
  end if;
  if exists (
    select 1
    from public.venue_events event
    where event.status = 'scheduled' and event.blocks_booking
      and event.starts_at < new.end_at and event.ends_at > new.start_at
      and (
        not exists (select 1 from public.venue_event_courts event_court where event_court.event_id = event.id)
        or exists (select 1 from public.venue_event_courts event_court where event_court.event_id = event.id and event_court.court_id = new.court_id)
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

drop trigger if exists bookings_venue_rules on public.bookings;
create trigger bookings_venue_rules
before insert or update of court_id, start_at, end_at, status, customer_email, customer_phone
on public.bookings for each row execute function private.enforce_venue_booking_rules();

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
  if v_user_id is null then raise exception 'Authentication required'; end if;
  select lower(users.email) into v_email from auth.users users where users.id = v_user_id;
  select member.tier, member.discount_percent into v_tier, v_discount
  from public.venue_members member
  where member.status = 'active' and (member.expires_on is null or member.expires_on >= p_date)
    and (member.auth_user_id = v_user_id or member.email = v_email)
  order by (member.auth_user_id = v_user_id) desc limit 1;

  select jsonb_build_object(
    'version', 1,
    'settings', (select jsonb_build_object(
      'timezone', settings.timezone, 'currency', settings.currency,
      'booking_window_days', settings.booking_window_days, 'slot_minutes', settings.slot_minutes,
      'customer_max_minutes', settings.customer_max_minutes,
      'cancellation_notice_hours', settings.cancellation_notice_hours
    ) from public.venue_settings settings where settings.singleton),
    'opening_hours', (select jsonb_build_object(
      'day_of_week', hours.day_of_week, 'open_minute', hours.open_minute,
      'close_minute', hours.close_minute, 'is_closed', hours.is_closed, 'label', hours.label
    ) from public.venue_opening_hours hours where hours.day_of_week = extract(dow from p_date)::smallint),
    'member', jsonb_build_object('tier', v_tier, 'discount_percent', v_discount),
    'pricing_rules', coalesce((select jsonb_agg(jsonb_build_object(
      'id', rule.id, 'court_id', rule.court_id, 'start_minute', rule.start_minute,
      'end_minute', rule.end_minute, 'hourly_rate', rule.hourly_rate,
      'member_tier', rule.member_tier, 'priority', rule.priority
    ) order by rule.priority desc, rule.created_at desc)
      from public.venue_pricing_rules rule
      where rule.is_active
        and (rule.day_of_week is null or rule.day_of_week = extract(dow from p_date)::smallint)
        and (rule.valid_from is null or rule.valid_from <= p_date)
        and (rule.valid_to is null or rule.valid_to >= p_date)
        and (rule.member_tier is null or rule.member_tier = v_tier)
    ), '[]'::jsonb),
    'blocked_intervals', coalesce((select jsonb_agg(jsonb_build_object(
      'id', event.id, 'title_zh', event.title_zh, 'title_en', event.title_en,
      'start_at', event.starts_at, 'end_at', event.ends_at,
      'court_ids', coalesce(courts.court_ids, '[]'::jsonb)
    ) order by event.starts_at)
      from public.venue_events event
      left join lateral (
        select jsonb_agg(event_court.court_id) as court_ids
        from public.venue_event_courts event_court where event_court.event_id = event.id
      ) courts on true
      where event.status = 'scheduled' and event.blocks_booking
        and event.starts_at < (p_date + 1)::timestamp and event.ends_at > p_date::timestamp
    ), '[]'::jsonb)
  ) into v_result;
  return v_result;
end;
$$;

revoke all on function private.calculate_booking_amount(uuid, timestamp, timestamp, text, numeric) from public, anon, authenticated;
revoke all on function private.enforce_venue_booking_rules() from public, anon, authenticated;
revoke execute on function public.get_venue_booking_configuration(date) from public, anon;
grant execute on function public.get_venue_booking_configuration(date) to authenticated;

comment on function private.calculate_booking_amount is 'Calculates an interval price in configured slot increments using the highest-priority applicable rule.';
comment on function public.get_venue_booking_configuration is 'Authenticated, safe booking configuration for one venue-local calendar date.';

notify pgrst, 'reload schema';
