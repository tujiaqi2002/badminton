-- Store a pricing rule's weekday scope once, so managers can maintain a
-- single rule for any combination of days instead of duplicating rows.
alter table public.venue_pricing_rules
  add column if not exists days_of_week smallint[];

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'venue_pricing_rules_days_of_week_check'
      and conrelid = 'public.venue_pricing_rules'::regclass
  ) then
    alter table public.venue_pricing_rules
      add constraint venue_pricing_rules_days_of_week_check
      check (
        days_of_week is null
        or (
          cardinality(days_of_week) between 1 and 7
          and days_of_week <@ array[0, 1, 2, 3, 4, 5, 6]::smallint[]
        )
      );
  end if;
end;
$$;

update public.venue_pricing_rules
set days_of_week = array[day_of_week]::smallint[]
where day_of_week is not null
  and days_of_week is null;

create or replace function public.admin_upsert_pricing_rule(p_rule jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := private.require_manager();
  v_id uuid := nullif(p_rule ->> 'id', '')::uuid;
  v_days smallint[];
  v_single_day smallint;
  v_row public.venue_pricing_rules;
begin
  if trim(coalesce(p_rule ->> 'name_zh', '')) = ''
      or trim(coalesce(p_rule ->> 'name_en', '')) = '' then
    raise exception 'Pricing rule name is required';
  end if;

  if p_rule ? 'days_of_week' then
    if jsonb_typeof(p_rule -> 'days_of_week') = 'null' then
      v_days := null;
    elsif jsonb_typeof(p_rule -> 'days_of_week') = 'array' then
      if jsonb_array_length(p_rule -> 'days_of_week') = 0 then
        raise exception 'Choose at least one weekday or every day';
      end if;
      select array_agg(day_value order by day_value)
      into v_days
      from (
        select distinct value::smallint as day_value
        from jsonb_array_elements_text(p_rule -> 'days_of_week')
      ) selected_days;
    else
      raise exception 'Weekdays must be an array or null';
    end if;
  elsif nullif(p_rule ->> 'day_of_week', '') is not null then
    v_days := array[(p_rule ->> 'day_of_week')::smallint];
  else
    v_days := null;
  end if;

  if v_days is not null
      and not (v_days <@ array[0, 1, 2, 3, 4, 5, 6]::smallint[]) then
    raise exception 'Weekdays must be between Sunday and Saturday';
  end if;

  v_single_day := case when cardinality(v_days) = 1 then v_days[1] else null end;

  if v_id is null then
    insert into public.venue_pricing_rules (
      name_zh, name_en, court_id, day_of_week, days_of_week,
      start_minute, end_minute, hourly_rate, member_tier,
      valid_from, valid_to, priority, is_active, updated_by
    ) values (
      trim(p_rule ->> 'name_zh'),
      trim(p_rule ->> 'name_en'),
      nullif(p_rule ->> 'court_id', '')::uuid,
      v_single_day,
      v_days,
      (p_rule ->> 'start_minute')::smallint,
      (p_rule ->> 'end_minute')::smallint,
      (p_rule ->> 'hourly_rate')::numeric,
      nullif(trim(p_rule ->> 'member_tier'), ''),
      nullif(p_rule ->> 'valid_from', '')::date,
      nullif(p_rule ->> 'valid_to', '')::date,
      coalesce((p_rule ->> 'priority')::smallint, 100),
      coalesce((p_rule ->> 'is_active')::boolean, true),
      v_actor_id
    ) returning * into v_row;
  else
    update public.venue_pricing_rules
    set name_zh = trim(p_rule ->> 'name_zh'),
        name_en = trim(p_rule ->> 'name_en'),
        court_id = nullif(p_rule ->> 'court_id', '')::uuid,
        day_of_week = v_single_day,
        days_of_week = v_days,
        start_minute = (p_rule ->> 'start_minute')::smallint,
        end_minute = (p_rule ->> 'end_minute')::smallint,
        hourly_rate = (p_rule ->> 'hourly_rate')::numeric,
        member_tier = nullif(trim(p_rule ->> 'member_tier'), ''),
        valid_from = nullif(p_rule ->> 'valid_from', '')::date,
        valid_to = nullif(p_rule ->> 'valid_to', '')::date,
        priority = coalesce((p_rule ->> 'priority')::smallint, 100),
        is_active = coalesce((p_rule ->> 'is_active')::boolean, true),
        updated_by = v_actor_id
    where id = v_id
    returning * into v_row;

    if v_row.id is null then
      raise exception 'Pricing rule not found';
    end if;
  end if;

  return to_jsonb(v_row);
end;
$$;

create or replace function private.has_complete_base_pricing()
returns boolean
language sql
security definer
stable
set search_path = ''
as $$
  select not exists (
    select 1
    from public.venue_settings settings
    cross join public.venue_opening_hours hours
    cross join public.courts court
    cross join lateral generate_series(
      hours.open_minute::integer,
      (hours.close_minute - settings.slot_minutes)::integer,
      settings.slot_minutes::integer
    ) slot_start
    where settings.singleton
      and not hours.is_closed
      and court.status = 'open'
      and not exists (
        select 1
        from public.venue_pricing_rules rule
        where rule.is_active
          and rule.member_tier is null
          and rule.valid_from is null
          and rule.valid_to is null
          and (rule.court_id is null or rule.court_id = court.id)
          and (rule.days_of_week is null or hours.day_of_week = any(rule.days_of_week))
          and rule.start_minute <= slot_start
          and rule.end_minute > slot_start
      )
  );
$$;

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
  v_segment_count bigint;
  v_priced_count bigint;
  v_amount numeric;
begin
  select settings.slot_minutes into v_slot_minutes
  from public.venue_settings settings
  where settings.singleton;

  with priced_segments as (
    select segment_start, price.hourly_rate
    from generate_series(
      p_start_at,
      p_end_at - make_interval(mins => v_slot_minutes),
      make_interval(mins => v_slot_minutes)
    ) segment_start
    left join lateral (
      select rule.hourly_rate
      from public.venue_pricing_rules rule
      where rule.is_active
        and (rule.court_id is null or rule.court_id = p_court_id)
        and (
          rule.days_of_week is null
          or extract(dow from segment_start)::smallint = any(rule.days_of_week)
        )
        and (rule.member_tier is null or rule.member_tier = p_member_tier)
        and (rule.valid_from is null or rule.valid_from <= segment_start::date)
        and (rule.valid_to is null or rule.valid_to >= segment_start::date)
        and (extract(hour from segment_start)::integer * 60 + extract(minute from segment_start)::integer) >= rule.start_minute
        and (extract(hour from segment_start)::integer * 60 + extract(minute from segment_start)::integer) < rule.end_minute
      order by
        rule.priority desc,
        (rule.court_id is not null) desc,
        (rule.member_tier is not null) desc,
        (rule.days_of_week is not null) desc,
        cardinality(rule.days_of_week) asc nulls last,
        rule.created_at desc
      limit 1
    ) price on true
  )
  select count(*), count(hourly_rate), sum(hourly_rate * v_slot_minutes / 60.0)
  into v_segment_count, v_priced_count, v_amount
  from priced_segments;

  if v_segment_count = 0 or v_priced_count <> v_segment_count then
    raise exception 'No pricing rule covers this booking';
  end if;

  return round(
    v_amount * (1 - least(greatest(coalesce(p_discount_percent, 0), 0), 100) / 100),
    2
  );
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
    'version', 3,
    'settings', (select jsonb_build_object(
      'name_zh', settings.name_zh,
      'name_en', settings.name_en,
      'timezone', settings.timezone,
      'currency', settings.currency,
      'booking_window_days', settings.booking_window_days,
      'slot_minutes', settings.slot_minutes,
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

revoke execute on function public.admin_upsert_pricing_rule(jsonb) from public, anon;
grant execute on function public.admin_upsert_pricing_rule(jsonb) to authenticated;
revoke all on function private.has_complete_base_pricing() from public, anon, authenticated;
revoke all on function private.calculate_booking_amount(uuid, timestamp, timestamp, text, numeric) from public, anon, authenticated;
revoke execute on function public.get_venue_booking_configuration(date) from public, anon;
grant execute on function public.get_venue_booking_configuration(date) to authenticated;

comment on column public.venue_pricing_rules.days_of_week is
  'Null means every day; otherwise contains unique PostgreSQL DOW values 0 (Sunday) through 6 (Saturday).';
comment on function public.admin_upsert_pricing_rule(jsonb) is
  'Creates or updates one pricing rule for every day or any selected weekday combination.';
comment on function private.has_complete_base_pricing() is
  'Returns true when permanent non-member pricing covers every configured open court slot.';
comment on function private.calculate_booking_amount is
  'Prices every slot using the highest-priority applicable multi-weekday rule and rejects partial coverage.';
comment on function public.get_venue_booking_configuration is
  'Authenticated booking configuration for one venue-local date, including multi-weekday pricing.';

notify pgrst, 'reload schema';
