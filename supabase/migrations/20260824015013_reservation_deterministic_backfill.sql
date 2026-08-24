-- Reservation migration Phase 2: deterministic legacy backfill only.
--
-- This migration intentionally does not change any current read/write RPC,
-- frontend contract, legacy relationship field, price, status, or slot. It
-- fails closed unless the production snapshot captured immediately before
-- authoring is still exact. A later production deployment therefore requires
-- a fresh baseline review if normal venue operations changed any booking.

begin;

set local statement_timeout = '30s';
set local lock_timeout = '5s';
set local idle_in_transaction_session_timeout = '30s';
set local timezone = 'UTC';

-- Coordinate this one-time operation and prevent the legacy source rows from
-- changing between the frozen fingerprint and the final assertions.
select pg_advisory_xact_lock(20260824015013);

lock table public.bookings in access exclusive mode;
lock table
  public.recurrence_series,
  public.reservations,
  public.reservation_legacy_sources,
  public.reservation_parties,
  public.reservation_party_roles,
  public.reservation_sessions,
  public.reservation_payment_shares,
  public.payments,
  public.payment_allocation_entries
in share row exclusive mode;

-- Historical reservations did not record payer intent. `single_payer` would
-- invent an intent, so Phase 2 adds an internal truthful legacy state while
-- leaving the future/default customer choice unchanged.
alter table public.reservations
  drop constraint reservations_payment_plan_check;
alter table public.reservations
  add constraint reservations_payment_plan_check
  check (payment_plan in (
    'single_payer',
    'split_equal',
    'split_custom',
    'legacy_unspecified'
  )) not valid;

comment on column public.reservations.payment_plan is
  'Payer intent. legacy_unspecified means the old booking model never captured a reliable single/split choice.';

-- Stable UUID namespaces. Every derived UUID is UUIDv5(namespace, source key),
-- making two independent mappings reproduce exactly the same identifiers.
create temporary table phase2_namespaces (
  entity text primary key,
  namespace_id uuid not null unique
) on commit drop;

insert into phase2_namespaces (entity, namespace_id)
values
  ('recurrence_series', extensions.uuid_generate_v5(
    '6ba7b811-9dad-11d1-80b4-00c04fd430c8'::uuid,
    'https://tiger-badminton.example/reservation-migration/recurrence-series/v1'
  )),
  ('reservation', extensions.uuid_generate_v5(
    '6ba7b811-9dad-11d1-80b4-00c04fd430c8'::uuid,
    'https://tiger-badminton.example/reservation-migration/reservation/v1'
  )),
  ('party', extensions.uuid_generate_v5(
    '6ba7b811-9dad-11d1-80b4-00c04fd430c8'::uuid,
    'https://tiger-badminton.example/reservation-migration/party/v1'
  )),
  ('session', extensions.uuid_generate_v5(
    '6ba7b811-9dad-11d1-80b4-00c04fd430c8'::uuid,
    'https://tiger-badminton.example/reservation-migration/session/v1'
  )),
  ('payment', extensions.uuid_generate_v5(
    '6ba7b811-9dad-11d1-80b4-00c04fd430c8'::uuid,
    'https://tiger-badminton.example/reservation-migration/payment/v1'
  ));

-- Frozen zero-PII production baseline captured at 2026-08-24 01:48:50 UTC.
-- The hashes cover the full booking rows and all dedicated payment audit rows,
-- but disclose none of their customer/audit payloads.
do $$
declare
  v_count bigint;
  v_booking_fingerprint text;
  v_payment_audit_fingerprint text;
  v_timezone text;
  v_currency text;
begin
  select settings.timezone, settings.currency
    into v_timezone, v_currency
  from public.venue_settings as settings
  where settings.singleton;

  if v_timezone is distinct from 'America/Toronto'
     or v_currency is distinct from 'CAD' then
    raise exception 'Phase 2 baseline venue configuration changed';
  end if;

  select md5(coalesce(string_agg(to_jsonb(booking)::text, '' order by booking.id), ''))
    into v_booking_fingerprint
  from public.bookings as booking;

  if v_booking_fingerprint <> '20802718eff3b81bd5fe38d99808e8d8' then
    raise exception 'Phase 2 booking fingerprint changed; rerun and review the baseline';
  end if;

  select md5(coalesce(string_agg(to_jsonb(event)::text, '' order by event.id), ''))
    into v_payment_audit_fingerprint
  from private.app_audit_events as event
  where event.event_type = 'booking.payment_updated';

  if v_payment_audit_fingerprint <> '80cbd801fce56b51b9d0e51c68a60e2c' then
    raise exception 'Phase 2 payment audit fingerprint changed; rerun and review reconciliation';
  end if;

  select count(*) into v_count from public.bookings;
  if v_count <> 192 then
    raise exception 'Phase 2 expected 192 legacy booking rows, found %', v_count;
  end if;

  select count(*) into v_count
  from public.bookings
  where reservation_id is not null or session_id is not null;
  if v_count <> 0 then
    raise exception 'Phase 2 requires every legacy booking ownership link to be empty';
  end if;

  select
    (select count(*) from public.recurrence_series)
    + (select count(*) from public.reservations)
    + (select count(*) from public.reservation_legacy_sources)
    + (select count(*) from public.reservation_parties)
    + (select count(*) from public.reservation_party_roles)
    + (select count(*) from public.reservation_sessions)
    + (select count(*) from public.reservation_payment_shares)
    + (select count(*) from public.payments)
    + (select count(*) from public.payment_allocation_entries)
  into v_count;
  if v_count <> 0 then
    raise exception 'Phase 2 target tables must be empty, found % rows', v_count;
  end if;
