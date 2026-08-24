-- Tiger Reservation migration Phase 2 production/isolated verification.
--
-- Run only after 20260824015013_reservation_deterministic_backfill.sql.
-- This script is read-only, emits aggregate results only, and raises on any
-- mapping, accounting, compatibility, privilege, or provenance mismatch.

begin transaction read only;
set local statement_timeout = '20s';
set local lock_timeout = '2s';
set local timezone = 'UTC';

do $$
declare
  v_count bigint;
  v_amount numeric;
  v_fingerprint text;
begin
  select count(*) into v_count from public.bookings;
  if v_count <> 192 then raise exception 'Expected 192 bookings, found %', v_count; end if;
  select count(*) into v_count from public.recurrence_series;
  if v_count <> 2 then raise exception 'Expected 2 recurrence series, found %', v_count; end if;
  select count(*) into v_count from public.reservations;
  if v_count <> 123 then raise exception 'Expected 123 Reservations, found %', v_count; end if;
  select count(*) into v_count from public.reservation_legacy_sources;
  if v_count <> 136 then raise exception 'Expected 136 legacy sources, found %', v_count; end if;
  select count(*) into v_count from public.reservation_parties;
  if v_count <> 131 then raise exception 'Expected 131 Parties, found %', v_count; end if;
  select count(*) into v_count from public.reservation_party_roles;
  if v_count <> 254 then raise exception 'Expected 254 Party roles, found %', v_count; end if;
  select count(*) into v_count from public.reservation_sessions;
  if v_count <> 135 then raise exception 'Expected 135 Sessions, found %', v_count; end if;
  select count(*) into v_count from public.reservation_payment_shares;
  if v_count <> 0 then raise exception 'Legacy payment intent was inferred'; end if;
  select count(*) into v_count from public.payments;
  if v_count <> 23 then raise exception 'Expected 23 Payments, found %', v_count; end if;
  select count(*) into v_count from public.payment_allocation_entries;
  if v_count <> 26 then raise exception 'Expected 26 allocations, found %', v_count; end if;

  select count(*) into v_count
  from public.bookings
  where reservation_id is null or session_id is null;
  if v_count <> 0 then raise exception '% bookings are not owned', v_count; end if;

  select count(*) into v_count
  from public.bookings as booking
  join public.reservation_sessions as session
    on session.id = booking.session_id
   and session.reservation_id = booking.reservation_id
  where timezone('America/Toronto', session.starts_at) is distinct from booking.start_at
     or timezone('America/Toronto', session.ends_at) is distinct from booking.end_at;
  if v_count <> 0 then raise exception '% Session projections differ', v_count; end if;

  select count(*) into v_count
  from public.reservations
  where payment_plan <> 'legacy_unspecified'
     or source <> 'legacy_migration';
  if v_count <> 0 then raise exception '% legacy Reservations have inferred intent/source', v_count; end if;

  select count(*) into v_count
  from (
    select reservation.id
    from public.reservations as reservation
    left join public.reservation_sessions as session
      on session.reservation_id = reservation.id
    left join public.reservation_parties as party
      on party.reservation_id = reservation.id
    group by reservation.id
    having count(distinct session.id) = 0 or count(distinct party.id) = 0
  ) as orphan;
  if v_count <> 0 then raise exception '% Reservations lack a Session or Party', v_count; end if;

  select count(*) into v_count
  from (
    select reservation.id
    from public.reservations as reservation
    left join public.reservation_party_roles as role
      on role.reservation_id = reservation.id and role.role = 'primary_contact'
    group by reservation.id
    having count(role.party_id) <> 1
  ) as invalid_contact;
  if v_count <> 0 then raise exception '% Reservations lack one primary contact', v_count; end if;

  select count(*) into v_count
  from public.reservation_party_roles where role = 'original_booker';
  if v_count <> 131 then raise exception 'Expected 131 original bookers, found %', v_count; end if;
  select count(*) into v_count
  from public.reservation_party_roles where role in ('payer', 'participant');
  if v_count <> 0 then raise exception 'Unsupported payer/participant roles were inferred'; end if;

  select count(*) into v_count
  from public.reservation_legacy_sources where source_type = 'booking_group';
  if v_count <> 131 then raise exception 'Expected 131 booking-group sources, found %', v_count; end if;
  select count(*) into v_count
  from public.reservation_legacy_sources where source_type = 'booking_link';
  if v_count <> 5 then raise exception 'Expected 5 booking-link sources, found %', v_count; end if;

  select count(*) into v_count
  from public.reservations
  where (recurrence_series_id is null) <> (recurrence_sequence is null);
  if v_count <> 0 then raise exception '% incomplete recurrence links', v_count; end if;
  select count(*) into v_count
  from public.reservations
  where recurrence_series_id is not null;
  if v_count <> 6 then raise exception 'Expected 6 recurring Reservations, found %', v_count; end if;

  select count(*) into v_count
  from public.payments
  where kind <> 'payment'
     or status <> 'succeeded'
     or source <> 'legacy_reconciliation'
     or method <> 'legacy_unknown'
     or payer_party_id is not null
     or provider is not null
     or provider_reference is not null
     or reverses_payment_id is not null;
  if v_count <> 0 then raise exception '% Payments contain invented legacy facts', v_count; end if;

  select count(*) into v_count
  from public.payments
  where left(idempotency_key, length('legacy_reconciliation:audit:'))
          = 'legacy_reconciliation:audit:'
    and occurred_at is not null;
  if v_count <> 2 then raise exception 'Expected 2 timed audited Payments, found %', v_count; end if;
  select count(*) into v_count
  from public.payments
  where left(idempotency_key, length('legacy_reconciliation:booking:'))
          = 'legacy_reconciliation:booking:'
    and occurred_at is null;
  if v_count <> 21 then raise exception 'Expected 21 unknown-time Payments, found %', v_count; end if;

  select round(sum(amount), 2) into v_amount from public.payments;
  if v_amount <> 1642.00 then raise exception 'Expected CAD 1642.00 Payments, found %', v_amount; end if;
  select round(sum(amount), 2) into v_amount from public.payment_allocation_entries;
  if v_amount <> 1642.00 then raise exception 'Expected CAD 1642.00 allocations, found %', v_amount; end if;

  select count(*) into v_count
  from (
    select booking.id
    from public.bookings as booking
    left join public.payment_allocation_entries as allocation
      on allocation.booking_id = booking.id
    group by booking.id, booking.payment_status
    having (booking.payment_status = 'paid' and count(allocation.id) <> 1)
        or (booking.payment_status <> 'paid' and count(allocation.id) <> 0)
  ) as mismatch;
  if v_count <> 0 then raise exception '% booking payment flags mismatch ledger', v_count; end if;

  select count(*) into v_count
  from public.payments as payment
  left join (
    select payment_id, round(sum(amount), 2) as allocated
    from public.payment_allocation_entries
    group by payment_id
  ) as allocation on allocation.payment_id = payment.id
  where payment.amount is distinct from allocation.allocated;
  if v_count <> 0 then raise exception '% Payments are under/over allocated', v_count; end if;

  select md5(coalesce(string_agg(
    (to_jsonb(booking) - 'reservation_id' - 'session_id')::text,
    '' order by booking.id
  ), '')) into v_fingerprint
  from public.bookings as booking;
  if v_fingerprint <> 'd27b6924d560d7fc1bf2f54ce3f38688' then
    raise exception 'Legacy booking payload changed';
  end if;

  select md5(coalesce(string_agg(to_jsonb(slot)::text, '' order by slot.id), ''))
    into v_fingerprint
  from public.court_slots as slot;
  if v_fingerprint <> '2617c5b347e5f516bae80cbb4bd92ccc' then
    raise exception 'court_slots changed';
  end if;

  select md5(coalesce(string_agg(to_jsonb(event)::text, '' order by event.id), ''))
    into v_fingerprint
  from private.app_audit_events as event
  where event.event_type = 'booking.payment_updated';
  if v_fingerprint <> '80cbd801fce56b51b9d0e51c68a60e2c' then
    raise exception 'Payment audit evidence changed';
  end if;

  select count(*) into v_count
  from private.app_audit_events as event
  where event.operation_id = 'reservation_phase_2:20260824015013'
    and event.event_type = 'booking.reservation_backfilled'
    and event.actor_kind = 'system'
    and event.source = 'reservation_phase_2_migration'
    and event.changed_fields = array['reservation_id', 'session_id']::text[];
  if v_count <> 192 then raise exception 'Expected 192 ownership audit events, found %', v_count; end if;
