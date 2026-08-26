import assert from 'node:assert/strict'
import test from 'node:test'
import {
  normalizeCanonicalAllocationResponse,
  normalizeCanonicalReservationDetail,
  normalizeCanonicalReservationSearch,
  normalizeCanonicalReservationSummary,
  normalizeCanonicalShadowStatus,
  normalizeLegacyAllocationRows,
  venueDateStartIso,
  venueLocalDateTime,
} from './reservationReadModel.js'
import {
  compareAllocationReadModels,
  createShadowLogEvent,
  fetchCanonicalAllocationWindow,
  isReservationReadShadowEnabled,
  runReservationScheduleShadow,
} from './reservationReadShadow.js'

const allocationOne = '10000000-0000-0000-0000-000000000101'
const allocationTwo = '10000000-0000-0000-0000-000000000102'
const reservationOne = '20000000-0000-0000-0000-000000000001'
const sessionOne = '30000000-0000-0000-0000-000000000001'
const groupOne = '40000000-0000-0000-0000-000000000001'
const linkOne = '50000000-0000-0000-0000-000000000001'
const courtOne = '10000000-0000-0000-0000-000000000001'
const courtTwo = '10000000-0000-0000-0000-000000000002'

const canonicalAllocation = (overrides = {}) => ({
  schema_version: 1,
  allocation_id: allocationOne,
  origin_reservation_id: reservationOne,
  origin_session_id: sessionOne,
  projection_reservation_id: reservationOne,
  projection_session_id: sessionOne,
  effective_reservation_id: reservationOne,
  effective_session_id: sessionOne,
  membership_version: 1,
  last_transition_id: null,
  court_id: courtOne,
  court_name_zh: '壹',
  court_name_en: 'Court 1',
  court_sort_order: 1,
  starts_at: '2026-08-25T14:00:00+00:00',
  ends_at: '2026-08-25T15:00:00+00:00',
  party_size: 2,
  allocation_status: 'confirmed',
  allocation_amount: '28.00',
  currency: 'CAD',
  system_calculated_amount: '28.00',
  price_source: 'system',
  price_override_amount: null,
  has_notes: false,
  legacy_source_group_id: groupOne,
  legacy_source_link_id: linkOne,
  session_allocation_count: 2,
  reservation_reference: 'R-000001',
  reference_number: 1,
  reservation_status: 'confirmed',
  payment_status: 'partial',
  payment_plan: 'split_equal',
  reservation_total_amount: '56.00',
  reservation_paid_amount: '28.00',
  reservation_refunded_amount: '0.00',
  reservation_net_paid_amount: '28.00',
  reservation_outstanding_amount: '28.00',
  reservation_session_count: 1,
  reservation_allocation_count: 2,
  primary_party_id: '60000000-0000-0000-0000-000000000001',
  primary_contact_name: 'Private Person',
  primary_contact_email: 'private@example.invalid',
  primary_contact_phone: '416-555-0000',
  recurrence_series_id: null,
  recurrence_sequence: null,
  transition_count: 2,
  source_lineage_count: 2,
  allocation_created_at: '2026-08-20T10:00:00+00:00',
  allocation_updated_at: '2026-08-20T10:00:00+00:00',
  ...overrides,
})

const legacyAllocation = (overrides = {}) => ({
  id: allocationOne,
  reservation_id: reservationOne,
  session_id: sessionOne,
  booking_group_id: groupOne,
  booking_link_id: linkOne,
  recurrence_series_id: null,
  recurrence_week: null,
  court_id: courtOne,
  customer_name: 'Private Person',
  customer_email: 'private@example.invalid',
  customer_phone: '416-555-0000',
  customer_notes: '',
  start_at: '2026-08-25T10:00:00',
  end_at: '2026-08-25T11:00:00',
  status: 'confirmed',
  payment_status: 'pending',
  total_amount: '28.00',
  currency: 'CAD',
  system_calculated_amount: '28.00',
  price_source: 'system',
  price_override_amount: null,
  party_size: 2,
  created_at: '2026-08-20T10:00:00',
  updated_at: '2026-08-20T10:00:00',
  ...overrides,
})