end;
$$;

-- Validate all source shapes before choosing any representative value.
do $$
declare
  v_count bigint;
begin
  select count(*) into v_count
  from (
    select booking_group_id
    from public.bookings
    group by booking_group_id
    having count(distinct customer_name) > 1
        or count(distinct coalesce(customer_email, '<null>')) > 1
        or count(distinct coalesce(customer_phone, '<null>')) > 1
        or count(distinct user_id) > 1
  ) as mismatch;
  if v_count <> 0 then
    raise exception 'Phase 2 found % groups with conflicting customer snapshots', v_count;
  end if;

  select count(*) into v_count
  from public.bookings
  where nullif(trim(customer_name), '') is null;
  if v_count <> 0 then
    raise exception 'Phase 2 found % bookings with a blank customer name', v_count;
  end if;

  select count(*) into v_count
  from (
    select booking_group_id, start_at, end_at
    from public.bookings
    group by booking_group_id, start_at, end_at
    having count(distinct party_size) > 1
        or count(distinct coalesce(customer_notes, '<null>')) > 1
  ) as mismatch;
  if v_count <> 0 then
    raise exception 'Phase 2 found % Sessions with conflicting party size or notes', v_count;
  end if;

  select count(*) into v_count
  from (
    select booking_group_id
    from public.bookings
    group by booking_group_id
    having count(distinct coalesce(booking_link_id::text, '<null>')) > 1
        or count(distinct coalesce(recurrence_series_id::text, '<null>')) > 1
        or count(distinct coalesce(recurrence_week::text, '<null>')) > 1
  ) as mismatch;
  if v_count <> 0 then
    raise exception 'Phase 2 found % groups with conflicting legacy relationships', v_count;
  end if;

  select count(*) into v_count
  from (
    select booking_group_id
    from public.bookings
    group by booking_group_id
    having bool_or(recurrence_series_id is null)
       <> bool_or(recurrence_week is null)
  ) as mismatch;
  if v_count <> 0 then
    raise exception 'Phase 2 found % groups with incomplete recurrence fields', v_count;
  end if;

  select count(*) into v_count
  from public.bookings
  where total_amount < 0
     or currency <> 'CAD'
     or (price_source = 'system' and system_calculated_amount is null)
     or (price_source = 'system' and price_override_amount is not null)
     or (price_source = 'manager_override' and price_override_amount is null)
     or (price_source = 'manager_override'
       and total_amount is distinct from price_override_amount);
  if v_count <> 0 then
    raise exception 'Phase 2 found % booking price/currency shape errors', v_count;
  end if;

  select count(*) into v_count
  from public.bookings
  where payment_status = 'paid' and total_amount <= 0;
  if v_count <> 0 then
    raise exception 'Phase 2 cannot reconcile % paid bookings with a non-positive amount', v_count;
  end if;
end;
$$;

-- Reject both nonexistent and repeated Toronto wall-clock values. PostgreSQL
-- otherwise silently adjusts nonexistent values and chooses one offset for an
-- ambiguous value.
do $$
declare
  v_count bigint;
  v_timezone text := 'America/Toronto';
begin
  with local_values as (
    select start_at as local_value from public.bookings
    union
    select end_at from public.bookings
  )
  select count(*) into v_count
  from local_values
  where timezone(v_timezone, local_value at time zone v_timezone)
          is distinct from local_value
     or timezone(v_timezone,
          (local_value at time zone v_timezone) - interval '1 hour') = local_value
     or timezone(v_timezone,
          (local_value at time zone v_timezone) + interval '1 hour') = local_value;

  if v_count <> 0 then
    raise exception 'Phase 2 found % nonexistent or ambiguous Toronto timestamps', v_count;
  end if;
end;
$$;

create temporary table phase2_groups on commit drop as
with rollup as (
  select
    booking.booking_group_id,
    (array_agg(booking.booking_link_id order by booking.booking_link_id)
      filter (where booking.booking_link_id is not null))[1] as booking_link_id,
    (array_agg(booking.recurrence_series_id order by booking.recurrence_series_id)
      filter (where booking.recurrence_series_id is not null))[1]
      as legacy_recurrence_series_id,
    min(booking.recurrence_week)
      filter (where booking.recurrence_week is not null) as recurrence_week,
    min(booking.customer_name) as customer_name,
    min(booking.customer_email) as customer_email,
    min(booking.customer_phone) as customer_phone,
    (array_agg(booking.user_id order by booking.user_id))[1] as auth_user_id,
    min(booking.currency) as currency,
    bool_or(
      booking.status in ('held', 'confirmed')
      and (
        booking.status <> 'held'
        or booking.hold_expires_at is null
        or booking.hold_expires_at > '2026-08-24 01:48:50+00'::timestamptz
      )
    ) as has_active_booking,
    min(booking.created_at) as first_created_at,
    max(booking.updated_at) as last_updated_at
  from public.bookings as booking
  group by booking.booking_group_id
), keyed as (
  select
    rollup.*,
    case when rollup.booking_link_id is null
      then 'group:' || rollup.booking_group_id::text
      else 'link:' || rollup.booking_link_id::text
    end as reservation_key
  from rollup
)
select
  keyed.*,
  extensions.uuid_generate_v5(reservation_namespace.namespace_id, keyed.reservation_key)
    as reservation_id,
  extensions.uuid_generate_v5(
    party_namespace.namespace_id,
    'booking-group:' || keyed.booking_group_id::text
  ) as party_id
