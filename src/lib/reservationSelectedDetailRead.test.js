import assert from 'node:assert/strict'
import test from 'node:test'
import {
  canonicalReservationDetailToAdminInspectorViewModel,
  createAdminReservationDetailLoader,
  fetchCanonicalAdminReservationDetail,
  normalizeReservationSelectedDetailReadSource,
  RESERVATION_SELECTED_DETAIL_READ_SOURCE_CANONICAL,
  RESERVATION_SELECTED_DETAIL_READ_SOURCE_LEGACY,
  selectedDetailSafeErrorCode,
} from './reservationSelectedDetailRead.js'
import { normalizeCanonicalReservationDetail } from './reservationReadModel.js'

const reservationId = '10000000-0000-0000-0000-000000000001'
const sessionId = '20000000-0000-0000-0000-000000000001'
const secondSessionId = '20000000-0000-0000-0000-000000000002'
const allocationId = '30000000-0000-0000-0000-000000000001'
const secondAllocationId = '30000000-0000-0000-0000-000000000002'
const courtId = '40000000-0000-0000-0000-000000000001'
const secondCourtId = '40000000-0000-0000-0000-000000000002'
const primaryPartyId = '50000000-0000-0000-0000-000000000001'
const otherPartyId = '50000000-0000-0000-0000-000000000002'

const detailPayload = (overrides = {}) => ({
  schema_version: 1,
  generated_at: '2026-09-01T00:00:00+00:00',
  reservation: {
    reservation_id: reservationId,
    reference_number: 42,
    reservation_reference: 'R-000042',
    reservation_status: 'confirmed',
    currency: 'CAD',
    payment_plan: 'split_custom',
    payment_status: 'partial',
    source: 'manager',
    total_amount: 84,
    paid_amount: 28,
    refunded_amount: 0,
    net_paid_amount: 28,
    outstanding_amount: 56,
    succeeded_payment_count: 1,
    session_count: 2,
    allocation_count: 3,
    allocation_minutes: 180,
    court_ids: [courtId, secondCourtId],
    allocation_status_counts: { confirmed: 3 },
    has_notes: true,
    primary_party_id: primaryPartyId,
    primary_contact_name: 'Synthetic Primary',
    primary_contact_email: 'primary@example.invalid',
    primary_contact_phone: '416-555-0100',
    legacy_group_count: 2,
    legacy_link_count: 1,
    source_lineage_count: 3,
    transition_count: 1,
    latest_transition_sequence: 1,
    notes: 'Reservation-level synthetic note',
    created_at: '2026-08-20T10:00:00+00:00',
    updated_at: '2026-08-20T10:00:00+00:00',
  },
  parties: [
    {
      party_id: primaryPartyId,
      party_type: 'person',
      display_name: 'Synthetic Primary',
      email: 'primary@example.invalid',
      phone: '416-555-0100',
      source: 'manager',
      roles: ['primary_contact', 'payer'],
      created_at: '2026-08-20T10:00:00+00:00',
      updated_at: '2026-08-20T10:00:00+00:00',
    },
    {
      party_id: otherPartyId,
      party_type: 'person',
      display_name: 'Synthetic Partner',
      email: 'partner@example.invalid',
      phone: '416-555-0101',
      source: 'manager',
      roles: ['participant'],
      created_at: '2026-08-20T10:00:00+00:00',
      updated_at: '2026-08-20T10:00:00+00:00',
    },
  ],
  sessions: [
    {
      session_id: sessionId,
      starts_at: '2026-09-07T14:00:00+00:00',
      ends_at: '2026-09-07T15:00:00+00:00',
      party_size: 4,
      notes: 'Selected Session synthetic note',
      source: 'manager',
      allocations: [
        {
          allocation_id: allocationId,
          origin_reservation_id: reservationId,
          origin_session_id: sessionId,
          projection_reservation_id: reservationId,
          projection_session_id: sessionId,
          court_id: courtId,
          court_name_zh: '一号场',
          court_name_en: 'Court 1',
          court_sort_order: 1,
          status: 'confirmed',
          amount: 28,
          currency: 'CAD',
          membership_version: 2,
          last_transition_id: null,
        },
        {
          allocation_id: secondAllocationId,
          origin_reservation_id: reservationId,
          origin_session_id: sessionId,
          projection_reservation_id: reservationId,
          projection_session_id: sessionId,
          court_id: secondCourtId,
          court_name_zh: '二号场',
          court_name_en: 'Court 2',
          court_sort_order: 2,
          status: 'confirmed',
          amount: 28,
          currency: 'CAD',
          membership_version: 2,
          last_transition_id: null,
        },
      ],
    },
    {
      session_id: secondSessionId,
      starts_at: '2026-09-08T15:00:00+00:00',
      ends_at: '2026-09-08T16:00:00+00:00',
      party_size: 2,
      notes: 'Second Session synthetic note',
      source: 'manager',
      allocations: [{
        allocation_id: '30000000-0000-0000-0000-000000000003',
        origin_reservation_id: reservationId,
        origin_session_id: secondSessionId,
        projection_reservation_id: reservationId,
        projection_session_id: secondSessionId,
        court_id: courtId,
        status: 'confirmed',
        amount: 28,
        currency: 'CAD',
        membership_version: 1,
        last_transition_id: '60000000-0000-0000-0000-000000000001',
      }],
    },
  ],
  payment_shares: [
    { share_id: 'share-1', party_id: primaryPartyId, share_type: 'fixed', target_amount: 56 },
    { share_id: 'share-2', party_id: otherPartyId, share_type: 'fixed', target_amount: 28 },
  ],
  payments: [{
    payment_id: '70000000-0000-0000-0000-000000000001',
    original_reservation_id: reservationId,
    payer_party_id: primaryPartyId,
    kind: 'payment',
    amount: 28,
    currency: 'CAD',
    method: 'cash',
    status: 'succeeded',
    source: 'manager',
    current_reservation_amount: 28,
  }],
  payment_allocation_entries: [{
    entry_id: '80000000-0000-0000-0000-000000000001',
    payment_id: '70000000-0000-0000-0000-000000000001',
    allocation_id: allocationId,
    original_payment_reservation_id: reservationId,
    entry_kind: 'allocation',
    amount: 28,
  }],
  source_lineage: [
    { source_type: 'legacy_booking_group', source_id: '90000000-0000-0000-0000-000000000001' },
    { source_type: 'legacy_booking_group', source_id: '90000000-0000-0000-0000-000000000002' },
    { source_type: 'legacy_booking_link', source_id: '90000000-0000-0000-0000-000000000003' },
  ],
  transitions: [{
    transition_id: '60000000-0000-0000-0000-000000000001',
    sequence: 1,
    type: 'merge',
  }],
  session_assignment_summary: {
    assignment_count: 3,
    allocation_count: 3,
    latest_assignment_at: '2026-08-25T12:00:00+00:00',
  },
  ...overrides,
})

