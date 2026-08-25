import { fetchCanonicalAllocationWindow } from './reservationReadShadow.js'

export const RESERVATION_SCHEDULE_READ_SOURCE_LEGACY = 'legacy'
export const RESERVATION_SCHEDULE_READ_SOURCE_CANONICAL = 'canonical'
export const ADMIN_SCHEDULE_VIEW_MODEL_VERSION = 1

const scheduleContractError = (code) => Object.assign(new Error(code), { code })

export const normalizeReservationScheduleReadSource = (value) => (
  value === RESERVATION_SCHEDULE_READ_SOURCE_CANONICAL
    ? RESERVATION_SCHEDULE_READ_SOURCE_CANONICAL
    : RESERVATION_SCHEDULE_READ_SOURCE_LEGACY
)

const requireText = (value, code) => {
  const text = String(value || '').trim()
  if (!text) throw scheduleContractError(code)
  return text
}

const canonicalPaymentMethod = (paymentStatus) => (
  paymentStatus === 'paid' || paymentStatus === 'partial' || paymentStatus === 'refunded'
    ? 'ledger'
    : null
)

export const canonicalAllocationToAdminScheduleViewModel = (allocation) => {
  if (allocation?.source !== RESERVATION_SCHEDULE_READ_SOURCE_CANONICAL) {
    throw scheduleContractError('reservation_schedule_source_invalid')
  }

  const id = requireText(allocation.allocationId, 'reservation_schedule_allocation_id_missing')
  const effectiveReservationId = requireText(
    allocation.effectiveReservationId,
    'reservation_schedule_effective_reservation_missing',
  )
  const effectiveSessionId = requireText(
    allocation.effectiveSessionId,
    'reservation_schedule_effective_session_missing',
  )
  const courtId = requireText(allocation.courtId, 'reservation_schedule_court_missing')
  const startsAt = requireText(allocation.startsAt, 'reservation_schedule_start_missing')
  const endsAt = requireText(allocation.endsAt, 'reservation_schedule_end_missing')
  if (endsAt <= startsAt) throw scheduleContractError('reservation_schedule_range_invalid')

  const customerName = requireText(
    allocation.primaryContact?.name,
    'reservation_schedule_primary_contact_missing',
  )
  const paymentStatus = requireText(
    allocation.reservation?.paymentStatus,
    'reservation_schedule_payment_status_missing',
  )

  return {
    schedule_view_model_version: ADMIN_SCHEDULE_VIEW_MODEL_VERSION,
    schedule_read_source: RESERVATION_SCHEDULE_READ_SOURCE_CANONICAL,
    id,
    reservation_id: allocation.projectionReservationId,
    session_id: allocation.projectionSessionId,
    effective_reservation_id: effectiveReservationId,
    effective_session_id: effectiveSessionId,
    membership_version: allocation.membershipVersion,
    last_transition_id: allocation.lastTransitionId,
    booking_group_id: allocation.legacySourceGroupId,
    booking_link_id: allocation.legacySourceLinkId,
    legacy_source_group_id: allocation.legacySourceGroupId,
    legacy_source_link_id: allocation.legacySourceLinkId,
    court_id: courtId,
    court_name_zh: allocation.courtNameZh,
    court_name_en: allocation.courtNameEn,
    court_sort_order: allocation.courtSortOrder,
    customer_name: customerName,
    customer_email: allocation.primaryContact?.email || null,
    customer_phone: allocation.primaryContact?.phone || null,
    customer_notes: null,
    has_notes: Boolean(allocation.hasNotes),
    start_at: startsAt,
    end_at: endsAt,
    status: requireText(allocation.allocationStatus, 'reservation_schedule_status_missing'),
    payment_status: paymentStatus,
    payment_method: canonicalPaymentMethod(paymentStatus),
    total_amount: allocation.allocationAmount,
    currency: allocation.currency,
    system_calculated_amount: allocation.systemCalculatedAmount,
    price_source: allocation.priceSource,
    price_override_amount: allocation.priceOverrideAmount,
    party_size: allocation.partySize,
    recurrence_series_id: allocation.reservation?.recurrenceSeriesId || null,
    recurrence_week: allocation.reservation?.recurrenceSequence ?? null,
    reservation_reference: allocation.reservation?.reference || null,
    reservation_status: allocation.reservation?.status || null,
    reservation_payment_plan: allocation.reservation?.paymentPlan || null,
    reservation_total_amount: allocation.reservation?.totalAmount ?? null,
    reservation_paid_amount: allocation.reservation?.paidAmount ?? null,
    reservation_refunded_amount: allocation.reservation?.refundedAmount ?? null,
    reservation_outstanding_amount: allocation.reservation?.outstandingAmount ?? null,
    reservation_session_count: allocation.reservation?.sessionCount ?? null,
    reservation_allocation_count: allocation.reservation?.allocationCount ?? null,
    session_allocation_count: allocation.sessionAllocationCount ?? null,
    created_at: allocation.createdAt,
    updated_at: allocation.updatedAt,
  }
}

export const canonicalAllocationsToAdminScheduleViewModels = (allocations) => {
  const rows = (Array.isArray(allocations) ? allocations : [])
    .map(canonicalAllocationToAdminScheduleViewModel)
    .sort((left, right) => left.start_at.localeCompare(right.start_at) || left.id.localeCompare(right.id))
  const ids = new Set()
  for (const row of rows) {
    if (ids.has(row.id)) throw scheduleContractError('reservation_schedule_allocation_duplicate')
    ids.add(row.id)
  }
  return rows
}

export const fetchCanonicalAdminScheduleWindow = async ({
  client,
  startDate,
  endDate,
  timeZone,
  signal,
  pageSize,
}) => {
  const model = await fetchCanonicalAllocationWindow({
    client,
    startDate,
    endDate,
    timeZone,
    signal,
    pageSize,
  })
  return canonicalAllocationsToAdminScheduleViewModels(model.items)
}