from keyed
cross join phase2_namespaces as reservation_namespace
cross join phase2_namespaces as party_namespace
where reservation_namespace.entity = 'reservation'
  and party_namespace.entity = 'party';

create unique index phase2_groups_group_idx
  on phase2_groups (booking_group_id);
create index phase2_groups_reservation_idx
  on phase2_groups (reservation_id, first_created_at, booking_group_id);

do $$
declare
  v_count bigint;
begin
  select count(*) into v_count from phase2_groups;
  if v_count <> 131 then
    raise exception 'Phase 2 expected 131 source groups, found %', v_count;
  end if;

  select count(*) into v_count
  from (
    select reservation_id
    from phase2_groups
    group by reservation_id
    having count(distinct currency) > 1
        or count(distinct legacy_recurrence_series_id)
             filter (where legacy_recurrence_series_id is not null) > 1
        or count(distinct recurrence_week)
             filter (where recurrence_week is not null) > 1
  ) as mismatch;
  if v_count <> 0 then
    raise exception 'Phase 2 found % Reservations with incompatible currency/recurrence sources', v_count;
  end if;

  select count(*) - count(distinct reservation_id) into v_count
  from (select distinct reservation_key, reservation_id from phase2_groups) as ids;
  if v_count <> 0 then
    raise exception 'Phase 2 Reservation UUID collision detected';
  end if;

  select count(*) - count(distinct party_id) into v_count from phase2_groups;
  if v_count <> 0 then
    raise exception 'Phase 2 Party UUID collision detected';
  end if;
end;
$$;

create temporary table phase2_recurrence_series on commit drop as
with occurrences as (
  select
    booking.recurrence_series_id as legacy_recurrence_series_id,
    booking.recurrence_week,
    booking.booking_group_id,
    min(booking.start_at::date) as occurrence_date,
    count(distinct booking.start_at::date) as group_date_count,
    count(distinct extract(dow from booking.start_at)) as group_weekday_count,
    min(booking.created_at) as first_created_at,
    max(booking.updated_at) as last_updated_at
  from public.bookings as booking
  where booking.recurrence_series_id is not null
  group by booking.recurrence_series_id, booking.recurrence_week,
           booking.booking_group_id
), anchors as (
  select
    occurrence.legacy_recurrence_series_id,
    min(occurrence.recurrence_week) as minimum_week,
    max(occurrence.recurrence_week) as maximum_week,
    min(occurrence.occurrence_date) as starts_on,
    count(distinct occurrence.recurrence_week) as week_count,
    count(*) as occurrence_group_count,
    count(distinct extract(dow from occurrence.occurrence_date)) as weekday_count,
    min(occurrence.first_created_at) as created_at,
    max(occurrence.last_updated_at) as updated_at
  from occurrences as occurrence
  group by occurrence.legacy_recurrence_series_id
), validated as (
  select
    anchor.*,
    count(*) filter (
      where occurrence.group_date_count <> 1
         or occurrence.group_weekday_count <> 1
         or occurrence.occurrence_date <> (
           anchor.starts_on
           + ((occurrence.recurrence_week - anchor.minimum_week) * 7)
         )
    ) as invalid_occurrences
  from anchors as anchor
  join occurrences as occurrence using (legacy_recurrence_series_id)
  group by anchor.legacy_recurrence_series_id, anchor.minimum_week,
           anchor.maximum_week, anchor.starts_on, anchor.week_count,
           anchor.occurrence_group_count, anchor.weekday_count,
           anchor.created_at, anchor.updated_at
)
select
  validated.*,
  extensions.uuid_generate_v5(
    recurrence_namespace.namespace_id,
    'legacy-series:' || validated.legacy_recurrence_series_id::text
  ) as recurrence_series_id,
  extract(dow from validated.starts_on)::smallint as day_of_week
from validated
cross join phase2_namespaces as recurrence_namespace
where recurrence_namespace.entity = 'recurrence_series';

create unique index phase2_recurrence_legacy_idx
  on phase2_recurrence_series (legacy_recurrence_series_id);

do $$
declare
  v_count bigint;
begin
  select count(*) into v_count from phase2_recurrence_series;
  if v_count <> 2 then
    raise exception 'Phase 2 expected 2 recurrence series, found %', v_count;
  end if;

  select count(*) - count(distinct recurrence_series_id) into v_count
  from phase2_recurrence_series;
  if v_count <> 0 then
    raise exception 'Phase 2 Recurrence Series UUID collision detected';
  end if;

  select count(*) into v_count
  from phase2_recurrence_series
  where minimum_week <> 1
     or maximum_week <> week_count
     or occurrence_group_count <> week_count
     or weekday_count <> 1
     or invalid_occurrences <> 0;
  if v_count <> 0 then
    raise exception 'Phase 2 recurrence weeks are incomplete or not weekly';
  end if;
