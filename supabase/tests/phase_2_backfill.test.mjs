import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { PGlite } from '@electric-sql/pglite'

const phase1Path = new URL(
  '../migrations/20260823072016_reservation_aggregate_schema.sql',
  import.meta.url,
)
const phase2Path = new URL(
  '../migrations/20260824015013_reservation_deterministic_backfill.sql',
  import.meta.url,
)
const diagnosticPath = new URL(
  '../diagnostics/phase_2_reservation_backfill.sql',
  import.meta.url,
)
const phase3aPath = new URL(
  '../migrations/20260824052629_reservation_phase_3a_compatibility_foundation.sql',
  import.meta.url,
)
const phase3aAccessFixPath = new URL(
  '../migrations/20260824130514_reservation_phase_3a_shadow_timezone_access.sql',
  import.meta.url,
)
const phase3aPolicyConsolidationPath = new URL(
  '../migrations/20260824132704_phase_3a_venue_settings_policy_consolidation.sql',
  import.meta.url,
)
const phase3bInactiveKernelPath = new URL(
  '../migrations/20260824143442_reservation_phase_3b_inactive_transaction_kernel.sql',
  import.meta.url,
)
const phase3bWriterInventoryCollationPath = new URL(
  '../migrations/20260824164530_phase_3b_writer_inventory_c_collation.sql',
  import.meta.url,
)
const phase3bInactiveKernelDiagnosticPath = new URL(
  '../diagnostics/phase_3b_inactive_transaction_kernel.sql',
  import.meta.url,
)

const productionFingerprints = {
  booking: '20802718eff3b81bd5fe38d99808e8d8',
  bookingPayload: 'd27b6924d560d7fc1bf2f54ce3f38688',
  slots: '2617c5b347e5f516bae80cbb4bd92ccc',
  paymentAudit: '80cbd801fce56b51b9d0e51c68a60e2c',
}

