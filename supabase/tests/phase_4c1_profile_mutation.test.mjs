import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { PGlite } from '@electric-sql/pglite'

const migrationPath = new URL(
  '../migrations/20260827084719_reservation_phase_4c1_profile_mutation.sql',
  import.meta.url,
)

const partyLineageMigrationPath = new URL(
  '../migrations/20260827090512_reservation_phase_4c1_party_lineage.sql',
  import.meta.url,
)

const diagnosticPath = new URL(
  '../diagnostics/phase_4c1_profile_mutation.sql',
  import.meta.url,
)

const ids = Object.freeze({
  manager: '00000000-0000-4000-8000-000000000001',
  nonManager: '00000000-0000-4000-8000-000000000002',
  reservation: '10000000-0000-4000-8000-000000000001',
  otherReservation: '10000000-0000-4000-8000-000000000002',
  session: '20000000-0000-4000-8000-000000000001',
  siblingSession: '20000000-0000-4000-8000-000000000002',
  allocationA: '30000000-0000-4000-8000-000000000001',
  allocationB: '30000000-0000-4000-8000-000000000002',
  siblingAllocation: '30000000-0000-4000-8000-000000000003',
  party: '40000000-0000-4000-8000-000000000001',
  lineageParty: '40000000-0000-4000-8000-000000000002',
  siblingParty: '40000000-0000-4000-8000-000000000003',
  group: '50000000-0000-4000-8000-000000000001',
  siblingGroup: '50000000-0000-4000-8000-000000000002',
})

const quoted = (value) => `'${value}'`