const selectedAllocation = (overrides = {}) => ({
  id: allocationId,
  effective_reservation_id: reservationId,
  effective_session_id: sessionId,
  membership_version: 2,
  last_transition_id: null,
  court_id: courtId,
  start_at: '2026-09-07T10:00:00',
  end_at: '2026-09-07T11:00:00',
  status: 'confirmed',
  total_amount: 28,
  currency: 'CAD',
  session_allocation_count: 2,
  ...overrides,
})

test('selected detail source fails closed to legacy', () => {
  assert.equal(normalizeReservationSelectedDetailReadSource('canonical'), RESERVATION_SELECTED_DETAIL_READ_SOURCE_CANONICAL)
  assert.equal(normalizeReservationSelectedDetailReadSource('legacy'), RESERVATION_SELECTED_DETAIL_READ_SOURCE_LEGACY)
  assert.equal(normalizeReservationSelectedDetailReadSource('CANONICAL'), RESERVATION_SELECTED_DETAIL_READ_SOURCE_LEGACY)
  assert.equal(normalizeReservationSelectedDetailReadSource('unknown'), RESERVATION_SELECTED_DETAIL_READ_SOURCE_LEGACY)
  assert.equal(normalizeReservationSelectedDetailReadSource(undefined), RESERVATION_SELECTED_DETAIL_READ_SOURCE_LEGACY)
})