const allocationResponse = (items, overrides = {}) => ({
  schema_version: 1,
  generated_at: '2026-08-25T12:00:00+00:00',
  limit: 1000,
  items,
  has_more: false,
  next_cursor: null,
  ...overrides,
})

const cleanShadowStatus = (overrides = {}) => ({
  schema_version: 1,
  contract_version: 1,
  status: 'clean',
  mismatch_count: 0,
  mismatch_counts: {},
  samples: [],
  totals: {
    allocations: 2,
    effective_memberships: 2,
    effective_reservations: 1,
    effective_sessions: 1,
    summary_rows: 1,
    schedule_rows: 2,
  },
  ...overrides,
})

test('venue date boundaries and canonical instants normalize to venue-local legacy time', () => {
  assert.equal(venueDateStartIso('2026-08-25', 'America/Toronto'), '2026-08-25T04:00:00.000Z')
  assert.equal(venueDateStartIso('2026-11-02', 'America/Toronto'), '2026-11-02T05:00:00.000Z')
  assert.equal(venueLocalDateTime('2026-08-25T14:00:00+00:00', 'America/Toronto'), '2026-08-25T10:00:00')
  assert.equal(venueLocalDateTime('2026-08-25T10:00:00', 'America/Toronto'), '2026-08-25T10:00:00')
})

test('shadow mode is fail-closed and only the exact true value enables it', () => {
  assert.equal(isReservationReadShadowEnabled('true'), true)
  assert.equal(isReservationReadShadowEnabled('TRUE'), false)
  assert.equal(isReservationReadShadowEnabled('1'), false)
  assert.equal(isReservationReadShadowEnabled(undefined), false)
})

test('legacy and canonical allocation fixtures normalize to a comparable v1 DTO', () => {
  const legacy = normalizeLegacyAllocationRows([legacyAllocation()])
  const canonical = normalizeCanonicalAllocationResponse(allocationResponse([canonicalAllocation()]))
  assert.equal(legacy.items[0].source, 'legacy')
  assert.equal(canonical.items[0].source, 'canonical')
  assert.equal(canonical.items[0].effectiveReservationId, reservationOne)
  assert.equal(canonical.items[0].reservation.paymentPlan, 'split_equal')
  assert.equal(canonical.items[0].primaryContact.name, 'Private Person')
  assert.deepEqual(compareAllocationReadModels(legacy, canonical), {
    status: 'clean',
    legacyAllocationCount: 1,
    canonicalAllocationCount: 1,
    comparedAllocationCount: 1,
    mismatchCount: 0,
    mismatchCounts: {},
    mismatches: [],
  })
})

test('allocation comparison reports only stable PII-free codes and IDs', () => {
  const legacy = normalizeLegacyAllocationRows([legacyAllocation({ customer_name: 'Sensitive Name' })])
  const canonical = normalizeCanonicalAllocationResponse(allocationResponse([
    canonicalAllocation({ court_id: courtTwo, primary_contact_name: 'Different Sensitive Name' }),
    canonicalAllocation({ allocation_id: allocationTwo, court_id: courtTwo }),
  ]))
  const comparison = compareAllocationReadModels(legacy, canonical)
  assert.equal(comparison.status, 'mismatch')
  assert.deepEqual(comparison.mismatchCounts, {
    allocation_court_mismatch: 1,
    allocation_missing_in_legacy: 1,
  })
  assert.equal(JSON.stringify(comparison).includes('Sensitive Name'), false)
})

test('allocation comparison fails visibly on duplicate identities', () => {
  const legacy = normalizeLegacyAllocationRows([legacyAllocation()])
  const canonical = normalizeCanonicalAllocationResponse(allocationResponse([
    canonicalAllocation(),
    canonicalAllocation(),
  ]))
  const comparison = compareAllocationReadModels(legacy, canonical)
  assert.equal(comparison.status, 'mismatch')
  assert.deepEqual(comparison.mismatchCounts, { allocation_duplicate_in_canonical: 1 })
})