end;
$$;

create unique index phase2_recurrence_target_idx
  on phase2_recurrence_series (recurrence_series_id);

create temporary table phase2_reservations on commit drop as
select
  groups.reservation_key,
  groups.reservation_id,
  min(groups.currency) as currency,
  min(groups.first_created_at) as created_at,
  max(groups.last_updated_at) as updated_at,
  (array_agg(groups.legacy_recurrence_series_id
    order by groups.legacy_recurrence_series_id)
    filter (where groups.legacy_recurrence_series_id is not null))[1]
    as legacy_recurrence_series_id,
  min(groups.recurrence_week)
    filter (where groups.recurrence_week is not null) as recurrence_sequence
from phase2_groups as groups
group by groups.reservation_key, groups.reservation_id;

alter table phase2_reservations add column recurrence_series_id uuid;
update phase2_reservations as reservation
set recurrence_series_id = series.recurrence_series_id
from phase2_recurrence_series as series
where series.legacy_recurrence_series_id = reservation.legacy_recurrence_series_id;

create unique index phase2_reservations_id_idx
  on phase2_reservations (reservation_id);

create temporary table phase2_sessions on commit drop as
select
  extensions.uuid_generate_v5(
    session_namespace.namespace_id,
    'booking-group:' || groups.booking_group_id::text
      || '|start:' || to_char(booking.start_at, 'YYYY-MM-DD"T"HH24:MI:SS.US')
      || '|end:' || to_char(booking.end_at, 'YYYY-MM-DD"T"HH24:MI:SS.US')
  ) as session_id,
  groups.reservation_id,
  groups.booking_group_id,
  booking.start_at as legacy_start_at,
  booking.end_at as legacy_end_at,
  booking.start_at at time zone 'America/Toronto' as starts_at,
  booking.end_at at time zone 'America/Toronto' as ends_at,
  min(booking.party_size)::smallint as party_size,
  min(booking.customer_notes) as notes,
  min(booking.created_at) as created_at,
  max(booking.updated_at) as updated_at
from public.bookings as booking
join phase2_groups as groups using (booking_group_id)
cross join phase2_namespaces as session_namespace
where session_namespace.entity = 'session'
group by session_namespace.namespace_id, groups.reservation_id,
         groups.booking_group_id, booking.start_at, booking.end_at;

create unique index phase2_sessions_source_idx
  on phase2_sessions (booking_group_id, legacy_start_at, legacy_end_at);

create temporary table phase2_booking_map on commit drop as
select
  booking.id as booking_id,
  groups.reservation_id,
  session.session_id
from public.bookings as booking
join phase2_groups as groups using (booking_group_id)
join phase2_sessions as session
  on session.booking_group_id = booking.booking_group_id
 and session.legacy_start_at = booking.start_at
 and session.legacy_end_at = booking.end_at;

create unique index phase2_booking_map_booking_idx
  on phase2_booking_map (booking_id);

do $$
declare
  v_count bigint;
begin
  select count(*) into v_count from phase2_reservations;
  if v_count <> 123 then
    raise exception 'Phase 2 expected 123 Reservations, found %', v_count;
  end if;

  select count(*) into v_count from phase2_sessions;
  if v_count <> 135 then
    raise exception 'Phase 2 expected 135 Sessions, found %', v_count;
  end if;

  select count(*) into v_count from phase2_booking_map;
  if v_count <> 192 then
    raise exception 'Phase 2 booking mapping covers % of 192 bookings', v_count;
  end if;

  select count(*) - count(distinct session_id) into v_count from phase2_sessions;
  if v_count <> 0 then
    raise exception 'Phase 2 Session UUID collision detected';
  end if;

  select count(*) into v_count
  from phase2_sessions
  where timezone('America/Toronto', starts_at) is distinct from legacy_start_at
     or timezone('America/Toronto', ends_at) is distinct from legacy_end_at
     or ends_at <= starts_at;
  if v_count <> 0 then
    raise exception 'Phase 2 Session timezone projection failed for % rows', v_count;
  end if;

  select count(*) into v_count
  from phase2_reservations
  where (recurrence_series_id is null) <> (recurrence_sequence is null);
  if v_count <> 0 then
    raise exception 'Phase 2 produced % incomplete Reservation recurrence links', v_count;
  end if;
end;
$$;

create unique index phase2_sessions_id_idx on phase2_sessions (session_id);

-- Select the last dedicated paid transition for each currently-paid booking.
-- One legacy booking was paid, reset, and paid again; selecting its last proven
-- transition prevents double-counting while retaining the current payment fact.
create temporary table phase2_selected_payment_events on commit drop as
with ranked as (
  select
    event.id as audit_event_id,
    event.operation_id,
    event.entity_id::uuid as booking_id,
    event.occurred_at,
    event.actor_kind,
    event.source,
    (event.after_state ->> 'total_amount')::numeric as audited_amount,
    event.after_state ->> 'currency' as audited_currency,
    row_number() over (
      partition by event.entity_id
      order by event.occurred_at desc, event.id desc
    ) as payment_rank
  from private.app_audit_events as event
  join public.bookings as booking on booking.id::text = event.entity_id
  where event.event_type = 'booking.payment_updated'
    and booking.payment_status = 'paid'
    and event.after_state ->> 'payment_status' = 'paid'
    and event.before_state ->> 'payment_status' is distinct from 'paid'
)
select
  ranked.*,
  mapping.reservation_id,
  booking.total_amount as current_amount,
  booking.currency as current_currency
