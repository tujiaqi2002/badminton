import assert from 'node:assert/strict'
import test from 'node:test'
import {
  canonicalReservationToAdminOrderViewModel,
  canonicalReservationsToAdminOrderViewModels,
  fetchCanonicalAdminReservationOrders,
  normalizeReservationOrderReadSource,
  reservationOrderSafeErrorCode,
  RESERVATION_ORDER_READ_SOURCE_CANONICAL,
  RESERVATION_ORDER_READ_SOURCE_LEGACY,
} from './reservationOrderRead.js'

const reservationOne = '20000000-0000-4000-8000-000000000001'
const reservationTwo = '20000000-0000-4000-8000-000000000002'
const partyOne = '50000000-0000-4000-8000-000000000001'
const courtOne = '10000000-0000-4000-8000-000000000001'
const courtTwo = '10000000-0000-4000-8000-000000000002'

const canonicalSummary = (overrides = {}) => ({
  reservationId: reservationOne,
  referenceNumber: 1,
  reference: 'R-000001',
  status: 'confirmed',
  currency: 'CAD',
  paymentPlan: 'split_equal',
  source: 'manager_merge',
  createdAt: '2026-08-20T10:00:00+00:00',
  updatedAt: '2026-08-25T10:00:00+00:00',
  primaryContact: {
    partyId: partyOne,
    name: 'Synthetic primary',
    email: 'primary@example.invalid',
    phone: '555-0100',
  },
  partyCount: 3,
  schedule: {
    firstStartsAt: '2026-09-07T14:00:00+00:00',
    lastEndsAt: '2026-09-14T16:00:00+00:00',
    nextStartsAt: '2026-09-07T14:00:00+00:00',
    matchedStartsAt: '2026-09-07T14:00:00+00:00',
    sessionCount: 2,
    allocationCount: 3,
    allocationMinutes: 240,
    matchedAllocationMinutes: 120,
    courtIds: [courtOne, courtTwo],
    allocationStatusCounts: { confirmed: 3 },
    hasNotes: true,
  },
  money: {
    totalAmount: 90,
    paidAmount: 30,
    refundedAmount: 0,
    netPaidAmount: 30,
    outstandingAmount: 60,
    paymentStatus: 'partial',
    succeededPaymentCount: 1,
  },
  recurrence: {
    seriesId: null,
    sequence: null,
    frequency: null,
  },
  lineage: {
    legacyGroupCount: 2,
    legacyLinkCount: 1,
    sourceLineageCount: 2,
    transitionCount: 1,
  },
  ...overrides,
})

const responseRow = (overrides = {}) => ({
  reservation_id: reservationOne,
  reference_number: 1,
  reservation_reference: 'R-000001',
  reservation_status: 'confirmed',
  currency: 'CAD',
  payment_plan: 'split_equal',
  source: 'manager_merge',
  created_at: '2026-08-20T10:00:00+00:00',
  updated_at: '2026-08-25T10:00:00+00:00',
  primary_party_id: partyOne,
  primary_contact_name: 'Synthetic primary',
  primary_contact_email: 'primary@example.invalid',
  primary_contact_phone: '555-0100',
  party_count: 3,
  first_session_starts_at: '2026-09-07T14:00:00+00:00',
  last_session_ends_at: '2026-09-14T16:00:00+00:00',
  next_session_starts_at: '2026-09-07T14:00:00+00:00',
  matched_start_at: '2026-09-07T14:00:00+00:00',
  session_count: 2,
  allocation_count: 3,
  allocation_minutes: 240,
  matched_allocation_minutes: 120,
  court_ids: [courtOne, courtTwo],
  allocation_status_counts: { confirmed: 3 },
  has_notes: true,
  total_amount: 90,
  paid_amount: 30,
  refunded_amount: 0,
  net_paid_amount: 30,
  outstanding_amount: 60,
  payment_status: 'partial',
  succeeded_payment_count: 1,
  legacy_group_count: 2,
  legacy_link_count: 1,
  source_lineage_count: 2,
  transition_count: 1,
  ...overrides,
})

test('order read source fails closed to legacy', () => {
  assert.equal(normalizeReservationOrderReadSource('canonical'), RESERVATION_ORDER_READ_SOURCE_CANONICAL)
  assert.equal(normalizeReservationOrderReadSource('legacy'), RESERVATION_ORDER_READ_SOURCE_LEGACY)
  assert.equal(normalizeReservationOrderReadSource('CANONICAL'), RESERVATION_ORDER_READ_SOURCE_LEGACY)
  assert.equal(normalizeReservationOrderReadSource('unknown'), RESERVATION_ORDER_READ_SOURCE_LEGACY)
  assert.equal(normalizeReservationOrderReadSource(undefined), RESERVATION_ORDER_READ_SOURCE_LEGACY)
})

