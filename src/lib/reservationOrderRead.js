import {
  DEFAULT_VENUE_TIMEZONE,
  normalizeCanonicalReservationSearch,
  venueLocalDateTime,
} from './reservationReadModel.js'

export const RESERVATION_ORDER_READ_SOURCE_LEGACY = 'legacy'
export const RESERVATION_ORDER_READ_SOURCE_CANONICAL = 'canonical'
export const ADMIN_RESERVATION_ORDER_VIEW_MODEL_VERSION = 1

const RESERVATION_STATUSES = new Set([
  'held', 'confirmed', 'cancelled', 'completed', 'expired', 'no_show', 'mixed',
])
const PAYMENT_PLANS = new Set([
  'single_payer', 'split_equal', 'split_custom', 'legacy_unspecified',
])
const PAYMENT_STATUSES = new Set([
  'unpaid', 'partial', 'paid', 'refunded', 'no_charge', 'inconsistent',
])

const orderContractError = (code) => Object.assign(new Error(code), { code })

const requireText = (value, code) => {
  const text = String(value || '').trim()
  if (!text) throw orderContractError(code)
  return text
}

const requireInteger = (value, minimum, code) => {
  const number = Number(value)
  if (!Number.isInteger(number) || number < minimum) throw orderContractError(code)
  return number
}

const requireEnum = (value, allowed, code) => {
  const text = requireText(value, code)
  if (!allowed.has(text)) throw orderContractError(code)
  return text
}

const cents = (value, code) => {
  const number = Number(value)
  if (!Number.isFinite(number)) throw orderContractError(code)
  return Math.round(number * 100)
}

const requireNonNegativeAmount = (value, code) => {
  const valueInCents = cents(value, code)
  if (valueInCents < 0) throw orderContractError(code)
  return valueInCents / 100
}

const requireDateKey = (value, code) => {
  const text = requireText(value, code)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) throw orderContractError(code)
  return text
}

const requireLocalDateTime = (value, timeZone, code) => {
  const local = venueLocalDateTime(requireText(value, code), timeZone)
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(local || '')) {
    throw orderContractError(code)
  }
  return local
}

export const normalizeReservationOrderReadSource = (value) => (
  value === RESERVATION_ORDER_READ_SOURCE_CANONICAL
    ? RESERVATION_ORDER_READ_SOURCE_CANONICAL
    : RESERVATION_ORDER_READ_SOURCE_LEGACY
)

