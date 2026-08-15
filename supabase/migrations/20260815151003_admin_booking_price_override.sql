-- Preserve both the venue-calculated amount and the manager-confirmed amount.
-- This keeps future reporting/auditing truthful even when a manager grants a
-- one-off price while taking a phone or walk-in booking.

alter table public.bookings
  add column system_calculated_amount numeric(10,2),
  add column price_source text not null default 'system',
  add column price_override_amount numeric(10,2),
  add column price_overridden_by uuid,
  add column price_overridden_at timestamptz;

update public.bookings
set system_calculated_amount = total_amount
where system_calculated_amount is null;

alter table public.bookings
  alter column system_calculated_amount set not null,
  add constraint bookings_system_calculated_amount_check
    check (system_calculated_amount >= 0),
  add constraint bookings_price_source_check
    check (price_source in ('system', 'manager_override')),
  add constraint bookings_price_override_amount_check
    check (price_override_amount is null or price_override_amount >= 0),
  add constraint bookings_price_override_shape_check
    check (
      (price_source = 'system'
        and price_override_amount is null
        and price_overridden_by is null
        and price_overridden_at is null)
      or
      (price_source = 'manager_override'
        and price_override_amount is not null
        and price_overridden_by is not null
        and price_overridden_at is not null)
    );

comment on column public.bookings.system_calculated_amount is
  'Venue pricing result before an optional manager override.';
comment on column public.bookings.price_source is
  'Whether total_amount came from venue rules or a manager override.';
comment on column public.bookings.price_override_amount is
  'Manager-confirmed final amount for this individual court booking.';

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
  v_system_amount numeric(10,2);
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

  -- For a manager-entered booking, membership belongs to the customer contact,
  -- never to the signed-in manager who happens to be creating the row.
  select member.tier, member.discount_percent into v_member_tier, v_discount
  from public.venue_members member
  where member.status = 'active'
    and (member.expires_on is null or member.expires_on >= new.start_at::date)
    and (
      (new.customer_email is not null and member.email = lower(new.customer_email))
      or (new.customer_phone is not null and member.phone = new.customer_phone)
      or (
        not v_is_manager
        and member.auth_user_id is not null
        and member.auth_user_id = new.user_id
      )
    )
  order by
    (not v_is_manager and member.auth_user_id = new.user_id) desc,
    member.updated_at desc
  limit 1;

  v_system_amount := private.calculate_booking_amount(
    new.court_id, new.start_at, new.end_at, v_member_tier, v_discount
  );
  new.system_calculated_amount := v_system_amount;

  if new.price_source = 'manager_override' then
    if not v_is_manager then
      raise exception 'Only a manager can override booking price';
    end if;
    if new.price_override_amount is null or new.price_override_amount < 0 then
      raise exception 'Manager price must be zero or greater';
    end if;
    new.price_override_amount := round(new.price_override_amount, 2);
    new.total_amount := new.price_override_amount;
    new.price_overridden_by := coalesce(new.price_overridden_by, auth.uid());
    new.price_overridden_at := coalesce(new.price_overridden_at, clock_timestamp());
  else
    new.price_source := 'system';
    new.total_amount := v_system_amount;
    new.price_override_amount := null;
    new.price_overridden_by := null;
    new.price_overridden_at := null;
  end if;

  return new;
end;
$$;

create or replace function public.admin_preview_booking_price(
  p_court_ids uuid[],
  p_start_at timestamp,
  p_end_at timestamp,
  p_customer_email text default null,
  p_customer_phone text default null,
  p_week_count smallint default 1
)
returns jsonb
language plpgsql
security definer
stable
set search_path = ''
as $$
declare
  v_actor_id uuid := private.require_manager();
  v_court_ids uuid[];
  v_week integer;
  v_start timestamp;
  v_end timestamp;
  v_member_tier text;
  v_member_name_zh text;
  v_member_name_en text;
  v_discount numeric := 0;
  v_courts jsonb;
  v_occurrence_total numeric(10,2);
  v_first_total numeric(10,2);
  v_series_total numeric(10,2) := 0;
  v_occurrences jsonb := '[]'::jsonb;
  v_currency text;
  v_manager_max_minutes smallint;
