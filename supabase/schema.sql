-- Tiger 羽球馆 · Supabase / PostgreSQL schema
-- 在 Supabase SQL Editor 中整段运行。脚本可重复执行。

create extension if not exists pgcrypto;
create extension if not exists btree_gist;
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

do $$ begin
  create type public.booking_status as enum ('held', 'confirmed', 'cancelled', 'completed', 'expired', 'no_show');
exception when duplicate_object then null; end $$;
+

-- Manager detail editing and the database-wide future-booking guard.
drop function if exists public.admin_update_booking_details(uuid, text, text, text);

create or replace function public.admin_update_booking_details(
  p_booking_id uuid,
  p_customer_name text,
  p_customer_email text default null,
  p_customer_phone text default null,
  p_customer_notes text default null,
  p_payment_status public.payment_status default 'pay_at_venue'
)
returns public.bookings
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := auth.uid();
  v_previous public.bookings;
  v_booking public.bookings;
begin
  if v_actor_id is null then raise exception 'Authentication required'; end if;
  if not exists (
    select 1
    from public.staff_members as staff
    where staff.user_id = v_actor_id and staff.role = 'admin'
  ) then
    raise exception 'Manager access required';
  end if;
  if nullif(trim(p_customer_name), '') is null then raise exception 'Customer name is required'; end if;
  if length(p_customer_name) > 120 then raise exception 'Customer name is too long'; end if;
  if nullif(trim(p_customer_email), '') is not null and position('@' in p_customer_email) < 2 then
    raise exception 'Customer email is invalid';
  end if;
  if length(coalesce(p_customer_email, '')) > 320 then raise exception 'Customer email is too long'; end if;
  if length(coalesce(p_customer_phone, '')) > 40 then raise exception 'Customer phone is too long'; end if;
  if length(coalesce(p_customer_notes, '')) > 2000 then raise exception 'Customer notes are too long'; end if;
  select *
    into v_previous
  from public.bookings
  where id = p_booking_id
  for update;

  if v_previous.id is null then raise exception 'Booking not found'; end if;
  if p_payment_status = 'pending' and v_previous.payment_method <> 'stripe' then
    raise exception 'Venue payments use pay-at-venue status';
  end if;
  if p_payment_status = 'pay_at_venue' and v_previous.payment_method <> 'venue' then
    raise exception 'Online payments use pending status';
  end if;

  update public.bookings as booking
     set customer_name = trim(p_customer_name),
         customer_email = lower(nullif(trim(p_customer_email), '')),
         customer_phone = nullif(trim(p_customer_phone), ''),
         customer_notes = nullif(trim(p_customer_notes), ''),
         payment_status = p_payment_status
   where booking.booking_group_id = v_previous.booking_group_id
      or (v_previous.booking_group_id is null and booking.id = v_previous.id);

  select *
    into v_booking
  from public.bookings
  where id = p_booking_id;

  insert into private.booking_admin_actions (
    booking_id, actor_id, action, previous_status, new_status,
    previous_court_id, new_court_id, previous_start_at, previous_end_at,
    new_start_at, new_end_at
  )
  select
    booking.id, v_actor_id, 'details_updated', booking.status, booking.status,
    booking.court_id, booking.court_id, booking.start_at, booking.end_at,
    booking.start_at, booking.end_at
  from public.bookings as booking
  where booking.booking_group_id = v_previous.booking_group_id
     or (v_previous.booking_group_id is null and booking.id = v_previous.id);

  return v_booking;
end;
$$;

revoke execute on function public.admin_update_booking_details(uuid, text, text, text, text, public.payment_status)
  from public, anon, authenticated;
grant execute on function public.admin_update_booking_details(uuid, text, text, text, text, public.payment_status)
  to authenticated;

create or replace function private.enforce_future_booking_schedule()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status in ('held', 'confirmed')
     and new.start_at <= timezone('America/Toronto', clock_timestamp()) then
    raise exception using
      errcode = '22007',
      message = 'Booking start time must be in the future';
  end if;
  return new;
