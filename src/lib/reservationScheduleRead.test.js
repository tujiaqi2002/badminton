import assert from 'node:assert/strict'
import test from 'node:test'
import {
  canonicalAllocationToAdminScheduleViewModel,
  canonicalAllocationsToAdminScheduleViewModels,
  fetchCanonicalAdminScheduleWindow,
  normalizeReservationScheduleReadSource,
  RESERVATION_SCHEDULE_READ_SOURCE_CANONICAL,
  RESERVATION_SCHEDULE_READ_SOURCE_LEGACY,
} from './reservationScheduleRead.js'

const allocationId = '10000000-0000-0000-0000-000000000001'
const reservationId = '20000000-0000-0000-0000-000000000001'
const sessionId = '30000000-0000-0000-0000-000000000001'
const courtId = '40000000-0000-0000-0000-000000000001'

const canonicalAllocation = (overrides = {}) => ({
  source: 'canonical',
  allocationId,
  originReservationId: reservationId,
  originSessionId: sessionId,
  projectionReservationId: reservationId,
  projectionSessionId: sessionId,
  effectiveReservationId: reservationId,
  effectiveSessionId: sessionId,
  membershipVersion: 2,
  lastTransitionId: null,
  courtId,
  courtNameZh: '一号场',
  courtNameEn: 'Court 1',
  courtSortOrder: 1,
  startsAt: '2026-09-07T10:00:00',
  endsAt: '2026-09-07T11:00:00',
  partySize: 4,
  allocationStatus: 'confirmed',
  allocationAmount: 28,
  currency: 'CAD',
  systemCalculatedAmount: 28,
  priceSource: 'system',
  priceOverrideAmount: null,
  hasNotes: true,
  legacySourceGroupId: '50000000-0000-0000-0000-000000000001',
  legacySourceLinkId: null,
  sessionAllocationCount: 2,
  reservation: {
    reference: 'R-000001',
    status: 'confirmed',
    paymentStatus: 'partial',
    paymentPlan: 'split_equal',
    totalAmount: 56,
    paidAmount: 28,
    refundedAmount: 0,
    outstandingAmount: 28,
    sessionCount: 1,
    allocationCount: 2,
    recurrenceSeriesId: '60000000-0000-0000-0000-000000000001',
    recurrenceSequence: 3,
  },
  primaryContact: {
    name: 'Synthetic customer',
    email: 'synthetic@example.invalid',
    phone: '416-555-0100',
  },
  createdAt: '2026-08-20T10:00:00+00:00',
  updatedAt: '2026-08-20T10:00:00+00:00',
  ...overrides,
})

const canonicalResponseRow = (overrides = {}) => ({
  allocation_id: allocationId,
  origin_reservation_id: reservationId,
  origin_session_id: sessionId,
  projection_reservation_id: reservationId,
  projection_session_id: sessionId,
  effective_reservation_id: reservationId,
  effective_session_id: sessionId,
  membership_version: 2,
  last_transition_id: null,
  court_id: courtId,
  court_name_zh: '一号场',
  court_name_en: 'Court 1',
  court_sort_order: 1,
  starts_at: '2026-09-07T14:00:00+00:00',
  ends_at: '2026-09-07T15:00:00+00:00',
  party_size: 4,
  allocation_status: 'confirmed',
  allocation_amount: 28,
  currency: 'CAD',
  system_calculated_amount: 28,
  price_source: 'system',
  price_override_amount: null,
  has_notes: false,
  legacy_source_group_id: null,
  legacy_source_link_id: null,
  session_allocation_count: 1,
  reservation_reference: 'R-000001',
  reservation_status: 'confirmed',
  payment_status: 'unpaid',
  payment_plan: 'single_payer',
  reservation_total_amount: 28,
  reservation_paid_amount: 0,
  reservation_refunded_amount: 0,
  reservation_net_paid_amount: 0,
  reservation_outstanding_amount: 28,
  reservation_session_count: 1,
  reservation_allocation_count: 1,
  primary_party_id: null,
  primary_contact_name: 'Synthetic customer',
  primary_contact_email: 'synthetic@example.invalid',
  primary_contact_phone: '416-555-0100',
  recurrence_series_id: null,
  recurrence_sequence: null,
  transition_count: 0,
  source_lineage_count: 1,
  allocation_created_at: '2026-08-20T10:00:00+00:00',
  allocation_updated_at: '2026-08-20T10:00:00+00:00',
  ...overrides,
})