begin
  select settings.currency, settings.manager_max_minutes
  into v_currency, v_manager_max_minutes
  from public.venue_settings settings
  where settings.singleton;

  select array_agg(distinct selected.id order by selected.id)
  into v_court_ids
  from unnest(coalesce(p_court_ids, '{}'::uuid[])) as selected(id);

  if coalesce(array_length(v_court_ids, 1), 0) < 1
     or array_length(v_court_ids, 1) > 5 then
    raise exception 'Select between 1 and 5 courts';
  end if;
  if coalesce(p_week_count, 0) < 1 or p_week_count > 12 then
    raise exception 'Price preview must contain between 1 and 12 occurrences';
  end if;
  perform private.assert_booking_window(
    p_start_at, p_end_at, make_interval(mins => v_manager_max_minutes)
  );
  if (select count(*) from public.courts court
      where court.id = any(v_court_ids) and court.status = 'open')
      <> array_length(v_court_ids, 1) then
    raise exception 'One or more courts are unavailable';
  end if;

  for v_week in 0..p_week_count - 1 loop
    v_start := p_start_at + make_interval(weeks => v_week);
    v_end := p_end_at + make_interval(weeks => v_week);
    v_member_tier := null;
    v_member_name_zh := null;
    v_member_name_en := null;
    v_discount := 0;

    select member.tier, tier.name_zh, tier.name_en, member.discount_percent
    into v_member_tier, v_member_name_zh, v_member_name_en, v_discount
    from public.venue_members member
    left join public.venue_member_tiers tier on tier.code = member.tier
    where member.status = 'active'
      and (member.expires_on is null or member.expires_on >= v_start::date)
      and (
        (nullif(trim(p_customer_email), '') is not null
          and member.email = lower(trim(p_customer_email)))
        or (nullif(trim(p_customer_phone), '') is not null
          and member.phone = trim(p_customer_phone))
      )
    order by member.updated_at desc
    limit 1;

    select
      jsonb_agg(jsonb_build_object(
        'court_id', priced.id,
        'name_zh', priced.name_zh,
        'name_en', priced.name_en,
        'amount', priced.amount
      ) order by priced.sort_order),
      round(sum(priced.amount), 2)
    into v_courts, v_occurrence_total
    from (
      select court.id, court.name_zh, court.name_en, court.sort_order,
        private.calculate_booking_amount(
          court.id, v_start, v_end, v_member_tier, v_discount
        ) as amount
      from public.courts court
      where court.id = any(v_court_ids)
    ) priced;

    if v_week = 0 then v_first_total := v_occurrence_total; end if;
    v_series_total := v_series_total + v_occurrence_total;
    v_occurrences := v_occurrences || jsonb_build_array(jsonb_build_object(
      'week', v_week + 1,
      'start_at', v_start,
      'end_at', v_end,
      'member', jsonb_build_object(
        'tier', v_member_tier,
        'name_zh', v_member_name_zh,
        'name_en', v_member_name_en,
        'discount_percent', coalesce(v_discount, 0)
      ),
      'courts', coalesce(v_courts, '[]'::jsonb),
      'total', v_occurrence_total
    ));
  end loop;

  return jsonb_build_object(
    'currency', v_currency,
    'occurrences', v_occurrences,
    'first_occurrence_total', v_first_total,
    'series_total', round(v_series_total, 2)
  );
end;
$$;

create or replace function public.admin_create_multi_booking_with_price(
  p_court_ids uuid[],
  p_start_at timestamp,
  p_end_at timestamp,
  p_customer_name text,
  p_customer_email text default null,
  p_party_size smallint default 2,
  p_customer_phone text default null,
  p_customer_notes text default null,
  p_price_override_total numeric default null
)
returns setof public.bookings
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := private.require_manager();
  v_court_ids uuid[];
  v_court record;
  v_group_id uuid := gen_random_uuid();
  v_operation_id uuid := gen_random_uuid();
  v_booking public.bookings;
  v_count integer;
  v_position integer := 0;
  v_override_total numeric(10,2);
  v_base_share numeric(10,2);
  v_share numeric(10,2);
  v_manager_max_minutes smallint;
