-- Structured member tiers, fast member enrolment support and a privacy-safe
-- customer availability feed. Manager-only functions perform their own role
-- check; customer availability exposes no customer or payment information.

create table public.venue_member_tiers (
  code text primary key,
  name_zh text not null,
  name_en text not null,
  description_zh text,
  description_en text,
  rank smallint not null unique,
  discount_percent numeric(5,2) not null default 0,
  default_validity_days smallint,
  color text not null default 'ink',
  benefits jsonb not null default '[]'::jsonb,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null,
  constraint venue_member_tiers_code check (code ~ '^[a-z][a-z0-9_]{0,31}$'),
  constraint venue_member_tiers_discount check (discount_percent between 0 and 100),
  constraint venue_member_tiers_validity check (default_validity_days is null or default_validity_days between 1 and 3650),
  constraint venue_member_tiers_color check (color in ('ink', 'jade', 'silver', 'gold', 'cinnabar')),
  constraint venue_member_tiers_benefits check (jsonb_typeof(benefits) = 'array')
);

insert into public.venue_member_tiers
  (code, name_zh, name_en, description_zh, description_en, rank, discount_percent, default_validity_days, color, benefits)
values
  ('standard', '普通会员', 'Member', '适合日常到店的基础会员。', 'The simple everyday membership.', 10, 0, 365, 'ink', '["member_profile"]'::jsonb),
  ('silver', '银虎会员', 'Silver Tiger', '稳定到店客户，享受基础会员价。', 'For regular players with an entry-level member rate.', 20, 5, 365, 'silver', '["member_rate","priority_support"]'::jsonb),
  ('gold', '金虎会员', 'Gold Tiger', '高频客户，享受更高折扣与活动优先权。', 'For frequent players with better rates and event priority.', 30, 10, 365, 'gold', '["member_rate","event_priority","priority_support"]'::jsonb),
  ('black', '黑金会员', 'Black Tiger', '最高等级，适合长期高频客户与团体负责人。', 'The highest tier for long-term frequent players and group organisers.', 40, 15, 365, 'cinnabar', '["best_rate","event_priority","priority_support","group_booking"]'::jsonb)
on conflict (code) do nothing;

-- Preserve any legacy free-text tier codes before adding referential integrity.
insert into public.venue_member_tiers (code, name_zh, name_en, rank, discount_percent, color)
select legacy.code, initcap(replace(legacy.code, '_', ' ')), initcap(replace(legacy.code, '_', ' ')),
  (100 + row_number() over (order by legacy.code))::smallint, 0, 'ink'
from (
  select distinct member.tier as code from public.venue_members member
  union
  select distinct rule.member_tier as code from public.venue_pricing_rules rule where rule.member_tier is not null
) legacy
where legacy.code is not null
on conflict (code) do nothing;

alter table public.venue_members
  add column discount_override_percent numeric(5,2),
  add constraint venue_members_discount_override check (discount_override_percent is null or discount_override_percent between 0 and 100),
  add constraint venue_members_tier_fk foreign key (tier) references public.venue_member_tiers(code) on update cascade;

alter table public.venue_pricing_rules
  add constraint venue_pricing_rules_member_tier_fk foreign key (member_tier) references public.venue_member_tiers(code) on update cascade;

create index venue_member_tiers_active_rank_idx on public.venue_member_tiers (is_active, rank, code);

alter table public.venue_member_tiers enable row level security;
alter table public.venue_member_tiers force row level security;
revoke all on public.venue_member_tiers from public, anon, authenticated;

create trigger venue_member_tiers_touch before update on public.venue_member_tiers
for each row execute function private.touch_venue_record();
create trigger venue_member_tiers_audit after insert or update or delete on public.venue_member_tiers
for each row execute function private.capture_venue_audit_event('member_tier');

create or replace function public.admin_get_member_tiers()
returns jsonb
language plpgsql
security definer
stable
set search_path = ''
as $$
declare
  v_actor_id uuid := private.require_manager();
  v_result jsonb;
begin
  select coalesce(jsonb_agg(
    to_jsonb(tier) || jsonb_build_object(
      'member_count', (select count(*) from public.venue_members member where member.tier = tier.code),
      'active_member_count', (select count(*) from public.venue_members member where member.tier = tier.code and member.status = 'active')
    ) order by tier.rank, tier.code
  ), '[]'::jsonb)
  into v_result
  from public.venue_member_tiers tier;
  return v_result;
end;
$$;

