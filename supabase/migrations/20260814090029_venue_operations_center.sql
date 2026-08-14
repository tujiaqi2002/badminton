-- Tiger venue operations center.
-- Mutable configuration lives in public with RLS forced and no direct client
-- privileges. Managers interact through SECURITY DEFINER RPCs; every mutation
-- is captured in the existing append-only private.app_audit_events ledger.

create table public.venue_settings (
  singleton boolean primary key default true check (singleton),
  name_zh text not null default 'Tiger 羽球馆',
  name_en text not null default 'Tiger Badminton Club',
  timezone text not null default 'America/Toronto',
  currency character(3) not null default 'CAD',
  booking_window_days smallint not null default 30 check (booking_window_days between 1 and 365),
  slot_minutes smallint not null default 30 check (slot_minutes in (15, 30, 60)),
  customer_max_minutes smallint not null default 120 check (customer_max_minutes between 30 and 480),
  manager_max_minutes smallint not null default 240 check (manager_max_minutes between 30 and 720),
  cancellation_notice_hours smallint not null default 12 check (cancellation_notice_hours between 0 and 168),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null
);

create table public.venue_opening_hours (
  id uuid primary key default gen_random_uuid(),
  day_of_week smallint not null check (day_of_week between 0 and 6),
  open_minute smallint not null default 600 check (open_minute between 0 and 1439),
  close_minute smallint not null default 1440 check (close_minute between 1 and 1440),
  is_closed boolean not null default false,
  label text,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null,
  constraint venue_opening_hours_range check (is_closed or close_minute > open_minute),
  constraint venue_opening_hours_day_unique unique (day_of_week)
);

create table public.venue_pricing_rules (
  id uuid primary key default gen_random_uuid(),
  name_zh text not null,
  name_en text not null,
  court_id uuid references public.courts(id) on delete cascade,
  day_of_week smallint check (day_of_week between 0 and 6),
  start_minute smallint not null check (start_minute between 0 and 1439),
  end_minute smallint not null check (end_minute between 1 and 1440),
  hourly_rate numeric(10,2) not null check (hourly_rate >= 0),
  member_tier text,
  valid_from date,
  valid_to date,
  priority smallint not null default 100 check (priority between 0 and 32767),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null,
  constraint venue_pricing_rules_range check (end_minute > start_minute),
  constraint venue_pricing_rules_dates check (valid_to is null or valid_from is null or valid_to >= valid_from),
  constraint venue_pricing_rules_tier check (member_tier is null or member_tier ~ '^[a-z][a-z0-9_]{0,31}$')
);