test('canonical detail maps one selected allocation into the versioned inspector model', () => {
  const detail = normalizeCanonicalReservationDetail(detailPayload())
  const model = canonicalReservationDetailToAdminInspectorViewModel(detail, selectedAllocation())

  assert.equal(model.inspector_view_model_version, 1)
  assert.equal(model.detail_read_source, 'canonical')
  assert.equal(model.selection.reservationId, reservationId)
  assert.equal(model.selection.sessionId, sessionId)
  assert.equal(model.selection.allocationId, allocationId)
  assert.equal(model.primaryContact.name, 'Synthetic Primary')
  assert.equal(model.primaryContact.updatedAt, '2026-08-20T10:00:00+00:00')
  assert.deepEqual(model.otherParties.map((party) => party.name), ['Synthetic Partner'])
  assert.equal(model.reservation.notes, 'Reservation-level synthetic note')
  assert.equal(model.selectedSession.notes, 'Selected Session synthetic note')
  assert.equal(model.reservation.sessionCount, 2)
  assert.equal(model.reservation.allocationCount, 3)
  assert.equal(model.payment.plan, 'split_custom')
  assert.equal(model.payment.totalAmount, 84)
  assert.equal(model.payment.outstandingAmount, 56)
  assert.equal(model.payment.shares.length, 2)
  assert.equal(model.lineage.transitions[0].type, 'merge')
})

test('canonical detail accepts the legacy unspecified plan and rejects unknown payment enums', () => {
  const legacyPayload = detailPayload()
  legacyPayload.reservation.payment_plan = 'legacy_unspecified'
  const legacyModel = canonicalReservationDetailToAdminInspectorViewModel(
    normalizeCanonicalReservationDetail(legacyPayload),
    selectedAllocation(),
  )
  assert.equal(legacyModel.payment.plan, 'legacy_unspecified')

  const inconsistentPayload = detailPayload()
  inconsistentPayload.reservation.payment_status = 'inconsistent'
  const inconsistentModel = canonicalReservationDetailToAdminInspectorViewModel(
    normalizeCanonicalReservationDetail(inconsistentPayload),
    selectedAllocation(),
  )
  assert.equal(inconsistentModel.payment.status, 'inconsistent')

  const unknownPlanPayload = detailPayload()
  unknownPlanPayload.reservation.payment_plan = 'future_plan'
  assert.throws(
    () => canonicalReservationDetailToAdminInspectorViewModel(
      normalizeCanonicalReservationDetail(unknownPlanPayload),
      selectedAllocation(),
    ),
    (error) => error.code === 'reservation_selected_detail_payment_plan_invalid',
  )

  const unknownStatusPayload = detailPayload()
  unknownStatusPayload.reservation.payment_status = 'future_status'
  assert.throws(
    () => canonicalReservationDetailToAdminInspectorViewModel(
      normalizeCanonicalReservationDetail(unknownStatusPayload),
      selectedAllocation(),
    ),
    (error) => error.code === 'reservation_selected_detail_payment_status_invalid',
  )
})

test('canonical detail fails closed on Reservation, Session and Allocation identity mismatches', () => {
  const detail = normalizeCanonicalReservationDetail(detailPayload())
  assert.throws(
    () => canonicalReservationDetailToAdminInspectorViewModel(detail, selectedAllocation({ effective_reservation_id: 'wrong' })),
    (error) => error.code === 'reservation_selected_detail_reservation_mismatch',
  )
  assert.throws(
    () => canonicalReservationDetailToAdminInspectorViewModel(detail, selectedAllocation({ effective_session_id: 'wrong' })),
    (error) => error.code === 'reservation_selected_detail_session_match_invalid',
  )
  assert.throws(
    () => canonicalReservationDetailToAdminInspectorViewModel(detail, selectedAllocation({ court_id: 'wrong' })),
    (error) => error.code === 'reservation_selected_detail_court_mismatch',
  )
  assert.throws(
    () => canonicalReservationDetailToAdminInspectorViewModel(detail, selectedAllocation({ total_amount: 29 })),
    (error) => error.code === 'reservation_selected_detail_amount_mismatch',
  )
})

