-- Preserve manager-defined special pricing while guaranteeing every open
-- court and slot always has a low-priority base price.
insert into public.venue_pricing_rules (
  name_zh, name_en, court_id, day_of_week, start_minute, end_minute,
  hourly_rate, member_tier, valid_from, valid_to, priority, is_active
)
select
  seed.name_zh, seed.name_en, null, null, seed.start_minute, seed.end_minute,
  seed.hourly_rate, null, null, null, 0, true
from (
  values
    ('基础日间价'::text, 'Base day rate'::text, 600::smallint, 1020::smallint, 28.00::numeric),
    ('基础晚间价'::text, 'Base evening rate'::text, 1020::smallint, 1440::smallint, 36.00::numeric)
) as seed(name_zh, name_en, start_minute, end_minute, hourly_rate)
where not exists (
  select 1
  from public.venue_pricing_rules rule
  where rule.name_en = seed.name_en
    and rule.court_id is null
    and rule.day_of_week is null
    and rule.member_tier is null
    and rule.valid_from is null
    and rule.valid_to is null
);

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
          and (rule.day_of_week is null or rule.day_of_week = hours.day_of_week)
          and rule.start_minute <= slot_start
          and rule.end_minute > slot_start
      )
  );
$$;

create or replace function private.enforce_complete_base_pricing()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.has_complete_base_pricing() then
    raise exception 'Pricing rules must cover every open court and time slot'
      using errcode = '23514';
  end if;
  return null;
end;
$$;

drop trigger if exists venue_pricing_coverage_guard on public.venue_pricing_rules;
create constraint trigger venue_pricing_coverage_guard
after insert or update or delete on public.venue_pricing_rules
deferrable initially deferred
for each row execute function private.enforce_complete_base_pricing();

drop trigger if exists venue_hours_pricing_coverage_guard on public.venue_opening_hours;
create constraint trigger venue_hours_pricing_coverage_guard
after insert or update or delete on public.venue_opening_hours
deferrable initially deferred
for each row execute function private.enforce_complete_base_pricing();

drop trigger if exists courts_pricing_coverage_guard on public.courts;
create constraint trigger courts_pricing_coverage_guard
after insert or update of status or delete on public.courts
deferrable initially deferred
for each row execute function private.enforce_complete_base_pricing();

-- Count all expected segments explicitly. A lateral inner join can otherwise
-- silently omit an uncovered segment and undercharge a partially covered order.
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
        and (rule.day_of_week is null or rule.day_of_week = extract(dow from segment_start)::smallint)
        and (rule.member_tier is null or rule.member_tier = p_member_tier)
        and (rule.valid_from is null or rule.valid_from <= segment_start::date)
        and (rule.valid_to is null or rule.valid_to >= segment_start::date)
        and (extract(hour from segment_start)::integer * 60 + extract(minute from segment_start)::integer) >= rule.start_minute
        and (extract(hour from segment_start)::integer * 60 + extract(minute from segment_start)::integer) < rule.end_minute
      order by
        rule.priority desc,
        (rule.court_id is not null) desc,
        (rule.member_tier is not null) desc,
        (rule.day_of_week is not null) desc,
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

revoke all on function private.has_complete_base_pricing() from public, anon, authenticated;
revoke all on function private.enforce_complete_base_pricing() from public, anon, authenticated;
revoke all on function private.calculate_booking_amount(uuid, timestamp, timestamp, text, numeric) from public, anon, authenticated;

comment on function private.has_complete_base_pricing() is
  'Returns true when permanent non-member pricing covers every configured open court slot.';
comment on function private.calculate_booking_amount is
  'Prices every slot using the highest-priority applicable rule and rejects partial coverage.';