test('canonical Reservation maps into one explicit aggregate order view model', () => {
  const row = canonicalReservationToAdminOrderViewModel(canonicalSummary())
  assert.equal(row.order_view_model_version, 1)
  assert.equal(row.order_read_source, 'canonical')
  assert.equal(row.reservationId, reservationOne)
  assert.equal(row.partyCount, 3)
  assert.equal(row.otherPartyCount, 2)
  assert.equal(row.schedule.firstStartsAt, '2026-09-07T10:00:00')
  assert.equal(row.schedule.lastEndsAt, '2026-09-14T12:00:00')
  assert.equal(row.payment.status, 'partial')
})

test('canonical aggregate fails closed on Party, payment, range, and duplicate identity drift', () => {
  assert.throws(
    () => canonicalReservationToAdminOrderViewModel(canonicalSummary({ partyCount: 0 })),
    (error) => error.code === 'reservation_order_party_count_invalid',
  )
  assert.throws(
    () => canonicalReservationToAdminOrderViewModel(canonicalSummary({
      money: { ...canonicalSummary().money, paymentStatus: 'pay_at_venue' },
    })),
    (error) => error.code === 'reservation_order_payment_status_invalid',
  )
  assert.throws(
    () => canonicalReservationToAdminOrderViewModel(canonicalSummary({
      schedule: { ...canonicalSummary().schedule, lastEndsAt: '2026-09-01T12:00:00+00:00' },
    })),
    (error) => error.code === 'reservation_order_schedule_range_invalid',
  )
  assert.throws(
    () => canonicalReservationsToAdminOrderViewModels([canonicalSummary(), canonicalSummary()]),
    (error) => error.code === 'reservation_order_duplicate',
  )
})

test('canonical order loader calls only Reservation search and preserves keyset cursor', async () => {
  const calls = []
  const payload = {
    schema_version: 1,
    generated_at: '2026-09-01T00:00:00+00:00',
    items: [responseRow()],
    summary: { results: 3, total_minutes: 360, primary_contacts: 2, today: 1 },
    has_more: true,
    next_cursor: { sort_at: '2026-09-07T14:00:00+00:00', reservation_id: reservationOne },
  }
  const client = {
    rpc: async (name, parameters) => {
      calls.push({ name, parameters })
      return { data: payload, error: null }
    },
  }

  const result = await fetchCanonicalAdminReservationOrders({
    client,
    filters: {
      start: '2026-09-07',
      end: '2026-09-30',
      query: 'alternate',
      status: 'not_cancelled',
      paymentStatus: 'partial',
    },
    cursor: null,
    limit: 50,
    timeZone: 'America/Toronto',
  })

  assert.equal(calls.length, 1)
  assert.equal(calls[0].name, 'admin_search_reservations')
  assert.equal(calls[0].parameters.p_reservation_status, 'not_cancelled')
  assert.equal(calls[0].parameters.p_after_sort_at, null)
  assert.equal('p_after_start_at' in calls[0].parameters, false)
  assert.deepEqual(result.summary, { results: 3, totalMinutes: 360, customers: 2, today: 1 })
  assert.deepEqual(result.nextCursor, {
    sort_at: '2026-09-07T14:00:00+00:00',
    reservation_id: reservationOne,
  })
})

test('canonical order loader rejects malformed cursors, stale server cursors, and raw errors', async () => {
  const client = {
    rpc: async () => ({
      data: {
        schema_version: 1,
        items: [responseRow()],
        summary: { results: 1, total_minutes: 120, primary_contacts: 1, today: 0 },
        has_more: true,
        next_cursor: { sort_at: '2026-09-08T14:00:00+00:00', reservation_id: reservationTwo },
      },
      error: null,
    }),
  }
  await assert.rejects(
    fetchCanonicalAdminReservationOrders({
      client,
      filters: { start: '2026-09-07', end: '2026-09-30', status: 'all', paymentStatus: 'all' },
    }),
    (error) => error.code === 'reservation_order_next_cursor_mismatch',
  )
  await assert.rejects(
    fetchCanonicalAdminReservationOrders({
      client,
      filters: { start: '2026-09-07', end: '2026-09-30', status: 'all', paymentStatus: 'all' },
      cursor: { sort_at: '2026-09-07T14:00:00+00:00' },
    }),
    (error) => error.code === 'reservation_order_cursor_invalid',
  )
  assert.equal(
    reservationOrderSafeErrorCode({ code: 'PGRST301', message: 'private server details' }),
    'reservation_order_read_failed',
  )
})