export const canonicalReservationToAdminOrderViewModel = (reservation, options = {}) => {
  const timeZone = options.timeZone || DEFAULT_VENUE_TIMEZONE
  const reservationId = requireText(
    reservation?.reservationId,
    'reservation_order_reservation_id_missing',
  )
  const reference = requireText(
    reservation?.reference,
    'reservation_order_reference_missing',
  )
  const status = requireEnum(
    reservation?.status,
    RESERVATION_STATUSES,
    'reservation_order_status_invalid',
  )
  const currency = requireText(
    reservation?.currency,
    'reservation_order_currency_missing',
  )
  const paymentPlan = requireEnum(
    reservation?.paymentPlan,
    PAYMENT_PLANS,
    'reservation_order_payment_plan_invalid',
  )
  const paymentStatus = requireEnum(
    reservation?.money?.paymentStatus,
    PAYMENT_STATUSES,
    'reservation_order_payment_status_invalid',
  )
  const primaryPartyId = requireText(
    reservation?.primaryContact?.partyId,
    'reservation_order_primary_party_id_missing',
  )
  const primaryName = requireText(
    reservation?.primaryContact?.name,
    'reservation_order_primary_contact_missing',
  )
  const partyCount = requireInteger(
    reservation?.partyCount,
    1,
    'reservation_order_party_count_invalid',
  )

  const firstStartsAt = requireLocalDateTime(
    reservation?.schedule?.firstStartsAt,
    timeZone,
    'reservation_order_first_start_invalid',
  )
  const lastEndsAt = requireLocalDateTime(
    reservation?.schedule?.lastEndsAt,
    timeZone,
    'reservation_order_last_end_invalid',
  )
  const matchedStartsAt = requireLocalDateTime(
    reservation?.schedule?.matchedStartsAt,
    timeZone,
    'reservation_order_matched_start_invalid',
  )
  if (lastEndsAt <= firstStartsAt || matchedStartsAt < firstStartsAt || matchedStartsAt >= lastEndsAt) {
    throw orderContractError('reservation_order_schedule_range_invalid')
  }

  const sessionCount = requireInteger(
    reservation?.schedule?.sessionCount,
    1,
    'reservation_order_session_count_invalid',
  )
  const allocationCount = requireInteger(
    reservation?.schedule?.allocationCount,
    1,
    'reservation_order_allocation_count_invalid',
  )
  if (allocationCount < sessionCount) {
    throw orderContractError('reservation_order_allocation_count_invalid')
  }
  const allocationMinutes = requireInteger(
    reservation?.schedule?.allocationMinutes,
    1,
    'reservation_order_allocation_minutes_invalid',
  )
  const matchedAllocationMinutes = requireInteger(
    reservation?.schedule?.matchedAllocationMinutes,
    1,
    'reservation_order_matched_minutes_invalid',
  )
  const courtIds = (Array.isArray(reservation?.schedule?.courtIds)
    ? reservation.schedule.courtIds
    : []).map((courtId) => requireText(courtId, 'reservation_order_court_id_missing'))
  if (!courtIds.length || new Set(courtIds).size !== courtIds.length) {
    throw orderContractError('reservation_order_court_ids_invalid')
  }

  const totalAmount = requireNonNegativeAmount(
    reservation?.money?.totalAmount,
    'reservation_order_total_amount_invalid',
  )
  const paidAmount = requireNonNegativeAmount(
    reservation?.money?.paidAmount,
    'reservation_order_paid_amount_invalid',
  )
  const refundedAmount = requireNonNegativeAmount(
    reservation?.money?.refundedAmount,
    'reservation_order_refunded_amount_invalid',
  )
  const outstandingAmount = requireNonNegativeAmount(
    reservation?.money?.outstandingAmount,
    'reservation_order_outstanding_amount_invalid',
  )
  const netPaidAmount = Number(reservation?.money?.netPaidAmount)
  if (!Number.isFinite(netPaidAmount)) {
    throw orderContractError('reservation_order_net_paid_amount_invalid')
  }

  const totalCents = cents(totalAmount)
  const netPaidCents = cents(netPaidAmount)
  const outstandingCents = cents(outstandingAmount)
  if (paymentStatus === 'no_charge' && (totalCents !== 0 || netPaidCents !== 0)) {
    throw orderContractError('reservation_order_payment_summary_mismatch')
  }
  if (paymentStatus === 'unpaid' && (totalCents <= 0 || netPaidCents !== 0)) {
    throw orderContractError('reservation_order_payment_summary_mismatch')
  }
  if (paymentStatus === 'partial' && !(netPaidCents > 0 && netPaidCents < totalCents)) {
    throw orderContractError('reservation_order_payment_summary_mismatch')
  }
  if (paymentStatus === 'paid' && (netPaidCents !== totalCents || outstandingCents !== 0)) {
    throw orderContractError('reservation_order_payment_summary_mismatch')
  }

  return {
    order_view_model_version: ADMIN_RESERVATION_ORDER_VIEW_MODEL_VERSION,
    order_read_source: RESERVATION_ORDER_READ_SOURCE_CANONICAL,
    reservationId,
    referenceNumber: reservation.referenceNumber,
    reference,
    status,
    source: reservation.source,
    currency,
    createdAt: reservation.createdAt,
    updatedAt: reservation.updatedAt,
    primaryContact: {
      partyId: primaryPartyId,
      name: primaryName,
      email: reservation.primaryContact.email || null,
      phone: reservation.primaryContact.phone || null,
    },
    partyCount,
    otherPartyCount: partyCount - 1,
    schedule: {
      firstStartsAt,
      lastEndsAt,
      nextStartsAt: reservation.schedule.nextStartsAt
        ? requireLocalDateTime(
            reservation.schedule.nextStartsAt,
            timeZone,
            'reservation_order_next_start_invalid',
          )
        : null,
      matchedStartsAt,
      sessionCount,
      allocationCount,
      allocationMinutes,
      matchedAllocationMinutes,
      courtIds,
      allocationStatusCounts: { ...reservation.schedule.allocationStatusCounts },
      hasNotes: Boolean(reservation.schedule.hasNotes),
    },
    payment: {
      plan: paymentPlan,
      status: paymentStatus,
      totalAmount,
      paidAmount,
      refundedAmount,
      netPaidAmount: Number(netPaidAmount.toFixed(2)),
      outstandingAmount,
      succeededPaymentCount: requireInteger(
        reservation.money.succeededPaymentCount,
        0,
        'reservation_order_payment_count_invalid',
      ),
    },
    recurrence: { ...reservation.recurrence },
    lineage: { ...reservation.lineage },
  }
}

