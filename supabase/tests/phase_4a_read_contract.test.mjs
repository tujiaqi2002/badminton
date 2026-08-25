import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { PGlite } from '@electric-sql/pglite'

const migrationPath = new URL(
  '../migrations/20260825091608_reservation_phase_4a_manager_read_contract.sql',
  import.meta.url,
)
const diagnosticPath = new URL(
  '../diagnostics/phase_4a_manager_read_contract.sql',
  import.meta.url,
)

const ids = Object.freeze({
  manager: '00000000-0000-4000-8000-000000000001',
  nonManager: '00000000-0000-4000-8000-000000000002',
  courtOne: '10000000-0000-4000-8000-000000000001',
  courtTwo: '10000000-0000-4000-8000-000000000002',
  reservationPaid: '20000000-0000-4000-8000-000000000001',
  reservationFree: '20000000-0000-4000-8000-000000000002',
  reservationOriginA: '20000000-0000-4000-8000-000000000003',
  reservationOriginB: '20000000-0000-4000-8000-000000000004',
  reservationMerged: '20000000-0000-4000-8000-000000000005',
  sessionPaid: '30000000-0000-4000-8000-000000000001',
  sessionFree: '30000000-0000-4000-8000-000000000002',
  sessionOriginA: '30000000-0000-4000-8000-000000000003',
  sessionOriginB: '30000000-0000-4000-8000-000000000004',
  sessionMerged: '30000000-0000-4000-8000-000000000005',
  allocationPaidA: '40000000-0000-4000-8000-000000000001',
  allocationPaidB: '40000000-0000-4000-8000-000000000002',
  allocationFree: '40000000-0000-4000-8000-000000000003',
  allocationOriginA: '40000000-0000-4000-8000-000000000004',
  allocationOriginB: '40000000-0000-4000-8000-000000000005',
  partyPaid: '50000000-0000-4000-8000-000000000001',
  partyFree: '50000000-0000-4000-8000-000000000002',
  partyMerged: '50000000-0000-4000-8000-000000000003',
  paymentPaid: '60000000-0000-4000-8000-000000000001',
  paymentPartial: '60000000-0000-4000-8000-000000000002',
  transitionMerge: '70000000-0000-4000-8000-000000000001',
})

function quote(value) {
  return `'${value}'`
}