end;
$$;

drop trigger if exists bookings_require_future_schedule on public.bookings;
create trigger bookings_require_future_schedule
before insert or update of court_id, start_at, end_at, status
on public.bookings
for each row
execute function private.enforce_future_booking_schedule();

notify pgrst, 'reload schema';


do $$ begin
  create type public.payment_status as enum ('pending', 'paid', 'pay_at_venue', 'refunded', 'failed');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.payment_method as enum ('venue', 'stripe');
exception when duplicate_object then null; end $$;

create table if not exists public.courts (
  id uuid primary key default gen_random_uuid(),
  booking_group_id uuid not null default gen_random_uuid(),
  name_zh text not null unique,
  name_en text not null,
  description text,
  sort_order smallint not null unique,
  status text not null default 'open' check (status in ('open', 'maintenance', 'closed')),
  created_at timestamptz not null default now()
);

insert into public.courts (id, name_zh, name_en, description, sort_order)
values
  ('10000000-0000-0000-0000-000000000001', '一', 'Court 1', '一号场地', 1),
  ('10000000-0000-0000-0000-000000000002', '二', 'Court 2', '二号场地', 2),
  ('10000000-0000-0000-0000-000000000003', '三', 'Court 3', '三号场地', 3),
  ('10000000-0000-0000-0000-000000000004', '四', 'Court 4', '四号场地', 4),
  ('10000000-0000-0000-0000-000000000005', '五', 'Court 5', '五号场地', 5)
on conflict (id) do update set
  name_zh = excluded.name_zh,
  name_en = excluded.name_en,
  description = excluded.description,
  sort_order = excluded.sort_order;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  phone text,
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 馆长权限只由数据库管理员写入。客户端仅能读取自己的角色，不能自行提权。
create table if not exists public.staff_members (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role text not null default 'admin' check (role in ('admin')),
  created_at timestamptz not null default now()
);

create table if not exists public.bookings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  court_id uuid not null references public.courts(id),
  customer_name text not null,
  customer_email text,
  customer_phone text,
  customer_notes text,
  start_at timestamp not null,
  end_at timestamp not null,
  status public.booking_status not null default 'held',
  payment_status public.payment_status not null default 'pending',
  payment_method public.payment_method not null default 'venue',
  total_amount numeric(10, 2) not null check (total_amount >= 0),
  currency char(3) not null default 'CAD',
  party_size smallint not null default 2 check (party_size between 1 and 8),
  hold_expires_at timestamptz,
  stripe_checkout_session_id text unique,
  stripe_payment_intent_id text unique,
  cancelled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint valid_booking_interval check (end_at > start_at),
  constraint valid_booking_duration check (end_at <= start_at + interval '4 hours')
);

-- 为已经存在的项目补齐客户快照列；姓名与邮箱来自受信任的 Auth 数据。
alter table public.bookings add column if not exists customer_name text;
alter table public.bookings add column if not exists customer_email text;
alter table public.bookings add column if not exists customer_phone text;
alter table public.bookings add column if not exists customer_notes text;
alter table public.bookings add column if not exists booking_group_id uuid;
alter table public.bookings add column if not exists recurrence_series_id uuid;
alter table public.bookings add column if not exists recurrence_week smallint;
update public.bookings set booking_group_id = id where booking_group_id is null;
alter table public.bookings alter column booking_group_id set default gen_random_uuid();
alter table public.bookings alter column booking_group_id set not null;
alter table public.bookings drop constraint if exists same_booking_day;

update public.bookings as booking
set
  customer_name = coalesce(
    booking.customer_name,
    nullif(trim(profile.display_name), ''),
    nullif(trim(auth_user.raw_user_meta_data->>'full_name'), ''),
    nullif(split_part(auth_user.email, '@', 1), ''),
    'Tiger guest'
  ),
  customer_email = coalesce(booking.customer_email, auth_user.email, 'unknown@tiger.local')