from ranked
join phase2_booking_map as mapping using (booking_id)
join public.bookings as booking on booking.id = ranked.booking_id
where ranked.payment_rank = 1;

create unique index phase2_selected_payment_booking_idx
  on phase2_selected_payment_events (booking_id);

do $$
declare
  v_count bigint;
begin
  select count(*) into v_count from phase2_selected_payment_events;
  if v_count <> 5 then
    raise exception 'Phase 2 expected 5 audit-backed paid bookings, found %', v_count;
  end if;

  select count(*) into v_count
  from phase2_selected_payment_events
  where audited_amount is null
     or audited_amount <= 0
     or audited_amount is distinct from current_amount
     or audited_currency is distinct from current_currency;
  if v_count <> 0 then
    raise exception 'Phase 2 found % audit-backed payment amount/currency mismatches', v_count;
  end if;

  select count(*) into v_count
  from (
    select operation_id, reservation_id
    from phase2_selected_payment_events
    group by operation_id, reservation_id
    having count(distinct occurred_at) <> 1
        or count(distinct actor_kind) <> 1
        or count(distinct source) <> 1
  ) as mismatch;
  if v_count <> 0 then
    raise exception 'Phase 2 found % non-uniform audited payment operations', v_count;
  end if;

  select count(*) into v_count
  from (
    select operation_id
    from phase2_selected_payment_events
    group by operation_id
    having count(distinct reservation_id) > 1
  ) as mismatch;
  if v_count <> 0 then
    raise exception 'Phase 2 found % payment operations crossing Reservations', v_count;
  end if;
end;
$$;

create temporary table phase2_payments on commit drop as
with audited as (
  select
    'audit:' || event.operation_id
      || ':reservation:' || event.reservation_id::text as payment_key,
    event.reservation_id,
    round(sum(event.audited_amount), 2) as amount,
    min(event.current_currency)::character(3) as currency,
    min(event.occurred_at) as occurred_at,
    'legacy_reconciliation:audit:' || event.operation_id
      || ':reservation:' || event.reservation_id::text as idempotency_key
  from phase2_selected_payment_events as event
  group by event.operation_id, event.reservation_id
), unaudited as (
  select
    'booking:' || booking.id::text as payment_key,
    mapping.reservation_id,
    booking.total_amount::numeric(12,2) as amount,
    booking.currency::character(3) as currency,
    null::timestamptz as occurred_at,
    'legacy_reconciliation:booking:' || booking.id::text as idempotency_key
  from public.bookings as booking
  join phase2_booking_map as mapping on mapping.booking_id = booking.id
  where booking.payment_status = 'paid'
    and not exists (
      select 1
      from phase2_selected_payment_events as event
      where event.booking_id = booking.id
    )
), combined as (
  select * from audited
  union all
  select * from unaudited
)
select
  extensions.uuid_generate_v5(payment_namespace.namespace_id, combined.payment_key)
    as payment_id,
  combined.*
from combined
cross join phase2_namespaces as payment_namespace
where payment_namespace.entity = 'payment';

create unique index phase2_payments_key_idx on phase2_payments (payment_key);
create unique index phase2_payments_idempotency_idx
  on phase2_payments (idempotency_key);

create temporary table phase2_payment_allocations on commit drop as
with audited as (
  select
    payment.payment_id,
    event.reservation_id,
    event.booking_id,
    event.audited_amount::numeric(12,2) as amount,
    'legacy_reconciliation:audit_allocation:' || event.operation_id
      || ':booking:' || event.booking_id::text as idempotency_key
  from phase2_selected_payment_events as event
  join phase2_payments as payment
    on payment.payment_key = 'audit:' || event.operation_id
      || ':reservation:' || event.reservation_id::text
), unaudited as (
  select
    payment.payment_id,
    mapping.reservation_id,
    booking.id as booking_id,
    booking.total_amount::numeric(12,2) as amount,
    'legacy_reconciliation:booking_allocation:' || booking.id::text
      as idempotency_key
  from public.bookings as booking
  join phase2_booking_map as mapping on mapping.booking_id = booking.id
  join phase2_payments as payment
    on payment.payment_key = 'booking:' || booking.id::text
  where booking.payment_status = 'paid'
    and not exists (
      select 1
      from phase2_selected_payment_events as event
      where event.booking_id = booking.id
    )
), combined as (
  select * from audited
  union all
  select * from unaudited
)
select
  row_number() over (
    order by combined.payment_id, combined.booking_id
  )::bigint as allocation_id,
  combined.*
from combined;

create unique index phase2_allocations_id_idx
  on phase2_payment_allocations (allocation_id);
create unique index phase2_allocations_booking_idx
  on phase2_payment_allocations (booking_id);
create unique index phase2_allocations_idempotency_idx
  on phase2_payment_allocations (idempotency_key);

do $$
declare
  v_count bigint;
  v_amount numeric;
