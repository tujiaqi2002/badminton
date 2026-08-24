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
    returns uuid language sql stable as $$ select null::uuid $$;

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
  const db = new PGlite()
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