test('Reservation summaries cover mixed sessions, multi-court, recurrence and payment states', () => {
  const statuses = ['no_charge', 'partial', 'paid', 'refunded']
  const summaries = statuses.map((paymentStatus, index) => normalizeCanonicalReservationSummary({
    reservation_id: `${reservationOne.slice(0, -1)}${index + 1}`,
    reservation_reference: `R-00000${index + 1}`,
    reservation_status: index === 0 ? 'mixed' : 'confirmed',
    currency: 'CAD',
    payment_plan: index === 1 ? 'split_custom' : 'single_payer',
    session_count: 2,
    allocation_count: 3,
    allocation_minutes: 240,
    court_ids: [courtOne, courtTwo],
    total_amount: index === 0 ? 0 : 84,
    paid_amount: index === 1 ? 42 : 84,
    refunded_amount: paymentStatus === 'refunded' ? 84 : 0,
    net_paid_amount: paymentStatus === 'refunded' ? 0 : index === 1 ? 42 : index === 0 ? 0 : 84,
    outstanding_amount: index === 1 ? 42 : 0,
    payment_status: paymentStatus,
    recurrence_series_id: '70000000-0000-0000-0000-000000000001',
    recurrence_sequence: 3,
    recurrence_frequency: 'weekly',
    recurrence_interval_count: 1,
    recurrence_occurrence_count: 8,
    legacy_group_count: 2,
    legacy_link_count: 1,
    source_lineage_count: 2,
    transition_count: 3,
  }))
  assert.deepEqual(summaries.map((summary) => summary.money.paymentStatus), statuses)
  assert.equal(summaries[0].status, 'mixed')
  assert.equal(summaries[0].schedule.allocationCount, 3)
  assert.equal(summaries[0].recurrence.frequency, 'weekly')
  assert.equal(summaries[0].lineage.transitionCount, 3)
  assert.equal(summaries[1].paymentPlan, 'split_custom')
})

test('Reservation search normalizes keyset pagination and aggregate summary without booking-row assumptions', () => {
  const result = normalizeCanonicalReservationSearch({
    schema_version: 1,
    generated_at: '2026-08-25T12:00:00+00:00',
    items: [{
      reservation_id: reservationOne,
      reservation_reference: 'R-000001',
      reservation_status: 'confirmed',
      currency: 'CAD',
      payment_status: 'paid',
      total_amount: 56,
      paid_amount: 56,
      net_paid_amount: 56,
      session_count: 1,
      allocation_count: 2,
      matched_start_at: '2026-08-25T14:00:00+00:00',
      matched_allocation_minutes: 120,
      party_count: 2,
    }],
    has_more: true,
    next_cursor: { sort_at: '2026-08-25T14:00:00+00:00', reservation_id: reservationOne },
    summary: { results: 4, total_minutes: 360, primary_contacts: 3, today: 2 },
  })
  assert.equal(result.items.length, 1)
  assert.equal(result.items[0].schedule.matchedAllocationMinutes, 120)
  assert.equal(result.items[0].partyCount, 2)
  assert.deepEqual(result.summary, { results: 4, totalMinutes: 360, primaryContacts: 3, today: 2 })
  assert.equal(result.nextCursor.reservationId, reservationOne)
})