begin
  select count(*) into v_count from phase2_payments;
  if v_count <> 23 then
    raise exception 'Phase 2 expected 23 reconciliation Payments, found %', v_count;
  end if;

  select count(*) into v_count from phase2_payment_allocations;
  if v_count <> 26 then
    raise exception 'Phase 2 expected 26 payment allocations, found %', v_count;
  end if;

  select count(*) - count(distinct payment_id) into v_count from phase2_payments;
  if v_count <> 0 then
    raise exception 'Phase 2 Payment UUID collision detected';
  end if;

  select count(*) into v_count
  from phase2_payments
  where length(idempotency_key) not between 1 and 200;
  if v_count <> 0 then
    raise exception 'Phase 2 generated an invalid Payment idempotency key';
  end if;

  select count(*) into v_count
  from phase2_payment_allocations
  where length(idempotency_key) not between 1 and 240;
  if v_count <> 0 then
    raise exception 'Phase 2 generated an invalid allocation idempotency key';
  end if;

  select count(*) into v_count
  from phase2_payments as payment
  left join (
    select payment_id, round(sum(amount), 2) as allocated
    from phase2_payment_allocations
    group by payment_id
  ) as allocation using (payment_id)
  where payment.amount is distinct from allocation.allocated;
  if v_count <> 0 then
    raise exception 'Phase 2 found % Payments with incomplete allocations', v_count;
  end if;

  select round(sum(amount), 2) into v_amount from phase2_payments;
  if v_amount <> 1642.00 then
    raise exception 'Phase 2 expected CAD 1642.00 reconciled, found %', v_amount;
  end if;
end;
$$;

create unique index phase2_payments_id_idx on phase2_payments (payment_id);

-- Verify namespaces do not collide across entity types even though the target
-- tables themselves also enforce their own primary/unique keys.
do $$
declare
  v_total bigint;
  v_distinct bigint;
begin
  with all_ids as (
    select recurrence_series_id as id from phase2_recurrence_series
    union all select reservation_id from phase2_reservations
    union all select party_id from phase2_groups
    union all select session_id from phase2_sessions
    union all select payment_id from phase2_payments
  )
  select count(*), count(distinct id) into v_total, v_distinct from all_ids;

  if v_total <> v_distinct then
    raise exception 'Phase 2 generated a cross-entity UUID collision';
  end if;
end;
$$;

-- Materialize aggregate roots in deterministic identifier order. Explicit
-- identity values make reference/source/ledger identifiers reproducible too.
insert into public.recurrence_series (
  id, timezone, frequency, interval_count, day_of_week, starts_on,
  ends_on, occurrence_count, source, created_by, created_at, updated_at
)
select
  series.recurrence_series_id,
  'America/Toronto',
  'weekly',
  1,
  series.day_of_week,
  series.starts_on,
  null,
  series.week_count,
  'legacy_migration',
  null,
  series.created_at,
  series.updated_at
from phase2_recurrence_series as series
order by series.recurrence_series_id;

insert into public.reservations (
  id, reference_number, recurrence_series_id, recurrence_sequence,
  currency, notes, payment_plan, source, created_by, created_at, updated_at
)
overriding system value
select
  reservation.reservation_id,
  999 + row_number() over (order by reservation.reservation_id),
  reservation.recurrence_series_id,
  reservation.recurrence_sequence,
  reservation.currency,
  null,
  'legacy_unspecified',
  'legacy_migration',
  null,
  reservation.created_at,
  reservation.updated_at
from phase2_reservations as reservation
order by reservation.reservation_id;

select setval(
  'public.reservations_reference_number_seq'::regclass,
  (select max(reference_number) from public.reservations),
  true
);

create temporary table phase2_legacy_sources on commit drop as
with sources as (
  select
    groups.reservation_id,
    'booking_group'::text as source_type,
    groups.booking_group_id as source_id,
    groups.first_created_at as created_at
  from phase2_groups as groups
  union all
  select
    groups.reservation_id,
    'booking_link',
    groups.booking_link_id,
    min(groups.first_created_at)
  from phase2_groups as groups
  where groups.booking_link_id is not null
  group by groups.reservation_id, groups.booking_link_id
)
select
  row_number() over (order by source_type, source_id)::bigint as source_row_id,
  sources.*
from sources;

insert into public.reservation_legacy_sources (
  id, reservation_id, source_type, source_id, created_by, created_at
)
overriding system value
select
  source.source_row_id,
  source.reservation_id,
  source.source_type,
  source.source_id,
  null,
  source.created_at
from phase2_legacy_sources as source
order by source.source_row_id;

select setval(
  'public.reservation_legacy_sources_id_seq'::regclass,
  (select max(id) from public.reservation_legacy_sources),
  true
);

insert into public.reservation_parties (
  id, reservation_id, party_type, display_name, email, phone,
  auth_user_id, source, legacy_booking_group_id, created_by,
  created_at, updated_at
)
select
  groups.party_id,
  groups.reservation_id,
  'person',
  groups.customer_name,
  groups.customer_email,
  groups.customer_phone,
  groups.auth_user_id,
  'legacy_booking_group',
  groups.booking_group_id,
  null,
  groups.first_created_at,
  groups.last_updated_at
from phase2_groups as groups
order by groups.party_id;

insert into public.reservation_party_roles (
  reservation_id, party_id, role, created_by, created_at
)
select
  groups.reservation_id,
  groups.party_id,
  'original_booker',
  null,
  groups.first_created_at