function baseSchemaSql() {
  return `
    create schema auth;
    create schema private;
    create schema supabase_migrations;

    create role anon nologin;
    create role authenticated nologin;
    create role service_role nologin;

    create function auth.uid()
    returns uuid
    language sql
    stable
    set search_path = ''
    as $$
      select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
    $$;

    grant usage on schema auth to anon, authenticated, service_role;
    grant execute on function auth.uid() to anon, authenticated, service_role;

    create table supabase_migrations.schema_migrations (
      version text primary key,
      name text not null
    );

    insert into supabase_migrations.schema_migrations (version, name)
    select pg_catalog.lpad(value::text, 14, '0'), 'synthetic_baseline'
    from generate_series(1, 46) as value;
    insert into supabase_migrations.schema_migrations (version, name)
    values ('20260825074102', 'phase_3b_zero_price_activation_assertion');

    create table public.staff_members (
      user_id uuid primary key,
      role text not null
    );

    create table public.courts (
      id uuid primary key,
      name_zh text not null,
      name_en text not null,
      description text,
      sort_order smallint not null,
      status text not null default 'active',
      created_at timestamptz not null default statement_timestamp()
    );

    create table public.venue_settings (
      singleton boolean primary key default true,
      timezone text not null,
      currency character(3) not null
    );

    create table public.recurrence_series (
      id uuid primary key,
      timezone text not null,
      frequency text not null,
      interval_count smallint not null,
      day_of_week smallint,
      starts_on date not null,
      ends_on date,
      occurrence_count integer,
      source text not null,
      created_by uuid,
      created_at timestamptz not null,
      updated_at timestamptz not null
    );

    create table public.reservations (
      id uuid primary key,
      reference_number bigint not null unique,
      recurrence_series_id uuid,
      recurrence_sequence integer,
      currency character(3) not null,
      notes text,
      payment_plan text not null,
      source text not null,
      created_by uuid,
      created_at timestamptz not null,
      updated_at timestamptz not null
    );

    create table public.reservation_sessions (
      id uuid primary key,
      reservation_id uuid not null,
      starts_at timestamptz not null,
      ends_at timestamptz not null,
      party_size smallint not null,
      notes text,
      source text not null,
      created_by uuid,
      created_at timestamptz not null,
      updated_at timestamptz not null
    );
    create unique index reservation_sessions_id_reservation_key
      on public.reservation_sessions (id, reservation_id);
    create index reservation_sessions_reservation_start_idx
      on public.reservation_sessions (reservation_id, starts_at, id);

    create table public.bookings (
      id uuid primary key,
      user_id uuid not null,
      court_id uuid not null,
      customer_name text not null,
      customer_email text,
      start_at timestamp not null,
      end_at timestamp not null,
      status text not null,
      payment_status text not null,
      payment_method text not null,
      total_amount numeric(12,2) not null,
      currency character(3) not null,
      party_size smallint not null,
      created_at timestamptz not null,
      updated_at timestamptz not null,
      customer_phone text,
      customer_notes text,
      booking_group_id uuid not null,
      recurrence_series_id uuid,
      recurrence_week smallint,
      system_calculated_amount numeric(12,2) not null,
      price_source text not null,
      price_override_amount numeric(12,2),
      price_overridden_by uuid,
      price_overridden_at timestamptz,
      booking_link_id uuid,
      reservation_id uuid,
      session_id uuid
    );

    create table public.reservation_parties (
      id uuid primary key,
      reservation_id uuid not null,
      party_type text not null,
      display_name text not null,
      email text,
      phone text,
      auth_user_id uuid,
      source text not null,
      legacy_booking_group_id uuid,
      created_by uuid,
      created_at timestamptz not null,
      updated_at timestamptz not null
    );

    create table public.reservation_party_roles (
      reservation_id uuid not null,
      party_id uuid not null,
      role text not null,
      created_by uuid,
      created_at timestamptz not null,
      primary key (reservation_id, party_id, role)
    );

    create table public.reservation_payment_shares (
      id uuid primary key,
      reservation_id uuid not null,
      party_id uuid not null,
      share_type text not null,
      target_amount numeric(12,2),
      target_percentage numeric(7,4),
      created_by uuid,
      created_at timestamptz not null,
      updated_at timestamptz not null
    );

    create table public.payments (
      id uuid primary key,
      reservation_id uuid not null,
      payer_party_id uuid,
      kind text not null,
      amount numeric(12,2) not null,
      currency character(3) not null,
      method text not null,
      status text not null,
      provider text,
      provider_reference text,
      idempotency_key text not null,
      reverses_payment_id uuid,
      source text not null,
      notes text,
      occurred_at timestamptz,
      recorded_by uuid,
      created_at timestamptz not null,
      updated_at timestamptz not null
    );

    create table public.payment_allocation_entries (
      id bigint generated always as identity primary key,
      reservation_id uuid not null,
      payment_id uuid not null,
      booking_id uuid not null,
      entry_kind text not null,
      amount numeric(12,2) not null,
      reverses_entry_id bigint,
      idempotency_key text not null,
      created_by uuid,
      created_at timestamptz not null
    );
    create index payment_allocation_entries_booking_idx
      on public.payment_allocation_entries (booking_id, reservation_id, id);

    create table public.reservation_legacy_sources (
      id bigint generated always as identity primary key,
      reservation_id uuid not null,
      source_type text not null,
      source_id uuid not null,
      created_by uuid,
      created_at timestamptz not null
    );

    create table public.reservation_transitions (
      id uuid primary key,
      sequence bigint not null,
      operation_id text not null,
      transition_type text not null,
      reverses_transition_id uuid,
      actor_id uuid,
      created_at timestamptz not null
    );

    create table public.reservation_transition_sources (
      transition_id uuid not null,
      reservation_id uuid not null,
      created_at timestamptz not null,
      primary key (transition_id, reservation_id)
    );

    create table public.reservation_transition_targets (
      transition_id uuid not null,
      reservation_id uuid not null,
      primary_party_id uuid not null,
      created_at timestamptz not null,
      primary key (transition_id, reservation_id)
    );

    create table public.reservation_transition_allocations (
      transition_id uuid not null,
      booking_id uuid not null,
      from_reservation_id uuid not null,
      from_session_id uuid not null,
      to_reservation_id uuid not null,
      to_session_id uuid not null,
      legacy_link_before uuid,
      legacy_link_after uuid,
      created_at timestamptz not null,
      primary key (transition_id, booking_id)
    );

    create table public.reservation_session_assignments (
      id uuid primary key,
      operation_id text not null,
      booking_id uuid not null,
      origin_reservation_id uuid not null,
      effective_reservation_id uuid not null,
      from_projection_session_id uuid not null,
      to_projection_session_id uuid not null,
      from_effective_session_id uuid not null,
      to_effective_session_id uuid not null,
      actor_id uuid,
      created_at timestamptz not null
    );

    create table public.reservation_allocation_memberships (
      booking_id uuid primary key,
      origin_reservation_id uuid not null,
      effective_reservation_id uuid not null,
      effective_session_id uuid not null,
      last_transition_id uuid,
      version integer not null,
      created_at timestamptz not null,
      updated_at timestamptz not null,
      last_session_assignment_id uuid
    );
    create index reservation_allocation_memberships_effective_idx
      on public.reservation_allocation_memberships
      (effective_reservation_id, effective_session_id, booking_id);
    create index reservation_allocation_memberships_session_idx
      on public.reservation_allocation_memberships (effective_session_id, booking_id);

    insert into public.staff_members (user_id, role) values
      (${quote(ids.manager)}::uuid, 'admin'),
      (${quote(ids.nonManager)}::uuid, 'customer');

    insert into public.courts (id, name_zh, name_en, description, sort_order) values
      (${quote(ids.courtOne)}::uuid, '壹', 'Court 1', 'North', 1),
      (${quote(ids.courtTwo)}::uuid, '贰', 'Court 2', 'South', 2);

    insert into public.venue_settings (singleton, timezone, currency)
    values (true, 'America/Toronto', 'CAD');

    create function private.assert_reservation_phase3b_activation()
    returns jsonb
    language sql
    stable
    security invoker
    set search_path = ''
    as $$
      select jsonb_build_object(
        'status', 'clean',
        'booking_count', 5,
        'membership_count', 5,
        'shadow_mismatch_count', 0,
        'projection_mismatch_count', 0,
        'payment_mismatch_count', 0,
        'incomplete_operation_count', 0,
        'rls_force_table_count', 7,
        'realtime_tables', jsonb_build_array('public.court_slots'),
        'writer_inventory', jsonb_build_object(
          'status', 'activated',
          'public_entry_count', 17,
          'public_direct_booking_writer_count', 0,
          'private_legacy_writer_count', 17,
          'wrapper_count', 3
        )
      )
    $$;
  `
}