from auth.users as auth_user
left join public.profiles as profile on profile.id = auth_user.id
where booking.user_id = auth_user.id
  and (booking.customer_name is null or booking.customer_email is null);

alter table public.bookings alter column customer_name set not null;

-- PostgreSQL 原生时间区间排他约束：同一场地任意重叠时段只能有一条有效订单。
do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'bookings_no_time_overlap'
      and conrelid = 'public.bookings'::regclass
  ) then
    alter table public.bookings add constraint bookings_no_time_overlap
    exclude using gist (
      court_id with =,
      tsrange(start_at, end_at, '[)') with &&
    ) where (status in ('held', 'confirmed'));
  end if;
end
$$;

create index if not exists bookings_user_start_idx on public.bookings (user_id, start_at desc);
create index if not exists bookings_court_start_idx on public.bookings (court_id, start_at);
create index if not exists bookings_admin_start_idx on public.bookings (start_at desc, id);
create index if not exists bookings_group_idx on public.bookings (booking_group_id, start_at);
create index if not exists bookings_recurrence_series_idx on public.bookings (recurrence_series_id, recurrence_week) where recurrence_series_id is not null;
create index if not exists bookings_held_expiry_idx on public.bookings (hold_expires_at)
where status = 'held';

-- 馆长操作日志不对客户端开放，由受控数据库函数写入。
create table if not exists private.booking_admin_actions (
  id bigint generated always as identity primary key,
  booking_id uuid not null references public.bookings(id) on delete restrict,
  actor_id uuid references auth.users(id) on delete set null,
  action text not null check (action in ('cancelled', 'created', 'rescheduled', 'details_updated', 'undone')),
  operation_id uuid not null default gen_random_uuid(),
  previous_status public.booking_status not null,
  new_status public.booking_status not null,
  previous_court_id uuid references public.courts(id),
  new_court_id uuid references public.courts(id),
  previous_start_at timestamp,
  previous_end_at timestamp,
  new_start_at timestamp,
  new_end_at timestamp,
  created_at timestamptz not null default now()
);

alter table private.booking_admin_actions drop constraint if exists booking_admin_actions_action_check;
alter table private.booking_admin_actions add constraint booking_admin_actions_action_check
check (action in ('cancelled', 'created', 'rescheduled', 'details_updated', 'undone'));
alter table private.booking_admin_actions add column if not exists operation_id uuid default gen_random_uuid() not null;
alter table private.booking_admin_actions add column if not exists previous_court_id uuid references public.courts(id);
alter table private.booking_admin_actions add column if not exists new_court_id uuid references public.courts(id);
alter table private.booking_admin_actions add column if not exists previous_start_at timestamp;
alter table private.booking_admin_actions add column if not exists previous_end_at timestamp;
alter table private.booking_admin_actions add column if not exists new_start_at timestamp;
alter table private.booking_admin_actions add column if not exists new_end_at timestamp;

create index if not exists booking_admin_actions_booking_created_idx
on private.booking_admin_actions (booking_id, created_at desc);

-- 公开实时表只含占用信息，不含 user_id，避免实时看板泄露用户身份。
create table if not exists public.court_slots (
  id uuid primary key references public.bookings(id) on delete cascade,
  court_id uuid not null references public.courts(id),
  start_at timestamp not null,
  end_at timestamp not null,
  status public.booking_status not null,
  updated_at timestamptz not null default now()
);

create index if not exists court_slots_date_idx on public.court_slots (start_at, end_at, court_id);
create index if not exists court_slots_court_id_idx on public.court_slots (court_id);

create or replace function public.set_updated_at()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at before update on public.profiles
for each row execute function public.set_updated_at();

drop trigger if exists bookings_set_updated_at on public.bookings;
create trigger bookings_set_updated_at before update on public.bookings
for each row execute function public.set_updated_at();

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, display_name, avatar_url)
  values (new.id, coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1)), new.raw_user_meta_data->>'avatar_url')
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
for each row execute function public.handle_new_user();