test('detail normalizer keeps merge/split/reverse and ledger facts while dropping unknown sensitive fields', () => {
  const detail = normalizeCanonicalReservationDetail({
    schema_version: 1,
    generated_at: '2026-08-25T12:00:00+00:00',
    reservation: {
      reservation_id: reservationOne,
      reservation_reference: 'R-000001',
      reservation_status: 'confirmed',
      currency: 'CAD',
      payment_plan: 'split_custom',
      payment_status: 'partial',
      total_amount: 56,
      paid_amount: 28,
      net_paid_amount: 28,
      outstanding_amount: 28,
      session_count: 1,
      allocation_count: 2,
      notes: 'Manager-visible note',
      auth_user_id: 'DO_NOT_KEEP_AUTH_ID',
    },
    parties: [{
      party_id: '60000000-0000-0000-0000-000000000001',
      party_type: 'person',
      display_name: 'Private Person',
      email: 'private@example.invalid',
      phone: '416-555-0000',
      roles: ['primary_contact', 'payer'],
      auth_user_id: 'DO_NOT_KEEP_PARTY_AUTH_ID',
    }],
    sessions: [{
      session_id: sessionOne,
      starts_at: '2026-08-25T14:00:00+00:00',
      ends_at: '2026-08-25T15:00:00+00:00',
      party_size: 2,
      notes: 'Session note',
      allocations: [{
        allocation_id: allocationOne,
        origin_reservation_id: reservationOne,
        origin_session_id: sessionOne,
        projection_reservation_id: reservationOne,
        projection_session_id: sessionOne,
        court_id: courtOne,
        status: 'confirmed',
        amount: 28,
        currency: 'CAD',
      }],
    }],
    payment_shares: [{ share_id: 'share-1', party_id: 'party-1', share_type: 'fixed', target_amount: 28 }],
    payments: [{
      payment_id: 'payment-1',
      original_reservation_id: reservationOne,
      amount: 28,
      currency: 'CAD',
      status: 'succeeded',
      current_reservation_amount: 28,
      provider_reference: 'DO_NOT_KEEP_PROVIDER_REFERENCE',
      idempotency_key: 'DO_NOT_KEEP_IDEMPOTENCY_KEY',
      notes: 'DO_NOT_KEEP_PAYMENT_NOTES',
    }],
    payment_allocation_entries: [{ entry_id: 'entry-1', payment_id: 'payment-1', allocation_id: allocationOne, amount: 28 }],
    source_lineage: [{ source_type: 'legacy_booking_group', source_id: groupOne }],
    transitions: [
      { transition_id: 'transition-1', sequence: 1, type: 'merge' },
      { transition_id: 'transition-2', sequence: 2, type: 'split' },
      { transition_id: 'transition-3', sequence: 3, type: 'reverse', reverses_transition_id: 'transition-2' },
    ],
    session_assignment_summary: { assignment_count: 4, allocation_count: 2 },
    provider_payload: 'DO_NOT_KEEP_PROVIDER_PAYLOAD',
  })
  const serialized = JSON.stringify(detail)
  assert.deepEqual(detail.transitions.map((item) => item.type), ['merge', 'split', 'reverse'])
  assert.equal(detail.paymentShares[0].targetAmount, 28)
  assert.equal(detail.sessionAssignmentSummary.allocationCount, 2)
  assert.equal(serialized.includes('DO_NOT_KEEP_'), false)
})

test('shadow status normalizer whitelists counts and discards sample details', () => {
  const result = normalizeCanonicalShadowStatus(cleanShadowStatus({
    status: 'mismatch',
    mismatch_count: 1,
    mismatch_counts: {
      allocation_projection_mismatch: 1,
      'private@example.invalid': 2,
    },
    samples: [{ details: { customer_name: 'DO_NOT_LOG_THIS' } }],
  }))
  assert.equal(result.status, 'mismatch')
  assert.deepEqual(result.mismatchCounts, {
    allocation_projection_mismatch: 1,
    unrecognized_server_mismatch_code: 2,
  })
  assert.equal(JSON.stringify(result).includes('DO_NOT_LOG_THIS'), false)
})

test('canonical allocation fetch follows compound cursors without OFFSET pagination', async () => {
  const calls = []
  const responses = [
    allocationResponse([canonicalAllocation()], {
      has_more: true,
      next_cursor: { starts_at: '2026-08-25T14:00:00+00:00', allocation_id: allocationOne },
    }),
    allocationResponse([canonicalAllocation({
      allocation_id: allocationTwo,
      court_id: courtTwo,
      legacy_source_group_id: groupOne,
    })]),
  ]
  const client = {
    rpc: async (name, parameters) => {
      calls.push({ name, parameters })
      return { data: responses.shift(), error: null }
    },
  }
  const result = await fetchCanonicalAllocationWindow({
    client,
    startDate: '2026-08-25',
    endDate: '2026-08-31',
  })
  assert.equal(result.items.length, 2)
  assert.equal(calls.length, 2)
  assert.equal(calls[0].parameters.p_after_starts_at, null)
  assert.equal(calls[1].parameters.p_after_starts_at, '2026-08-25T14:00:00+00:00')
  assert.equal('p_offset' in calls[0].parameters, false)
})