function fixtureSql() {
  const reservations = [
    [ids.reservationPaid, 1, 'legacy_unspecified', 'legacy_backfill', 'Paid multi-court'],
    [ids.reservationFree, 2, 'legacy_unspecified', 'legacy_backfill', 'Free court'],
    [ids.reservationOriginA, 3, 'legacy_unspecified', 'legacy_backfill', null],
    [ids.reservationOriginB, 4, 'legacy_unspecified', 'legacy_backfill', null],
    [ids.reservationMerged, 5, 'single_payer', 'manager_merge', 'Merged couple'],
  ].map(([id, reference, paymentPlan, source, notes]) => `(
    ${quote(id)}::uuid, ${reference}, 'CAD', ${notes ? quote(notes) : 'null'},
    ${quote(paymentPlan)}, ${quote(source)}, ${quote(ids.manager)}::uuid,
    '2026-08-25 12:00:00+00', '2026-08-25 12:00:00+00'
  )`).join(',\n')

  const sessions = [
    [ids.sessionPaid, ids.reservationPaid, '2026-09-01 14:00:00+00', '2026-09-01 15:00:00+00', 'Paid session'],
    [ids.sessionFree, ids.reservationFree, '2026-09-02 14:00:00+00', '2026-09-02 15:00:00+00', null],
    [ids.sessionOriginA, ids.reservationOriginA, '2026-09-03 14:00:00+00', '2026-09-03 15:00:00+00', null],
    [ids.sessionOriginB, ids.reservationOriginB, '2026-09-03 14:00:00+00', '2026-09-03 15:00:00+00', null],
    [ids.sessionMerged, ids.reservationMerged, '2026-09-03 14:00:00+00', '2026-09-03 15:00:00+00', 'Merged session'],
  ].map(([id, reservationId, startsAt, endsAt, notes]) => `(
    ${quote(id)}::uuid, ${quote(reservationId)}::uuid,
    ${quote(startsAt)}::timestamptz, ${quote(endsAt)}::timestamptz,
    2, ${notes ? quote(notes) : 'null'}, 'synthetic', ${quote(ids.manager)}::uuid,
    '2026-08-25 12:00:00+00', '2026-08-25 12:00:00+00'
  )`).join(',\n')

  const bookings = [
    [ids.allocationPaidA, ids.courtOne, ids.reservationPaid, ids.sessionPaid, 40, 'Paid customer', 'paid', '2026-09-01 10:00:00', '2026-09-01 11:00:00'],
    [ids.allocationPaidB, ids.courtTwo, ids.reservationPaid, ids.sessionPaid, 50, 'Paid customer', 'paid', '2026-09-01 10:00:00', '2026-09-01 11:00:00'],
    [ids.allocationFree, ids.courtOne, ids.reservationFree, ids.sessionFree, 0, 'Free customer', 'pay_at_venue', '2026-09-02 10:00:00', '2026-09-02 11:00:00'],
    [ids.allocationOriginA, ids.courtOne, ids.reservationOriginA, ids.sessionOriginA, 60, 'Husband source', 'pay_at_venue', '2026-09-03 10:00:00', '2026-09-03 11:00:00'],
    [ids.allocationOriginB, ids.courtTwo, ids.reservationOriginB, ids.sessionOriginB, 40, 'Wife source', 'pay_at_venue', '2026-09-03 10:00:00', '2026-09-03 11:00:00'],
  ].map(([
    id, courtId, reservationId, sessionId, amount, name, paymentStatus, startAt, endAt,
  ], index) => `(
    ${quote(id)}::uuid, ${quote(ids.manager)}::uuid, ${quote(courtId)}::uuid,
    ${quote(name)}, ${quote(`customer-${index}@example.invalid`)},
    ${quote(startAt)}::timestamp, ${quote(endAt)}::timestamp,
    'confirmed', ${quote(paymentStatus)}, 'venue', ${amount}, 'CAD', 2,
    '2026-08-25 12:00:00+00', '2026-08-25 12:00:00+00',
    '555000000${index}', ${index === 0 ? quote('Synthetic private note') : 'null'},
    ${quote(`80000000-0000-4000-8000-00000000000${index + 1}`)}::uuid,
    ${amount}, 'system', null, null, null, null,
    ${quote(reservationId)}::uuid, ${quote(sessionId)}::uuid
  )`).join(',\n')

  return `
    insert into public.reservations (
      id, reference_number, currency, notes, payment_plan, source, created_by,
      created_at, updated_at
    ) values ${reservations};

    insert into public.reservation_sessions (
      id, reservation_id, starts_at, ends_at, party_size, notes, source,
      created_by, created_at, updated_at
    ) values ${sessions};

    insert into public.bookings (
      id, user_id, court_id, customer_name, customer_email, start_at, end_at,
      status, payment_status, payment_method, total_amount, currency, party_size,
      created_at, updated_at, customer_phone, customer_notes, booking_group_id,
      system_calculated_amount, price_source, price_override_amount,
      price_overridden_by, price_overridden_at, booking_link_id,
      reservation_id, session_id
    ) values ${bookings};

    insert into public.reservation_allocation_memberships (
      booking_id, origin_reservation_id, effective_reservation_id,
      effective_session_id, last_transition_id, version, created_at, updated_at
    ) values
      (${quote(ids.allocationPaidA)}, ${quote(ids.reservationPaid)}, ${quote(ids.reservationPaid)}, ${quote(ids.sessionPaid)}, null, 1, now(), now()),
      (${quote(ids.allocationPaidB)}, ${quote(ids.reservationPaid)}, ${quote(ids.reservationPaid)}, ${quote(ids.sessionPaid)}, null, 1, now(), now()),
      (${quote(ids.allocationFree)}, ${quote(ids.reservationFree)}, ${quote(ids.reservationFree)}, ${quote(ids.sessionFree)}, null, 1, now(), now()),
      (${quote(ids.allocationOriginA)}, ${quote(ids.reservationOriginA)}, ${quote(ids.reservationMerged)}, ${quote(ids.sessionMerged)}, ${quote(ids.transitionMerge)}, 2, now(), now()),
      (${quote(ids.allocationOriginB)}, ${quote(ids.reservationOriginB)}, ${quote(ids.reservationMerged)}, ${quote(ids.sessionMerged)}, ${quote(ids.transitionMerge)}, 2, now(), now());

    insert into public.reservation_parties (
      id, reservation_id, party_type, display_name, email, phone, source,
      legacy_booking_group_id, created_at, updated_at
    ) values
      (${quote(ids.partyPaid)}, ${quote(ids.reservationPaid)}, 'person', 'Paid customer', 'paid@example.invalid', '5551000000', 'synthetic', null, now(), now()),
      (${quote(ids.partyFree)}, ${quote(ids.reservationFree)}, 'person', 'Free customer', 'free@example.invalid', '5552000000', 'synthetic', null, now(), now()),
      (${quote(ids.partyMerged)}, ${quote(ids.reservationMerged)}, 'person', 'Merged primary', 'merged@example.invalid', '5553000000', 'manager_merge', null, now(), now());

    insert into public.reservation_party_roles (
      reservation_id, party_id, role, created_at
    ) values
      (${quote(ids.reservationPaid)}, ${quote(ids.partyPaid)}, 'primary_contact', now()),
      (${quote(ids.reservationFree)}, ${quote(ids.partyFree)}, 'primary_contact', now()),
      (${quote(ids.reservationMerged)}, ${quote(ids.partyMerged)}, 'primary_contact', now());

    insert into public.payments (
      id, reservation_id, payer_party_id, kind, amount, currency, method, status,
      provider, provider_reference, idempotency_key, source, occurred_at,
      created_at, updated_at
    ) values
      (${quote(ids.paymentPaid)}, ${quote(ids.reservationPaid)}, ${quote(ids.partyPaid)}, 'payment', 90, 'CAD', 'venue', 'succeeded', null, null, 'paid-fixture', 'synthetic', now(), now(), now()),
      (${quote(ids.paymentPartial)}, ${quote(ids.reservationOriginA)}, null, 'payment', 20, 'CAD', 'venue', 'succeeded', null, null, 'partial-fixture', 'synthetic', now(), now(), now());

    insert into public.payment_allocation_entries (
      reservation_id, payment_id, booking_id, entry_kind, amount,
      idempotency_key, created_at
    ) values
      (${quote(ids.reservationPaid)}, ${quote(ids.paymentPaid)}, ${quote(ids.allocationPaidA)}, 'payment', 40, 'paid-a', now()),
      (${quote(ids.reservationPaid)}, ${quote(ids.paymentPaid)}, ${quote(ids.allocationPaidB)}, 'payment', 50, 'paid-b', now()),
      (${quote(ids.reservationOriginA)}, ${quote(ids.paymentPartial)}, ${quote(ids.allocationOriginA)}, 'payment', 20, 'partial-a', now());

    insert into public.reservation_legacy_sources (
      reservation_id, source_type, source_id, created_at
    ) values
      (${quote(ids.reservationPaid)}, 'booking_group', '80000000-0000-4000-8000-000000000001', now()),
      (${quote(ids.reservationFree)}, 'booking_group', '80000000-0000-4000-8000-000000000003', now()),
      (${quote(ids.reservationMerged)}, 'booking_link', '90000000-0000-4000-8000-000000000001', now());

    insert into public.reservation_transitions (
      id, sequence, operation_id, transition_type, created_at
    ) values (${quote(ids.transitionMerge)}, 1, 'synthetic-merge-operation', 'merge', now());

    insert into public.reservation_transition_sources (
      transition_id, reservation_id, created_at
    ) values
      (${quote(ids.transitionMerge)}, ${quote(ids.reservationOriginA)}, now()),
      (${quote(ids.transitionMerge)}, ${quote(ids.reservationOriginB)}, now());

    insert into public.reservation_transition_targets (
      transition_id, reservation_id, primary_party_id, created_at
    ) values (
      ${quote(ids.transitionMerge)}, ${quote(ids.reservationMerged)},
      ${quote(ids.partyMerged)}, now()
    );

    insert into public.reservation_transition_allocations (
      transition_id, booking_id, from_reservation_id, from_session_id,
      to_reservation_id, to_session_id, created_at
    ) values
      (${quote(ids.transitionMerge)}, ${quote(ids.allocationOriginA)}, ${quote(ids.reservationOriginA)}, ${quote(ids.sessionOriginA)}, ${quote(ids.reservationMerged)}, ${quote(ids.sessionMerged)}, now()),
      (${quote(ids.transitionMerge)}, ${quote(ids.allocationOriginB)}, ${quote(ids.reservationOriginB)}, ${quote(ids.sessionOriginB)}, ${quote(ids.reservationMerged)}, ${quote(ids.sessionMerged)}, now());
  `
}