-- Supabase Authentication → Hooks 中将此函数设为 Before User Created hook，
-- 从 Auth 层阻止白名单之外的新账号（Google OAuth 与邮箱登录都适用）。
create or replace function public.hook_allow_manager_accounts(event jsonb)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  v_email text := lower(trim(event->'user'->>'email'));
begin
  if v_email in ('321756623tu@gmail.com', 'zhangk7@gmail.com') then
    return '{}'::jsonb;
  end if;
  return jsonb_build_object(
    'error', jsonb_build_object(
      'message', 'This Tiger workspace is restricted to approved manager accounts.',
      'http_code', 403
    )
  );
end;
$$;

grant execute on function public.hook_allow_manager_accounts(jsonb) to supabase_auth_admin;
revoke execute on function public.hook_allow_manager_accounts(jsonb) from public, anon, authenticated;

create or replace function public.sync_public_court_slot()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'DELETE' then
    delete from public.court_slots where id = old.id;
    return old;
  end if;

  if new.status in ('held', 'confirmed') and (new.status <> 'held' or new.hold_expires_at is null or new.hold_expires_at > now()) then
    insert into public.court_slots (id, court_id, start_at, end_at, status, updated_at)
    values (new.id, new.court_id, new.start_at, new.end_at, new.status, now())
    on conflict (id) do update set
      court_id = excluded.court_id,
      start_at = excluded.start_at,
      end_at = excluded.end_at,
      status = excluded.status,
      updated_at = now();
  else
    delete from public.court_slots where id = new.id;
  end if;
  return new;
end;
$$;

drop trigger if exists bookings_sync_public_slot on public.bookings;
create trigger bookings_sync_public_slot after insert or update or delete on public.bookings
for each row execute function public.sync_public_court_slot();

create or replace function public.create_booking(
  p_court_id uuid,
  p_start_at timestamp,
  p_end_at timestamp,
  p_customer_phone text,
  p_customer_notes text default null,
  p_party_size smallint default 2,
  p_payment_method public.payment_method default 'venue'
)
returns public.bookings
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_customer_name text;
  v_customer_email text;
  v_hourly_rate numeric(10,2);
  v_total numeric(10,2);
  v_booking public.bookings;
begin
  if v_user_id is null then raise exception 'Authentication required'; end if;
  if not exists (
    select 1 from public.staff_members as staff
    where staff.user_id = v_user_id and staff.role = 'admin'
  ) then raise exception 'Manager access required'; end if;
  if nullif(trim(p_customer_phone), '') is null then raise exception 'Customer phone is required'; end if;
  if length(trim(p_customer_phone)) > 40 then raise exception 'Customer phone is too long'; end if;
  if length(coalesce(p_customer_notes, '')) > 2000 then raise exception 'Customer notes are too long'; end if;
  if p_end_at <= p_start_at then raise exception 'Invalid time range'; end if;
  if p_end_at < p_start_at + interval '30 minutes' then raise exception 'Minimum booking length is 30 minutes'; end if;
  if p_end_at > p_start_at + interval '2 hours' then raise exception 'Maximum booking length is 2 hours'; end if;
  if p_start_at::time < time '07:00' or p_end_at::time > time '22:00' then raise exception 'Booking must be within opening hours'; end if;
  if p_start_at < timezone('America/Toronto', now()) - interval '5 minutes' then raise exception 'Cannot book a past time'; end if;
  if p_start_at > timezone('America/Toronto', now()) + interval '30 days' then raise exception 'Bookings open 30 days in advance'; end if;
  if p_party_size not between 1 and 8 then raise exception 'Party size must be between 1 and 8'; end if;
  if not exists (select 1 from public.courts where id = p_court_id and status = 'open') then raise exception 'Court is unavailable'; end if;

  select
    coalesce(
      nullif(trim(profile.display_name), ''),
      nullif(trim(auth_user.raw_user_meta_data->>'full_name'), ''),
      nullif(split_part(auth_user.email, '@', 1), ''),
      'Tiger guest'
    ),
    coalesce(auth_user.email, 'unknown@tiger.local')
  into v_customer_name, v_customer_email
  from auth.users as auth_user
  left join public.profiles as profile on profile.id = auth_user.id
  where auth_user.id = v_user_id;

  if v_customer_email is null then raise exception 'Authenticated user profile is unavailable'; end if;

  -- 清理超时的支付锁，触发器会同步释放公开占用表。
  update public.bookings
     set status = 'expired'
   where status = 'held' and hold_expires_at <= now();

  v_hourly_rate := case when p_start_at::time >= time '17:00' then 36 else 28 end;
  v_total := round(v_hourly_rate * extract(epoch from (p_end_at - p_start_at)) / 3600, 2);

  begin
    insert into public.bookings (
      user_id, court_id, customer_name, customer_email, customer_phone, customer_notes,
      start_at, end_at, status, payment_status, payment_method,
      total_amount, party_size, hold_expires_at
    ) values (
      v_user_id, p_court_id, v_customer_name, v_customer_email,
      trim(p_customer_phone), nullif(trim(p_customer_notes), ''),
      p_start_at, p_end_at,
      case when p_payment_method = 'stripe' then 'held'::public.booking_status else 'confirmed'::public.booking_status end,
      case when p_payment_method = 'stripe' then 'pending'::public.payment_status else 'pay_at_venue'::public.payment_status end,
      p_payment_method, v_total, p_party_size,
      case when p_payment_method = 'stripe' then now() + interval '10 minutes' else null end
    ) returning * into v_booking;
  exception when exclusion_violation then
    raise exception using message = 'This court is already booked for that time', errcode = 'P0001';
  end;

  return v_booking;