create or replace function public.admin_upsert_member_tier(p_tier jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := private.require_manager();
  v_code text := lower(nullif(trim(p_tier ->> 'code'), ''));
  v_row public.venue_member_tiers;
begin
  if jsonb_typeof(coalesce(p_tier, '{}'::jsonb)) <> 'object' then raise exception 'Invalid member tier'; end if;
  if v_code is null or v_code !~ '^[a-z][a-z0-9_]{0,31}$' then raise exception 'Invalid member tier code'; end if;
  if trim(coalesce(p_tier ->> 'name_zh', '')) = '' or trim(coalesce(p_tier ->> 'name_en', '')) = '' then
    raise exception 'Member tier names are required';
  end if;

  insert into public.venue_member_tiers (
    code, name_zh, name_en, description_zh, description_en, rank,
    discount_percent, default_validity_days, color, benefits, is_active, updated_by
  ) values (
    v_code, trim(p_tier ->> 'name_zh'), trim(p_tier ->> 'name_en'),
    nullif(trim(p_tier ->> 'description_zh'), ''), nullif(trim(p_tier ->> 'description_en'), ''),
    coalesce((p_tier ->> 'rank')::smallint, 100),
    coalesce((p_tier ->> 'discount_percent')::numeric, 0),
    nullif(p_tier ->> 'default_validity_days', '')::smallint,
    coalesce(nullif(p_tier ->> 'color', ''), 'ink'),
    coalesce(p_tier -> 'benefits', '[]'::jsonb),
    coalesce((p_tier ->> 'is_active')::boolean, true), v_actor_id
  )
  on conflict (code) do update set
    name_zh = excluded.name_zh,
    name_en = excluded.name_en,
    description_zh = excluded.description_zh,
    description_en = excluded.description_en,
    rank = excluded.rank,
    discount_percent = excluded.discount_percent,
    default_validity_days = excluded.default_validity_days,
    color = excluded.color,
    benefits = excluded.benefits,
    is_active = excluded.is_active,
    updated_by = v_actor_id
  returning * into v_row;

  update public.venue_members member
  set discount_percent = v_row.discount_percent, updated_by = v_actor_id
  where member.tier = v_row.code and member.discount_override_percent is null
    and member.discount_percent is distinct from v_row.discount_percent;

  return to_jsonb(v_row);
end;
$$;

create or replace function public.admin_upsert_member(p_member jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := private.require_manager();
  v_id uuid := nullif(p_member ->> 'id', '')::uuid;
  v_number text := upper(nullif(trim(p_member ->> 'member_number'), ''));
  v_tier_code text := coalesce(nullif(p_member ->> 'tier', ''), 'standard');
  v_tier public.venue_member_tiers;
  v_joined_on date := coalesce(nullif(p_member ->> 'joined_on', '')::date, current_date);
  v_expires_on date;
  v_override numeric;
  v_row public.venue_members;
begin
  if jsonb_typeof(coalesce(p_member, '{}'::jsonb)) <> 'object' then raise exception 'Invalid member'; end if;
  if trim(coalesce(p_member ->> 'display_name', '')) = '' then raise exception 'Member name is required'; end if;
  select * into v_tier from public.venue_member_tiers tier where tier.code = v_tier_code and tier.is_active;
  if v_tier.code is null then raise exception 'Active member tier not found'; end if;
  if v_number is null then v_number := 'TGR-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8)); end if;

  v_override := nullif(p_member ->> 'discount_override_percent', '')::numeric;
  if p_member ? 'expires_on' then
    v_expires_on := nullif(p_member ->> 'expires_on', '')::date;
  elsif v_tier.default_validity_days is not null then
    v_expires_on := v_joined_on + v_tier.default_validity_days;
  end if;

  if v_id is null then
    insert into public.venue_members (
      auth_user_id, member_number, display_name, email, phone, tier, status,
      discount_percent, discount_override_percent, joined_on, expires_on, notes, metadata, updated_by
    ) values (
      nullif(p_member ->> 'auth_user_id', '')::uuid, v_number, trim(p_member ->> 'display_name'),
      lower(nullif(trim(p_member ->> 'email'), '')), nullif(trim(p_member ->> 'phone'), ''),
      v_tier.code, coalesce(nullif(p_member ->> 'status', ''), 'active'),
      coalesce(v_override, v_tier.discount_percent), v_override, v_joined_on, v_expires_on,
      nullif(trim(p_member ->> 'notes'), ''), coalesce(p_member -> 'metadata', '{}'::jsonb), v_actor_id
    ) returning * into v_row;
  else
    update public.venue_members set
      auth_user_id = nullif(p_member ->> 'auth_user_id', '')::uuid,
      member_number = v_number,
      display_name = trim(p_member ->> 'display_name'),
      email = lower(nullif(trim(p_member ->> 'email'), '')),
      phone = nullif(trim(p_member ->> 'phone'), ''),
      tier = v_tier.code,
      status = coalesce(nullif(p_member ->> 'status', ''), status),
      discount_percent = coalesce(v_override, v_tier.discount_percent),
      discount_override_percent = v_override,
      joined_on = v_joined_on,
      expires_on = v_expires_on,
      notes = nullif(trim(p_member ->> 'notes'), ''),
      metadata = coalesce(p_member -> 'metadata', metadata),
      updated_by = v_actor_id
    where id = v_id returning * into v_row;
    if v_row.id is null then raise exception 'Member not found'; end if;
  end if;
  return to_jsonb(v_row);
end;
$$;

create or replace function public.admin_search_members(
  p_query text default '', p_status text default 'all', p_tier text default 'all',
  p_limit integer default 50, p_after_created_at timestamptz default null, p_after_id uuid default null
)
returns jsonb
language plpgsql
security definer
stable
set search_path = ''
as $$
declare
  v_actor_id uuid := private.require_manager();
  v_query text := nullif(trim(coalesce(p_query, '')), '');
  v_limit integer := least(greatest(coalesce(p_limit, 50), 1), 50);
  v_result jsonb;
begin
  if (p_after_created_at is null) <> (p_after_id is null) then raise exception 'Invalid member cursor'; end if;
  with matching as materialized (
    select member.*, tier.name_zh as tier_name_zh, tier.name_en as tier_name_en,
      tier.color as tier_color, tier.discount_percent as tier_discount_percent
    from public.venue_members member
    join public.venue_member_tiers tier on tier.code = member.tier
    where (p_status = 'all' or member.status = p_status)
      and (p_tier = 'all' or member.tier = p_tier)
      and (v_query is null or member.display_name ilike '%' || v_query || '%'
        or member.member_number ilike '%' || v_query || '%'
        or member.email ilike '%' || v_query || '%' or member.phone ilike '%' || v_query || '%')
  ), candidates as materialized (
    select * from matching
    where p_after_created_at is null or (created_at, id) < (p_after_created_at, p_after_id)
    order by created_at desc, id desc limit v_limit + 1
  ), items as materialized (
    select * from candidates order by created_at desc, id desc limit v_limit
  ), cursor_row as (
    select created_at, id from items order by created_at asc, id asc limit 1
  )
  select jsonb_build_object(
    'version', 2,
    'total', (select count(*) from matching),
    'items', coalesce((select jsonb_agg(to_jsonb(items) order by created_at desc, id desc) from items), '[]'::jsonb),
    'has_more', (select count(*) > v_limit from candidates),
    'next_cursor', case when (select count(*) > v_limit from candidates)
      then (select jsonb_build_object('created_at', created_at, 'id', id) from cursor_row) else null end,
    'tiers', coalesce((select jsonb_agg(tier.code order by tier.rank, tier.code) from public.venue_member_tiers tier where tier.is_active), '[]'::jsonb),
    'tier_options', coalesce((select jsonb_agg(to_jsonb(tier) order by tier.rank, tier.code) from public.venue_member_tiers tier), '[]'::jsonb)
  ) into v_result;
  return v_result;
end;
$$;

create or replace function public.get_customer_court_slots(p_date date)
returns table (court_id uuid, start_at timestamp, end_at timestamp)
language plpgsql
security definer
stable
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null then raise exception 'Authentication required'; end if;
  if p_date is null then raise exception 'Date is required'; end if;

  return query
  select slot.court_id, slot.start_at, slot.end_at
  from public.court_slots slot
  where slot.status in ('held', 'confirmed')
    and slot.start_at < (p_date + 1)::timestamp
    and slot.end_at > p_date::timestamp
  order by slot.start_at, slot.court_id;
end;
$$;

revoke execute on function public.admin_get_member_tiers() from public, anon;
revoke execute on function public.admin_upsert_member_tier(jsonb) from public, anon;
revoke execute on function public.admin_upsert_member(jsonb) from public, anon;
revoke execute on function public.admin_search_members(text, text, text, integer, timestamptz, uuid) from public, anon;
revoke execute on function public.get_customer_court_slots(date) from public, anon;

grant execute on function public.admin_get_member_tiers() to authenticated;
grant execute on function public.admin_upsert_member_tier(jsonb) to authenticated;
grant execute on function public.admin_upsert_member(jsonb) to authenticated;
grant execute on function public.admin_search_members(text, text, text, integer, timestamptz, uuid) to authenticated;
grant execute on function public.get_customer_court_slots(date) to authenticated;

comment on table public.venue_member_tiers is 'Manager-defined membership tiers used by the member directory and pricing engine.';
comment on function public.admin_get_member_tiers is 'Manager-only tier catalogue with current member counts.';
comment on function public.get_customer_court_slots is 'Authenticated privacy-safe busy intervals for one date; no customer or payment data is exposed.';

notify pgrst, 'reload schema';