end;
$$;

-- Independently derive every Reservation, Party, and Session UUID from legacy
-- source keys and compare it with the materialized mapping.
do $$
declare
  v_count bigint;
  v_reservation_namespace uuid := extensions.uuid_generate_v5(
    '6ba7b811-9dad-11d1-80b4-00c04fd430c8'::uuid,
    'https://tiger-badminton.example/reservation-migration/reservation/v1'
  );
  v_party_namespace uuid := extensions.uuid_generate_v5(
    '6ba7b811-9dad-11d1-80b4-00c04fd430c8'::uuid,
    'https://tiger-badminton.example/reservation-migration/party/v1'
  );
  v_session_namespace uuid := extensions.uuid_generate_v5(
    '6ba7b811-9dad-11d1-80b4-00c04fd430c8'::uuid,
    'https://tiger-badminton.example/reservation-migration/session/v1'
  );
begin
  with groups as (
    select
      booking_group_id,
      (array_agg(booking_link_id order by booking_link_id)
        filter (where booking_link_id is not null))[1] as booking_link_id
    from public.bookings
    group by booking_group_id
  ), expected as (
    select
      booking_group_id,
      extensions.uuid_generate_v5(
        v_reservation_namespace,
        case when booking_link_id is null
          then 'group:' || booking_group_id::text
          else 'link:' || booking_link_id::text
        end
      ) as reservation_id,
      extensions.uuid_generate_v5(
        v_party_namespace,
        'booking-group:' || booking_group_id::text
      ) as party_id
    from groups
  )
  select count(*) into v_count
  from expected
  left join public.reservation_legacy_sources as source
    on source.source_type = 'booking_group'
   and source.source_id = expected.booking_group_id
  left join public.reservation_parties as party
    on party.legacy_booking_group_id = expected.booking_group_id
  where source.reservation_id is distinct from expected.reservation_id
     or party.id is distinct from expected.party_id
     or party.reservation_id is distinct from expected.reservation_id;
  if v_count <> 0 then raise exception '% deterministic Reservation/Party IDs differ', v_count; end if;

  with expected as (
    select
      booking.id,
      extensions.uuid_generate_v5(
        v_session_namespace,
        'booking-group:' || booking.booking_group_id::text
          || '|start:' || to_char(booking.start_at, 'YYYY-MM-DD"T"HH24:MI:SS.US')
          || '|end:' || to_char(booking.end_at, 'YYYY-MM-DD"T"HH24:MI:SS.US')
      ) as session_id
    from public.bookings as booking
  )
  select count(*) into v_count
  from expected
  join public.bookings as booking on booking.id = expected.id
  where booking.session_id is distinct from expected.session_id;
  if v_count <> 0 then raise exception '% deterministic Session IDs differ', v_count; end if;