const baseSql = () => `
  drop schema if exists public cascade;
  drop schema if exists auth cascade;
  drop schema if exists private cascade;
  drop schema if exists supabase_migrations cascade;
  create schema public;
  create schema auth;
  create schema private;
  create schema supabase_migrations;

  do $$ begin create role anon nologin; exception when duplicate_object then null; end $$;
  do $$ begin create role authenticated nologin; exception when duplicate_object then null; end $$;
  do $$ begin create role service_role nologin; exception when duplicate_object then null; end $$;

  grant usage on schema public, auth to anon, authenticated, service_role;

  create function auth.uid()
  returns uuid
  language sql
  stable
  set search_path = ''
  as $$
    select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
  $$;
  grant execute on function auth.uid() to anon, authenticated, service_role;

  create table supabase_migrations.schema_migrations (
    version text primary key,
    name text not null
  );
  insert into supabase_migrations.schema_migrations (version, name)
  select lpad(value::text, 14, '0'), 'synthetic_baseline'
  from generate_series(1, 48) as value;
  insert into supabase_migrations.schema_migrations (version, name)
  values ('20260826181644', 'reservation_phase_4b3_order_search');

  create table public.staff_members (
    user_id uuid primary key,
    role text not null
  );
  insert into public.staff_members (user_id, role) values
    (${quoted(ids.manager)}::uuid, 'admin'),
    (${quoted(ids.nonManager)}::uuid, 'customer');

  create table public.reservations (
    id uuid primary key,
    notes text,
    updated_at timestamptz not null
  );
  create table public.reservation_sessions (
    id uuid primary key,
    reservation_id uuid not null,
    party_size smallint not null,
    notes text,
    updated_at timestamptz not null
  );
  create table public.bookings (
    id uuid primary key,
    reservation_id uuid not null,
    session_id uuid not null,
    booking_group_id uuid not null,
    customer_name text not null,
    customer_email text,
    customer_phone text,
    customer_notes text,
    party_size smallint not null,
    payment_status text not null,
    updated_at timestamptz not null
  );
  create table public.reservation_parties (
    id uuid primary key,
    reservation_id uuid not null,
    display_name text not null,
    email text,
    phone text,
    legacy_booking_group_id uuid,
    updated_at timestamptz not null
  );
  create table public.reservation_allocation_memberships (
    booking_id uuid primary key,
    origin_reservation_id uuid not null,
    effective_reservation_id uuid not null,
    effective_session_id uuid not null
  );
  create table public.reservation_transition_parties (
    source_party_id uuid not null,
    target_party_id uuid not null
  );

  create table private.app_audit_events (
    id bigint generated always as identity primary key,
    operation_id text not null,
    event_type text not null,
    entity_type text not null,
    entity_id text,
    actor_id uuid,
    actor_kind text not null,
    source text not null,
    changed_fields text[] not null default '{}'::text[],
    metadata jsonb not null default '{}'::jsonb
  );

  create table private.reservation_phase3b_operations (
    operation_id text primary key,
    operation_type text not null,
    request_fingerprint text not null,
    status text not null default 'started',
    actor_id uuid,
    result_entity_id uuid,
    result_payload jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default statement_timestamp(),
    completed_at timestamptz,
    constraint reservation_phase3b_operations_type_check
      check (operation_type ~ '^[a-z][a-z0-9_.]{0,99}$')
  );

  create function private.require_manager()
  returns uuid
  language plpgsql
  security definer
  set search_path = ''
  as $$
  declare v_actor uuid := auth.uid();
  begin
    if v_actor is null or not exists (
      select 1 from public.staff_members as staff
      where staff.user_id = v_actor and staff.role = 'admin'
    ) then
      raise exception using errcode = '42501', message = 'Manager access required';
    end if;
    return v_actor;
  end;
  $$;

  create function private.reservation_phase3b_request_fingerprint(p_request jsonb)
  returns text
  language sql
  immutable
  set search_path = ''
  as $$ select md5(p_request::text) $$;

  create function private.reservation_phase3b_claim_operation(
    p_operation_id text,
    p_operation_type text,
    p_request_fingerprint text,
    p_actor_id uuid
  )
  returns table (already_completed boolean, result_entity_id uuid, result_payload jsonb)
  language plpgsql
  security invoker
  set search_path = ''
  as $$
  declare v_operation private.reservation_phase3b_operations%rowtype;
  begin
    perform pg_advisory_xact_lock(hashtextextended('operation:' || p_operation_id, 0));
    insert into private.reservation_phase3b_operations (
      operation_id, operation_type, request_fingerprint, actor_id
    ) values (
      p_operation_id, p_operation_type, p_request_fingerprint, p_actor_id
    ) on conflict (operation_id) do nothing;

    select operation.* into v_operation
    from private.reservation_phase3b_operations as operation
    where operation.operation_id = p_operation_id
    for update;

    if v_operation.operation_type is distinct from p_operation_type
       or v_operation.request_fingerprint is distinct from p_request_fingerprint
       or v_operation.actor_id is distinct from p_actor_id then
      raise exception 'Phase 3B idempotency key was reused with a different request';
    end if;
    return query select
      v_operation.status = 'completed',
      v_operation.result_entity_id,
      v_operation.result_payload;
  end;
  $$;

  create function private.reservation_phase3b_complete_operation(
    p_operation_id text,
    p_result_entity_id uuid,
    p_result_payload jsonb
  )
  returns void
  language plpgsql
  security invoker
  set search_path = ''
  as $$
  begin
    update private.reservation_phase3b_operations
    set status = 'completed',
        result_entity_id = p_result_entity_id,
        result_payload = p_result_payload,
        completed_at = statement_timestamp()
    where operation_id = p_operation_id and status = 'started';
    if not found then raise exception 'Operation is not completable'; end if;
  end;
  $$;

  create function private.reservation_phase3b_lock_allocations(
    p_booking_ids uuid[],
    p_additional_reservation_ids uuid[]
  )
  returns void
  language plpgsql
  security invoker
  set search_path = ''
  as $$
  declare v_booking_id uuid;
  begin
    foreach v_booking_id in array p_booking_ids loop
      perform pg_advisory_xact_lock(hashtextextended('booking:' || v_booking_id::text, 0));
    end loop;
    perform 1 from public.reservations as reservation
      where reservation.id = any(p_additional_reservation_ids)
         or reservation.id in (
           select membership.origin_reservation_id
           from public.reservation_allocation_memberships as membership
           where membership.booking_id = any(p_booking_ids)
           union
           select membership.effective_reservation_id
           from public.reservation_allocation_memberships as membership
           where membership.booking_id = any(p_booking_ids)
         )
      order by reservation.id for update;
    perform 1 from public.reservation_sessions as session
      where session.id in (
        select membership.effective_session_id
        from public.reservation_allocation_memberships as membership
        where membership.booking_id = any(p_booking_ids)
      ) or session.id in (
        select booking.session_id from public.bookings as booking
        where booking.id = any(p_booking_ids)
      ) order by session.id for update;
    perform 1 from public.bookings as booking
      where booking.id = any(p_booking_ids) order by booking.id for update;
    perform 1 from public.reservation_allocation_memberships as membership
      where membership.booking_id = any(p_booking_ids)
      order by membership.booking_id for update;
  end;
  $$;

  create function private.assert_reservation_phase3b_activation()
  returns jsonb
  language sql
  stable
  security invoker
  set search_path = ''
  as $$
    select jsonb_build_object(
      'status', 'clean',
      'writer_inventory', jsonb_build_object(
        'public_entry_count', 17,
        'public_direct_booking_writer_count', 0,
        'private_legacy_writer_count', 17,
        'wrapper_count', 3
      ),
      'incomplete_operation_count', (
        select count(*) from private.reservation_phase3b_operations where status <> 'completed'
      )
    )
  $$;

  create function private.assert_reservation_phase4a_read_contract()
  returns jsonb
  language sql
  stable
  security invoker
  set search_path = ''
  as $$ select jsonb_build_object('status', 'phase_4a_manager_read_contract_verified') $$;

  revoke all on all functions in schema private from public, anon, authenticated, service_role;
  revoke all on all tables in schema private from public, anon, authenticated, service_role;

  insert into public.reservations (id, notes, updated_at) values
    (${quoted(ids.reservation)}, 'Original Reservation note', '2026-08-27 10:00:00+00'),
    (${quoted(ids.otherReservation)}, 'Other Reservation note', '2026-08-27 10:00:00+00');
  insert into public.reservation_sessions (id, reservation_id, party_size, notes, updated_at) values
    (${quoted(ids.session)}, ${quoted(ids.reservation)}, 2, 'Original Session note', '2026-08-27 10:00:00+00'),
    (${quoted(ids.siblingSession)}, ${quoted(ids.reservation)}, 3, 'Sibling Session note', '2026-08-27 10:00:00+00');
  insert into public.bookings (
    id, reservation_id, session_id, booking_group_id, customer_name,
    customer_email, customer_phone, customer_notes, party_size,
    payment_status, updated_at
  ) values
    (${quoted(ids.allocationA)}, ${quoted(ids.reservation)}, ${quoted(ids.session)}, ${quoted(ids.group)}, 'Original Player', 'original@example.invalid', '4160000001', 'Original Session note', 2, 'paid', '2026-08-27 10:00:00+00'),
    (${quoted(ids.allocationB)}, ${quoted(ids.reservation)}, ${quoted(ids.session)}, ${quoted(ids.group)}, 'Original Player', 'original@example.invalid', '4160000001', 'Original Session note', 2, 'paid', '2026-08-27 10:00:00+00'),
    (${quoted(ids.siblingAllocation)}, ${quoted(ids.reservation)}, ${quoted(ids.siblingSession)}, ${quoted(ids.siblingGroup)}, 'Sibling Player', 'sibling@example.invalid', '4160000002', 'Sibling Session note', 3, 'pay_at_venue', '2026-08-27 10:00:00+00');
  insert into public.reservation_allocation_memberships (
    booking_id, origin_reservation_id, effective_reservation_id, effective_session_id
  ) values
    (${quoted(ids.allocationA)}, ${quoted(ids.reservation)}, ${quoted(ids.reservation)}, ${quoted(ids.session)}),
    (${quoted(ids.allocationB)}, ${quoted(ids.reservation)}, ${quoted(ids.reservation)}, ${quoted(ids.session)}),
    (${quoted(ids.siblingAllocation)}, ${quoted(ids.reservation)}, ${quoted(ids.reservation)}, ${quoted(ids.siblingSession)});
  insert into public.reservation_parties (
    id, reservation_id, display_name, email, phone, legacy_booking_group_id, updated_at
  ) values
    (${quoted(ids.party)}, ${quoted(ids.otherReservation)}, 'Original Player', 'original@example.invalid', '4160000001', ${quoted(ids.group)}, '2026-08-27 10:00:00+00'),
    (${quoted(ids.lineageParty)}, ${quoted(ids.reservation)}, 'Original Player', 'original@example.invalid', '4160000001', null, '2026-08-27 10:00:00+00'),
    (${quoted(ids.siblingParty)}, ${quoted(ids.reservation)}, 'Sibling Player', 'sibling@example.invalid', '4160000002', ${quoted(ids.siblingGroup)}, '2026-08-27 10:00:00+00');
  insert into public.reservation_transition_parties (source_party_id, target_party_id)
  values (${quoted(ids.party)}, ${quoted(ids.lineageParty)});
`