from phase2_groups as groups
order by groups.reservation_id, groups.party_id;

with ranked as (
  select
    groups.*,
    row_number() over (
      partition by groups.reservation_id
      order by groups.has_active_booking desc,
               groups.first_created_at,
               groups.booking_group_id
    ) as contact_rank
  from phase2_groups as groups
)
insert into public.reservation_party_roles (
  reservation_id, party_id, role, created_by, created_at
)
select
  ranked.reservation_id,
  ranked.party_id,
  'primary_contact',
  null,
  ranked.first_created_at
from ranked
where ranked.contact_rank = 1
order by ranked.reservation_id;

insert into public.reservation_sessions (
  id, reservation_id, starts_at, ends_at, party_size, notes,
  source, created_by, created_at, updated_at
)
select
  session.session_id,
  session.reservation_id,
  session.starts_at,
  session.ends_at,
  session.party_size,
  session.notes,
  'legacy_migration',
  null,
  session.created_at,
  session.updated_at
from phase2_sessions as session
order by session.session_id;

insert into public.payments (
  id, reservation_id, payer_party_id, kind, amount, currency,
  method, status, provider, provider_reference, idempotency_key,
  reverses_payment_id, source, notes, occurred_at, recorded_by
)
select
  payment.payment_id,
  payment.reservation_id,
  null,
  'payment',
  payment.amount,
  payment.currency,
  'legacy_unknown',
  'succeeded',
  null,
  null,
  payment.idempotency_key,
  null,
  'legacy_reconciliation',
  null,
  payment.occurred_at,
  null
from phase2_payments as payment
order by payment.payment_id;

-- Only ownership columns change. Generic updated_at and public slot projection
-- triggers are transactionally paused so legacy operational timestamps and the
-- entire court_slots table remain byte-for-byte stable. The Phase 1 ownership
-- projection trigger and append-only audit trigger remain active.
alter table public.bookings disable trigger bookings_set_updated_at;
alter table public.bookings disable trigger bookings_sync_public_slot;

do $$
begin
  perform booking.id
  from public.bookings as booking
  order by booking.id
  for update;
end;
$$;

select set_config(
  'app.audit_operation_id',
  'reservation_phase_2:20260824015013',
  true
);
select set_config(
  'app.audit_event_type',
  'booking.reservation_backfilled',
  true
);
select set_config(
  'app.audit_source',
  'reservation_phase_2_migration',
  true
);

update public.bookings as booking
set
  reservation_id = mapping.reservation_id,
  session_id = mapping.session_id
from phase2_booking_map as mapping
where mapping.booking_id = booking.id;

alter table public.bookings enable trigger bookings_sync_public_slot;
alter table public.bookings enable trigger bookings_set_updated_at;

insert into public.payment_allocation_entries (
  id, reservation_id, payment_id, booking_id, entry_kind, amount,
  reverses_entry_id, idempotency_key, created_by
)
overriding system value
select
  allocation.allocation_id,
  allocation.reservation_id,
  allocation.payment_id,
  allocation.booking_id,
  'allocation',
  allocation.amount,
  null,
  allocation.idempotency_key,
  null
from phase2_payment_allocations as allocation
order by allocation.allocation_id;

select setval(
  'public.payment_allocation_entries_id_seq'::regclass,
  (select max(id) from public.payment_allocation_entries),
  true
);

alter table public.reservations
  validate constraint reservations_payment_plan_check;

-- Final fail-closed assertions: exact coverage, truthful payment totals,
-- deterministic contacts/recurrence, and zero changes outside ownership/audit.
do $$
declare
  v_count bigint;
  v_amount numeric;
  v_fingerprint text;
