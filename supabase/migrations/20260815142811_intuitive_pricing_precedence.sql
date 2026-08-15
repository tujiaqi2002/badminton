-- Replace manager-entered numeric priorities with a deterministic,
-- specificity-first pricing order. The legacy priority column stays in place
-- for backwards compatibility, but no longer participates in price selection.

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
        (rule.valid_from is not null or rule.valid_to is not null) desc,
        ((rule.valid_from is not null)::integer + (rule.valid_to is not null)::integer) desc,
        case
          when rule.valid_from is not null and rule.valid_to is not null then rule.valid_to - rule.valid_from
          else 2147483647
        end asc,
        (rule.member_tier is not null) desc,
        (rule.court_id is not null) desc,
        (rule.days_of_week is not null) desc,
        cardinality(rule.days_of_week) asc nulls last,
        (rule.end_minute - rule.start_minute) asc,
        rule.updated_at desc,
        rule.created_at desc,
        rule.id desc
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
  v_tier_name_zh text;
  v_tier_name_en text;
  v_discount numeric := 0;
  v_result jsonb;
begin
  if v_user_id is null then
    raise exception 'Authentication required';
  end if;

  select lower(users.email) into v_email
  from auth.users users
  where users.id = v_user_id;

  select member.tier, tier.name_zh, tier.name_en, member.discount_percent
  into v_tier, v_tier_name_zh, v_tier_name_en, v_discount
  from public.venue_members member
  left join public.venue_member_tiers tier on tier.code = member.tier
  where member.status = 'active'
    and (member.expires_on is null or member.expires_on >= p_date)
    and (member.auth_user_id = v_user_id or member.email = v_email)
  order by (member.auth_user_id = v_user_id) desc
  limit 1;

  select jsonb_build_object(
    'version', 5,
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
    'member', jsonb_build_object(
      'tier', v_tier,
      'name_zh', v_tier_name_zh,
      'name_en', v_tier_name_en,
      'discount_percent', v_discount
    ),
    'pricing_rules', coalesce((select jsonb_agg(jsonb_build_object(
      'id', rule.id,
      'name_zh', rule.name_zh,
      'name_en', rule.name_en,
      'court_id', rule.court_id,
      'days_of_week', rule.days_of_week,
      'start_minute', rule.start_minute,
      'end_minute', rule.end_minute,
      'hourly_rate', rule.hourly_rate,
      'member_tier', rule.member_tier,
      'valid_from', rule.valid_from,
      'valid_to', rule.valid_to,
      'created_at', rule.created_at,
      'updated_at', rule.updated_at
    ) order by
      (rule.valid_from is not null or rule.valid_to is not null) desc,
      ((rule.valid_from is not null)::integer + (rule.valid_to is not null)::integer) desc,
      case
        when rule.valid_from is not null and rule.valid_to is not null then rule.valid_to - rule.valid_from
        else 2147483647
      end asc,
      (rule.member_tier is not null) desc,
      (rule.court_id is not null) desc,
      (rule.days_of_week is not null) desc,
      cardinality(rule.days_of_week) asc nulls last,
      (rule.end_minute - rule.start_minute) asc,
      rule.updated_at desc,
      rule.created_at desc,
      rule.id desc)
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
      0,
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
        priority = 0,
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

create index if not exists venue_pricing_rules_active_match_idx
  on public.venue_pricing_rules (member_tier, court_id, start_minute, end_minute)
  include (days_of_week, valid_from, valid_to, hourly_rate, updated_at)
  where is_active;

update public.venue_pricing_rules
set priority = 0
where priority <> 0;

revoke all on function private.calculate_booking_amount(uuid, timestamp, timestamp, text, numeric)
  from public, anon, authenticated;
revoke execute on function public.get_venue_booking_configuration(date) from public, anon;
grant execute on function public.get_venue_booking_configuration(date) to authenticated;
revoke execute on function public.admin_upsert_pricing_rule(jsonb) from public, anon;
grant execute on function public.admin_upsert_pricing_rule(jsonb) to authenticated;

comment on column public.venue_pricing_rules.priority is
  'Deprecated compatibility field. Pricing now uses deterministic specificity-first matching and this value is ignored.';
comment on function private.calculate_booking_amount is
  'Prices each slot with the most specific matching rule: dated, member, court, weekday, narrower time, then latest edit.';
comment on function public.get_venue_booking_configuration is
  'Authenticated date configuration with named pricing rules and an explicit member discount for transparent quotes.';
comment on function public.admin_upsert_pricing_rule(jsonb) is
  'Creates or updates a pricing rule; numeric priority input is intentionally ignored.';

notify pgrst, 'reload schema';