export const canonicalReservationsToAdminOrderViewModels = (reservations, options = {}) => {
  const rows = (Array.isArray(reservations) ? reservations : [])
    .map((reservation) => canonicalReservationToAdminOrderViewModel(reservation, options))
    .sort((left, right) => (
      left.schedule.matchedStartsAt.localeCompare(right.schedule.matchedStartsAt)
      || left.reservationId.localeCompare(right.reservationId)
    ))
  const ids = new Set()
  for (const row of rows) {
    if (ids.has(row.reservationId)) throw orderContractError('reservation_order_duplicate')
    ids.add(row.reservationId)
  }
  return rows
}

const executeSearchRpc = async ({ client, filters, cursor, limit, signal }) => {
  let request = client.rpc('admin_search_reservations', {
    p_start_date: requireDateKey(filters?.start, 'reservation_order_start_date_invalid'),
    p_end_date: requireDateKey(filters?.end, 'reservation_order_end_date_invalid'),
    p_query: String(filters?.query || '').trim(),
    p_reservation_status: String(filters?.status || 'not_cancelled'),
    p_payment_status: String(filters?.paymentStatus || 'all'),
    p_limit: Math.min(Math.max(Number(limit) || 50, 1), 50),
    p_after_sort_at: cursor?.sort_at || null,
    p_after_reservation_id: cursor?.reservation_id || null,
  })
  if (signal && typeof request?.abortSignal === 'function') request = request.abortSignal(signal)
  const response = await request
  if (response?.error) throw response.error
  return normalizeCanonicalReservationSearch(response?.data)
}

export const fetchCanonicalAdminReservationOrders = async ({
  client,
  filters,
  cursor = null,
  limit = 50,
  timeZone = DEFAULT_VENUE_TIMEZONE,
  signal,
}) => {
  if ((cursor?.sort_at && !cursor?.reservation_id) || (!cursor?.sort_at && cursor?.reservation_id)) {
    throw orderContractError('reservation_order_cursor_invalid')
  }
  const result = await executeSearchRpc({ client, filters, cursor, limit, signal })
  const items = canonicalReservationsToAdminOrderViewModels(result.items, { timeZone })
  if (result.summary.results < items.length) {
    throw orderContractError('reservation_order_summary_count_invalid')
  }
  if (result.hasMore) {
    const nextSortAt = requireText(
      result.nextCursor?.sortAt,
      'reservation_order_next_cursor_missing',
    )
    const nextReservationId = requireText(
      result.nextCursor?.reservationId,
      'reservation_order_next_cursor_missing',
    )
    const last = items.at(-1)
    if (!last
      || last.reservationId !== nextReservationId
      || last.schedule.matchedStartsAt !== venueLocalDateTime(nextSortAt, timeZone)) {
      throw orderContractError('reservation_order_next_cursor_mismatch')
    }
  } else if (result.nextCursor) {
    throw orderContractError('reservation_order_unexpected_cursor')
  }

  return {
    order_view_model_version: ADMIN_RESERVATION_ORDER_VIEW_MODEL_VERSION,
    order_read_source: RESERVATION_ORDER_READ_SOURCE_CANONICAL,
    generatedAt: result.generatedAt,
    items,
    summary: {
      results: result.summary.results,
      totalMinutes: result.summary.totalMinutes,
      customers: result.summary.primaryContacts,
      today: result.summary.today,
    },
    hasMore: result.hasMore,
    nextCursor: result.nextCursor ? {
      sort_at: result.nextCursor.sortAt,
      reservation_id: result.nextCursor.reservationId,
    } : null,
  }
}

export const reservationOrderSafeErrorCode = (error) => {
  const code = String(error?.code || '')
  return code.startsWith('reservation_order_') ? code : 'reservation_order_read_failed'
}