end;
$$;

create or replace function public.admin_create_booking(
  p_court_id uuid,
  p_start_at timestamp,
  p_end_at timestamp,
  p_customer_name text,
  p_customer_email text default null,
  p_party_size smallint default 2,
  p_customer_phone text default null,
  p_customer_notes text default null
)
returns public.bookings
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := auth.uid();
  v_hourly_rate numeric(10,2);
  v_total numeric(10,2);
  v_booking public.bookings;
begin
  if v_actor_id is null then raise exception 'Authentication required'; end if;
  if not exists (
    select 1 from public.staff_members as staff
    where staff.user_id = v_actor_id and staff.role = 'admin'
  ) then raise exception 'Manager access required'; end if;
  if nullif(trim(p_customer_name), '') is null then raise exception 'Customer name is required'; end if;
  if nullif(trim(p_customer_email), '') is not null and position('@' in p_customer_email) < 2 then raise exception 'Customer email is invalid'; end if;
  if length(coalesce(p_customer_phone, '')) > 40 then raise exception 'Customer phone is too long'; end if;
  if length(coalesce(p_customer_notes, '')) > 2000 then raise exception 'Customer notes are too long'; end if;
  if p_end_at <= p_start_at then raise exception 'Invalid time range'; end if;
  if p_end_at < p_start_at + interval '30 minutes' then raise exception 'Minimum booking length is 30 minutes'; end if;
  if p_end_at > p_start_at + interval '4 hours' then raise exception 'Maximum booking length is 4 hours'; end if;
  if p_start_at::date <> p_end_at::date then raise exception 'Booking must end on the same day'; end if;
  if p_start_at::time < time '07:00' or p_end_at::time > time '22:00' then raise exception 'Booking must be within opening hours'; end if;
  if p_party_size not between 1 and 8 then raise exception 'Party size must be between 1 and 8'; end if;
  if not exists (select 1 from public.courts where id = p_court_id and status = 'open') then raise exception 'Court is unavailable'; end if;

  v_hourly_rate := case when p_start_at::time >= time '17:00' then 36 else 28 end;
  v_total := round(v_hourly_rate * extract(epoch from (p_end_at - p_start_at)) / 3600, 2);

  begin
    insert into public.bookings (
      user_id, court_id, customer_name, customer_email, customer_phone, customer_notes, start_at, end_at,
      status, payment_status, payment_method, total_amount, party_size
    ) values (
      v_actor_id, p_court_id, trim(p_customer_name), lower(nullif(trim(p_customer_email), '')),
      nullif(trim(p_customer_phone), ''), nullif(trim(p_customer_notes), ''), p_start_at, p_end_at,
      'confirmed', 'pay_at_venue', 'venue', v_total, p_party_size
    ) returning * into v_booking;
  exception when exclusion_violation then
    raise exception using message = 'This court is already booked for that time', errcode = 'P0001';
  end;

  insert into private.booking_admin_actions (
    booking_id, actor_id, action, previous_status, new_status,
    new_court_id, new_start_at, new_end_at
  ) values (
    v_booking.id, v_actor_id, 'created', v_booking.status, v_booking.status,
    v_booking.court_id, v_booking.start_at, v_booking.end_at
  );
  return v_booking;