begin
  select array_agg(distinct selected.id order by selected.id)
  into v_court_ids
  from unnest(coalesce(p_court_ids, '{}'::uuid[])) as selected(id);
  v_count := coalesce(array_length(v_court_ids, 1), 0);
  if v_count < 1 or v_count > 5 then raise exception 'Select between 1 and 5 courts'; end if;
  if trim(coalesce(p_customer_name, '')) = '' then raise exception 'Customer name is required'; end if;
  if nullif(trim(p_customer_email), '') is not null and position('@' in p_customer_email) < 2 then
    raise exception 'Customer email is invalid';
  end if;
  if length(coalesce(p_customer_email, '')) > 320 then raise exception 'Customer email is too long'; end if;
  if length(coalesce(p_customer_phone, '')) > 40 then raise exception 'Customer phone is too long'; end if;
  if length(coalesce(p_customer_notes, '')) > 2000 then raise exception 'Customer notes are too long'; end if;
  if p_party_size < 1 or p_party_size > 8 then raise exception 'Party size must be between 1 and 8'; end if;

  select settings.manager_max_minutes into v_manager_max_minutes
  from public.venue_settings settings where settings.singleton;
  perform private.assert_booking_window(
    p_start_at, p_end_at, make_interval(mins => v_manager_max_minutes)
  );
  if (select count(*) from public.courts court
      where court.id = any(v_court_ids) and court.status = 'open') <> v_count then
    raise exception 'One or more courts are unavailable';
  end if;

  if p_price_override_total is not null then
    if p_price_override_total < 0 or p_price_override_total >= 1000000 then
      raise exception 'Manager price must be between 0 and 999999.99';
    end if;
    v_override_total := round(p_price_override_total, 2);
    v_base_share := trunc(v_override_total * 100 / v_count) / 100;
  end if;

  perform set_config('app.audit_operation_id', v_operation_id::text, true);
  perform set_config('app.audit_source', 'manager_ui', true);

  for v_court in
    select court.id from public.courts court
    where court.id = any(v_court_ids)
    order by court.sort_order, court.id
  loop
    v_position := v_position + 1;
    v_share := case when v_override_total is null then null
      when v_position = v_count then v_override_total - v_base_share * (v_count - 1)
      else v_base_share end;
    begin
      insert into public.bookings (
        booking_group_id, user_id, court_id, customer_name, customer_email,
        customer_phone, customer_notes, start_at, end_at, status,
        payment_status, payment_method, total_amount, system_calculated_amount,
        price_source, price_override_amount, price_overridden_by,
        price_overridden_at, party_size
      ) values (
        v_group_id, v_actor_id, v_court.id, trim(p_customer_name),
        lower(nullif(trim(p_customer_email), '')), nullif(trim(p_customer_phone), ''),
        nullif(trim(p_customer_notes), ''), p_start_at, p_end_at, 'confirmed',
        'pay_at_venue', 'venue', 0, 0,
        case when v_override_total is null then 'system' else 'manager_override' end,
        v_share, case when v_override_total is null then null else v_actor_id end,
        case when v_override_total is null then null else clock_timestamp() end,
        p_party_size
      ) returning * into v_booking;
    exception when exclusion_violation then
      raise exception 'One or more selected courts are already booked';
    end;

    insert into private.booking_admin_actions (
      booking_id, actor_id, action, operation_id, previous_status, new_status,
      new_court_id, new_start_at, new_end_at
    ) values (
      v_booking.id, v_actor_id, 'created', v_operation_id,
      v_booking.status, v_booking.status, v_booking.court_id,
      v_booking.start_at, v_booking.end_at
    );
    return next v_booking;
  end loop;
end;
$$;

create or replace function public.admin_create_weekly_booking_with_price(
  p_court_ids uuid[],
  p_start_at timestamp,
  p_end_at timestamp,
  p_week_count smallint,
  p_customer_name text,
  p_customer_email text default null,
  p_party_size smallint default 2,
  p_customer_phone text default null,
  p_customer_notes text default null,
  p_price_override_total numeric default null
)
returns setof public.bookings
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := private.require_manager();
  v_court_ids uuid[];
  v_court record;
  v_series_id uuid := gen_random_uuid();
  v_group_id uuid;
  v_operation_id uuid := gen_random_uuid();
  v_booking public.bookings;
  v_conflict record;
  v_week integer;
  v_start timestamp;
  v_end timestamp;
  v_count integer;
  v_position integer;
  v_override_total numeric(10,2);
  v_base_share numeric(10,2);
  v_share numeric(10,2);
  v_manager_max_minutes smallint;