test('canonical detail rejects duplicate allocation membership and broken payment references', () => {
  const duplicatePayload = detailPayload()
  duplicatePayload.sessions[1].allocations.push(structuredClone(duplicatePayload.sessions[0].allocations[0]))
  duplicatePayload.reservation.allocation_count += 1
  assert.throws(
    () => canonicalReservationDetailToAdminInspectorViewModel(
      normalizeCanonicalReservationDetail(duplicatePayload),
      selectedAllocation(),
    ),
    (error) => error.code === 'reservation_selected_detail_allocation_match_invalid',
  )

  const invalidPaymentPayload = detailPayload()
  invalidPaymentPayload.payment_allocation_entries[0].allocation_id = 'missing'
  assert.throws(
    () => canonicalReservationDetailToAdminInspectorViewModel(
      normalizeCanonicalReservationDetail(invalidPaymentPayload),
      selectedAllocation(),
    ),
    (error) => error.code === 'reservation_selected_detail_payment_entry_allocation_missing',
  )
})

test('detail RPC uses only admin_get_reservation_detail and preserves the v1 whitelist', async () => {
  const calls = []
  const client = {
    rpc: async (name, parameters) => {
      calls.push({ name, parameters })
      return { data: detailPayload({ provider_payload: 'DO_NOT_KEEP' }), error: null }
    },
  }
  const detail = await fetchCanonicalAdminReservationDetail({ client, reservationId })
  assert.deepEqual(calls, [{
    name: 'admin_get_reservation_detail',
    parameters: { p_reservation_id: reservationId },
  }])
  assert.equal(JSON.stringify(detail).includes('DO_NOT_KEEP'), false)
})

test('loader deduplicates and caches selections in one Reservation, then refetches after invalidation', async () => {
  let calls = 0
  let attachedSignal = null
  const client = {
    rpc: () => {
      calls += 1
      return {
        abortSignal(signal) {
          attachedSignal = signal
          return Promise.resolve({ data: detailPayload(), error: null })
        },
      }
    },
  }
  const loader = createAdminReservationDetailLoader({ client })
  const [first, second] = await Promise.all([
    loader.load(selectedAllocation()),
    loader.load(selectedAllocation({
      id: secondAllocationId,
      court_id: secondCourtId,
    })),
  ])
  assert.equal(calls, 1)
  assert.equal(attachedSignal instanceof AbortSignal, true)
  assert.equal(first.selection.allocationId, allocationId)
  assert.equal(second.selection.allocationId, secondAllocationId)

  await loader.load(selectedAllocation())
  assert.equal(calls, 1)
  loader.invalidate(reservationId)
  await loader.load(selectedAllocation())
  assert.equal(calls, 2)
  loader.dispose()
})

test('loader aborts an in-flight request when selection crosses Reservations', async () => {
  const secondReservationId = '10000000-0000-0000-0000-000000000002'
  let firstSignal = null
  const client = {
    rpc: (_name, parameters) => ({
      abortSignal(signal) {
        if (parameters.p_reservation_id === reservationId) {
          firstSignal = signal
          return new Promise((_resolve, reject) => {
            signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })))
          })
        }
        const payload = detailPayload()
        payload.reservation.reservation_id = secondReservationId
        payload.sessions.forEach((session) => {
          session.allocations.forEach((allocation) => {
            allocation.origin_reservation_id = secondReservationId
            allocation.projection_reservation_id = secondReservationId
          })
        })
        return Promise.resolve({ data: payload, error: null })
      },
    }),
  }
  const loader = createAdminReservationDetailLoader({ client })
  const first = loader.load(selectedAllocation())
  const second = loader.load(selectedAllocation({ effective_reservation_id: secondReservationId }))

  await assert.rejects(first, (error) => error.name === 'AbortError')
  assert.equal(firstSignal.aborted, true)
  assert.equal((await second).selection.reservationId, secondReservationId)
  loader.dispose()
})

test('detail UI error codes never expose arbitrary server messages', () => {
  assert.equal(
    selectedDetailSafeErrorCode({ code: 'PGRST301', message: 'private detail' }),
    'pgrst301',
  )
  assert.equal(
    selectedDetailSafeErrorCode({ code: 'unexpected', message: 'private detail' }),
    'reservation_selected_detail_read_failed',
  )
})