function rlsSql() {
  const managerTables = [
    'courts',
    'venue_settings',
    'recurrence_series',
    'reservations',
    'reservation_sessions',
    'bookings',
    'reservation_parties',
    'reservation_party_roles',
    'reservation_payment_shares',
    'payments',
    'payment_allocation_entries',
    'reservation_legacy_sources',
    'reservation_transitions',
    'reservation_transition_sources',
    'reservation_transition_targets',
    'reservation_transition_allocations',
    'reservation_session_assignments',
    'reservation_allocation_memberships',
  ]
  const policies = managerTables.map((table) => `
    alter table public.${table} enable row level security;
    alter table public.${table} force row level security;
    create policy "managers read ${table}"
      on public.${table}
      for select
      to authenticated
      using ((select exists (
        select 1 from public.staff_members as staff
        where staff.user_id = (select auth.uid()) and staff.role = 'admin'
      )));
    grant select on public.${table} to authenticated;
  `).join('\n')

  return `
    alter table public.staff_members enable row level security;
    alter table public.staff_members force row level security;
    create policy "staff read own role"
      on public.staff_members
      for select
      to authenticated
      using ((select auth.uid()) = user_id);
    grant select on public.staff_members to authenticated;
    ${policies}
  `
}

async function buildDatabase() {
  const db = new PGlite()
  await db.exec(baseSchemaSql())
  await db.exec(fixtureSql())
  await db.exec(rlsSql())
  const migration = await readFile(migrationPath, 'utf8')
  await db.exec(migration)
  return db
}