begin
  select count(*) into v_count from public.recurrence_series;
  if v_count <> 2 then raise exception 'Expected 2 recurrence series, found %', v_count; end if;
  select count(*) into v_count from public.reservations;
  if v_count <> 123 then raise exception 'Expected 123 Reservations, found %', v_count; end if;
  select count(*) into v_count from public.reservation_legacy_sources;
  if v_count <> 136 then raise exception 'Expected 136 legacy sources, found %', v_count; end if;
  select count(*) into v_count from public.reservation_parties;
  if v_count <> 131 then raise exception 'Expected 131 Parties, found %', v_count; end if;
  select count(*) into v_count from public.reservation_sessions;
  if v_count <> 135 then raise exception 'Expected 135 Sessions, found %', v_count; end if;
  select count(*) into v_count from public.reservation_payment_shares;
  if v_count <> 0 then raise exception 'Legacy payment intent must remain unspecified'; end if;
  select count(*) into v_count from public.payments;
  if v_count <> 23 then raise exception 'Expected 23 Payments, found %', v_count; end if;
  select count(*) into v_count from public.payment_allocation_entries;
  if v_count <> 26 then raise exception 'Expected 26 allocations, found %', v_count; end if;

  select count(*) into v_count
  from public.bookings
  where reservation_id is null or session_id is null;
  if v_count <> 0 then
    raise exception 'Phase 2 left % bookings without Reservation ownership', v_count;
  end if;

  select count(*) into v_count
  from public.bookings as booking
  join phase2_booking_map as mapping on mapping.booking_id = booking.id
  where booking.reservation_id is distinct from mapping.reservation_id
     or booking.session_id is distinct from mapping.session_id;
  if v_count <> 0 then
    raise exception 'Phase 2 produced % incorrect booking ownership mappings', v_count;
  end if;

  select count(*) into v_count
  from (
    select reservation.id
    from public.reservations as reservation
    left join public.reservation_party_roles as role
      on role.reservation_id = reservation.id and role.role = 'primary_contact'
    group by reservation.id
    having count(role.party_id) <> 1
  ) as invalid_reservation;
  if v_count <> 0 then
    raise exception 'Phase 2 produced a Reservation without exactly one primary contact';
  end if;

  select count(*) into v_count
  from public.reservation_party_roles
  where role = 'original_booker';
  if v_count <> 131 then
    raise exception 'Expected 131 original-booker roles, found %', v_count;
  end if;

  select count(*) into v_count
  from public.reservation_party_roles
  where role in ('payer', 'participant');
  if v_count <> 0 then
    raise exception 'Phase 2 inferred an unsupported payer/participant role';
  end if;

  select count(*) into v_count
  from public.payments
  where payer_party_id is not null
     or provider is not null
     or provider_reference is not null
     or method <> 'legacy_unknown'
     or source <> 'legacy_reconciliation'
     or status <> 'succeeded';
  if v_count <> 0 then
    raise exception 'Phase 2 invented unsupported legacy payment facts';
  end if;

  select count(*) into v_count
  from public.payments
  where (left(idempotency_key, length('legacy_reconciliation:audit:'))
          = 'legacy_reconciliation:audit:'
      and occurred_at is null)
     or (left(idempotency_key, length('legacy_reconciliation:booking:'))
          = 'legacy_reconciliation:booking:'
      and occurred_at is not null);
  if v_count <> 0 then
    raise exception 'Phase 2 payment occurrence-time truth is inconsistent';
  end if;

  select round(sum(amount), 2) into v_amount
  from public.payments where status = 'succeeded';
  if v_amount <> 1642.00 then
    raise exception 'Expected CAD 1642.00 successful Payments, found %', v_amount;
  end if;

  select round(sum(amount), 2) into v_amount
  from public.payment_allocation_entries;
  if v_amount <> 1642.00 then
    raise exception 'Expected CAD 1642.00 allocated, found %', v_amount;
  end if;

  select count(*) into v_count
  from (
    select booking.id
    from public.bookings as booking
    left join public.payment_allocation_entries as allocation
      on allocation.booking_id = booking.id
    group by booking.id, booking.payment_status
    having (booking.payment_status = 'paid' and count(allocation.id) <> 1)
        or (booking.payment_status <> 'paid' and count(allocation.id) <> 0)
  ) as invalid_booking;
  if v_count <> 0 then
    raise exception 'Phase 2 payment allocations do not match legacy paid flags';
  end if;

  select count(*) into v_count
  from public.payments as payment
  left join (
    select payment_id, round(sum(amount), 2) as allocated
    from public.payment_allocation_entries
    group by payment_id
  ) as allocation on allocation.payment_id = payment.id
  where payment.amount is distinct from allocation.allocated;
  if v_count <> 0 then
    raise exception 'Phase 2 left % Payments under/over allocated', v_count;
  end if;

  select md5(coalesce(string_agg(
    (to_jsonb(booking) - 'reservation_id' - 'session_id')::text,
    '' order by booking.id
  ), '')) into v_fingerprint
  from public.bookings as booking;
  if v_fingerprint <> 'd27b6924d560d7fc1bf2f54ce3f38688' then
    raise exception 'A legacy booking field changed during Phase 2';
  end if;

  select md5(coalesce(string_agg(to_jsonb(slot)::text, '' order by slot.id), ''))
    into v_fingerprint
  from public.court_slots as slot;
  if v_fingerprint <> '2617c5b347e5f516bae80cbb4bd92ccc' then
    raise exception 'court_slots changed during Phase 2';
  end if;

  select md5(coalesce(string_agg(to_jsonb(event)::text, '' order by event.id), ''))
    into v_fingerprint
  from private.app_audit_events as event
  where event.event_type = 'booking.payment_updated';
  if v_fingerprint <> '80cbd801fce56b51b9d0e51c68a60e2c' then
    raise exception 'Payment audit evidence changed during Phase 2';
  end if;

  select count(*) into v_count
  from private.app_audit_events as event
  where event.operation_id = 'reservation_phase_2:20260824015013'
    and event.event_type = 'booking.reservation_backfilled'
    and event.entity_type = 'booking'
    and event.actor_kind = 'system'
    and event.source = 'reservation_phase_2_migration'
    and event.changed_fields = array['reservation_id', 'session_id']::text[];
  if v_count <> 192 then
    raise exception 'Expected 192 explicit ownership audit events, found %', v_count;
  end if;

  select count(*) into v_count
  from pg_publication_tables
  where pubname = 'supabase_realtime'
    and schemaname = 'public'
    and tablename in (
      'recurrence_series', 'reservations', 'reservation_legacy_sources',
      'reservation_parties', 'reservation_party_roles',
      'reservation_sessions', 'reservation_payment_shares', 'payments',
      'payment_allocation_entries'
    );
  if v_count <> 0 then
    raise exception 'Phase 2 unexpectedly changed Realtime publication';
  end if;
end;
$$;

commit;