test('shadow runner logs a clean PII-free event while returning legacy UI data untouched', async () => {
  const secondLegacy = legacyAllocation({
    id: allocationTwo,
    court_id: courtTwo,
    total_amount: 28,
  })
  const canonicalItems = [
    canonicalAllocation(),
    canonicalAllocation({ allocation_id: allocationTwo, court_id: courtTwo }),
    canonicalAllocation({
      allocation_id: '10000000-0000-0000-0000-000000000103',
      starts_at: '2026-08-25T03:30:00+00:00',
      ends_at: '2026-08-25T04:30:00+00:00',
    }),
  ]
  const calls = []
  const client = {
    rpc: async (name) => {
      calls.push(name)
      return name === 'admin_get_reservation_read_shadow_status'
        ? { data: cleanShadowStatus(), error: null }
        : { data: allocationResponse(canonicalItems), error: null }
    },
  }
  const logs = []
  const event = await runReservationScheduleShadow({
    client,
    legacyRows: [legacyAllocation(), secondLegacy],
    startDate: '2026-08-25',
    endDate: '2026-08-31',
    logger: {
      info: (...args) => logs.push(args),
      warn: (...args) => logs.push(args),
    },
  })
  assert.equal(event.status, 'clean')
  assert.deepEqual(calls.sort(), ['admin_get_reservation_read_shadow_status', 'admin_list_reservation_allocations'])
  assert.equal(logs.length, 1)
  const serialized = JSON.stringify(logs)
  assert.equal(serialized.includes('Private Person'), false)
  assert.equal(serialized.includes('private@example.invalid'), false)
  assert.equal(serialized.includes('416-555-0000'), false)
})

test('shadow error logging drops server messages that could contain PII', async () => {
  const logs = []
  const client = {
    rpc: async () => ({
      data: null,
      error: { code: 'private@example.invalid', message: 'Private Person private@example.invalid must never be logged' },
    }),
  }
  const event = await runReservationScheduleShadow({
    client,
    legacyRows: [legacyAllocation()],
    startDate: '2026-08-25',
    endDate: '2026-08-31',
    logger: { warn: (...args) => logs.push(args) },
  })
  assert.deepEqual(event, {
    event: 'reservation_read_shadow_v1',
    schema_version: 1,
    status: 'error',
    error_code: 'reservation_read_shadow_failed',
  })
  assert.equal(JSON.stringify(logs).includes('Private Person'), false)
  assert.equal(JSON.stringify(logs).includes('private@example.invalid'), false)
})

test('shadow log event contains only counts, codes and totals', () => {
  const event = createShadowLogEvent({
    comparison: {
      status: 'mismatch',
      legacyAllocationCount: 1,
      canonicalAllocationCount: 1,
      comparedAllocationCount: 1,
      mismatchCount: 1,
      mismatchCounts: { allocation_status_mismatch: 1 },
    },
    serverStatus: normalizeCanonicalShadowStatus(cleanShadowStatus()),
  })
  assert.deepEqual(Object.keys(event).sort(), [
    'canonical_allocation_count',
    'client_mismatch_count',
    'client_mismatch_counts',
    'compared_allocation_count',
    'event',
    'legacy_allocation_count',
    'schema_version',
    'server_mismatch_count',
    'server_mismatch_counts',
    'server_status',
    'server_totals',
    'status',
  ])
})

test('unsupported server schema versions fail closed before adaptation', () => {
  assert.throws(
    () => normalizeCanonicalAllocationResponse({ schema_version: 2, items: [] }),
    (error) => error.code === 'reservation_read_schema_version_unsupported',
  )
  assert.throws(
    () => normalizeCanonicalAllocationResponse(allocationResponse([
      canonicalAllocation({ allocation_amount: 'not-a-number' }),
    ])),
    (error) => error.code === 'reservation_read_invalid_amount',
  )
})