async function queryAs(db, role, userId, sql) {
  await db.exec('begin;')
  try {
    await db.exec(`set local role ${role};`)
    if (userId) {
      await db.exec(`set local request.jwt.claim.sub = ${quote(userId)};`)
    }
    const result = await db.query(sql)
    await db.exec('rollback;')
    return result
  } catch (error) {
    await db.exec('rollback;').catch(() => {})
    throw error
  }
}

test('Phase 4A migration is additive, invoker-secured, and explicitly granted', async () => {
  const sql = await readFile(migrationPath, 'utf8')

  assert.match(sql, /^begin;/m)
  assert.match(sql, /commit;\s*$/)
  assert.match(sql, /v_version_count <> 47/)
  assert.match(sql, /v_latest_version <> '20260825074102'/)
  assert.equal((sql.match(/with \(security_invoker = true\)/g) ?? []).length, 3)
  assert.equal((sql.match(/security invoker/g) ?? []).length >= 5, true)
  assert.match(sql, /reservation_sessions_admin_window_idx/)
  assert.match(sql, /\(allocation\.starts_at, allocation\.allocation_id\)/)
  assert.match(sql, /\(matching\.matched_start_at, matching\.reservation_id\)/)
  assert.match(sql, /membership\.effective_reservation_id/)
  assert.match(sql, /when allocation_scope\.total_amount = 0[\s\S]*?'no_charge'/)
  assert.match(sql, /revoke all on function public\.admin_get_reservation_detail/)
  assert.doesNotMatch(sql, /security definer[\s\S]{0,80}admin_(list|search|get)_reservation/i)
  assert.doesNotMatch(sql, /service[_ -]?role[_ -]?(key|secret)/i)
  assert.doesNotMatch(
    sql,
    /\b(insert|update|delete|truncate)\s+(?:table\s+)?public\.(?:bookings|reservations|reservation_sessions|payments|payment_allocation_entries)\b/i,
  )
})