end;
$$;

create or replace function public.admin_reschedule_booking(
  p_booking_id uuid,
  p_court_id uuid,
  p_start_at timestamp,
  p_end_at timestamp
)
returns public.bookings
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := auth.uid();
  v_booking public.bookings;
  v_previous public.bookings;
  v_hourly_rate numeric(10,2);
begin
  if v_actor_id is null then raise exception 'Authentication required'; end if;
  if not exists (
    select 1 from public.staff_members as staff
    where staff.user_id = v_actor_id and staff.role = 'admin'
  ) then raise exception 'Manager access required'; end if;
  if p_end_at <= p_start_at then raise exception 'Invalid time range'; end if;
  if p_end_at < p_start_at + interval '30 minutes' then raise exception 'Minimum booking length is 30 minutes'; end if;
  if p_end_at > p_start_at + interval '4 hours' then raise exception 'Maximum booking length is 4 hours'; end if;
  if p_start_at::date <> p_end_at::date then raise exception 'Booking must end on the same day'; end if;
  if p_start_at::time < time '07:00' or p_end_at::time > time '22:00' then raise exception 'Booking must be within opening hours'; end if;
  if not exists (select 1 from public.courts where id = p_court_id and status = 'open') then raise exception 'Court is unavailable'; end if;

  select * into v_previous from public.bookings where id = p_booking_id for update;
  if v_previous.id is null then raise exception 'Booking not found'; end if;
  if v_previous.status not in ('held', 'confirmed') then raise exception 'Booking is no longer active'; end if;

  v_hourly_rate := case when p_start_at::time >= time '17:00' then 36 else 28 end;
  begin
    update public.bookings
       set court_id = p_court_id,
           start_at = p_start_at,
           end_at = p_end_at,
           total_amount = round(v_hourly_rate * extract(epoch from (p_end_at - p_start_at)) / 3600, 2)
     where id = p_booking_id
    returning * into v_booking;
  exception when exclusion_violation then
    raise exception using message = 'This court is already booked for that time', errcode = 'P0001';
  end;

  insert into private.booking_admin_actions (
    booking_id, actor_id, action, previous_status, new_status,
    previous_court_id, new_court_id, previous_start_at, previous_end_at, new_start_at, new_end_at
  ) values (
    v_booking.id, v_actor_id, 'rescheduled', v_previous.status, v_booking.status,
    v_previous.court_id, v_booking.court_id, v_previous.start_at, v_previous.end_at, v_booking.start_at, v_booking.end_at
  );
  return v_booking;
end;
$$;

create or replace function public.admin_update_booking_details(
  p_booking_id uuid,
  p_customer_email text default null,
  p_customer_phone text default null,
  p_customer_notes text default null
)
returns public.bookings
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := auth.uid();
  v_previous public.bookings;
  v_booking public.bookings;