create table public.venue_events (
  id uuid primary key default gen_random_uuid(),
  title_zh text not null,
  title_en text not null,
  description text,
  event_type text not null default 'special_event'
    check (event_type in ('special_event', 'tournament', 'maintenance', 'private_event', 'promotion', 'closure')),
  status text not null default 'scheduled'
    check (status in ('draft', 'scheduled', 'completed', 'cancelled')),
  starts_at timestamp not null,
  ends_at timestamp not null,
  blocks_booking boolean not null default false,
  color text not null default 'ink' check (color in ('ink', 'red', 'gold', 'green', 'blue', 'purple')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null,
  constraint venue_events_range check (ends_at > starts_at)
);

create table public.venue_event_courts (
  event_id uuid not null references public.venue_events(id) on delete cascade,
  court_id uuid not null references public.courts(id) on delete cascade,
  primary key (event_id, court_id)
);

create table public.venue_members (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid references auth.users(id) on delete set null,
  member_number text not null unique,
  display_name text not null,
  email text,
  phone text,
  tier text not null default 'standard' check (tier ~ '^[a-z][a-z0-9_]{0,31}$'),
  status text not null default 'active' check (status in ('active', 'paused', 'expired', 'cancelled')),
  discount_percent numeric(5,2) not null default 0 check (discount_percent between 0 and 100),
  joined_on date not null default current_date,
  expires_on date,
  notes text,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null,
  constraint venue_members_email check (email is null or position('@' in email) > 1),
  constraint venue_members_dates check (expires_on is null or expires_on >= joined_on)
);

create index venue_pricing_rules_lookup_idx
  on public.venue_pricing_rules (is_active, day_of_week, court_id, priority desc)
  include (start_minute, end_minute, hourly_rate, member_tier, valid_from, valid_to);
create index venue_events_schedule_idx
  on public.venue_events (starts_at, ends_at) where status = 'scheduled';
create index venue_event_courts_court_idx on public.venue_event_courts (court_id, event_id);
create index venue_members_status_created_idx on public.venue_members (status, created_at desc, id desc);
create index venue_members_tier_status_idx on public.venue_members (tier, status);
create index app_audit_events_type_occurred_idx
  on private.app_audit_events (event_type, occurred_at desc, id desc);
create index app_audit_events_entity_occurred_idx
  on private.app_audit_events (entity_type, occurred_at desc, id desc);

alter table public.venue_settings enable row level security;
alter table public.venue_settings force row level security;
alter table public.venue_opening_hours enable row level security;
alter table public.venue_opening_hours force row level security;
alter table public.venue_pricing_rules enable row level security;
alter table public.venue_pricing_rules force row level security;
alter table public.venue_events enable row level security;
alter table public.venue_events force row level security;
alter table public.venue_event_courts enable row level security;
alter table public.venue_event_courts force row level security;
alter table public.venue_members enable row level security;
alter table public.venue_members force row level security;

revoke all on public.venue_settings, public.venue_opening_hours, public.venue_pricing_rules,
  public.venue_events, public.venue_event_courts, public.venue_members
from public, anon, authenticated;

insert into public.venue_settings (singleton) values (true);
insert into public.venue_opening_hours (day_of_week, open_minute, close_minute)
select day, 600, 1440 from generate_series(0, 6) as day;
insert into public.venue_pricing_rules
  (name_zh, name_en, start_minute, end_minute, hourly_rate, priority)
values
  ('日间标准价', 'Day rate', 600, 1020, 28, 100),
  ('晚间标准价', 'Evening rate', 1020, 1440, 36, 100);

create or replace function private.require_manager()
returns uuid
language plpgsql
security definer
stable
set search_path = ''
as $$
declare
  v_actor_id uuid := auth.uid();
begin
  if v_actor_id is null or not exists (
    select 1 from public.staff_members staff
    where staff.user_id = v_actor_id and staff.role = 'admin'
  ) then
    raise exception 'Manager access required';
  end if;
  return v_actor_id;
end;
$$;

create or replace function private.touch_venue_record()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.updated_at := statement_timestamp();
  new.updated_by := auth.uid();
  return new;
end;
$$;

create or replace function private.capture_venue_audit_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := auth.uid();
  v_actor_email text;
  v_before jsonb;
  v_after jsonb;
  v_changed_fields text[] := '{}'::text[];
  v_entity_id text;
  v_event_type text;
begin
  if tg_op = 'INSERT' then
    v_after := to_jsonb(new);
  elsif tg_op = 'UPDATE' then
    if old is not distinct from new then return new; end if;
    v_before := to_jsonb(old);
    v_after := to_jsonb(new);
  else
    v_before := to_jsonb(old);
  end if;

  v_entity_id := coalesce(v_after ->> 'id', v_before ->> 'id', v_after ->> 'singleton', v_before ->> 'singleton');
  select users.email into v_actor_email from auth.users users where users.id = v_actor_id;

  if v_before is not null and v_after is not null then
    select coalesce(array_agg(changed.key order by changed.key), '{}'::text[])
    into v_changed_fields
    from (
      select coalesce(before_field.key, after_field.key) as key
      from jsonb_each(v_before) before_field
      full join jsonb_each(v_after) after_field using (key)
      where before_field.value is distinct from after_field.value
    ) changed;
  elsif v_after is not null then
    select coalesce(array_agg(field.key order by field.key), '{}'::text[])
    into v_changed_fields from jsonb_each(v_after) field;
  else
    select coalesce(array_agg(field.key order by field.key), '{}'::text[])
    into v_changed_fields from jsonb_each(v_before) field;
  end if;

  v_event_type := tg_argv[0] || '.' || case tg_op
    when 'INSERT' then 'created'
    when 'UPDATE' then 'updated'
    else 'deleted'
  end;

  insert into private.app_audit_events (
    operation_id, event_type, entity_type, entity_id, actor_id, actor_email,
    actor_kind, source, before_state, after_state, changed_fields, metadata
  ) values (
    coalesce(nullif(current_setting('app.audit_operation_id', true), ''), txid_current()::text),
    v_event_type, tg_argv[0], v_entity_id, v_actor_id, v_actor_email,
    case when v_actor_id is null then 'system' else 'manager' end,
    'operations_center', v_before, v_after, v_changed_fields,
    jsonb_build_object('schema_version', 1, 'table', tg_table_schema || '.' || tg_table_name)
  );
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

create trigger venue_settings_touch before update on public.venue_settings
for each row execute function private.touch_venue_record();
create trigger venue_opening_hours_touch before update on public.venue_opening_hours
for each row execute function private.touch_venue_record();
create trigger venue_pricing_rules_touch before update on public.venue_pricing_rules
for each row execute function private.touch_venue_record();
create trigger venue_events_touch before update on public.venue_events
for each row execute function private.touch_venue_record();
create trigger venue_members_touch before update on public.venue_members
for each row execute function private.touch_venue_record();

create trigger venue_settings_audit after insert or update or delete on public.venue_settings
for each row execute function private.capture_venue_audit_event('venue_settings');
create trigger venue_opening_hours_audit after insert or update or delete on public.venue_opening_hours
for each row execute function private.capture_venue_audit_event('opening_hours');
create trigger venue_pricing_rules_audit after insert or update or delete on public.venue_pricing_rules
for each row execute function private.capture_venue_audit_event('pricing_rule');
create trigger venue_events_audit after insert or update or delete on public.venue_events
for each row execute function private.capture_venue_audit_event('venue_event');
create trigger venue_event_courts_audit after insert or update or delete on public.venue_event_courts
for each row execute function private.capture_venue_audit_event('event_court');
create trigger venue_members_audit after insert or update or delete on public.venue_members
for each row execute function private.capture_venue_audit_event('member');

create or replace function public.admin_get_venue_operations()
returns jsonb
language plpgsql
security definer
stable
set search_path = ''
as $$
declare
  v_actor_id uuid;
  v_result jsonb;
begin
  v_actor_id := private.require_manager();
  select jsonb_build_object(
    'version', 1,
    'settings', (select to_jsonb(settings) - 'singleton' from public.venue_settings settings where settings.singleton),
    'hours', coalesce((
      select jsonb_agg(to_jsonb(hours) order by hours.day_of_week)
      from public.venue_opening_hours hours
    ), '[]'::jsonb),
    'pricing_rules', coalesce((
      select jsonb_agg(to_jsonb(rule) || jsonb_build_object(
        'court_name_zh', court.name_zh, 'court_name_en', court.name_en
      ) order by rule.priority desc, rule.start_minute, rule.created_at)
      from public.venue_pricing_rules rule
      left join public.courts court on court.id = rule.court_id
    ), '[]'::jsonb),
    'events', coalesce((
      select jsonb_agg(to_jsonb(event) || jsonb_build_object(
        'court_ids', coalesce(courts.court_ids, '[]'::jsonb),
        'court_names_zh', coalesce(courts.court_names_zh, '[]'::jsonb),
        'active_booking_conflicts', (
          select count(*)
          from public.bookings booking
          where booking.status in ('held', 'confirmed')
            and booking.start_at < event.ends_at and booking.end_at > event.starts_at
            and (courts.court_count = 0 or booking.court_id in (
              select event_court.court_id from public.venue_event_courts event_court where event_court.event_id = event.id
            ))
        )
      ) order by event.starts_at desc)
      from public.venue_events event
      left join lateral (
        select count(*)::integer as court_count,
          jsonb_agg(court.id order by court.sort_order) as court_ids,
          jsonb_agg(court.name_zh order by court.sort_order) as court_names_zh
        from public.venue_event_courts event_court
        join public.courts court on court.id = event_court.court_id
        where event_court.event_id = event.id
      ) courts on true
      where event.ends_at >= timezone('America/Toronto', clock_timestamp()) - interval '30 days'
         or event.status = 'draft'
    ), '[]'::jsonb),
    'member_summary', jsonb_build_object(
      'total', (select count(*) from public.venue_members),
      'active', (select count(*) from public.venue_members where status = 'active'),
      'expiring_30_days', (select count(*) from public.venue_members where status = 'active' and expires_on between current_date and current_date + 30)
    )
  ) into v_result;
  return v_result;
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
  if jsonb_typeof(coalesce(p_settings, '{}'::jsonb)) <> 'object' then raise exception 'Invalid venue settings'; end if;
  update public.venue_settings set
    name_zh = coalesce(nullif(trim(p_settings ->> 'name_zh'), ''), name_zh),
    name_en = coalesce(nullif(trim(p_settings ->> 'name_en'), ''), name_en),
    timezone = coalesce(nullif(trim(p_settings ->> 'timezone'), ''), timezone),
    currency = upper(coalesce(nullif(trim(p_settings ->> 'currency'), ''), currency)),
    booking_window_days = coalesce((p_settings ->> 'booking_window_days')::smallint, booking_window_days),
    slot_minutes = coalesce((p_settings ->> 'slot_minutes')::smallint, slot_minutes),
    customer_max_minutes = coalesce((p_settings ->> 'customer_max_minutes')::smallint, customer_max_minutes),
    manager_max_minutes = coalesce((p_settings ->> 'manager_max_minutes')::smallint, manager_max_minutes),
    cancellation_notice_hours = coalesce((p_settings ->> 'cancellation_notice_hours')::smallint, cancellation_notice_hours),
    updated_by = v_actor_id
  where singleton returning * into v_row;
  return to_jsonb(v_row) - 'singleton';
end;
$$;

create or replace function public.admin_replace_opening_hours(p_hours jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := private.require_manager();
  v_count integer;
begin
  if jsonb_typeof(p_hours) <> 'array' or jsonb_array_length(p_hours) <> 7 then
    raise exception 'Opening hours must contain all seven days';
  end if;
  if (select count(distinct (item ->> 'day_of_week')::smallint) from jsonb_array_elements(p_hours) item) <> 7 then
    raise exception 'Opening hours must contain each weekday once';
  end if;
  perform set_config('app.audit_operation_id', gen_random_uuid()::text, true);
  delete from public.venue_opening_hours;
  insert into public.venue_opening_hours
    (day_of_week, open_minute, close_minute, is_closed, label, updated_by)
  select
    (item ->> 'day_of_week')::smallint,
    coalesce((item ->> 'open_minute')::smallint, 600),
    coalesce((item ->> 'close_minute')::smallint, 1440),
    coalesce((item ->> 'is_closed')::boolean, false),
    nullif(trim(item ->> 'label'), ''),
    v_actor_id
  from jsonb_array_elements(p_hours) item;
  select count(*) into v_count from public.venue_opening_hours;
  return jsonb_build_object('saved', v_count);
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
  v_row public.venue_pricing_rules;
begin
  if trim(coalesce(p_rule ->> 'name_zh', '')) = '' or trim(coalesce(p_rule ->> 'name_en', '')) = '' then
    raise exception 'Pricing rule name is required';
  end if;
  if v_id is null then
    insert into public.venue_pricing_rules (
      name_zh, name_en, court_id, day_of_week, start_minute, end_minute,
      hourly_rate, member_tier, valid_from, valid_to, priority, is_active, updated_by
    ) values (
      trim(p_rule ->> 'name_zh'), trim(p_rule ->> 'name_en'), nullif(p_rule ->> 'court_id', '')::uuid,
      nullif(p_rule ->> 'day_of_week', '')::smallint, (p_rule ->> 'start_minute')::smallint,
      (p_rule ->> 'end_minute')::smallint, (p_rule ->> 'hourly_rate')::numeric,
      nullif(trim(p_rule ->> 'member_tier'), ''), nullif(p_rule ->> 'valid_from', '')::date,
      nullif(p_rule ->> 'valid_to', '')::date, coalesce((p_rule ->> 'priority')::smallint, 100),
      coalesce((p_rule ->> 'is_active')::boolean, true), v_actor_id
    ) returning * into v_row;
  else
    update public.venue_pricing_rules set
      name_zh = trim(p_rule ->> 'name_zh'), name_en = trim(p_rule ->> 'name_en'),
      court_id = nullif(p_rule ->> 'court_id', '')::uuid,
      day_of_week = nullif(p_rule ->> 'day_of_week', '')::smallint,
      start_minute = (p_rule ->> 'start_minute')::smallint,
      end_minute = (p_rule ->> 'end_minute')::smallint,
      hourly_rate = (p_rule ->> 'hourly_rate')::numeric,
      member_tier = nullif(trim(p_rule ->> 'member_tier'), ''),
      valid_from = nullif(p_rule ->> 'valid_from', '')::date,
      valid_to = nullif(p_rule ->> 'valid_to', '')::date,
      priority = coalesce((p_rule ->> 'priority')::smallint, 100),
      is_active = coalesce((p_rule ->> 'is_active')::boolean, true), updated_by = v_actor_id
    where id = v_id returning * into v_row;
    if v_row.id is null then raise exception 'Pricing rule not found'; end if;
  end if;
  return to_jsonb(v_row);
end;
$$;

create or replace function public.admin_delete_pricing_rule(p_rule_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.require_manager();
  delete from public.venue_pricing_rules where id = p_rule_id;
  return found;
end;
$$;

create or replace function public.admin_upsert_venue_event(p_event jsonb, p_allow_conflicts boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := private.require_manager();
  v_id uuid := nullif(p_event ->> 'id', '')::uuid;
  v_row public.venue_events;
  v_court_ids uuid[];
  v_conflicts integer;
begin
  if trim(coalesce(p_event ->> 'title_zh', '')) = '' or trim(coalesce(p_event ->> 'title_en', '')) = '' then
    raise exception 'Event title is required';
  end if;
  select coalesce(array_agg(distinct value::uuid), '{}'::uuid[]) into v_court_ids
  from jsonb_array_elements_text(coalesce(p_event -> 'court_ids', '[]'::jsonb));

  select count(*) into v_conflicts
  from public.bookings booking
  where booking.status in ('held', 'confirmed')
    and booking.start_at < (p_event ->> 'ends_at')::timestamp
    and booking.end_at > (p_event ->> 'starts_at')::timestamp
    and (cardinality(v_court_ids) = 0 or booking.court_id = any(v_court_ids));
  if coalesce((p_event ->> 'blocks_booking')::boolean, false) and v_conflicts > 0 and not p_allow_conflicts then
    raise exception 'Event conflicts with % active bookings', v_conflicts;
  end if;

  perform set_config('app.audit_operation_id', gen_random_uuid()::text, true);
  if v_id is null then
    insert into public.venue_events (
      title_zh, title_en, description, event_type, status, starts_at, ends_at,
      blocks_booking, color, updated_by
    ) values (
      trim(p_event ->> 'title_zh'), trim(p_event ->> 'title_en'), nullif(trim(p_event ->> 'description'), ''),
      coalesce(nullif(p_event ->> 'event_type', ''), 'special_event'),
      coalesce(nullif(p_event ->> 'status', ''), 'scheduled'),
      (p_event ->> 'starts_at')::timestamp, (p_event ->> 'ends_at')::timestamp,
      coalesce((p_event ->> 'blocks_booking')::boolean, false),
      coalesce(nullif(p_event ->> 'color', ''), 'ink'), v_actor_id
    ) returning * into v_row;
  else
    update public.venue_events set
      title_zh = trim(p_event ->> 'title_zh'), title_en = trim(p_event ->> 'title_en'),
      description = nullif(trim(p_event ->> 'description'), ''),
      event_type = coalesce(nullif(p_event ->> 'event_type', ''), event_type),
      status = coalesce(nullif(p_event ->> 'status', ''), status),
      starts_at = (p_event ->> 'starts_at')::timestamp, ends_at = (p_event ->> 'ends_at')::timestamp,
      blocks_booking = coalesce((p_event ->> 'blocks_booking')::boolean, false),
      color = coalesce(nullif(p_event ->> 'color', ''), color), updated_by = v_actor_id
    where id = v_id returning * into v_row;
    if v_row.id is null then raise exception 'Event not found'; end if;
  end if;
  delete from public.venue_event_courts where event_id = v_row.id;
  insert into public.venue_event_courts (event_id, court_id)
  select v_row.id, unnest(v_court_ids);
  return to_jsonb(v_row) || jsonb_build_object('court_ids', to_jsonb(v_court_ids), 'active_booking_conflicts', v_conflicts);
end;
$$;

create or replace function public.admin_cancel_venue_event(p_event_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := private.require_manager();
  v_row public.venue_events;
begin
  update public.venue_events set status = 'cancelled', updated_by = v_actor_id
  where id = p_event_id returning * into v_row;
  if v_row.id is null then raise exception 'Event not found'; end if;
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
  v_row public.venue_members;
begin
  if trim(coalesce(p_member ->> 'display_name', '')) = '' then raise exception 'Member name is required'; end if;
  if v_number is null then v_number := 'TGR-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8)); end if;
  if v_id is null then
    insert into public.venue_members (
      auth_user_id, member_number, display_name, email, phone, tier, status,
      discount_percent, joined_on, expires_on, notes, metadata, updated_by
    ) values (
      nullif(p_member ->> 'auth_user_id', '')::uuid, v_number, trim(p_member ->> 'display_name'),
      lower(nullif(trim(p_member ->> 'email'), '')), nullif(trim(p_member ->> 'phone'), ''),
      coalesce(nullif(p_member ->> 'tier', ''), 'standard'), coalesce(nullif(p_member ->> 'status', ''), 'active'),
      coalesce((p_member ->> 'discount_percent')::numeric, 0),
      coalesce(nullif(p_member ->> 'joined_on', '')::date, current_date),
      nullif(p_member ->> 'expires_on', '')::date, nullif(trim(p_member ->> 'notes'), ''),
      coalesce(p_member -> 'metadata', '{}'::jsonb), v_actor_id
    ) returning * into v_row;
  else
    update public.venue_members set
      auth_user_id = nullif(p_member ->> 'auth_user_id', '')::uuid,
      member_number = v_number, display_name = trim(p_member ->> 'display_name'),
      email = lower(nullif(trim(p_member ->> 'email'), '')), phone = nullif(trim(p_member ->> 'phone'), ''),
      tier = coalesce(nullif(p_member ->> 'tier', ''), tier),
      status = coalesce(nullif(p_member ->> 'status', ''), status),
      discount_percent = coalesce((p_member ->> 'discount_percent')::numeric, discount_percent),
      joined_on = coalesce(nullif(p_member ->> 'joined_on', '')::date, joined_on),
      expires_on = nullif(p_member ->> 'expires_on', '')::date,
      notes = nullif(trim(p_member ->> 'notes'), ''),
      metadata = coalesce(p_member -> 'metadata', metadata), updated_by = v_actor_id
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
    select * from public.venue_members member
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
    'version', 1, 'total', (select count(*) from matching),
    'items', coalesce((select jsonb_agg(to_jsonb(items) order by created_at desc, id desc) from items), '[]'::jsonb),
    'has_more', (select count(*) > v_limit from candidates),
    'next_cursor', case when (select count(*) > v_limit from candidates)
      then (select jsonb_build_object('created_at', created_at, 'id', id) from cursor_row) else null end,
    'tiers', coalesce((select jsonb_agg(distinct tier order by tier) from public.venue_members), '[]'::jsonb)
  ) into v_result;
  return v_result;
end;
$$;

create or replace function public.admin_search_audit_events(
  p_start_at timestamptz default null, p_end_at timestamptz default null,
  p_query text default '', p_event_prefix text default 'all', p_entity_type text default 'all',
  p_actor_kind text default 'all', p_limit integer default 50,
  p_after_occurred_at timestamptz default null, p_after_id bigint default null
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
  v_start timestamptz := coalesce(p_start_at, now() - interval '30 days');
  v_end timestamptz := coalesce(p_end_at, now());
  v_result jsonb;
begin
  if v_end < v_start or v_end > v_start + interval '367 days' then raise exception 'Invalid audit date range'; end if;
  if (p_after_occurred_at is null) <> (p_after_id is null) then raise exception 'Invalid audit cursor'; end if;
  if p_actor_kind not in ('all', 'manager', 'user', 'system') then raise exception 'Invalid actor filter'; end if;
  with matching as materialized (
    select event.* from private.app_audit_events event
    where event.occurred_at >= v_start and event.occurred_at <= v_end
      and (p_event_prefix = 'all' or event.event_type like p_event_prefix || '.%')
      and (p_entity_type = 'all' or event.entity_type = p_entity_type)
      and (p_actor_kind = 'all' or event.actor_kind = p_actor_kind)
      and (v_query is null or event.actor_email ilike '%' || v_query || '%'
        or event.event_type ilike '%' || v_query || '%' or event.entity_type ilike '%' || v_query || '%'
        or event.entity_id ilike '%' || v_query || '%' or event.operation_id ilike '%' || v_query || '%')
  ), candidates as materialized (
    select * from matching
    where p_after_occurred_at is null or (occurred_at, id) < (p_after_occurred_at, p_after_id)
    order by occurred_at desc, id desc limit v_limit + 1
  ), items as materialized (
    select * from candidates order by occurred_at desc, id desc limit v_limit
  ), cursor_row as (
    select occurred_at, id from items order by occurred_at asc, id asc limit 1
  )
  select jsonb_build_object(
    'version', 1, 'total', (select count(*) from matching),
    'items', coalesce((select jsonb_agg(to_jsonb(items) order by occurred_at desc, id desc) from items), '[]'::jsonb),
    'has_more', (select count(*) > v_limit from candidates),
    'next_cursor', case when (select count(*) > v_limit from candidates)
      then (select jsonb_build_object('occurred_at', occurred_at, 'id', id) from cursor_row) else null end,
    'event_prefixes', coalesce((select jsonb_agg(prefix order by prefix) from (
      select distinct split_part(event_type, '.', 1) as prefix from matching
    ) prefixes), '[]'::jsonb),
    'entity_types', coalesce((select jsonb_agg(entity_type order by entity_type) from (
      select distinct event.entity_type from matching event
    ) entities), '[]'::jsonb)
  ) into v_result;
  return v_result;
end;
$$;

revoke all on function private.require_manager() from public, anon, authenticated;
revoke all on function private.capture_venue_audit_event() from public, anon, authenticated;
revoke all on function private.touch_venue_record() from public, anon, authenticated;

revoke execute on function public.admin_get_venue_operations() from public, anon;
revoke execute on function public.admin_update_venue_settings(jsonb) from public, anon;
revoke execute on function public.admin_replace_opening_hours(jsonb) from public, anon;
revoke execute on function public.admin_upsert_pricing_rule(jsonb) from public, anon;
revoke execute on function public.admin_delete_pricing_rule(uuid) from public, anon;
revoke execute on function public.admin_upsert_venue_event(jsonb, boolean) from public, anon;
revoke execute on function public.admin_cancel_venue_event(uuid) from public, anon;
revoke execute on function public.admin_upsert_member(jsonb) from public, anon;
revoke execute on function public.admin_search_members(text, text, text, integer, timestamptz, uuid) from public, anon;
revoke execute on function public.admin_search_audit_events(timestamptz, timestamptz, text, text, text, text, integer, timestamptz, bigint) from public, anon;

grant execute on function public.admin_get_venue_operations() to authenticated;
grant execute on function public.admin_update_venue_settings(jsonb) to authenticated;
grant execute on function public.admin_replace_opening_hours(jsonb) to authenticated;
grant execute on function public.admin_upsert_pricing_rule(jsonb) to authenticated;
grant execute on function public.admin_delete_pricing_rule(uuid) to authenticated;
grant execute on function public.admin_upsert_venue_event(jsonb, boolean) to authenticated;
grant execute on function public.admin_cancel_venue_event(uuid) to authenticated;
grant execute on function public.admin_upsert_member(jsonb) to authenticated;
grant execute on function public.admin_search_members(text, text, text, integer, timestamptz, uuid) to authenticated;
grant execute on function public.admin_search_audit_events(timestamptz, timestamptz, text, text, text, text, integer, timestamptz, bigint) to authenticated;

comment on table public.venue_settings is 'Singleton venue-wide booking and localization configuration.';
comment on table public.venue_opening_hours is 'Canonical weekly opening schedule; minutes support a midnight value of 1440.';
comment on table public.venue_pricing_rules is 'Priority-based, date-aware pricing rules. Null court/day/tier values mean all.';
comment on table public.venue_events is 'Venue events, closures and maintenance windows; court links are normalized.';
comment on table public.venue_members is 'Manager-only member directory with extensible metadata.';
comment on function public.admin_search_audit_events is 'Cursor-paginated, manager-only query over the append-only application audit ledger.';

notify pgrst, 'reload schema';