async function buildDatabase(db = new PGlite()) {
  await db.exec(baseSql())
  const migration = await readFile(migrationPath, 'utf8')
  await db.exec(migration)
  await db.exec(`
    insert into supabase_migrations.schema_migrations (version, name)
    values ('20260827084719', 'reservation_phase_4c1_profile_mutation')
  `)
  const partyLineageMigration = await readFile(partyLineageMigrationPath, 'utf8')
  await db.exec(partyLineageMigration)
  return db
}

async function mutateAs(db, role, actorId, values) {
  await db.exec('begin;')
  try {
    await db.exec(`set local role ${role};`)
    if (actorId) await db.exec(`set local request.jwt.claim.sub = ${quoted(actorId)};`)
    const result = await db.query(`
      select public.admin_update_reservation_profile(
        ${quoted(values.scope)},
        ${quoted(values.reservationId)}::uuid,
        ${quoted(values.targetId)}::uuid,
        ${quoted(JSON.stringify(values.patch))}::jsonb,
        ${quoted(values.reason || 'manager_edit')},
        ${quoted(values.key)},
        ${quoted(values.expectedUpdatedAt)}::timestamptz
      ) as result
    `)
    await db.exec('commit;')
    return result.rows[0].result
  } catch (error) {
    await db.exec('rollback;').catch(() => {})
    throw error
  }
}