test('Phase 4A hosted diagnostic is read-only and PII-free', async () => {
  const sql = await readFile(diagnosticPath, 'utf8')

  assert.match(sql, /begin transaction read only;/i)
  assert.match(sql, /rollback;\s*$/)
  assert.match(sql, /v_version_count <> 48/)
  assert.match(sql, /v_latest_version <> '20260825091608'/)
  assert.match(sql, /assert_reservation_phase3b_activation/)
  assert.match(sql, /assert_reservation_phase4a_read_contract/)
  assert.match(sql, /reservation_phase4a_read_mismatches/)
  assert.doesNotMatch(
    sql,
    /select[\s\S]{0,120}\b(customer_(name|email|phone|notes)|display_name|email|phone)\b/i,
  )
})

test('Phase 4A derives paid, no-charge, and merged partial balances from current membership', async () => {
  const db = await buildDatabase()
  try {
    const result = await db.query(`
      select
        reservation_id,
        allocation_count,
        session_count,
        total_amount::text,
        net_paid_amount::text,
        payment_status
      from public.reservation_admin_summary_v1
      order by reference_number
    `)

    assert.deepEqual(result.rows, [
      {
        reservation_id: ids.reservationPaid,
        allocation_count: 2,
        session_count: 1,
        total_amount: '90.00',
        net_paid_amount: '90.00',
        payment_status: 'paid',
      },
      {
        reservation_id: ids.reservationFree,
        allocation_count: 1,
        session_count: 1,
        total_amount: '0.00',
        net_paid_amount: '0.00',
        payment_status: 'no_charge',
      },
      {
        reservation_id: ids.reservationMerged,
        allocation_count: 2,
        session_count: 1,
        total_amount: '100.00',
        net_paid_amount: '20.00',
        payment_status: 'partial',
      },
    ])
  } finally {
    await db.close()
  }
})