test('schedule read source is fail-closed to legacy', () => {
  assert.equal(normalizeReservationScheduleReadSource('canonical'), RESERVATION_SCHEDULE_READ_SOURCE_CANONICAL)
  assert.equal(normalizeReservationScheduleReadSource('legacy'), RESERVATION_SCHEDULE_READ_SOURCE_LEGACY)
  assert.equal(normalizeReservationScheduleReadSource('CANONICAL'), RESERVATION_SCHEDULE_READ_SOURCE_LEGACY)
  assert.equal(normalizeReservationScheduleReadSource('unknown'), RESERVATION_SCHEDULE_READ_SOURCE_LEGACY)
  assert.equal(normalizeReservationScheduleReadSource(undefined), RESERVATION_SCHEDULE_READ_SOURCE_LEGACY)
})

test('canonical allocation maps once into the explicit schedule view model', () => {
  const row = canonicalAllocationToAdminScheduleViewModel(canonicalAllocation())
  assert.equal(row.schedule_view_model_version, 1)
  assert.equal(row.schedule_read_source, 'canonical')
  assert.equal(row.id, allocationId)
  assert.equal(row.effective_reservation_id, reservationId)
  assert.equal(row.effective_session_id, sessionId)
  assert.equal(row.customer_name, 'Synthetic customer')
  assert.equal(row.customer_notes, null)
  assert.equal(row.has_notes, true)
  assert.equal(row.payment_status, 'partial')
  assert.equal(row.total_amount, 28)
  assert.equal(row.reservation_total_amount, 56)
})

test('canonical schedule view model fails closed on missing effective identity and duplicates', () => {
  assert.throws(
    () => canonicalAllocationToAdminScheduleViewModel(canonicalAllocation({ effectiveSessionId: null })),
    (error) => error.code === 'reservation_schedule_effective_session_missing',
  )
  assert.throws(
    () => canonicalAllocationsToAdminScheduleViewModels([canonicalAllocation(), canonicalAllocation()]),
    (error) => error.code === 'reservation_schedule_allocation_duplicate',
  )
})

test('canonical schedule loader follows keyset cursors and never requests legacy bookings', async () => {
  const calls = []
  const secondId = '10000000-0000-0000-0000-000000000002'
  const responses = [
    {
      schema_version: 1,
      generated_at: '2026-09-01T00:00:00+00:00',
      limit: 1,
      items: [canonicalResponseRow()],
      has_more: true,
      next_cursor: { starts_at: '2026-09-07T14:00:00+00:00', allocation_id: allocationId },
    },
    {
      schema_version: 1,
      generated_at: '2026-09-01T00:00:00+00:00',
      limit: 1,
      items: [canonicalResponseRow({ allocation_id: secondId, court_id: '40000000-0000-0000-0000-000000000002' })],
      has_more: false,
      next_cursor: null,
    },
  ]
  const client = {
    rpc: async (name, parameters) => {
      calls.push({ name, parameters })
      return { data: responses.shift(), error: null }
    },
  }

  const rows = await fetchCanonicalAdminScheduleWindow({
    client,
    startDate: '2026-09-07',
    endDate: '2026-09-13',
    timeZone: 'America/Toronto',
    pageSize: 1,
  })

  assert.equal(rows.length, 2)
  assert.equal(calls.length, 2)
  assert.deepEqual(new Set(calls.map((call) => call.name)), new Set(['admin_list_reservation_allocations']))
  assert.equal(calls[0].parameters.p_after_starts_at, null)
  assert.equal(calls[1].parameters.p_after_starts_at, '2026-09-07T14:00:00+00:00')
  assert.equal('p_offset' in calls[0].parameters, false)
})

test('canonical schedule loader surfaces RPC errors without producing fallback rows', async () => {
  const client = {
    rpc: async () => ({ data: null, error: { code: 'PGRST301', message: 'permission denied' } }),
  }
  await assert.rejects(
    fetchCanonicalAdminScheduleWindow({
      client,
      startDate: '2026-09-07',
      endDate: '2026-09-13',
      timeZone: 'America/Toronto',
    }),
    (error) => error.code === 'PGRST301',
  )
})