end;
$$;

-- Re-derive the selected audit-backed and unaudited payment IDs independently.
do $$
declare
  v_count bigint;
  v_payment_namespace uuid := extensions.uuid_generate_v5(
    '6ba7b811-9dad-11d1-80b4-00c04fd430c8'::uuid,
    'https://tiger-badminton.example/reservation-migration/payment/v1'
  );
begin
  with ranked as (
    select
      event.operation_id,
      event.entity_id::uuid as booking_id,
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
  ), selected as (
    select * from ranked where payment_rank = 1
  ), expected_audited as (
    select distinct
      selected.operation_id,
      booking.reservation_id,
      extensions.uuid_generate_v5(
        v_payment_namespace,
        'audit:' || selected.operation_id
          || ':reservation:' || booking.reservation_id::text
      ) as payment_id
    from selected
    join public.bookings as booking on booking.id = selected.booking_id
  ), expected_unaudited as (
    select
      booking.id as booking_id,
      extensions.uuid_generate_v5(
        v_payment_namespace,
        'booking:' || booking.id::text
      ) as payment_id
    from public.bookings as booking
    where booking.payment_status = 'paid'
      and not exists (
        select 1 from selected where selected.booking_id = booking.id
      )
  ), mismatch as (
    select expected_audited.payment_id
    from expected_audited
    left join public.payments as payment on payment.id = expected_audited.payment_id
    where payment.id is null
    union all
    select expected_unaudited.payment_id
    from expected_unaudited
    left join public.payments as payment on payment.id = expected_unaudited.payment_id
    where payment.id is null
  )
  select count(*) into v_count from mismatch;
  if v_count <> 0 then raise exception '% deterministic Payment IDs differ', v_count; end if;