test('Phase 4A manager APIs use stable cursors and return one complete detail snapshot', async () => {
  const db = await buildDatabase()
  try {
    const firstPage = await queryAs(
      db,
      'authenticated',
      ids.manager,
      `select public.admin_list_reservation_allocations(
        '2026-09-01 00:00:00+00', '2026-09-05 00:00:00+00', 2, null, null
      ) as payload`,
    )
    const firstPayload = firstPage.rows[0].payload
    assert.equal(firstPayload.items.length, 2)
    assert.equal(firstPayload.has_more, true)
    assert.ok(firstPayload.next_cursor)

    const secondPage = await queryAs(
      db,
      'authenticated',
      ids.manager,
      `select public.admin_list_reservation_allocations(
        '2026-09-01 00:00:00+00',
        '2026-09-05 00:00:00+00',
        10,
        ${quote(firstPayload.next_cursor.starts_at)}::timestamptz,
        ${quote(firstPayload.next_cursor.allocation_id)}::uuid
      ) as payload`,
    )
    const firstIds = new Set(firstPayload.items.map((item) => item.allocation_id))
    assert.equal(
      secondPage.rows[0].payload.items.some((item) => firstIds.has(item.allocation_id)),
      false,
    )

    const search = await queryAs(
      db,
      'authenticated',
      ids.manager,
      `select public.admin_search_reservations(
        '2026-09-01', '2026-09-04', 'Merged primary', 'all', 'partial', 50, null, null
      ) as payload`,
    )
    assert.equal(search.rows[0].payload.items.length, 1)
    assert.equal(search.rows[0].payload.items[0].reservation_id, ids.reservationMerged)

    const detail = await queryAs(
      db,
      'authenticated',
      ids.manager,
      `select public.admin_get_reservation_detail(
        ${quote(ids.reservationMerged)}::uuid
      ) as payload`,
    )
    const detailPayload = detail.rows[0].payload
    assert.equal(detailPayload.reservation.payment_status, 'partial')
    assert.equal(detailPayload.sessions.length, 1)
    assert.equal(detailPayload.sessions[0].allocations.length, 2)
    assert.equal(detailPayload.parties[0].display_name, 'Merged primary')
    assert.equal(detailPayload.payments.length, 1)
    assert.equal(detailPayload.payments[0].original_reservation_id, ids.reservationOriginA)
    assert.equal(detailPayload.payments[0].current_reservation_amount, 20)
    assert.equal('provider_reference' in detailPayload.payments[0], false)
    assert.equal('idempotency_key' in detailPayload.payments[0], false)
  } finally {
    await db.close()
  }
})