function uuid(family, value) {
  const hex = (BigInt(family) * 10_000n + BigInt(value))
    .toString(16)
    .padStart(32, '0')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

function dateFrom(base, days) {
  const date = new Date(`${base}T00:00:00.000Z`)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

function sqlString(value) {
  if (value === null) return 'null'
  return `'${String(value).replaceAll("'", "''")}'`
}

function buildBookings() {
  const links = new Map()
  const clusters = [[1, 2], [3, 4], [5, 6], [7, 8], [9, 10, 11, 12, 13]]
  clusters.forEach((groups, index) => {
    groups.forEach((group) => links.set(group, uuid(3, index + 1)))
  })

  const recurrence = new Map([
    [14, { series: uuid(4, 1), week: 1, date: '2026-09-07' }],
    [15, { series: uuid(4, 1), week: 2, date: '2026-09-14' }],
    [16, { series: uuid(4, 2), week: 1, date: '2026-09-08' }],
    [17, { series: uuid(4, 2), week: 2, date: '2026-09-15' }],
    [18, { series: uuid(4, 2), week: 3, date: '2026-09-22' }],
    [19, { series: uuid(4, 2), week: 4, date: '2026-09-29' }],
  ])

  const bookings = []
  let bookingIndex = 0
  for (let group = 1; group <= 131; group += 1) {
    const rowCount = group <= 61 ? 2 : 1
    for (let row = 1; row <= rowCount; row += 1) {
      bookingIndex += 1
      const recurring = recurrence.get(group)
      const date = recurring?.date ?? dateFrom('2026-10-01', group)
      const hour = group <= 4 && row === 2 ? 12 : 10
      const start = `${date} ${String(hour).padStart(2, '0')}:00:00`
      const end = `${date} ${String(hour + 1).padStart(2, '0')}:00:00`
      const status = bookingIndex === 26 || bookingIndex > 140
        ? 'cancelled'
        : 'confirmed'
      const paid = bookingIndex <= 26
      const amount = paid ? (bookingIndex === 1 ? 92 : 62) : 40
      bookings.push({
        id: uuid(1, bookingIndex),
        groupId: uuid(2, group),
        linkId: links.get(group) ?? null,
        recurrenceSeriesId: recurring?.series ?? null,
        recurrenceWeek: recurring?.week ?? null,
        courtId: uuid(5, row),
        start,
        end,
        status,
        paymentStatus: paid ? 'paid' : 'pay_at_venue',
        amount,
        customerName: `Synthetic customer ${group}`,
        customerEmail: `synthetic-${group}@example.invalid`,
        customerPhone: `555${String(group).padStart(7, '0')}`,
        customerNotes: group % 3 === 0 ? `Synthetic note ${group}` : null,
        createdAt: `${date}T12:00:00.000Z`,
        updatedAt: `${date}T12:30:00.000Z`,
      })
    }
  }
  assert.equal(bookings.length, 192)
  assert.equal(
    bookings.filter((booking) => booking.status === 'confirmed').length,
    139,
  )
  assert.equal(
    bookings.filter((booking) => booking.paymentStatus === 'paid')
      .reduce((sum, booking) => sum + booking.amount, 0),
    1642,
  )
  return bookings
}

function baseSchemaSql({ forceSessionCollision = false } = {}) {
  const deterministicUuidBody = forceSessionCollision
    ? `
      select case
        when p_name like 'booking-group:%|start:%'
          then 'aaaaaaaa-aaaa-5aaa-8aaa-aaaaaaaaaaaa'::uuid
        else md5(p_namespace::text || ':' || p_name)::uuid
      end
    `
    : `select md5(p_namespace::text || ':' || p_name)::uuid`

  return `
    create schema auth;
    create schema private;
    create schema extensions;
    create role anon nologin;
    create role authenticated nologin;
    create role service_role nologin;

    create function auth.uid()
    returns uuid language sql stable as $$
      select nullif(
        current_setting('request.jwt.claim.sub', true),
        ''
      )::uuid
    $$;

    create function extensions.uuid_generate_v5(p_namespace uuid, p_name text)
    returns uuid language sql immutable set search_path = '' as $$
      ${deterministicUuidBody}
    $$;

    create table auth.users (id uuid primary key);
    create table public.staff_members (
      user_id uuid primary key references auth.users(id),
      role text not null
    );
    create table public.courts (id uuid primary key);

    create type public.booking_status as enum (
      'held', 'confirmed', 'cancelled', 'expired', 'no_show'
    );
    create type public.payment_status as enum (
      'pending', 'paid', 'pay_at_venue', 'refunded', 'failed'
    );
    create type public.payment_method as enum ('venue', 'stripe');

    create table public.venue_settings (
      singleton boolean primary key default true,
      timezone text not null,
      currency character(3) not null
    );
    alter table public.venue_settings enable row level security;
    alter table public.venue_settings force row level security;
    create policy venue_settings_rpc_only
      on public.venue_settings
      for all
      to authenticated
      using (false)
      with check (false);

    create table public.bookings (
      id uuid primary key,
      user_id uuid not null references auth.users(id),
      court_id uuid not null references public.courts(id),
      start_at timestamp not null,
      end_at timestamp not null,
      status public.booking_status not null,
      payment_status public.payment_status not null,
      payment_method public.payment_method not null,
      total_amount numeric(10,2) not null,
      currency character(3) not null default 'CAD',
      party_size smallint not null default 2,
      hold_expires_at timestamptz,
      stripe_checkout_session_id text,
      stripe_payment_intent_id text,
      cancelled_at timestamptz,
      created_at timestamptz not null,
      updated_at timestamptz not null,
      customer_name text not null,
      customer_email text,
      customer_phone text,
      customer_notes text,
      booking_group_id uuid not null,
      recurrence_series_id uuid,
      recurrence_week smallint,
      system_calculated_amount numeric(10,2) not null,
      price_source text not null,
      price_override_amount numeric(10,2),
      price_overridden_by uuid,
      price_overridden_at timestamptz,
      booking_link_id uuid
    );

    create table public.court_slots (
      id uuid primary key references public.bookings(id) on delete cascade,
      court_id uuid not null references public.courts(id),
      start_at timestamp not null,
      end_at timestamp not null,
      status public.booking_status not null,
      updated_at timestamptz not null
    );

    create table private.app_audit_events (
      id bigint generated always as identity primary key,
      occurred_at timestamptz not null default statement_timestamp(),
      transaction_id bigint not null default txid_current(),
      operation_id text not null default txid_current()::text,
      event_type text not null,
      entity_type text not null,
      entity_id text,
      actor_id uuid,
      actor_email text,
      actor_kind text not null default 'system',
      source text not null default 'database',
      before_state jsonb,
      after_state jsonb,
      changed_fields text[] not null default '{}'::text[],
      metadata jsonb not null default '{}'::jsonb,
      reverts_operation_id text
    );

    grant usage on schema auth to anon, authenticated, service_role;
    grant execute on function auth.uid() to anon, authenticated, service_role;
    grant select on table
      public.staff_members,
      public.bookings
    to authenticated;

    create function public.set_updated_at()
    returns trigger language plpgsql set search_path = '' as $$
    begin
      new.updated_at := statement_timestamp();
      return new;
    end;
    $$;
  `
}

function bookingSeedSql(bookings) {
  const userId = uuid(6, 1)
  const courtValues = Array.from({ length: 5 }, (_, index) =>
    `(${sqlString(uuid(5, index + 1))}::uuid)`,
  ).join(',\n')
  const bookingValues = bookings.map((booking) => `(
    ${sqlString(booking.id)}::uuid,
    ${sqlString(userId)}::uuid,
    ${sqlString(booking.courtId)}::uuid,
    ${sqlString(booking.start)}::timestamp,
    ${sqlString(booking.end)}::timestamp,
    ${sqlString(booking.status)}::public.booking_status,
    ${sqlString(booking.paymentStatus)}::public.payment_status,
    'venue'::public.payment_method,
    ${booking.amount}::numeric,
    'CAD'::character(3),
    2::smallint,
    null,
    null,
    null,
    ${booking.status === 'cancelled' ? `${sqlString(booking.updatedAt)}::timestamptz` : 'null'},
    ${sqlString(booking.createdAt)}::timestamptz,
    ${sqlString(booking.updatedAt)}::timestamptz,
    ${sqlString(booking.customerName)},
    ${sqlString(booking.customerEmail)},
    ${sqlString(booking.customerPhone)},
    ${sqlString(booking.customerNotes)},
    ${sqlString(booking.groupId)}::uuid,
    ${booking.recurrenceSeriesId ? `${sqlString(booking.recurrenceSeriesId)}::uuid` : 'null'},
    ${booking.recurrenceWeek ?? 'null'},
    ${booking.amount}::numeric,
    'system',
    null,
    null,
    null,
    ${booking.linkId ? `${sqlString(booking.linkId)}::uuid` : 'null'}
  )`).join(',\n')

  return `
    insert into auth.users (id) values (${sqlString(userId)}::uuid);
    insert into public.staff_members (user_id, role)
    values (${sqlString(userId)}::uuid, 'admin');
    insert into public.courts (id) values ${courtValues};
    insert into public.venue_settings (singleton, timezone, currency)
    values (true, 'America/Toronto', 'CAD');

    insert into public.bookings (
      id, user_id, court_id, start_at, end_at, status, payment_status,
      payment_method, total_amount, currency, party_size, hold_expires_at,
      stripe_checkout_session_id, stripe_payment_intent_id, cancelled_at,
      created_at, updated_at, customer_name, customer_email, customer_phone,
      customer_notes, booking_group_id, recurrence_series_id, recurrence_week,
      system_calculated_amount, price_source, price_override_amount,
      price_overridden_by, price_overridden_at, booking_link_id
    ) values ${bookingValues};

    insert into public.court_slots (
      id, court_id, start_at, end_at, status, updated_at
    )
    select id, court_id, start_at, end_at, status, updated_at
    from public.bookings
    where status in ('held', 'confirmed');
  `
}

function auditAndTriggerSql(auditedBookingIds) {
  const audited = auditedBookingIds.map(sqlString).join(', ')
  const duplicate = sqlString(auditedBookingIds[0])
  return `
    insert into private.app_audit_events (
      occurred_at, operation_id, event_type, entity_type, entity_id,
      actor_kind, source, before_state, after_state, changed_fields, metadata
    )
    select
      '2026-08-20 14:00:00+00'::timestamptz,
      'synthetic-payment-operation-a',
      'booking.payment_updated',
      'booking',
      booking.id::text,
      'manager',
      'manager_schedule',
      to_jsonb(booking) || jsonb_build_object('payment_status', 'pay_at_venue'),
      to_jsonb(booking),
      array['payment_status']::text[],
      jsonb_build_object('schema_version', 1)
    from public.bookings as booking
    where booking.id::text in (${audited});

    insert into private.app_audit_events (
      occurred_at, operation_id, event_type, entity_type, entity_id,
      actor_kind, source, before_state, after_state, changed_fields, metadata
    )
    select
      '2026-08-21 14:00:00+00'::timestamptz,
      'synthetic-payment-operation-b',
      'booking.payment_updated',
      'booking',
      booking.id::text,
      'manager',
      'manager_schedule',
      to_jsonb(booking) || jsonb_build_object('payment_status', 'pay_at_venue'),
      to_jsonb(booking),
      array['payment_status']::text[],
      jsonb_build_object('schema_version', 1)
    from public.bookings as booking
    where booking.id::text = ${duplicate};

    create function private.capture_booking_audit_event()
    returns trigger language plpgsql security definer set search_path = '' as $$
    declare
      v_before jsonb := to_jsonb(old);
      v_after jsonb := to_jsonb(new);
      v_changed_fields text[];
    begin
      select coalesce(array_agg(field order by field), '{}'::text[])
        into v_changed_fields
      from (
        select coalesce(before_field.key, after_field.key) as field
        from jsonb_each(v_before) as before_field
        full join jsonb_each(v_after) as after_field using (key)
        where before_field.value is distinct from after_field.value
      ) as changed;

      insert into private.app_audit_events (
        operation_id, event_type, entity_type, entity_id, actor_kind,
        source, before_state, after_state, changed_fields, metadata
      ) values (
        coalesce(nullif(current_setting('app.audit_operation_id', true), ''), txid_current()::text),
        coalesce(nullif(current_setting('app.audit_event_type', true), ''), 'booking.details_updated'),
        'booking', new.id::text, 'system',
        coalesce(nullif(current_setting('app.audit_source', true), ''), 'database'),
        v_before, v_after, v_changed_fields, jsonb_build_object('schema_version', 1)
      );
      return new;
    end;
    $$;

    create trigger bookings_capture_audit_event
    after update on public.bookings
    for each row execute function private.capture_booking_audit_event();

    create trigger bookings_set_updated_at
    before update on public.bookings
    for each row execute function public.set_updated_at();

    create function public.sync_public_court_slot()
    returns trigger language plpgsql set search_path = '' as $$
    begin
      if new.status in ('held', 'confirmed') then
        insert into public.court_slots (
          id, court_id, start_at, end_at, status, updated_at
        ) values (
          new.id, new.court_id, new.start_at, new.end_at,
          new.status, statement_timestamp()
        )
        on conflict (id) do update set
          court_id = excluded.court_id,
          start_at = excluded.start_at,
          end_at = excluded.end_at,
          status = excluded.status,
          updated_at = excluded.updated_at;
      else
        delete from public.court_slots where id = new.id;
      end if;
      return new;
    end;
    $$;

    create trigger bookings_sync_public_slot
    after update on public.bookings
    for each row execute function public.sync_public_court_slot();
  `
}

async function scalar(db, sql, column) {
  const result = await db.query(sql)
  return result.rows[0][column]
}

async function fingerprints(db) {
  // Match the migration's session setting exactly. PostgreSQL renders
  // timestamptz values in JSON using the active timezone, so otherwise an
  // equivalent PGlite row can hash differently before SET LOCAL timezone.
  await db.exec("set timezone = 'UTC';")
  return {
    booking: await scalar(db, `
      select md5(coalesce(string_agg(to_jsonb(booking)::text, '' order by booking.id), '')) as value
      from public.bookings as booking
    `, 'value'),
    bookingPayload: await scalar(db, `
      select md5(coalesce(string_agg(
        (to_jsonb(booking) - 'reservation_id' - 'session_id')::text,
        '' order by booking.id
      ), '')) as value
      from public.bookings as booking
    `, 'value'),
    slots: await scalar(db, `
      select md5(coalesce(string_agg(to_jsonb(slot)::text, '' order by slot.id), '')) as value
      from public.court_slots as slot
    `, 'value'),
    paymentAudit: await scalar(db, `
      select md5(coalesce(string_agg(to_jsonb(event)::text, '' order by event.id), '')) as value
      from private.app_audit_events as event
      where event.event_type = 'booking.payment_updated'
    `, 'value'),
  }
}

function specialize(sql, localFingerprints) {
  let result = sql
  for (const [key, production] of Object.entries(productionFingerprints)) {
    result = result.replaceAll(production, localFingerprints[key])
  }
  return result
}

async function buildDatabase(options = {}) {
  const db = options.db ?? new PGlite()
  const bookings = buildBookings()
  await db.exec(baseSchemaSql(options))
  await db.exec(bookingSeedSql(bookings))
  await db.exec(await readFile(phase1Path, 'utf8'))

  const linkedAuditBookings = bookings
    .filter((booking) => booking.linkId === uuid(3, 5))
    .filter((booking, index, rows) =>
      rows.findIndex((row) => row.groupId === booking.groupId) === index,
    )
    .slice(0, 5)
    .map((booking) => booking.id)
  assert.equal(linkedAuditBookings.length, 5)
  await db.exec(auditAndTriggerSql(linkedAuditBookings))

  if (options.customerMismatch) {
    await db.exec(`
      update public.bookings
      set customer_name = 'Conflicting synthetic customer'
      where id = ${sqlString(bookings.find((booking) => booking.groupId === uuid(2, 5)).id)}::uuid
    `)
  }

  if (options.dstValue) {
    const target = bookings.find((booking) => booking.status === 'confirmed')
    await db.exec(`
      update public.bookings
      set start_at = ${sqlString(options.dstValue)}::timestamp,
          end_at = ${sqlString(options.dstEndValue)}::timestamp
      where id = ${sqlString(target.id)}::uuid
    `)
  }

  if (options.paymentAuditMismatch) {
    await db.exec(`
      update private.app_audit_events
      set after_state = jsonb_set(after_state, '{total_amount}', '999'::jsonb)
      where event_type = 'booking.payment_updated'
    `)
  }

  const localFingerprints = await fingerprints(db)
  const migration = specialize(await readFile(phase2Path, 'utf8'), localFingerprints)
  const diagnostic = specialize(await readFile(diagnosticPath, 'utf8'), localFingerprints)
  return { db, migration, diagnostic }
}

async function rollbackAfterFailure(db) {
  await db.exec('rollback;').catch(() => {})
  const counts = await db.query(`
    select
      (select count(*) from public.reservations)::integer as reservations,
      (select count(*) from public.payments)::integer as payments,
      (select count(*) from public.bookings
        where reservation_id is not null or session_id is not null)::integer as owned
  `)
  assert.deepEqual(counts.rows[0], { reservations: 0, payments: 0, owned: 0 })
}

async function mappingFingerprint(db) {
  return scalar(db, `
    select md5(concat_ws('|',
      (select string_agg(id::text, '' order by id) from public.recurrence_series),
      (select string_agg(id::text || ':' || reference_number::text, '' order by id)
        from public.reservations),
      (select string_agg(id::text || ':' || reservation_id::text, '' order by id)
        from public.reservation_parties),
      (select string_agg(reservation_id::text || ':' || party_id::text || ':' || role,
          '' order by reservation_id, party_id, role)
        from public.reservation_party_roles),
      (select string_agg(id::text || ':' || reservation_id::text, '' order by id)
        from public.reservation_sessions),
      (select string_agg(id::text || ':' || idempotency_key, '' order by id)
        from public.payments),
      (select string_agg(id::text || ':' || idempotency_key, '' order by id)
        from public.payment_allocation_entries),
      (select string_agg(id::text || ':' || reservation_id::text || ':' || session_id::text,
          '' order by id)
        from public.bookings)
    )) as value
  `, 'value')
}

test('Phase 2 deterministically backfills the frozen aggregate and ledger', async () => {
  const { db, migration, diagnostic } = await buildDatabase()
  let comparisonDb
  try {
    await db.exec(migration)
    await db.exec(diagnostic)
    const result = await db.query(`
      select
        (select count(*) from public.reservations)::integer as reservations,
        (select count(*) from public.reservation_sessions)::integer as sessions,
        (select count(*) from public.bookings)::integer as bookings,
        (select count(*) from public.reservation_parties)::integer as parties,
        (select count(*) from public.payments)::integer as payments,
        (select count(*) from public.payment_allocation_entries)::integer as allocations,
        (select round(sum(amount), 2) from public.payments)::text as amount
    `)
    assert.deepEqual(result.rows[0], {
      reservations: 123,
      sessions: 135,
      bookings: 192,
      parties: 131,
      payments: 23,
      allocations: 26,
      amount: '1642.00',
    })

    const comparison = await buildDatabase()
    comparisonDb = comparison.db
    await comparisonDb.exec(comparison.migration)
    assert.equal(await mappingFingerprint(comparisonDb), await mappingFingerprint(db))
  } finally {
    if (comparisonDb) await comparisonDb.close()
    await db.close()
  }
})

test('Phase 2 fails closed on conflicting customer snapshots', async () => {
  const { db, migration } = await buildDatabase({ customerMismatch: true })
  try {
    await assert.rejects(db.exec(migration), /conflicting customer snapshots/)
    await rollbackAfterFailure(db)
  } finally {
    await db.close()
  }
})

for (const scenario of [
  {
    name: 'nonexistent Toronto wall-clock time',
    start: '2026-03-08 02:30:00',
    end: '2026-03-08 03:30:00',
  },
  {
    name: 'ambiguous Toronto wall-clock time',
    start: '2026-11-01 01:30:00',
    end: '2026-11-01 02:30:00',
  },
]) {
  test(`Phase 2 fails closed on a ${scenario.name}`, async () => {
    const { db, migration } = await buildDatabase({
      dstValue: scenario.start,
      dstEndValue: scenario.end,
    })
    try {
      await assert.rejects(db.exec(migration), /nonexistent or ambiguous Toronto timestamps/)
      await rollbackAfterFailure(db)
    } finally {
      await db.close()
    }
  })
}

test('Phase 2 fails closed on contradictory payment audit evidence', async () => {
  const { db, migration } = await buildDatabase({ paymentAuditMismatch: true })
  try {
    await assert.rejects(db.exec(migration), /payment amount\/currency mismatches/)
    await rollbackAfterFailure(db)
  } finally {
    await db.close()
  }
})

test('Phase 2 fails closed on a deterministic UUID collision', async () => {
  const { db, migration } = await buildDatabase({ forceSessionCollision: true })
  try {
    await assert.rejects(db.exec(migration), /duplicate key|UUID collision/i)
    await rollbackAfterFailure(db)
  } finally {
    await db.close()
  }
})

test('Phase 2 rejects payment over-allocation and rolls back', async () => {
  const { db, migration } = await buildDatabase()
  const invalidMigration = migration.replace(
    'event.audited_amount::numeric(12,2) as amount,',
    '(event.audited_amount + 1)::numeric(12,2) as amount,',
  )
  assert.notEqual(invalidMigration, migration)
  try {
    await assert.rejects(db.exec(invalidMigration), /incomplete allocations/)
    await rollbackAfterFailure(db)
  } finally {
    await db.close()
  }
})

test('Phase 2 rolls back every write after a late failure', async () => {
  const { db, migration } = await buildDatabase()
  const failingMigration = migration.replace(
    /\ncommit;\s*$/,
    '\nselect 1 / 0;\ncommit;',
  )
  assert.notEqual(failingMigration, migration)
  try {
    await assert.rejects(db.exec(failingMigration), /division by zero/)
    await rollbackAfterFailure(db)
  } finally {
    await db.close()
  }
})

async function applyPhase3a(db) {
  await db.exec(await readFile(phase3aPath, 'utf8'))
}

async function applyPhase3aAccessFix(db) {
  await db.exec(await readFile(phase3aAccessFixPath, 'utf8'))
}

async function applyPhase3aPolicyConsolidation(db) {
  await db.exec(await readFile(phase3aPolicyConsolidationPath, 'utf8'))
}

async function applyPhase3bInactiveKernel(db) {
  await db.exec(await readFile(phase3bInactiveKernelPath, 'utf8'))
  await db.exec(await readFile(phase3bWriterInventoryCollationPath, 'utf8'))
}

function uuidArraySql(values) {
  return `array[${values.map((value) => `${sqlString(value)}::uuid`).join(', ')}]::uuid[]`
}

function numericArraySql(values) {
  return `array[${values.map((value) => `${value}::numeric`).join(', ')}]::numeric[]`
}

async function buildPhase3bDatabase(options = {}) {
  const setup = await buildDatabase(options)
  await setup.db.exec(setup.migration)
  await applyPhase3a(setup.db)
  await applyPhase3aAccessFix(setup.db)
  await applyPhase3aPolicyConsolidation(setup.db)
  await applyPhase3bInactiveKernel(setup.db)
  return setup.db
}

async function installWriterInventoryStubs(db) {
  const inventory = await db.query(`
    select signature, writer_kind
    from private.reservation_phase3b_writer_inventory
    where writer_kind in ('direct', 'wrapper')
    order by signature
  `)

  for (const writer of inventory.rows) {
    const body = writer.writer_kind === 'direct'
      ? `update public.bookings set updated_at = updated_at where false;`
      : `perform 1;`
    await db.exec(`
      create or replace function ${writer.signature}
      returns void
      language plpgsql
      security definer
      set search_path = ''
      as $stub$
      begin
        ${body}
      end;
      $stub$;

      revoke all on function ${writer.signature} from public, anon;
      grant execute on function ${writer.signature}
        to authenticated, service_role;
    `)
  }
}

async function prepareTransitionTarget(db, {
  targetReservationId,
  sourcePartyIds,
  targetPartyIds,
  primarySourcePartyId,
  paymentPlan = 'single_payer',
}) {
  assert.equal(sourcePartyIds.length, targetPartyIds.length)
  const actorId = uuid(6, 1)
  const sourceParties = await db.query(`
    select
      party.id,
      party.party_type,
      party.display_name,
      party.email,
      party.phone,
      party.auth_user_id
    from public.reservation_parties as party
    where party.id = any(${uuidArraySql(sourcePartyIds)})
    order by array_position(${uuidArraySql(sourcePartyIds)}, party.id)
  `)
  assert.equal(sourceParties.rows.length, sourcePartyIds.length)

  await db.exec(`
    insert into public.reservations (
      id, currency, payment_plan, source, created_by
    ) values (
      ${sqlString(targetReservationId)}::uuid,
      'CAD',
      ${sqlString(paymentPlan)},
      'system',
      ${sqlString(actorId)}::uuid
    );
  `)

  for (let index = 0; index < sourceParties.rows.length; index += 1) {
    const source = sourceParties.rows[index]
    const targetPartyId = targetPartyIds[index]
    await db.exec(`
      insert into public.reservation_parties (
        id, reservation_id, party_type, display_name, email, phone,
        auth_user_id, source, created_by
      ) values (
        ${sqlString(targetPartyId)}::uuid,
        ${sqlString(targetReservationId)}::uuid,
        ${sqlString(source.party_type)},
        ${sqlString(source.display_name)},
        ${sqlString(source.email)},
        ${sqlString(source.phone)},
        ${source.auth_user_id ? `${sqlString(source.auth_user_id)}::uuid` : 'null'},
        'system',
        ${sqlString(actorId)}::uuid
      );

      insert into public.reservation_party_roles (
        reservation_id, party_id, role, created_by
      )
      select
        ${sqlString(targetReservationId)}::uuid,
        ${sqlString(targetPartyId)}::uuid,
        role.role,
        ${sqlString(actorId)}::uuid
      from public.reservation_party_roles as role
      where role.party_id = ${sqlString(source.id)}::uuid
        and role.role <> 'primary_contact'
      on conflict do nothing;
    `)
  }

  const primaryIndex = sourcePartyIds.indexOf(primarySourcePartyId)
  assert.notEqual(primaryIndex, -1)
  const primaryTargetPartyId = targetPartyIds[primaryIndex]
  await db.exec(`
    insert into public.reservation_party_roles (
      reservation_id, party_id, role, created_by
    ) values (
      ${sqlString(targetReservationId)}::uuid,
      ${sqlString(primaryTargetPartyId)}::uuid,
      'primary_contact',
      ${sqlString(actorId)}::uuid
    );
  `)
  return { primaryTargetPartyId }
}

async function shadowMismatchCodes(db) {
  const result = await db.query(`
    select mismatch_code, count(*)::integer as mismatch_count
    from public.reservation_shadow_mismatches
    group by mismatch_code
    order by mismatch_code
  `)
  return result.rows
}

test('Phase 3A installs an inactive, clean, idempotent compatibility foundation', async () => {
  const { db, migration } = await buildDatabase()
  try {
    await db.exec(migration)
    await applyPhase3a(db)
    await applyPhase3aAccessFix(db)
    await applyPhase3aPolicyConsolidation(db)

    const securityBoundary = await db.query(`
      select
        coalesce('security_invoker=true' = any(view.reloptions), false)
          as shadow_security_invoker,
        not has_table_privilege(
          'anon',
          'public.reservation_shadow_mismatches',
          'select'
        )
          and has_table_privilege(
            'authenticated',
            'public.reservation_shadow_mismatches',
            'select'
          )
          and not has_table_privilege(
            'service_role',
            'public.reservation_shadow_mismatches',
            'select'
          ) as shadow_grants_are_minimal,
        diagnostic.prosecdef = false
          and diagnostic.proconfig is not null
          and (
            'search_path=' = any(diagnostic.proconfig)
            or 'search_path=""' = any(diagnostic.proconfig)
          ) as diagnostic_is_invoker_with_empty_path,
        not has_function_privilege(
          'anon',
          'public.admin_get_reservation_shadow_status(integer)',
          'execute'
        )
          and has_function_privilege(
            'authenticated',
            'public.admin_get_reservation_shadow_status(integer)',
            'execute'
          )
          and not has_function_privilege(
            'service_role',
            'public.admin_get_reservation_shadow_status(integer)',
            'execute'
          ) as diagnostic_grants_are_minimal,
        not has_function_privilege(
          'anon',
          'private.catch_up_reservation_aggregates(uuid,integer)',
          'execute'
        )
          and not has_function_privilege(
            'authenticated',
            'private.catch_up_reservation_aggregates(uuid,integer)',
            'execute'
          )
          and not has_function_privilege(
            'service_role',
            'private.catch_up_reservation_aggregates(uuid,integer)',
            'execute'
          ) as catch_up_has_no_client_execute,
        has_column_privilege(
          'authenticated',
          'public.venue_settings',
          'timezone',
          'select'
        )
          and (
            select count(*) = 1
            from information_schema.column_privileges as privilege
            where privilege.table_schema = 'public'
              and privilege.table_name = 'venue_settings'
              and privilege.grantee = 'authenticated'
              and privilege.privilege_type = 'SELECT'
          )
          and (
            select count(*) = 1
            from information_schema.column_privileges as privilege
            where privilege.table_schema = 'public'
              and privilege.table_name = 'venue_settings'
              and privilege.grantee = 'authenticated'
          ) as timezone_grant_is_column_only,
        not exists (
          select 1
          from pg_policies as policy
          where policy.schemaname = 'public'
            and policy.tablename = 'venue_settings'
            and policy.policyname = 'venue_settings_rpc_only'
        )
          and (
            select count(*) = 1
            from pg_policies as policy
            where policy.schemaname = 'public'
              and policy.tablename = 'venue_settings'
              and policy.permissive = 'PERMISSIVE'
              and policy.roles @> array['authenticated']::name[]
              and policy.cmd in ('ALL', 'SELECT')
          )
          and not exists (
            select 1
            from pg_policies as policy
            where policy.schemaname = 'public'
              and policy.tablename = 'venue_settings'
              and policy.roles @> array['authenticated']::name[]
              and policy.cmd in ('ALL', 'INSERT', 'UPDATE', 'DELETE')
          )
          and not has_table_privilege(
            'authenticated',
            'public.venue_settings',
            'select'
          )
          and not has_table_privilege(
            'authenticated',
            'public.venue_settings',
            'insert'
          )
          and not has_table_privilege(
            'authenticated',
            'public.venue_settings',
            'update'
          )
          and not has_table_privilege(
            'authenticated',
            'public.venue_settings',
            'delete'
          ) as venue_settings_policy_is_consolidated
      from pg_class as view
      join pg_namespace as view_schema on view_schema.oid = view.relnamespace
      cross join pg_proc as diagnostic
      where view_schema.nspname = 'public'
        and view.relname = 'reservation_shadow_mismatches'
        and diagnostic.oid =
          'public.admin_get_reservation_shadow_status(integer)'::regprocedure
    `)
    assert.deepEqual(securityBoundary.rows, [{
      shadow_security_invoker: true,
      shadow_grants_are_minimal: true,
      diagnostic_is_invoker_with_empty_path: true,
      diagnostic_grants_are_minimal: true,
      catch_up_has_no_client_execute: true,
      timezone_grant_is_column_only: true,
      venue_settings_policy_is_consolidated: true,
    }])

    const managerId = uuid(6, 1)
    await db.exec(`
      select set_config(
        'request.jwt.claim.sub',
        ${sqlString(managerId)},
        false
      );
      set role authenticated;
    `)
    const managerShadow = await db.query(`
      select count(*)::integer as mismatch_count
      from public.reservation_shadow_mismatches
    `)
    assert.equal(managerShadow.rows[0].mismatch_count, 0)
    const managerStatus = await db.query(`
      select public.admin_get_reservation_shadow_status(10) as result
    `)
    assert.equal(managerStatus.rows[0].result.status, 'clean')
    assert.equal(managerStatus.rows[0].result.mismatch_count, 0)
    const managerTimezone = await db.query(`
      select timezone from public.venue_settings
    `)
    assert.deepEqual(managerTimezone.rows, [{ timezone: 'America/Toronto' }])
    await assert.rejects(
      db.query('select currency from public.venue_settings'),
      /permission denied/,
    )
    await assert.rejects(
      db.query(`
        update public.venue_settings
        set timezone = timezone
        returning timezone
      `),
      /permission denied/,
    )
    await db.exec('reset role;')

    const nonManagerId = uuid(9, 2)
    await db.exec(`
      insert into auth.users (id) values (${sqlString(nonManagerId)}::uuid);
      select set_config(
        'request.jwt.claim.sub',
        ${sqlString(nonManagerId)},
        false
      );
      set role authenticated;
    `)
    const nonManagerShadow = await db.query(`
      select count(*)::integer as mismatch_count
      from public.reservation_shadow_mismatches
    `)
    assert.equal(nonManagerShadow.rows[0].mismatch_count, 0)
    const nonManagerTimezone = await db.query(`
      select timezone from public.venue_settings
    `)
    assert.deepEqual(nonManagerTimezone.rows, [])
    await assert.rejects(
      db.exec('select public.admin_get_reservation_shadow_status(10);'),
      /Manager access required/,
    )
    await db.exec('reset role;')

    assert.deepEqual(await shadowMismatchCodes(db), [])
    await db.exec('select private.assert_reservation_shadow_clean();')

    const before = await mappingFingerprint(db)
    const auditBefore = await scalar(db, `
      select count(*)::integer as value
      from private.app_audit_events
    `, 'value')
    const first = await db.query(`
      select private.catch_up_reservation_aggregates(null, 100) as result
    `)
    assert.equal(first.rows[0].result.processed_group_count, 100)
    assert.equal(first.rows[0].result.has_more, true)

    const second = await db.query(`
      select private.catch_up_reservation_aggregates(
        ${(first.rows[0].result.last_group_id
          ? sqlString(first.rows[0].result.last_group_id)
          : 'null')}::uuid,
        100
      ) as result
    `)
    assert.equal(second.rows[0].result.processed_group_count, 31)
    assert.equal(second.rows[0].result.has_more, false)
    assert.equal(await mappingFingerprint(db), before)
    assert.equal(await scalar(db, `
      select count(*)::integer as value
      from private.app_audit_events
    `, 'value'), auditBefore)
    assert.deepEqual(await shadowMismatchCodes(db), [])
  } finally {
    await db.close()
  }
})

test('Phase 3A policy consolidation fails closed on authenticated DML grant drift', async () => {
  const { db, migration } = await buildDatabase()
  try {
    await db.exec(migration)
    await applyPhase3a(db)
    await applyPhase3aAccessFix(db)
    await db.exec(`
      grant update (currency)
        on table public.venue_settings
        to authenticated;
    `)
    const before = await mappingFingerprint(db)

    await assert.rejects(
      applyPhase3aPolicyConsolidation(db),
      /authenticated venue_settings column privileges must be timezone SELECT only/,
    )
    await db.exec('rollback;').catch(() => {})

    assert.equal(await mappingFingerprint(db), before)
    assert.equal(await scalar(db, `
      select count(*)::integer as value
      from pg_policies as policy
      where policy.schemaname = 'public'
        and policy.tablename = 'venue_settings'
        and policy.policyname = 'venue_settings_rpc_only'
    `, 'value'), 1)
    assert.equal(await scalar(db, `
      select has_column_privilege(
        'authenticated',
        'public.venue_settings',
        'currency',
        'update'
      ) as value
    `, 'value'), true)
  } finally {
    await db.close()
  }
})

test('Phase 3A deterministically catches up a new unowned booking without duplicating facts', async () => {
  const { db, migration } = await buildDatabase()
  const bookingId = uuid(8, 1)
  const groupId = uuid(8, 2)
  const userId = uuid(6, 1)
  const courtId = uuid(5, 1)
  try {
    await db.exec(migration)
    await applyPhase3a(db)
    await db.exec(`
      insert into public.bookings (
        id, user_id, court_id, start_at, end_at, status, payment_status,
        payment_method, total_amount, currency, party_size, hold_expires_at,
        stripe_checkout_session_id, stripe_payment_intent_id, cancelled_at,
        created_at, updated_at, customer_name, customer_email, customer_phone,
        customer_notes, booking_group_id, recurrence_series_id, recurrence_week,
        system_calculated_amount, price_source, price_override_amount,
        price_overridden_by, price_overridden_at, booking_link_id
      ) values (
        ${sqlString(bookingId)}::uuid,
        ${sqlString(userId)}::uuid,
        ${sqlString(courtId)}::uuid,
        '2027-04-01 10:00:00'::timestamp,
        '2027-04-01 11:00:00'::timestamp,
        'confirmed',
        'pay_at_venue',
        'venue',
        44,
        'CAD',
        2,
        null,
        null,
        null,
        null,
        '2026-08-24 06:00:00+00'::timestamptz,
        '2026-08-24 06:00:00+00'::timestamptz,
        'Phase 3 synthetic customer',
        'phase3@example.invalid',
        '5550000000',
        null,
        ${sqlString(groupId)}::uuid,
        null,
        null,
        44,
        'system',
        null,
        null,
        null,
        null
      );
    `)

    assert.deepEqual(await shadowMismatchCodes(db), [
      { mismatch_code: 'booking_unowned', mismatch_count: 1 },
      { mismatch_code: 'group_ownership_mismatch', mismatch_count: 1 },
    ])

    await db.exec('select private.catch_up_reservation_aggregates(null, 200);')
    await db.exec('select private.assert_reservation_shadow_clean();')

    const ownership = await db.query(`
      select reservation_id, session_id, updated_at
      from public.bookings
      where id = ${sqlString(bookingId)}::uuid
    `)
    assert.ok(ownership.rows[0].reservation_id)
    assert.ok(ownership.rows[0].session_id)
    assert.equal(
      new Date(ownership.rows[0].updated_at).toISOString(),
      '2026-08-24T06:00:00.000Z',
    )

    const countsBeforeRetry = await db.query(`
      select
        (select count(*) from public.reservations)::integer as reservations,
        (select count(*) from public.reservation_sessions)::integer as sessions,
        (select count(*) from public.reservation_parties)::integer as parties,
        (select count(*) from public.reservation_legacy_sources)::integer as sources
    `)
    await db.exec('select private.catch_up_reservation_aggregates(null, 200);')
    const countsAfterRetry = await db.query(`
      select
        (select count(*) from public.reservations)::integer as reservations,
        (select count(*) from public.reservation_sessions)::integer as sessions,
        (select count(*) from public.reservation_parties)::integer as parties,
        (select count(*) from public.reservation_legacy_sources)::integer as sources
    `)
    assert.deepEqual(countsAfterRetry.rows[0], countsBeforeRetry.rows[0])
    assert.deepEqual(await shadowMismatchCodes(db), [])
  } finally {
    await db.close()
  }
})

test('Phase 3A fails closed when one legacy group points at multiple auth users', async () => {
  const { db, migration } = await buildDatabase()
  const conflictingUserId = uuid(9, 1)
  const groupId = uuid(2, 1)
  try {
    await db.exec(migration)
    await applyPhase3a(db)
    await db.exec(`
      insert into auth.users (id) values (${sqlString(conflictingUserId)}::uuid);
      update public.bookings
         set user_id = ${sqlString(conflictingUserId)}::uuid
       where id = (
         select booking.id
         from public.bookings as booking
         where booking.booking_group_id = ${sqlString(groupId)}::uuid
         order by booking.id
         limit 1
       );
    `)

    assert.deepEqual(
      (await shadowMismatchCodes(db)).filter(
        (row) => row.mismatch_code === 'group_aggregate_facts_inconsistent',
      ),
      [{ mismatch_code: 'group_aggregate_facts_inconsistent', mismatch_count: 1 }],
    )
    await assert.rejects(
      db.exec(`
        select private.reconcile_legacy_booking_group(
          ${sqlString(groupId)}::uuid,
          null,
          'system'
        );
      `),
      /conflicting aggregate facts/,
    )
  } finally {
    await db.close()
  }
})

test('Phase 3A fails closed when a legacy link would merge owned Reservations', async () => {
  const { db, migration } = await buildDatabase()
  const linkId = uuid(9, 1)
  const sourceGroupId = uuid(2, 20)
  const targetGroupId = uuid(2, 21)
  try {
    await db.exec(migration)
    await applyPhase3a(db)
    const before = await db.query(`
      select booking_group_id, min(reservation_id::text) as reservation_id
      from public.bookings
      where booking_group_id in (
        ${sqlString(sourceGroupId)}::uuid,
        ${sqlString(targetGroupId)}::uuid
      )
      group by booking_group_id
      order by booking_group_id
    `)

    await db.exec(`
      update public.bookings
      set booking_link_id = ${sqlString(linkId)}::uuid
      where booking_group_id in (
        ${sqlString(sourceGroupId)}::uuid,
        ${sqlString(targetGroupId)}::uuid
      );
    `)

    assert.deepEqual(await shadowMismatchCodes(db), [
      { mismatch_code: 'link_scope_mismatch', mismatch_count: 1 },
    ])
    await assert.rejects(
      db.exec(`select private.reconcile_legacy_booking_group(
        ${sqlString(sourceGroupId)}::uuid,
        null,
        'system'
      );`),
      /relationship transition required/i,
    )

    const after = await db.query(`
      select booking_group_id, min(reservation_id::text) as reservation_id
      from public.bookings
      where booking_group_id in (
        ${sqlString(sourceGroupId)}::uuid,
        ${sqlString(targetGroupId)}::uuid
      )
      group by booking_group_id
      order by booking_group_id
    `)
    assert.deepEqual(after.rows, before.rows)
    await assert.rejects(
      db.exec('select private.assert_reservation_shadow_clean();'),
      /link_scope_mismatch/,
    )
  } finally {
    await db.close()
  }
})

test('Phase 3A reports payment drift without inventing a receipt', async () => {
  const { db, migration } = await buildDatabase()
  try {
    await db.exec(migration)
    await applyPhase3a(db)
    const booking = await db.query(`
      select id
      from public.bookings
      where payment_status = 'pay_at_venue'
      order by id
      limit 1
    `)
    const paymentCount = await scalar(db, `
      select count(*)::integer as value from public.payments
    `, 'value')

    await db.exec(`
      update public.bookings
      set payment_status = 'paid'
      where id = ${sqlString(booking.rows[0].id)}::uuid;
    `)

    assert.deepEqual(await shadowMismatchCodes(db), [
      { mismatch_code: 'booking_payment_balance_mismatch', mismatch_count: 1 },
    ])
    await db.exec('select private.catch_up_reservation_aggregates(null, 200);')
    assert.equal(await scalar(db, `
      select count(*)::integer as value from public.payments
    `, 'value'), paymentCount)
    assert.deepEqual(await shadowMismatchCodes(db), [
      { mismatch_code: 'booking_payment_balance_mismatch', mismatch_count: 1 },
    ])
  } finally {
    await db.close()
  }
})

test('Phase 3B.1 installs an inactive private kernel without replacing writers', async () => {
  const { db, migration } = await buildDatabase()
  try {
    await db.exec(migration)
    await applyPhase3a(db)
    await applyPhase3aAccessFix(db)
    await applyPhase3aPolicyConsolidation(db)

    const publicFunctionsBefore = await scalar(db, `
      select md5(coalesce(string_agg(
        routine.oid::regprocedure::text || ':' || pg_get_functiondef(routine.oid),
        '' order by routine.oid::regprocedure::text
      ), '')) as value
      from pg_proc as routine
      join pg_namespace as schema on schema.oid = routine.pronamespace
      where schema.nspname = 'public'
    `, 'value')

    await applyPhase3bInactiveKernel(db)

    const inactive = await db.query(`
      select private.assert_reservation_phase3b_kernel_inactive() as result
    `)
    assert.equal(inactive.rows[0].result.status, 'inactive')
    assert.equal(inactive.rows[0].result.transition_count, 0)
    assert.equal(inactive.rows[0].result.membership_count, 0)
    assert.equal(inactive.rows[0].result.operation_count, 0)

    assert.equal(await scalar(db, `
      select md5(coalesce(string_agg(
        routine.oid::regprocedure::text || ':' || pg_get_functiondef(routine.oid),
        '' order by routine.oid::regprocedure::text
      ), '')) as value
      from pg_proc as routine
      join pg_namespace as schema on schema.oid = routine.pronamespace
      where schema.nspname = 'public'
    `, 'value'), publicFunctionsBefore)

    const boundary = await db.query(`
      select
        (select count(*) = 6
          from pg_class as relation
          join pg_namespace as schema on schema.oid = relation.relnamespace
          where schema.nspname = 'public'
            and relation.relname in (
              'reservation_transitions',
              'reservation_transition_sources',
              'reservation_transition_targets',
              'reservation_transition_allocations',
              'reservation_transition_parties',
              'reservation_allocation_memberships'
            )
            and relation.relrowsecurity
            and relation.relforcerowsecurity
        ) as all_new_tables_force_rls,
        not has_function_privilege(
          'anon',
          'private.reservation_phase3b_record_payment(uuid,uuid[],numeric[],text,text,timestamp with time zone,uuid,uuid)',
          'execute'
        )
          and not has_function_privilege(
            'authenticated',
            'private.reservation_phase3b_record_payment(uuid,uuid[],numeric[],text,text,timestamp with time zone,uuid,uuid)',
            'execute'
          )
          and not has_function_privilege(
            'service_role',
            'private.reservation_phase3b_record_payment(uuid,uuid[],numeric[],text,text,timestamp with time zone,uuid,uuid)',
            'execute'
          ) as private_payment_has_no_client_execute,
        not has_table_privilege(
          'authenticated',
          'public.reservation_transitions',
          'insert'
        )
          and not has_table_privilege(
            'authenticated',
            'public.reservation_transitions',
            'update'
          )
          and not has_table_privilege(
            'authenticated',
            'public.reservation_transitions',
            'delete'
          ) as transition_dml_is_private,
        exists (
          select 1
          from pg_constraint as constraint_row
          where constraint_row.conrelid =
            'public.payment_allocation_entries'::regclass
            and constraint_row.conname =
              'payment_allocation_entries_booking_fkey'
            and constraint_row.contype = 'f'
            and constraint_row.confrelid = 'public.bookings'::regclass
            and cardinality(constraint_row.conkey) = 1
            and cardinality(constraint_row.confkey) = 1
            and constraint_row.convalidated
        ) as payment_fk_supports_effective_scope,
        not exists (
          select 1
          from pg_constraint as foreign_key
          where foreign_key.contype = 'f'
            and foreign_key.conrelid in (
              'private.reservation_phase3b_operations'::regclass,
              'public.reservation_transitions'::regclass,
              'public.reservation_transition_sources'::regclass,
              'public.reservation_transition_targets'::regclass,
              'public.reservation_transition_allocations'::regclass,
              'public.reservation_transition_parties'::regclass,
              'public.reservation_allocation_memberships'::regclass
            )
            and not exists (
              select 1
              from pg_index as index_row
              where index_row.indrelid = foreign_key.conrelid
                and index_row.indisvalid
                and index_row.indisready
                and index_row.indnkeyatts >= cardinality(foreign_key.conkey)
                and (
                  select count(distinct foreign_key_column.attnum)
                  from unnest(foreign_key.conkey)
                    as foreign_key_column(attnum)
                  join unnest(index_row.indkey::smallint[]) with ordinality
                    as index_column(attnum, position)
                    on index_column.attnum = foreign_key_column.attnum
                   and index_column.position <= cardinality(foreign_key.conkey)
                ) = cardinality(foreign_key.conkey)
            )
        ) as all_new_foreign_keys_indexed
    `)
    assert.deepEqual(boundary.rows, [{
      all_new_tables_force_rls: true,
      private_payment_has_no_client_execute: true,
      transition_dml_is_private: true,
      payment_fk_supports_effective_scope: true,
      all_new_foreign_keys_indexed: true,
    }])
  } finally {
    await db.close()
  }
})

test('Phase 3B.1 idempotently attaches a newly-created legacy group', async () => {
  const db = await buildPhase3bDatabase()
  const bookingId = uuid(8, 11)
  const groupId = uuid(8, 12)
  const userId = uuid(6, 1)
  const courtId = uuid(5, 1)
  try {
    await db.exec(`
      insert into public.bookings (
        id, user_id, court_id, start_at, end_at, status, payment_status,
        payment_method, total_amount, currency, party_size, hold_expires_at,
        stripe_checkout_session_id, stripe_payment_intent_id, cancelled_at,
        created_at, updated_at, customer_name, customer_email, customer_phone,
        customer_notes, booking_group_id, recurrence_series_id, recurrence_week,
        system_calculated_amount, price_source, price_override_amount,
        price_overridden_by, price_overridden_at, booking_link_id
      ) values (
        ${sqlString(bookingId)}::uuid,
        ${sqlString(userId)}::uuid,
        ${sqlString(courtId)}::uuid,
        '2027-06-01 10:00:00'::timestamp,
        '2027-06-01 11:00:00'::timestamp,
        'confirmed', 'pay_at_venue', 'venue', 48, 'CAD', 2,
        null, null, null, null,
        '2026-08-24 15:00:00+00'::timestamptz,
        '2026-08-24 15:00:00+00'::timestamptz,
        'Phase 3B synthetic customer',
        'phase3b@example.invalid',
        '5550000011', null,
        ${sqlString(groupId)}::uuid,
        null, null, 48, 'system', null, null, null, null
      );
    `)

    const operationId = 'phase3b-test-attach-group'
    const first = await db.query(`
      select private.reservation_phase3b_attach_legacy_groups(
        ${uuidArraySql([groupId])},
        ${sqlString(operationId)},
        ${sqlString(userId)}::uuid
      ) as reservation_ids
    `)
    assert.equal(first.rows[0].reservation_ids.length, 1)

    const stateAfterFirst = await db.query(`
      select
        booking.reservation_id,
        booking.session_id,
        membership.origin_reservation_id,
        membership.effective_reservation_id,
        membership.effective_session_id,
        membership.version
      from public.bookings as booking
      join public.reservation_allocation_memberships as membership
        on membership.booking_id = booking.id
      where booking.id = ${sqlString(bookingId)}::uuid
    `)
    assert.equal(stateAfterFirst.rows[0].version, 0)
    assert.equal(
      stateAfterFirst.rows[0].reservation_id,
      stateAfterFirst.rows[0].effective_reservation_id,
    )
    assert.equal(
      stateAfterFirst.rows[0].session_id,
      stateAfterFirst.rows[0].effective_session_id,
    )

    const second = await db.query(`
      select private.reservation_phase3b_attach_legacy_groups(
        ${uuidArraySql([groupId])},
        ${sqlString(operationId)},
        ${sqlString(userId)}::uuid
      ) as reservation_ids
    `)
    assert.deepEqual(second.rows[0], first.rows[0])
    assert.equal(await scalar(db, `
      select count(*)::integer as value
      from private.reservation_phase3b_operations
      where operation_id = ${sqlString(operationId)}
        and status = 'completed'
    `, 'value'), 1)
    assert.deepEqual(await shadowMismatchCodes(db), [])

    await assert.rejects(
      db.exec(`
        select private.reservation_phase3b_attach_legacy_groups(
          ${uuidArraySql([uuid(2, 30)])},
          ${sqlString(operationId)},
          ${sqlString(userId)}::uuid
        )
      `),
      /idempotency key was reused/i,
    )
  } finally {
    await db.close()
  }
})

test('Phase 3B.1 schedule, details, and cancellation primitives are atomic and idempotent', async () => {
  const db = await buildPhase3bDatabase()
  const groupId = uuid(2, 30)
  const actorId = uuid(6, 1)
  try {
    const scope = await db.query(`
      select booking.id, booking.session_id
      from public.bookings as booking
      where booking.booking_group_id = ${sqlString(groupId)}::uuid
      order by booking.id
    `)
    const bookingIds = scope.rows.map((row) => row.id)
    const sessionId = scope.rows[0].session_id
    assert.equal(new Set(scope.rows.map((row) => row.session_id)).size, 1)

    const session = await db.query(`
      select starts_at, ends_at
      from public.reservation_sessions
      where id = ${sqlString(sessionId)}::uuid
    `)
    const newStart = new Date(
      new Date(session.rows[0].starts_at).getTime() + 2 * 60 * 60 * 1000,
    ).toISOString()
    const newEnd = new Date(
      new Date(session.rows[0].ends_at).getTime() + 2 * 60 * 60 * 1000,
    ).toISOString()

    const moved = await db.query(`
      select private.reservation_phase3b_reschedule_session(
        ${sqlString(sessionId)}::uuid,
        ${sqlString(newStart)}::timestamptz,
        ${sqlString(newEnd)}::timestamptz,
        'phase3b-test-reschedule',
        ${sqlString(actorId)}::uuid
      ) as booking_count
    `)
    assert.equal(moved.rows[0].booking_count, bookingIds.length)
    const movedRetry = await db.query(`
      select private.reservation_phase3b_reschedule_session(
        ${sqlString(sessionId)}::uuid,
        ${sqlString(newStart)}::timestamptz,
        ${sqlString(newEnd)}::timestamptz,
        'phase3b-test-reschedule',
        ${sqlString(actorId)}::uuid
      ) as booking_count
    `)
    assert.deepEqual(movedRetry.rows, moved.rows)

    const aligned = await db.query(`
      select count(*)::integer as aligned_count
      from public.bookings as booking
      join public.reservation_sessions as session
        on session.id = booking.session_id
       and session.reservation_id = booking.reservation_id
      cross join public.venue_settings as settings
      where booking.id = any(${uuidArraySql(bookingIds)})
        and booking.start_at = timezone(settings.timezone, session.starts_at)
        and booking.end_at = timezone(settings.timezone, session.ends_at)
    `)
    assert.equal(aligned.rows[0].aligned_count, bookingIds.length)

    await db.exec(`
      select private.reservation_phase3b_update_booking_details(
        ${uuidArraySql(bookingIds)},
        'Updated synthetic customer',
        'updated@example.invalid',
        '5550000030',
        'Updated Phase 3B note',
        4::smallint,
        'phase3b-test-details',
        ${sqlString(actorId)}::uuid
      )
    `)
    const details = await db.query(`
      select distinct customer_name, customer_notes, party_size
      from public.bookings
      where id = any(${uuidArraySql(bookingIds)})
    `)
    assert.deepEqual(details.rows, [{
      customer_name: 'Updated synthetic customer',
      customer_notes: 'Updated Phase 3B note',
      party_size: 4,
    }])

    await db.exec(`
      select private.reservation_phase3b_set_booking_status(
        ${uuidArraySql(bookingIds)},
        'cancelled',
        'phase3b-test-cancel',
        ${sqlString(actorId)}::uuid
      )
    `)
    assert.equal(await scalar(db, `
      select count(*)::integer as value
      from public.court_slots
      where id = any(${uuidArraySql(bookingIds)})
    `, 'value'), 0)

    await db.exec(`
      select private.reservation_phase3b_set_booking_status(
        ${uuidArraySql(bookingIds)},
        'confirmed',
        'phase3b-test-restore',
        ${sqlString(actorId)}::uuid
      )
    `)
    assert.equal(await scalar(db, `
      select count(*)::integer as value
      from public.court_slots
      where id = any(${uuidArraySql(bookingIds)})
    `, 'value'), bookingIds.length)

    const beforeRollback = await db.query(`
      select starts_at, ends_at
      from public.reservation_sessions
      where id = ${sqlString(sessionId)}::uuid
    `)
    await db.exec('begin;')
    await db.exec(`
      select private.reservation_phase3b_reschedule_session(
        ${sqlString(sessionId)}::uuid,
        ${sqlString(new Date(new Date(newStart).getTime() + 3600000).toISOString())}::timestamptz,
        ${sqlString(new Date(new Date(newEnd).getTime() + 3600000).toISOString())}::timestamptz,
        'phase3b-test-reschedule-rollback',
        ${sqlString(actorId)}::uuid
      )
    `)
    await assert.rejects(db.exec('select 1 / 0;'), /division by zero/i)
    await db.exec('rollback;')
    const afterRollback = await db.query(`
      select starts_at, ends_at
      from public.reservation_sessions
      where id = ${sqlString(sessionId)}::uuid
    `)
    assert.deepEqual(afterRollback.rows, beforeRollback.rows)
    assert.equal(await scalar(db, `
      select count(*)::integer as value
      from private.reservation_phase3b_operations
      where operation_id = 'phase3b-test-reschedule-rollback'
    `, 'value'), 0)
  } finally {
    await db.close()
  }
})

test('Phase 3B.1 merges different customers, supports one-payer and AA ledger entries, and reverses without rewriting origins', async () => {
  const db = await buildPhase3bDatabase()
  const actorId = uuid(6, 1)
  const sourceGroupIds = [uuid(2, 20), uuid(2, 21)]
  const targetReservationId = uuid(10, 1)
  try {
    const sources = await db.query(`
      select distinct booking.reservation_id
      from public.bookings as booking
      where booking.booking_group_id = any(${uuidArraySql(sourceGroupIds)})
      order by booking.reservation_id
    `)
    const sourceReservationIds = sources.rows.map((row) => row.reservation_id)
    assert.equal(sourceReservationIds.length, 2)

    const parties = await db.query(`
      select party.id, party.reservation_id
      from public.reservation_parties as party
      where party.reservation_id = any(${uuidArraySql(sourceReservationIds)})
      order by party.id
    `)
    const sourcePartyIds = parties.rows.map((row) => row.id)
    assert.equal(sourcePartyIds.length, 2)
    const targetPartyIds = [uuid(10, 11), uuid(10, 12)]
    const prepared = await prepareTransitionTarget(db, {
      targetReservationId,
      sourcePartyIds,
      targetPartyIds,
      primarySourcePartyId: sourcePartyIds[0],
      paymentPlan: 'split_custom',
    })

    const bookingScope = await db.query(`
      select booking.id, booking.reservation_id, booking.session_id,
        booking.total_amount
      from public.bookings as booking
      where booking.reservation_id = any(${uuidArraySql(sourceReservationIds)})
      order by booking.id
    `)
    const bookingIds = bookingScope.rows.map((row) => row.id)
    const physicalOrigins = new Map(
      bookingScope.rows.map((row) => [row.id, row.reservation_id]),
    )
    const originalSessionIds = [...new Set(
      bookingScope.rows.map((row) => row.session_id),
    )].sort()
    const originalSessions = await db.query(`
      select id, reservation_id, starts_at, ends_at, party_size, notes
      from public.reservation_sessions
      where id = any(${uuidArraySql(originalSessionIds)})
      order by id
    `)
    const bookingTargets = bookingIds.map(() => targetReservationId)

    await assert.rejects(
      db.exec(`
        select private.reservation_phase3b_apply_transition(
          'merge',
          ${uuidArraySql(sourceReservationIds)},
          ${uuidArraySql([uuid(10, 2)])},
          array[null::uuid],
          ${uuidArraySql(bookingIds)},
          ${uuidArraySql(bookingIds.map(() => uuid(10, 2)))},
          ${uuidArraySql(sourcePartyIds)},
          ${uuidArraySql(targetPartyIds)},
          'phase3b-test-ambiguous-primary',
          ${sqlString(actorId)}::uuid
        )
      `),
      /primary|invalid shapes/i,
    )

    await assert.rejects(
      db.exec(`
        select private.reservation_phase3b_apply_transition(
          'merge',
          ${uuidArraySql(sourceReservationIds)},
          ${uuidArraySql([targetReservationId])},
          ${uuidArraySql([prepared.primaryTargetPartyId])},
          ${uuidArraySql(bookingIds)},
          ${uuidArraySql(bookingTargets)},
          ${uuidArraySql([sourcePartyIds[0]])},
          ${uuidArraySql([targetPartyIds[0]])},
          'phase3b-test-incomplete-party-lineage',
          ${sqlString(actorId)}::uuid
        )
      `),
      /Every source Party requires explicit transition lineage/i,
    )

    const merge = await db.query(`
      select private.reservation_phase3b_apply_transition(
        'merge',
        ${uuidArraySql(sourceReservationIds)},
        ${uuidArraySql([targetReservationId])},
        ${uuidArraySql([prepared.primaryTargetPartyId])},
        ${uuidArraySql(bookingIds)},
        ${uuidArraySql(bookingTargets)},
        ${uuidArraySql(sourcePartyIds)},
        ${uuidArraySql(targetPartyIds)},
        'phase3b-test-merge',
        ${sqlString(actorId)}::uuid
      ) as transition_id
    `)
    const transitionId = merge.rows[0].transition_id
    const mergeRetry = await db.query(`
      select private.reservation_phase3b_apply_transition(
        'merge',
        ${uuidArraySql(sourceReservationIds)},
        ${uuidArraySql([targetReservationId])},
        ${uuidArraySql([prepared.primaryTargetPartyId])},
        ${uuidArraySql(bookingIds)},
        ${uuidArraySql(bookingTargets)},
        ${uuidArraySql(sourcePartyIds)},
        ${uuidArraySql(targetPartyIds)},
        'phase3b-test-merge',
        ${sqlString(actorId)}::uuid
      ) as transition_id
    `)
    assert.deepEqual(mergeRetry.rows, merge.rows)

    const mergedScope = await db.query(`
      select
        booking.id,
        booking.reservation_id,
        membership.origin_reservation_id,
        membership.effective_reservation_id,
        membership.version,
        booking.booking_link_id
      from public.bookings as booking
      join public.reservation_allocation_memberships as membership
        on membership.booking_id = booking.id
      where booking.id = any(${uuidArraySql(bookingIds)})
      order by booking.id
    `)
    assert.equal(mergedScope.rows.length, bookingIds.length)
    for (const row of mergedScope.rows) {
      assert.equal(row.reservation_id, physicalOrigins.get(row.id))
      assert.equal(row.origin_reservation_id, physicalOrigins.get(row.id))
      assert.equal(row.effective_reservation_id, targetReservationId)
      assert.equal(row.version, 1)
      assert.equal(row.booking_link_id, targetReservationId)
    }
    assert.equal(await scalar(db, `
      select count(*)::integer as value
      from public.reservation_transition_parties
      where transition_id = ${sqlString(transitionId)}::uuid
    `, 'value'), sourcePartyIds.length)

    const firstPartyReservationId = parties.rows.find(
      (row) => row.id === sourcePartyIds[0],
    ).reservation_id
    const firstPartyBookingIds = bookingScope.rows
      .filter((row) => row.reservation_id === firstPartyReservationId)
      .map((row) => row.id)
    const untouchedPartyBefore = await db.query(`
      select display_name, email, phone
      from public.reservation_parties
      where id = ${sqlString(targetPartyIds[1])}::uuid
    `)
    await db.exec(`
      select private.reservation_phase3b_update_booking_details(
        ${uuidArraySql(firstPartyBookingIds)},
        'Updated merged caller',
        'merged-caller@example.invalid',
        '5550009911',
        'Lineage-specific update',
        3::smallint,
        'phase3b-test-merged-details',
        ${sqlString(actorId)}::uuid
      )
    `)
    assert.deepEqual(await db.query(`
      select display_name, email, phone
      from public.reservation_parties
      where id = ${sqlString(targetPartyIds[0])}::uuid
    `).then((result) => result.rows), [{
      display_name: 'Updated merged caller',
      email: 'merged-caller@example.invalid',
      phone: '5550009911',
    }])
    assert.deepEqual(await db.query(`
      select display_name, email, phone
      from public.reservation_parties
      where id = ${sqlString(targetPartyIds[1])}::uuid
    `).then((result) => result.rows), untouchedPartyBefore.rows)

    await assert.rejects(
      db.exec(`
        select private.reservation_phase3b_record_payment(
          ${sqlString(targetReservationId)}::uuid,
          ${uuidArraySql([bookingIds[0]])},
          array[0.001::numeric]::numeric[],
          'venue',
          'phase3b-test-sub-cent-payment',
          '2026-08-24 15:59:00+00'::timestamptz,
          ${sqlString(targetPartyIds[0])}::uuid,
          ${sqlString(actorId)}::uuid
        )
      `),
      /allocations.*invalid/i,
    )
    assert.equal(await scalar(db, `
      select count(*)::integer as value
      from private.reservation_phase3b_operations
      where operation_id = 'phase3b-test-sub-cent-payment'
    `, 'value'), 0)

    const movedSession = await db.query(`
      select distinct
        membership.effective_session_id,
        session.starts_at,
        session.ends_at
      from public.reservation_allocation_memberships as membership
      join public.reservation_sessions as session
        on session.id = membership.effective_session_id
      where membership.booking_id = any(${uuidArraySql(firstPartyBookingIds)})
    `)
    assert.equal(movedSession.rows.length, 1)
    const movedStartsAt = new Date(
      new Date(movedSession.rows[0].starts_at).getTime() + 30 * 60 * 1000,
    ).toISOString()
    const movedEndsAt = new Date(
      new Date(movedSession.rows[0].ends_at).getTime() + 30 * 60 * 1000,
    ).toISOString()
    await db.exec(`
      select private.reservation_phase3b_reschedule_session(
        ${sqlString(movedSession.rows[0].effective_session_id)}::uuid,
        ${sqlString(movedStartsAt)}::timestamptz,
        ${sqlString(movedEndsAt)}::timestamptz,
        'phase3b-test-post-merge-reschedule',
        ${sqlString(actorId)}::uuid
      )
    `)

    const firstAmounts = bookingScope.rows.map((row) => Number(row.total_amount) / 2)
    const paymentOne = await db.query(`
      select private.reservation_phase3b_record_payment(
        ${sqlString(targetReservationId)}::uuid,
        ${uuidArraySql(bookingIds)},
        ${numericArraySql(firstAmounts)},
        'venue',
        'phase3b-test-aa-payment-one',
        '2026-08-24 16:00:00+00'::timestamptz,
        ${sqlString(targetPartyIds[0])}::uuid,
        ${sqlString(actorId)}::uuid
      ) as payment_id
    `)
    const paymentOneId = paymentOne.rows[0].payment_id
    assert.ok(paymentOneId)
    assert.deepEqual(await db.query(`
      select distinct payment_status
      from public.bookings
      where id = any(${uuidArraySql(bookingIds)})
    `).then((result) => result.rows), [{ payment_status: 'pay_at_venue' }])

    const paymentTwo = await db.query(`
      select private.reservation_phase3b_record_payment(
        ${sqlString(targetReservationId)}::uuid,
        ${uuidArraySql(bookingIds)},
        ${numericArraySql(firstAmounts)},
        'venue',
        'phase3b-test-aa-payment-two',
        '2026-08-24 16:05:00+00'::timestamptz,
        ${sqlString(targetPartyIds[1])}::uuid,
        ${sqlString(actorId)}::uuid
      ) as payment_id
    `)
    const paymentTwoId = paymentTwo.rows[0].payment_id
    assert.ok(paymentTwoId)
    assert.notEqual(paymentTwoId, paymentOneId)
    assert.deepEqual(await db.query(`
      select distinct payment_status
      from public.bookings
      where id = any(${uuidArraySql(bookingIds)})
    `).then((result) => result.rows), [{ payment_status: 'paid' }])

    const crossOriginLedger = await db.query(`
      select count(distinct booking.reservation_id)::integer as origin_count
      from public.payment_allocation_entries as entry
      join public.bookings as booking on booking.id = entry.booking_id
      where entry.payment_id = ${sqlString(paymentOneId)}::uuid
        and entry.reservation_id = ${sqlString(targetReservationId)}::uuid
    `)
    assert.equal(crossOriginLedger.rows[0].origin_count, 2)

    const refundableEntries = await db.query(`
      select entry.id
      from public.payment_allocation_entries as entry
      where entry.payment_id = ${sqlString(paymentTwoId)}::uuid
      order by entry.id
    `)
    const entryIds = refundableEntries.rows.map((row) => row.id)
    await db.exec(`
      select private.reservation_phase3b_refund_payment(
        ${sqlString(paymentTwoId)}::uuid,
        array[${entryIds.map((id) => `${id}::bigint`).join(', ')}]::bigint[],
        ${numericArraySql(firstAmounts)},
        'phase3b-test-aa-refund',
        '2026-08-24 16:10:00+00'::timestamptz,
        ${sqlString(actorId)}::uuid
      )
    `)
    assert.deepEqual(await db.query(`
      select distinct payment_status
      from public.bookings
      where id = any(${uuidArraySql(bookingIds)})
    `).then((result) => result.rows), [{ payment_status: 'pay_at_venue' }])

    const reverse = await db.query(`
      select private.reservation_phase3b_reverse_transition(
        ${sqlString(transitionId)}::uuid,
        'phase3b-test-reverse-merge',
        ${sqlString(actorId)}::uuid
      ) as transition_id
    `)
    assert.notEqual(reverse.rows[0].transition_id, transitionId)
    const restored = await db.query(`
      select
        booking.id,
        booking.reservation_id,
        membership.effective_reservation_id,
        membership.effective_session_id,
        membership.version,
        booking.booking_link_id,
        booking.session_id = membership.effective_session_id
          and booking.start_at = timezone(settings.timezone, session.starts_at)
          and booking.end_at = timezone(settings.timezone, session.ends_at)
          as projection_aligned,
        booking.party_size = session.party_size
          and booking.customer_notes is not distinct from session.notes
          as details_aligned
      from public.bookings as booking
      join public.reservation_allocation_memberships as membership
        on membership.booking_id = booking.id
      join public.reservation_sessions as session
        on session.id = membership.effective_session_id
       and session.reservation_id = membership.effective_reservation_id
      cross join public.venue_settings as settings
      where booking.id = any(${uuidArraySql(bookingIds)})
      order by booking.id
    `)
    for (const row of restored.rows) {
      assert.equal(row.reservation_id, physicalOrigins.get(row.id))
      assert.equal(row.effective_reservation_id, physicalOrigins.get(row.id))
      assert.equal(row.version, 2)
      assert.equal(row.booking_link_id, null)
      assert.equal(row.projection_aligned, true)
      assert.equal(row.details_aligned, true)
    }
    assert.deepEqual(await db.query(`
      select id, reservation_id, starts_at, ends_at, party_size, notes
      from public.reservation_sessions
      where id = any(${uuidArraySql(originalSessionIds)})
      order by id
    `).then((result) => result.rows), originalSessions.rows)

    await assert.rejects(
      db.exec(`
        select private.reservation_phase3b_apply_transition(
          'merge',
          ${uuidArraySql(sourceReservationIds)},
          ${uuidArraySql([targetReservationId])},
          ${uuidArraySql([prepared.primaryTargetPartyId])},
          ${uuidArraySql(bookingIds)},
          ${uuidArraySql(bookingTargets)},
          ${uuidArraySql(sourcePartyIds)},
          ${uuidArraySql(targetPartyIds)},
          'phase3b-test-reuse-transition-target',
          ${sqlString(actorId)}::uuid
        )
      `),
      /newly prepared empty Reservations/i,
    )

    await assert.rejects(
      db.exec(`
        update public.reservation_allocation_memberships as membership
        set effective_reservation_id = allocation.to_reservation_id,
            effective_session_id = allocation.to_session_id,
            last_transition_id = allocation.transition_id,
            version = membership.version + 1
        from public.reservation_transition_allocations as allocation
        where allocation.transition_id = ${sqlString(transitionId)}::uuid
          and allocation.booking_id = ${sqlString(bookingIds[0])}::uuid
          and membership.booking_id = allocation.booking_id
      `),
      /new immutable Reservation transition/i,
    )

    await assert.rejects(
      db.exec(`
        update public.reservation_transition_allocations
        set legacy_link_after = null
        where transition_id = ${sqlString(transitionId)}::uuid
      `),
      /append-only/i,
    )
  } finally {
    await db.close()
  }
})

test('Phase 3B.1 splits one paid Reservation without rewriting price or payment history', async () => {
  const db = await buildPhase3bDatabase()
  const actorId = uuid(6, 1)
  const sourceGroupId = uuid(2, 22)
  const targetReservationIds = [uuid(11, 1), uuid(11, 2)]
  const targetPartyIds = [uuid(11, 11), uuid(11, 12)]
  try {
    const source = await db.query(`
      select distinct booking.reservation_id
      from public.bookings as booking
      where booking.booking_group_id = ${sqlString(sourceGroupId)}::uuid
    `)
    assert.equal(source.rows.length, 1)
    const sourceReservationId = source.rows[0].reservation_id

    const sourceParty = await db.query(`
      select party.id
      from public.reservation_parties as party
      where party.reservation_id = ${sqlString(sourceReservationId)}::uuid
      order by party.id
    `)
    assert.equal(sourceParty.rows.length, 1)
    const sourcePartyId = sourceParty.rows[0].id

    const scope = await db.query(`
      select booking.id, booking.total_amount, booking.payment_status
      from public.bookings as booking
      where booking.reservation_id = ${sqlString(sourceReservationId)}::uuid
      order by booking.id
    `)
    assert.equal(scope.rows.length, 2)
    const bookingIds = scope.rows.map((row) => row.id)
    const originalAmounts = new Map(
      scope.rows.map((row) => [row.id, Number(row.total_amount)]),
    )

    const payment = await db.query(`
      select private.reservation_phase3b_record_payment(
        ${sqlString(sourceReservationId)}::uuid,
        ${uuidArraySql(bookingIds)},
        ${numericArraySql(scope.rows.map((row) => Number(row.total_amount)))},
        'venue',
        'phase3b-test-pre-split-payment',
        '2026-08-24 17:00:00+00'::timestamptz,
        ${sqlString(sourcePartyId)}::uuid,
        ${sqlString(actorId)}::uuid
      ) as payment_id
    `)
    const paymentId = payment.rows[0].payment_id
    const ledgerBefore = await db.query(`
      select entry.id, entry.payment_id, entry.reservation_id,
        entry.booking_id, entry.amount
      from public.payment_allocation_entries as entry
      where entry.payment_id = ${sqlString(paymentId)}::uuid
      order by entry.id
    `)

    const targetPrimaryPartyIds = []
    for (let index = 0; index < targetReservationIds.length; index += 1) {
      const prepared = await prepareTransitionTarget(db, {
        targetReservationId: targetReservationIds[index],
        sourcePartyIds: [sourcePartyId],
        targetPartyIds: [targetPartyIds[index]],
        primarySourcePartyId: sourcePartyId,
      })
      targetPrimaryPartyIds.push(prepared.primaryTargetPartyId)
    }

    await assert.rejects(
      db.exec(`
        select private.reservation_phase3b_apply_transition(
          'split',
          ${uuidArraySql([sourceReservationId])},
          ${uuidArraySql(targetReservationIds)},
          ${uuidArraySql(targetPrimaryPartyIds)},
          ${uuidArraySql([bookingIds[0]])},
          ${uuidArraySql([targetReservationIds[0]])},
          ${uuidArraySql([sourcePartyId, sourcePartyId])},
          ${uuidArraySql(targetPartyIds)},
          'phase3b-test-incomplete-split',
          ${sqlString(actorId)}::uuid
        )
      `),
      /every current Court allocation|receive at least one/i,
    )
    assert.equal(await scalar(db, `
      select count(*)::integer as value
      from private.reservation_phase3b_operations
      where operation_id = 'phase3b-test-incomplete-split'
    `, 'value'), 0)

    const split = await db.query(`
      select private.reservation_phase3b_apply_transition(
        'split',
        ${uuidArraySql([sourceReservationId])},
        ${uuidArraySql(targetReservationIds)},
        ${uuidArraySql(targetPrimaryPartyIds)},
        ${uuidArraySql(bookingIds)},
        ${uuidArraySql(targetReservationIds)},
        ${uuidArraySql([sourcePartyId, sourcePartyId])},
        ${uuidArraySql(targetPartyIds)},
        'phase3b-test-split',
        ${sqlString(actorId)}::uuid
      ) as transition_id
    `)
    const transitionId = split.rows[0].transition_id

    const splitState = await db.query(`
      select
        booking.id,
        booking.reservation_id,
        booking.total_amount,
        booking.payment_status,
        membership.origin_reservation_id,
        membership.effective_reservation_id,
        membership.version
      from public.bookings as booking
      join public.reservation_allocation_memberships as membership
        on membership.booking_id = booking.id
      where booking.id = any(${uuidArraySql(bookingIds)})
      order by booking.id
    `)
    for (let index = 0; index < splitState.rows.length; index += 1) {
      const row = splitState.rows[index]
      assert.equal(row.reservation_id, sourceReservationId)
      assert.equal(row.origin_reservation_id, sourceReservationId)
      assert.equal(row.effective_reservation_id, targetReservationIds[index])
      assert.equal(Number(row.total_amount), originalAmounts.get(row.id))
      assert.equal(row.payment_status, 'paid')
      assert.equal(row.version, 1)
    }
    assert.deepEqual(await db.query(`
      select entry.id, entry.payment_id, entry.reservation_id,
        entry.booking_id, entry.amount
      from public.payment_allocation_entries as entry
      where entry.payment_id = ${sqlString(paymentId)}::uuid
      order by entry.id
    `).then((result) => result.rows), ledgerBefore.rows)

    await db.exec(`
      select private.reservation_phase3b_reverse_transition(
        ${sqlString(transitionId)}::uuid,
        'phase3b-test-reverse-split',
        ${sqlString(actorId)}::uuid
      )
    `)
    const restored = await db.query(`
      select membership.effective_reservation_id, membership.version
      from public.reservation_allocation_memberships as membership
      where membership.booking_id = any(${uuidArraySql(bookingIds)})
      order by membership.booking_id
    `)
    assert.deepEqual(restored.rows, bookingIds.map(() => ({
      effective_reservation_id: sourceReservationId,
      version: 2,
    })))
  } finally {
    await db.close()
  }
})

test('Phase 3B.1 writer inventory and private permission gates fail closed', async () => {
  const db = await buildPhase3bDatabase()
  try {
    await installWriterInventoryStubs(db)
    const inventory = await db.query(`
      select private.assert_reservation_phase3b_writer_inventory() as result
    `)
    assert.equal(inventory.rows[0].result.direct_writer_count, 17)
    assert.equal(inventory.rows[0].result.wrapper_count, 3)
    assert.equal(inventory.rows[0].result.undeployed_edge_path_count, 2)
    assert.ok(inventory.rows[0].result.direct_writer_fingerprint)
    assert.ok(inventory.rows[0].result.wrapper_fingerprint)

    await db.exec('set role authenticated;')
    await assert.rejects(
      db.exec(`select private.assert_reservation_phase3b_kernel_inactive()`),
      /permission denied/i,
    )
    await db.exec('reset role;')

    await db.exec(`
      create function public.rogue_phase3b_writer()
      returns void
      language sql
      security definer
      set search_path = ''
      as $rogue$
        update only public."bookings" set updated_at = updated_at where false
      $rogue$;
    `)
    await assert.rejects(
      db.exec(`select private.assert_reservation_phase3b_writer_inventory()`),
      /writer inventory drift/i,
    )
  } finally {
    await db.close()
  }
})

test('Phase 3B.1 read-only diagnostic verifies an untouched inactive install', async () => {
  const db = await buildPhase3bDatabase()
  try {
    await installWriterInventoryStubs(db)
    await db.exec(await readFile(phase3bInactiveKernelDiagnosticPath, 'utf8'))
    const diagnostic = await db.query(`
      select jsonb_build_object(
        'status', 'phase_3b_inactive_transaction_kernel_verified',
        'kernel', private.assert_reservation_phase3b_kernel_inactive(),
        'writer_inventory', private.assert_reservation_phase3b_writer_inventory()
      ) as result
    `)
    const result = diagnostic.rows[0].result
    assert.equal(
      result.status,
      'phase_3b_inactive_transaction_kernel_verified',
    )
    assert.equal(result.kernel.status, 'inactive')
    assert.equal(result.kernel.transition_count, 0)
    assert.equal(result.kernel.membership_count, 0)
    assert.equal(result.kernel.operation_count, 0)
    assert.equal(result.writer_inventory.direct_writer_count, 17)
    assert.equal(result.writer_inventory.wrapper_count, 3)
  } finally {
    await db.close()
  }
})

test('Phase 3B.1 serializes real PostgreSQL payment retries, AA writes, and refund races', {
  skip: !process.env.PHASE3B_POSTGRES_URL,
  timeout: 120_000,
}, async () => {
  const { Client } = await import('pg')
  const clients = []
  const connect = async () => {
    const client = new Client({ connectionString: process.env.PHASE3B_POSTGRES_URL })
    await client.connect()
    clients.push(client)
    return {
      async exec(sql) {
        await client.query(sql)
      },
      async query(sql) {
        const result = await client.query(sql)
        return Array.isArray(result) ? result.at(-1) : result
      },
      async close() {
        await client.end()
      },
    }
  }

  const rootDb = await connect()
  let workerA
  let workerB
  const actorId = uuid(6, 1)
  try {
    await buildPhase3bDatabase({ db: rootDb })
    workerA = await connect()
    workerB = await connect()

    const scopeForGroup = async (groupNumber) => {
      const groupId = uuid(2, groupNumber)
      const scope = await rootDb.query(`
        select booking.id, booking.reservation_id, booking.total_amount
        from public.bookings as booking
        where booking.booking_group_id = ${sqlString(groupId)}::uuid
        order by booking.id
      `)
      assert.equal(scope.rows.length, 2)
      assert.equal(new Set(scope.rows.map((row) => row.reservation_id)).size, 1)
      const reservationId = scope.rows[0].reservation_id
      const party = await rootDb.query(`
        select party.id
        from public.reservation_parties as party
        where party.reservation_id = ${sqlString(reservationId)}::uuid
        order by party.id
        limit 1
      `)
      return {
        reservationId,
        partyId: party.rows[0].id,
        bookingIds: scope.rows.map((row) => row.id),
        amounts: scope.rows.map((row) => Number(row.total_amount)),
      }
    }

    const retryScope = await scopeForGroup(23)
    const retrySql = `
      select private.reservation_phase3b_record_payment(
        ${sqlString(retryScope.reservationId)}::uuid,
        ${uuidArraySql(retryScope.bookingIds)},
        ${numericArraySql(retryScope.amounts)},
        'venue',
        'phase3b-ci-concurrent-idempotency',
        '2026-08-24 18:00:00+00'::timestamptz,
        ${sqlString(retryScope.partyId)}::uuid,
        ${sqlString(actorId)}::uuid
      ) as payment_id
    `
    const retryResults = await Promise.all([
      workerA.query(retrySql),
      workerB.query(retrySql),
    ])
    assert.equal(
      retryResults[0].rows[0].payment_id,
      retryResults[1].rows[0].payment_id,
    )
    const retryPaymentId = retryResults[0].rows[0].payment_id
    assert.equal(await scalar(rootDb, `
      select count(*)::integer as value
      from public.payments
      where id = ${sqlString(retryPaymentId)}::uuid
    `, 'value'), 1)
    assert.equal(await scalar(rootDb, `
      select count(*)::integer as value
      from public.payment_allocation_entries
      where payment_id = ${sqlString(retryPaymentId)}::uuid
    `, 'value'), retryScope.bookingIds.length)

    const aaScope = await scopeForGroup(24)
    const halfAmounts = aaScope.amounts.map((amount) => amount / 2)
    const aaSql = (operationId, occurredAt) => `
      select private.reservation_phase3b_record_payment(
        ${sqlString(aaScope.reservationId)}::uuid,
        ${uuidArraySql(aaScope.bookingIds)},
        ${numericArraySql(halfAmounts)},
        'venue',
        ${sqlString(operationId)},
        ${sqlString(occurredAt)}::timestamptz,
        ${sqlString(aaScope.partyId)}::uuid,
        ${sqlString(actorId)}::uuid
      ) as payment_id
    `
    const aaResults = await Promise.all([
      workerA.query(aaSql(
        'phase3b-ci-concurrent-aa-a',
        '2026-08-24 18:05:00+00',
      )),
      workerB.query(aaSql(
        'phase3b-ci-concurrent-aa-b',
        '2026-08-24 18:05:01+00',
      )),
    ])
    assert.notEqual(
      aaResults[0].rows[0].payment_id,
      aaResults[1].rows[0].payment_id,
    )
    assert.deepEqual(await rootDb.query(`
      select distinct payment_status
      from public.bookings
      where id = any(${uuidArraySql(aaScope.bookingIds)})
    `).then((result) => result.rows), [{ payment_status: 'paid' }])

    const refundableEntries = await rootDb.query(`
      select id, amount
      from public.payment_allocation_entries
      where payment_id = ${sqlString(retryPaymentId)}::uuid
      order by id
    `)
    const refundEntryIds = refundableEntries.rows.map((row) => row.id)
    const refundAmounts = refundableEntries.rows.map((row) => Number(row.amount))
    const refundSql = (operationId) => `
      select private.reservation_phase3b_refund_payment(
        ${sqlString(retryPaymentId)}::uuid,
        array[${refundEntryIds.map((id) => `${id}::bigint`).join(', ')}]::bigint[],
        ${numericArraySql(refundAmounts)},
        ${sqlString(operationId)},
        '2026-08-24 18:10:00+00'::timestamptz,
        ${sqlString(actorId)}::uuid
      ) as refund_id
    `
    const refundRace = await Promise.allSettled([
      workerA.query(refundSql('phase3b-ci-concurrent-refund-a')),
      workerB.query(refundSql('phase3b-ci-concurrent-refund-b')),
    ])
    assert.equal(
      refundRace.filter((result) => result.status === 'fulfilled').length,
      1,
    )
    assert.equal(
      refundRace.filter((result) => result.status === 'rejected').length,
      1,
    )
    assert.match(
      refundRace.find((result) => result.status === 'rejected').reason.message,
      /Refund exceeds the remaining amount/i,
    )
    assert.equal(await scalar(rootDb, `
      select count(*)::integer as value
      from public.payments
      where reverses_payment_id = ${sqlString(retryPaymentId)}::uuid
    `, 'value'), 1)
    assert.deepEqual(await rootDb.query(`
      select distinct payment_status
      from public.bookings
      where id = any(${uuidArraySql(retryScope.bookingIds)})
    `).then((result) => result.rows), [{ payment_status: 'refunded' }])
    assert.equal(await scalar(rootDb, `
      select count(*)::integer as value
      from private.reservation_phase3b_operations
      where status = 'started'
    `, 'value'), 0)
  } finally {
    for (const client of clients.slice(1)) {
      if (!client.ended) await client.end()
    }
    if (!clients[0].ended) await clients[0].end()
  }
})