const sessionMutation = (overrides = {}) => ({
  scope: 'session',
  reservationId: ids.reservation,
  targetId: ids.session,
  patch: { notes: 'Updated Session note', party_size: 4 },
  key: 'session-update-1',
  expectedUpdatedAt: '2026-08-27 10:00:00+00',
  ...overrides,
})

test('Phase 4C.1 migration is additive, explicit, PII-safe and default-compatible', async () => {
  const sql = await readFile(migrationPath, 'utf8')
  const partyLineageSql = await readFile(partyLineageMigrationPath, 'utf8')
  const diagnosticSql = await readFile(diagnosticPath, 'utf8')

  assert.match(sql, /^begin;/m)
  assert.match(sql, /commit;\s*$/)
  assert.equal((sql.match(/^commit;$/gm) || []).length, 1)
  assert.match(sql, /v_version_count <> 49/)
  assert.match(sql, /v_latest_version <> '20260826181644'/)
  assert.match(sql, /p_scope not in \('reservation', 'session', 'party'\)/)
  assert.match(sql, /p_expected_updated_at/)
  assert.match(sql, /reservation_profile_stale_target/)
  assert.match(sql, /reservation_phase3b_claim_operation/)
  assert.match(sql, /reservation_phase3b_lock_allocations/)
  assert.match(sql, /Authorization intentionally precedes every argument/)
  assert.match(sql, /revoke all on function public\.admin_update_reservation_profile[\s\S]*?grant execute[\s\S]*?to authenticated/)
  assert.doesNotMatch(sql, /grant execute[\s\S]{0,140}to (?:anon|service_role)/i)
  assert.doesNotMatch(sql, /\b(update|insert|delete)\s+public\.(?:payments|payment_allocation_entries|reservation_payment_shares)\b/i)
  assert.doesNotMatch(sql, /provider_reference|service[_ -]?role[_ -]?(?:key|secret)/i)
  assert.match(partyLineageSql, /v_version_count <> 50/i)
  assert.match(partyLineageSql, /v_latest_version <> '20260827084719'/i)
  assert.match(partyLineageSql, /reservation_phase4c1_party_lineage_scope/i)
  assert.match(partyLineageSql, /reservation_transition_parties/i)
  assert.match(partyLineageSql, /party_lineage_mode', 'bidirectional_transition_graph'/i)
  assert.doesNotMatch(
    partyLineageSql,
    /\b(update|insert|delete)\s+public\.(?:payments|payment_allocation_entries|reservation_payment_shares)\b/i,
  )
  assert.match(diagnosticSql, /begin transaction read only/i)
  assert.match(diagnosticSql, /v_version_count <> 51/i)
  assert.match(diagnosticSql, /v_latest_version <> '20260827090512'/i)
  assert.match(diagnosticSql, /private\.assert_reservation_phase4c1_profile_mutation\(\)/i)
  assert.doesNotMatch(
    diagnosticSql,
    /select\s+(?:[^;]*)(?:display_name|email|phone|notes|request_fingerprint|result_payload)/i,
  )
})

test('Phase 4C.1 independently updates Reservation, Session and explicit Party scopes', async () => {
  const db = await buildDatabase()
  try {
    const reservationResult = await mutateAs(db, 'authenticated', ids.manager, {
      scope: 'reservation',
      reservationId: ids.reservation,
      targetId: ids.reservation,
      patch: { notes: 'Updated Reservation note' },
      key: 'reservation-update-1',
      expectedUpdatedAt: '2026-08-27 10:00:00+00',
    })
    assert.equal(reservationResult.status, 'updated')
    assert.deepEqual(reservationResult.changed_fields, ['notes'])
    assert.equal(JSON.stringify(reservationResult).includes('Updated Reservation note'), false)

    const sessionResult = await mutateAs(db, 'authenticated', ids.manager, sessionMutation())
    assert.equal(sessionResult.scope, 'session')
    assert.deepEqual(sessionResult.changed_fields, ['notes', 'party_size'])

    const partyResult = await mutateAs(db, 'authenticated', ids.manager, {
      scope: 'party',
      reservationId: ids.reservation,
      targetId: ids.lineageParty,
      patch: { display_name: 'Updated Player', email: 'UPDATED@EXAMPLE.INVALID', phone: '4169990000' },
      key: 'party-update-1',
      expectedUpdatedAt: '2026-08-27 10:00:00+00',
    })
    assert.equal(partyResult.scope, 'party')
    assert.equal(JSON.stringify(partyResult).includes('Updated Player'), false)
    assert.deepEqual((await db.query(`
      select party_ids, legacy_group_ids, booking_ids
      from private.reservation_phase4c1_party_lineage_scope(${quoted(ids.lineageParty)}::uuid)
    `)).rows[0], {
      party_ids: [ids.party, ids.lineageParty],
      legacy_group_ids: [ids.group],
      booking_ids: [ids.allocationA, ids.allocationB],
    })

    assert.deepEqual((await db.query(`
      select id, notes from public.reservations order by id
    `)).rows, [
      { id: ids.reservation, notes: 'Updated Reservation note' },
      { id: ids.otherReservation, notes: 'Other Reservation note' },
    ])
    assert.deepEqual((await db.query(`
      select id, notes, party_size from public.reservation_sessions order by id
    `)).rows, [
      { id: ids.session, notes: 'Updated Session note', party_size: 4 },
      { id: ids.siblingSession, notes: 'Sibling Session note', party_size: 3 },
    ])
    assert.deepEqual((await db.query(`
      select id, customer_name, customer_email, customer_notes, party_size, payment_status
      from public.bookings order by id
    `)).rows, [
      { id: ids.allocationA, customer_name: 'Updated Player', customer_email: 'updated@example.invalid', customer_notes: 'Updated Session note', party_size: 4, payment_status: 'paid' },
      { id: ids.allocationB, customer_name: 'Updated Player', customer_email: 'updated@example.invalid', customer_notes: 'Updated Session note', party_size: 4, payment_status: 'paid' },
      { id: ids.siblingAllocation, customer_name: 'Sibling Player', customer_email: 'sibling@example.invalid', customer_notes: 'Sibling Session note', party_size: 3, payment_status: 'pay_at_venue' },
    ])
    assert.deepEqual((await db.query(`
      select id, display_name, email from public.reservation_parties order by id
    `)).rows, [
      { id: ids.party, display_name: 'Updated Player', email: 'updated@example.invalid' },
      { id: ids.lineageParty, display_name: 'Updated Player', email: 'updated@example.invalid' },
      { id: ids.siblingParty, display_name: 'Sibling Player', email: 'sibling@example.invalid' },
    ])
    assert.equal((await db.query(`select count(*)::integer as count from private.app_audit_events`)).rows[0].count, 3)
    assert.equal((await db.query(`select count(*)::integer as count from private.reservation_phase3b_operations where status <> 'completed'`)).rows[0].count, 0)
  } finally {
    await db.close()
  }
})

test('Phase 4C.1 enforces ACL, idempotency, stale versions and atomic rollback', async () => {
  const db = await buildDatabase()
  try {
    const privileges = await db.query(`
      select
        has_function_privilege('authenticated', 'public.admin_update_reservation_profile(text,uuid,uuid,jsonb,text,text,timestamp with time zone)', 'EXECUTE') as authenticated,
        has_function_privilege('anon', 'public.admin_update_reservation_profile(text,uuid,uuid,jsonb,text,text,timestamp with time zone)', 'EXECUTE') as anon,
        has_function_privilege('service_role', 'public.admin_update_reservation_profile(text,uuid,uuid,jsonb,text,text,timestamp with time zone)', 'EXECUTE') as service_role
    `)
    assert.deepEqual(privileges.rows[0], { authenticated: true, anon: false, service_role: false })

    await assert.rejects(
      () => mutateAs(db, 'authenticated', ids.nonManager, sessionMutation()),
      /reservation_profile_manager_required/,
    )
    await assert.rejects(
      () => mutateAs(db, 'anon', null, sessionMutation()),
      /permission denied/i,
    )

    const first = await mutateAs(db, 'authenticated', ids.manager, sessionMutation())
    const retry = await mutateAs(db, 'authenticated', ids.manager, sessionMutation())
    assert.deepEqual(retry, first)
    assert.equal((await db.query(`select count(*)::integer as count from private.app_audit_events`)).rows[0].count, 1)

    await assert.rejects(
      () => mutateAs(db, 'authenticated', ids.manager, sessionMutation({
        patch: { notes: 'Different request', party_size: 4 },
      })),
      /idempotency key was reused/i,
    )
    await assert.rejects(
      () => mutateAs(db, 'authenticated', ids.manager, sessionMutation({
        key: 'stale-update-2',
        patch: { notes: 'Must roll back', party_size: 5 },
      })),
      /reservation_profile_stale_target/,
    )
    await assert.rejects(
      () => mutateAs(db, 'authenticated', ids.manager, sessionMutation({
        key: 'invalid-payment-field',
        patch: { payment_status: 'paid' },
        expectedUpdatedAt: first.target_updated_at,
      })),
      /reservation_profile_patch_scope_mismatch/,
    )
    await db.exec(`
      update public.reservation_allocation_memberships
      set effective_reservation_id = ${quoted(ids.otherReservation)}::uuid
      where booking_id = ${quoted(ids.allocationA)}::uuid
    `)
    await assert.rejects(
      () => mutateAs(db, 'authenticated', ids.manager, {
        scope: 'party',
        reservationId: ids.reservation,
        targetId: ids.lineageParty,
        patch: { display_name: 'Must not split' },
        key: 'party-lineage-split',
        expectedUpdatedAt: '2026-08-27 10:00:00+00',
      }),
      /reservation_profile_party_lineage_split/,
    )
    assert.equal((await db.query(`select notes from public.reservation_sessions where id = ${quoted(ids.session)}`)).rows[0].notes, 'Updated Session note')
    assert.equal((await db.query(`select count(*)::integer as count from private.reservation_phase3b_operations where status <> 'completed'`)).rows[0].count, 0)
  } finally {
    await db.close()
  }
})

test('Phase 4C.1 serializes real PostgreSQL retry and stale-write races', {
  skip: !process.env.PHASE3B_POSTGRES_URL,
  timeout: 120_000,
}, async () => {
  const { Client } = await import('pg')
  const clients = []
  const connect = async () => {
    const client = new Client({ connectionString: process.env.PHASE3B_POSTGRES_URL })
    await client.connect()
    clients.push(client)
    return client
  }

  const root = await connect()
  try {
    await root.query(baseSql())
    await root.query(await readFile(migrationPath, 'utf8'))
    await root.query(`
      insert into supabase_migrations.schema_migrations (version, name)
      values ('20260827084719', 'reservation_phase_4c1_profile_mutation')
    `)
    await root.query(await readFile(partyLineageMigrationPath, 'utf8'))
    const workerA = await connect()
    const workerB = await connect()
    for (const worker of [workerA, workerB]) {
      await worker.query(`set role authenticated; set request.jwt.claim.sub = ${quoted(ids.manager)};`)
    }

    const callSql = (key, note, target = ids.session) => `
      select public.admin_update_reservation_profile(
        'session', ${quoted(ids.reservation)}::uuid, ${quoted(target)}::uuid,
        jsonb_build_object('notes', ${quoted(note)}, 'party_size', 4),
        'manager_edit', ${quoted(key)}, '2026-08-27 10:00:00+00'::timestamptz
      ) as result
    `

    const retryRace = await Promise.all([
      workerA.query(callSql('concurrent-retry', 'Concurrent retry note')),
      workerB.query(callSql('concurrent-retry', 'Concurrent retry note')),
    ])
    assert.deepEqual(retryRace[0].rows[0].result, retryRace[1].rows[0].result)
    assert.equal((await root.query(`select count(*)::integer as count from private.app_audit_events`)).rows[0].count, 1)

    const staleRace = await Promise.allSettled([
      workerA.query(callSql('concurrent-stale-a', 'Stale A', ids.siblingSession)),
      workerB.query(callSql('concurrent-stale-b', 'Stale B', ids.siblingSession)),
    ])
    assert.equal(staleRace.filter((result) => result.status === 'fulfilled').length, 1)
    assert.equal(staleRace.filter((result) => result.status === 'rejected').length, 1)
    assert.match(staleRace.find((result) => result.status === 'rejected').reason.message, /reservation_profile_stale_target/)
    assert.equal((await root.query(`select count(*)::integer as count from private.reservation_phase3b_operations where status <> 'completed'`)).rows[0].count, 0)
  } finally {
    await Promise.all(clients.map((client) => client.end().catch(() => {})))
  }
})