begin
  if v_actor_id is null then raise exception 'Authentication required'; end if;
  if not exists (
    select 1 from public.staff_members as staff
    where staff.user_id = v_actor_id and staff.role = 'admin'
  ) then raise exception 'Manager access required'; end if;
  if nullif(trim(p_customer_email), '') is not null and position('@' in p_customer_email) < 2 then raise exception 'Customer email is invalid'; end if;
  if length(coalesce(p_customer_email, '')) > 320 then raise exception 'Customer email is too long'; end if;
  if length(coalesce(p_customer_phone, '')) > 40 then raise exception 'Customer phone is too long'; end if;
  if length(coalesce(p_customer_notes, '')) > 2000 then raise exception 'Customer notes are too long'; end if;

  select * into v_previous from public.bookings where id = p_booking_id for update;
  if v_previous.id is null then raise exception 'Booking not found'; end if;

  update public.bookings
     set customer_email = lower(nullif(trim(p_customer_email), '')),
         customer_phone = nullif(trim(p_customer_phone), ''),
         customer_notes = nullif(trim(p_customer_notes), '')
   where id = p_booking_id
  returning * into v_booking;

  insert into private.booking_admin_actions (
    booking_id, actor_id, action, previous_status, new_status,
    previous_court_id, new_court_id, previous_start_at, previous_end_at,
    new_start_at, new_end_at
  ) values (
    v_booking.id, v_actor_id, 'details_updated', v_previous.status, v_booking.status,
    v_previous.court_id, v_booking.court_id, v_previous.start_at, v_previous.end_at,
    v_booking.start_at, v_booking.end_at
  );
  return v_booking;
end;
$$;

create or replace function public.cancel_booking(p_booking_id uuid)
returns public.bookings
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_booking public.bookings;
begin
  if v_user_id is null then raise exception 'Authentication required'; end if;

  select *
    into v_booking
    from public.bookings
   where id = p_booking_id
     and user_id = v_user_id
   for update;

  if v_booking.id is null then raise exception 'Booking not found or it does not belong to you'; end if;
  if v_booking.status not in ('held', 'confirmed') then raise exception 'Booking is no longer active'; end if;
  if v_booking.start_at <= timezone('America/Toronto', now()) + interval '12 hours' then
    raise exception 'Booking cannot be cancelled within 12 hours of start time';
  end if;

  update public.bookings
     set status = 'cancelled', cancelled_at = now()
   where id = p_booking_id
  returning * into v_booking;

  return v_booking;
end;
$$;

create or replace function public.admin_cancel_booking(p_booking_id uuid)
returns public.bookings
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := auth.uid();
  v_booking public.bookings;
  v_previous_status public.booking_status;
begin
  if v_actor_id is null then raise exception 'Authentication required'; end if;
  if not exists (
    select 1
    from public.staff_members as staff
    where staff.user_id = v_actor_id
      and staff.role = 'admin'
  ) then
    raise exception 'Manager access required';
  end if;

  select *
    into v_booking
    from public.bookings
   where id = p_booking_id
   for update;

  if v_booking.id is null then raise exception 'Booking not found'; end if;
  if v_booking.status not in ('held', 'confirmed') then raise exception 'Booking is no longer active'; end if;

  v_previous_status := v_booking.status;

  update public.bookings
     set status = 'cancelled', cancelled_at = now()
   where id = p_booking_id
  returning * into v_booking;

  insert into private.booking_admin_actions (
    booking_id, actor_id, action, previous_status, new_status
  ) values (
    v_booking.id, v_actor_id, 'cancelled', v_previous_status, v_booking.status
  );

  return v_booking;
end;
$$;

alter table public.courts enable row level security;
alter table public.profiles enable row level security;
alter table public.staff_members enable row level security;
alter table public.bookings enable row level security;
alter table private.booking_admin_actions enable row level security;
alter table public.court_slots enable row level security;

drop policy if exists "courts are public" on public.courts;
drop policy if exists "staff read courts" on public.courts;
create policy "staff read courts" on public.courts for select
to authenticated
using ((select exists (select 1 from public.staff_members where user_id = (select auth.uid()) and role = 'admin')));