end;
$$;

-- Phase 1 API security remains unchanged: manager-only read, no client DML,
-- no direct sequence use, and no new Realtime exposure.
do $$
declare
  v_count bigint;
  v_names text[] := array[
    'payment_allocation_entries', 'payments', 'recurrence_series',
    'reservation_legacy_sources', 'reservation_parties',
    'reservation_party_roles', 'reservation_payment_shares',
    'reservation_sessions', 'reservations'
  ];
begin
  select count(*) into v_count
  from pg_class as relation
  join pg_namespace as namespace on namespace.oid = relation.relnamespace
  where namespace.nspname = 'public'
    and relation.relname = any(v_names)
    and relation.relkind = 'r'
    and relation.relrowsecurity
    and relation.relforcerowsecurity;
  if v_count <> 9 then raise exception 'Expected RLS + FORCE RLS on 9 Reservation tables'; end if;

  select count(*) into v_count
  from information_schema.role_table_grants
  where table_schema = 'public'
    and table_name = any(v_names)
    and grantee in ('anon', 'service_role');
  if v_count <> 0 then raise exception 'Unexpected anon/service_role grants'; end if;

  select count(*) into v_count
  from information_schema.role_table_grants
  where table_schema = 'public'
    and table_name = any(v_names)
    and grantee = 'authenticated'
    and privilege_type <> 'SELECT';
  if v_count <> 0 then raise exception 'Unexpected authenticated DML grants'; end if;

  select count(*) into v_count
  from information_schema.role_table_grants
  where table_schema = 'public'
    and table_name = any(v_names)
    and grantee = 'authenticated'
    and privilege_type = 'SELECT';
  if v_count <> 9 then raise exception 'Expected authenticated SELECT on 9 Reservation tables'; end if;

  select count(*) into v_count
  from (values
    ('public.reservations_reference_number_seq'),
    ('public.reservation_legacy_sources_id_seq'),
    ('public.payment_allocation_entries_id_seq')
  ) as sequence_name(name)
  cross join (values ('anon'), ('authenticated'), ('service_role')) as client_role(name)
  where has_sequence_privilege(client_role.name, sequence_name.name, 'USAGE')
     or has_sequence_privilege(client_role.name, sequence_name.name, 'SELECT')
     or has_sequence_privilege(client_role.name, sequence_name.name, 'UPDATE');
  if v_count <> 0 then raise exception 'Unexpected direct client sequence privileges'; end if;

  select count(*) into v_count
  from pg_publication_tables
  where pubname = 'supabase_realtime'
    and schemaname = 'public'
    and tablename = any(v_names);
  if v_count <> 0 then raise exception 'Unexpected Reservation Realtime tables'; end if;
end;
$$;

select
  statement_timestamp() as verified_at,
  'phase_2_reservation_backfill_verified' as result,
  (select count(*) from public.reservations) as reservations,
  (select count(*) from public.reservation_sessions) as sessions,
  (select count(*) from public.bookings) as court_allocations,
  (select count(*) from public.reservation_parties) as party_snapshots,
  (select count(*) from public.payments) as reconciliation_payments,
  (select count(*) from public.payment_allocation_entries) as payment_allocations,
  (select round(sum(amount), 2) from public.payments) as reconciled_amount;

rollback;