test('Phase 4A denies non-managers and leaves the PII-free shadow contract clean', async () => {
  const db = await buildDatabase()
  try {
    await assert.rejects(
      queryAs(
        db,
        'authenticated',
        ids.nonManager,
        `select public.admin_get_reservation_detail(${quote(ids.reservationPaid)}::uuid)`,
      ),
      /Manager access required/,
    )

    await assert.rejects(
      queryAs(
        db,
        'anon',
        null,
        `select public.admin_get_reservation_detail(${quote(ids.reservationPaid)}::uuid)`,
      ),
      /permission denied/i,
    )

    const shadow = await queryAs(
      db,
      'authenticated',
      ids.manager,
      'select public.admin_get_reservation_read_shadow_status(100) as payload',
    )
    assert.equal(shadow.rows[0].payload.status, 'clean')
    assert.equal(shadow.rows[0].payload.mismatch_count, 0)
    assert.deepEqual(shadow.rows[0].payload.samples, [])
    assert.equal(shadow.rows[0].payload.totals.allocations, 5)
    assert.equal(shadow.rows[0].payload.totals.effective_reservations, 3)

    const diagnosticText = JSON.stringify(shadow.rows[0].payload)
    assert.doesNotMatch(diagnosticText, /Paid customer|Merged primary|example\.invalid|555/)
  } finally {
    await db.close()
  }
})