drop policy if exists "public schedule is readable" on public.court_slots;
drop policy if exists "staff read schedule" on public.court_slots;
create policy "staff read schedule" on public.court_slots for select
to authenticated
using ((select exists (select 1 from public.staff_members where user_id = (select auth.uid()) and role = 'admin')));

drop policy if exists "users read own profile" on public.profiles;
create policy "users read own profile" on public.profiles for select
to authenticated
using ((select auth.uid()) = id);
drop policy if exists "users update own profile" on public.profiles;
create policy "users update own profile" on public.profiles for update
to authenticated
using ((select auth.uid()) = id)
with check ((select auth.uid()) = id);

drop policy if exists "staff read own role" on public.staff_members;
create policy "staff read own role" on public.staff_members for select
to authenticated
using ((select auth.uid()) = user_id);

drop policy if exists "users read own bookings" on public.bookings;
drop policy if exists "admins read all bookings" on public.bookings;
drop policy if exists "users read permitted bookings" on public.bookings;
create policy "users read permitted bookings" on public.bookings for select
to authenticated
using (
  (select exists (
    select 1 from public.staff_members as staff
    where staff.user_id = (select auth.uid()) and staff.role = 'admin'
  ))
);

revoke all on public.courts, public.profiles, public.staff_members, public.bookings, public.court_slots from anon, authenticated;
revoke all on private.booking_admin_actions from public, anon, authenticated;
grant usage on schema public to anon, authenticated;
grant select on public.courts, public.court_slots to authenticated;
grant select on public.bookings to authenticated;
grant select on public.staff_members to authenticated;
grant select, update on public.profiles to authenticated;

revoke execute on function public.set_updated_at() from PUBLIC, anon, authenticated;
revoke execute on function public.handle_new_user() from PUBLIC, anon, authenticated;
revoke execute on function public.sync_public_court_slot() from PUBLIC, anon, authenticated;
revoke execute on function public.create_booking(uuid, timestamp, timestamp, text, text, smallint, public.payment_method) from PUBLIC, anon, authenticated;
revoke execute on function public.cancel_booking(uuid) from PUBLIC, anon, authenticated;
revoke execute on function public.admin_cancel_booking(uuid) from PUBLIC, anon, authenticated;
revoke execute on function public.admin_create_booking(uuid, timestamp, timestamp, text, text, smallint, text, text) from PUBLIC, anon, authenticated;
revoke execute on function public.admin_reschedule_booking(uuid, uuid, timestamp, timestamp) from PUBLIC, anon, authenticated;
revoke execute on function public.admin_update_booking_details(uuid, text, text, text) from PUBLIC, anon, authenticated;
grant execute on function public.create_booking(uuid, timestamp, timestamp, text, text, smallint, public.payment_method) to authenticated;
grant execute on function public.cancel_booking(uuid) to authenticated;
grant execute on function public.admin_cancel_booking(uuid) to authenticated;
grant execute on function public.admin_create_booking(uuid, timestamp, timestamp, text, text, smallint, text, text) to authenticated;
grant execute on function public.admin_reschedule_booking(uuid, uuid, timestamp, timestamp) to authenticated;
grant execute on function public.admin_update_booking_details(uuid, text, text, text) to authenticated;

-- Multi-court booking, recurring booking, group rescheduling, resize and undo functions are maintained in
-- supabase/migrations/20260812202340_multi_court_schedule_v2.sql and
-- supabase/migrations/20260813034246_weekly_booking_and_undo_history.sql. They intentionally
-- remain transaction-based so a multi-court request succeeds or fails as one unit.
-- Contiguous multi-court lane shifting is maintained in
-- supabase/migrations/20260812203328_shift_multi_court_group.sql and its adjacent
-- shift hardening migration. Legacy single-court RPCs remain compatible through
-- supabase/migrations/20260812204252_legacy_booking_wrappers_v2.sql.

alter table public.court_slots replica identity full;
do $$ begin
  alter publication supabase_realtime add table public.court_slots;
exception when duplicate_object then null; end $$;