begin
  select array_agg(distinct selected.id order by selected.id)
  into v_court_ids
  from unnest(coalesce(p_court_ids, '{}'::uuid[])) as selected(id);
  v_count := coalesce(array_length(v_court_ids, 1), 0);
  if v_count < 1 or v_count > 5 then raise exception 'Select between 1 and 5 courts'; end if;
  if p_week_count < 2 or p_week_count > 12 then
    raise exception 'Weekly bookings must repeat between 2 and 12 weeks';
  end if;
  if trim(coalesce(p_customer_name, '')) = '' then raise exception 'Customer name is required'; end if;
  if nullif(trim(p_customer_email), '') is not null and position('@' in p_customer_email) < 2 then
    raise exception 'Customer email is invalid';
  end if;
  if length(coalesce(p_customer_email, '')) > 320 then raise exception 'Customer email is too long'; end if;
  if length(coalesce(p_customer_phone, '')) > 40 then raise exception 'Customer phone is too long'; end if;
  if length(coalesce(p_customer_notes, '')) > 2000 then raise exception 'Customer notes are too long'; end if;
  if p_party_size < 1 or p_party_size > 8 then raise exception 'Party size must be between 1 and 8'; end if;

  select settings.manager_max_minutes into v_manager_max_minutes
  from public.venue_settings settings where settings.singleton;
  perform private.assert_booking_window(
    p_start_at, p_end_at, make_interval(mins => v_manager_max_minutes)
  );
  if (select count(*) from public.courts court
      where court.id = any(v_court_ids) and court.status = 'open') <> v_count then
    raise exception 'One or more courts are unavailable';
  end if;

  select * into v_conflict
  from public.admin_preview_weekly_booking(v_court_ids, p_start_at, p_end_at, p_week_count)
  limit 1;
  if v_conflict.occurrence_start_at is not null then
    raise exception 'One or more weekly occurrences are unavailable';
  end if;

  if p_price_override_total is not null then
    if p_price_override_total < 0 or p_price_override_total >= 1000000 then
      raise exception 'Manager price must be between 0 and 999999.99';
    end if;
    v_override_total := round(p_price_override_total, 2);
    v_base_share := trunc(v_override_total * 100 / v_count) / 100;
  end if;

  perform set_config('app.audit_operation_id', v_operation_id::text, true);
  perform set_config('app.audit_source', 'manager_ui', true);

  for v_week in 0..p_week_count - 1 loop
    v_group_id := gen_random_uuid();
    v_start := p_start_at + make_interval(weeks => v_week);
    v_end := p_end_at + make_interval(weeks => v_week);
    v_position := 0;

    for v_court in
      select court.id from public.courts court
      where court.id = any(v_court_ids)
      order by court.sort_order, court.id
    loop
      v_position := v_position + 1;
      v_share := case when v_override_total is null then null
        when v_position = v_count then v_override_total - v_base_share * (v_count - 1)
        else v_base_share end;
      begin
        insert into public.bookings (
          booking_group_id, recurrence_series_id, recurrence_week,
          user_id, court_id, customer_name, customer_email, customer_phone,
          customer_notes, start_at, end_at, status, payment_status,
          payment_method, total_amount, system_calculated_amount, price_source,
          price_override_amount, price_overridden_by, price_overridden_at,
          party_size
        ) values (
          v_group_id, v_series_id, v_week + 1,
          v_actor_id, v_court.id, trim(p_customer_name),
          lower(nullif(trim(p_customer_email), '')), nullif(trim(p_customer_phone), ''),
          nullif(trim(p_customer_notes), ''), v_start, v_end, 'confirmed',
          'pay_at_venue', 'venue', 0, 0,
          case when v_override_total is null then 'system' else 'manager_override' end,
          v_share, case when v_override_total is null then null else v_actor_id end,
          case when v_override_total is null then null else clock_timestamp() end,
          p_party_size
        ) returning * into v_booking;
      exception when exclusion_violation then
        raise exception 'One or more weekly occurrences are unavailable';
      end;

      insert into private.booking_admin_actions (
        booking_id, actor_id, action, operation_id, previous_status, new_status,
        new_court_id, new_start_at, new_end_at
      ) values (
        v_booking.id, v_actor_id, 'created', v_operation_id,
        v_booking.status, v_booking.status, v_booking.court_id,
        v_booking.start_at, v_booking.end_at
      );
      return next v_booking;
    end loop;
  end loop;
end;
$$;

revoke execute on function public.admin_preview_booking_price(uuid[],timestamp,timestamp,text,text,smallint)
  from public, anon, authenticated;
revoke execute on function public.admin_create_multi_booking_with_price(uuid[],timestamp,timestamp,text,text,smallint,text,text,numeric)
  from public, anon, authenticated;
revoke execute on function public.admin_create_weekly_booking_with_price(uuid[],timestamp,timestamp,smallint,text,text,smallint,text,text,numeric)
  from public, anon, authenticated;
grant execute on function public.admin_preview_booking_price(uuid[],timestamp,timestamp,text,text,smallint)
  to authenticated;
grant execute on function public.admin_create_multi_booking_with_price(uuid[],timestamp,timestamp,text,text,smallint,text,text,numeric)
  to authenticated;
grant execute on function public.admin_create_weekly_booking_with_price(uuid[],timestamp,timestamp,smallint,text,text,smallint,text,text,numeric)
  to authenticated;

comment on function public.admin_preview_booking_price is
  'Manager-only exact quote for one or more courts and optional weekly occurrences.';
comment on function public.admin_create_multi_booking_with_price is
  'Creates a manager booking with either the exact system quote or an auditable manager override.';
comment on function public.admin_create_weekly_booking_with_price is
  'Creates weekly manager bookings; an override is applied per occurrence and allocated across courts.';

notify pgrst, 'reload schema';
