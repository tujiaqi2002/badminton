import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'

export const stageProjectRef = 'vcoujmzsgdboidndtzzg'
export const syntheticUserId = '00000000-0000-0000-0000-000000017701'

export const productionFingerprints = Object.freeze({
  booking: '20802718eff3b81bd5fe38d99808e8d8',
  bookingPayload: 'd27b6924d560d7fc1bf2f54ce3f38688',
  slots: '2617c5b347e5f516bae80cbb4bd92ccc',
  paymentAudit: '80cbd801fce56b51b9d0e51c68a60e2c',
})

export const productionFingerprintOccurrences = Object.freeze({
  booking: 1,
  bookingPayload: 1,
  slots: 1,
  paymentAudit: 2,
})

export const diagnosticFingerprintOccurrences = Object.freeze({
  booking: 0,
  bookingPayload: 1,
  slots: 1,
  paymentAudit: 1,
})

const courtIds = Object.freeze([
  '10000000-0000-0000-0000-000000000001',
  '10000000-0000-0000-0000-000000000002',
  '10000000-0000-0000-0000-000000000003',
  '10000000-0000-0000-0000-000000000004',
  '10000000-0000-0000-0000-000000000005',
])

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

export function buildBookings() {
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
        courtId: courtIds[row - 1],
        start: `${date} ${String(hour).padStart(2, '0')}:00:00`,
        end: `${date} ${String(hour + 1).padStart(2, '0')}:00:00`,
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
  assert.equal(bookings.filter(({ status }) => status === 'confirmed').length, 139)
  assert.equal(bookings.filter(({ paymentStatus }) => paymentStatus === 'paid').length, 26)
  assert.equal(
    bookings
      .filter(({ paymentStatus }) => paymentStatus === 'paid')
      .reduce((sum, { amount }) => sum + amount, 0),
    1642,
  )
  return bookings
}

function stageOnlyGuardSql(expectedPhase) {
  return `
    do $stage_guard$
    begin
      if current_database() <> 'postgres' then
        raise exception 'Unexpected database name: %', current_database();
      end if;
      if exists (select 1 from public.bookings) then
        raise exception '${expectedPhase} requires an empty legacy bookings table';
      end if;
    end
    $stage_guard$;
  `
}

export function bookingSeedSql(bookings = buildBookings()) {
  const bookingValues = bookings.map((booking) => `(
    ${sqlString(booking.id)}::uuid,
    ${sqlString(syntheticUserId)}::uuid,
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
    begin;
    set local timezone = 'UTC';
    set local session_replication_role = replica;
    ${stageOnlyGuardSql('Synthetic legacy fixture')}

    insert into auth.users (
      id, aud, role, email, raw_app_meta_data, raw_user_meta_data,
      created_at, updated_at
    ) values (
      ${sqlString(syntheticUserId)}::uuid,
      'authenticated',
      'authenticated',
      'synthetic-manager@example.invalid',
      '{"provider":"email","providers":["email"]}'::jsonb,
      '{"full_name":"Synthetic staging manager"}'::jsonb,
      '2026-08-20 12:00:00+00'::timestamptz,
      '2026-08-20 12:00:00+00'::timestamptz
    );

    insert into public.staff_members (user_id, role)
    values (${sqlString(syntheticUserId)}::uuid, 'admin');

    update public.venue_settings
       set timezone = 'America/Toronto', currency = 'CAD'
     where singleton;

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

    set local session_replication_role = origin;
    commit;
  `
}

export function linkedAuditBookingIds(bookings = buildBookings()) {
  const targetLinkId = uuid(3, 5)
  const ids = bookings
    .filter(({ linkId }) => linkId === targetLinkId)
    .filter((booking, index, rows) =>
      rows.findIndex(({ groupId }) => groupId === booking.groupId) === index,
    )
    .slice(0, 5)
    .map(({ id }) => id)
  assert.equal(ids.length, 5)
  return ids
}

export function paymentAuditSql(bookings = buildBookings()) {
  const ids = linkedAuditBookingIds(bookings)
  const audited = ids.map(sqlString).join(', ')
  const duplicate = sqlString(ids[0])
  return `
    begin;
    set local timezone = 'UTC';

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
      jsonb_build_object('schema_version', 1, 'fixture', 'synthetic-stage')
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
      jsonb_build_object('schema_version', 1, 'fixture', 'synthetic-stage')
    from public.bookings as booking
    where booking.id::text = ${duplicate};

    commit;
  `
}

export function specializePhase2(
  sql,
  fingerprints,
  expectedOccurrences = productionFingerprintOccurrences,
) {
  const keys = Object.keys(productionFingerprints)
  for (const key of keys) {
    if (!/^[0-9a-f]{32}$/.test(fingerprints[key] ?? '')) {
      throw new Error(`Invalid ${key} fingerprint`)
    }
  }

  let specialized = sql
  for (const key of keys) {
    const production = productionFingerprints[key]
    assert.equal(
      specialized.split(production).length - 1,
      expectedOccurrences[key],
    )
    specialized = specialized.replaceAll(production, fingerprints[key])
  }
  for (const production of Object.values(productionFingerprints)) {
    assert.equal(specialized.includes(production), false)
  }
  return specialized
}

async function runCli() {
  const [mode, ...args] = process.argv.slice(2)
  if (mode === 'bookings') {
    process.stdout.write(bookingSeedSql())
    return
  }
  if (mode === 'audit') {
    process.stdout.write(paymentAuditSql())
    return
  }
  if (mode === 'specialize') {
    const [inputPath, booking, bookingPayload, slots, paymentAudit] = args
    const sql = await readFile(inputPath, 'utf8')
    const expectedOccurrences = inputPath.includes('diagnostics')
      ? diagnosticFingerprintOccurrences
      : productionFingerprintOccurrences
    process.stdout.write(specializePhase2(sql, {
      booking,
      bookingPayload,
      slots,
      paymentAudit,
    }, expectedOccurrences))
    return
  }
  if (mode === 'summary') {
    const bookings = buildBookings()
    process.stdout.write(`${JSON.stringify({
      projectRef: stageProjectRef,
      bookings: bookings.length,
      activeSlots: bookings.filter(({ status }) => status === 'confirmed').length,
      paidBookings: bookings.filter(({ paymentStatus }) => paymentStatus === 'paid').length,
      paidTotalCad: bookings
        .filter(({ paymentStatus }) => paymentStatus === 'paid')
        .reduce((sum, { amount }) => sum + amount, 0),
      paymentAuditEvents: linkedAuditBookingIds(bookings).length + 1,
    }, null, 2)}\n`)
    return
  }
  throw new Error('Usage: bookings | audit | summary | specialize <path> <booking> <bookingPayload> <slots> <paymentAudit>')
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await runCli()
}
