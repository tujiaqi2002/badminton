import {
  DEFAULT_VENUE_TIMEZONE,
  normalizeCanonicalReservationDetail,
  venueLocalDateTime,
} from './reservationReadModel.js'

export const RESERVATION_SELECTED_DETAIL_READ_SOURCE_LEGACY = 'legacy'
export const RESERVATION_SELECTED_DETAIL_READ_SOURCE_CANONICAL = 'canonical'
export const ADMIN_RESERVATION_INSPECTOR_VIEW_MODEL_VERSION = 1

const detailContractError = (code) => Object.assign(new Error(code), { code })

const requireText = (value, code) => {
  const text = String(value || '').trim()
  if (!text) throw detailContractError(code)
  return text
}

const cents = (value, code) => {
  const number = Number(value)
  if (!Number.isFinite(number)) throw detailContractError(code)
  return Math.round(number * 100)
}

const nullableText = (value) => {
  const text = String(value || '').trim()
  return text || null
}

const assertEqual = (actual, expected, code) => {
  if (actual !== expected) throw detailContractError(code)
}

const assertOneOf = (value, allowed, code) => {
  if (!allowed.includes(value)) throw detailContractError(code)
  return value
}

const normalizedSession = (session, timeZone) => ({
  ...session,
  startsAt: venueLocalDateTime(session.startsAt, timeZone),
  endsAt: venueLocalDateTime(session.endsAt, timeZone),
})

export const normalizeReservationSelectedDetailReadSource = (value) => (
  value === RESERVATION_SELECTED_DETAIL_READ_SOURCE_CANONICAL
    ? RESERVATION_SELECTED_DETAIL_READ_SOURCE_CANONICAL
    : RESERVATION_SELECTED_DETAIL_READ_SOURCE_LEGACY
)

export const canonicalReservationDetailToAdminInspectorViewModel = (
  detail,
  selectedAllocation,
  options = {},
) => {
  const timeZone = options.timeZone || DEFAULT_VENUE_TIMEZONE
  const allocationId = requireText(
    selectedAllocation?.id,
    'reservation_selected_detail_allocation_id_missing',
  )
  const reservationId = requireText(
    selectedAllocation?.effective_reservation_id,
    'reservation_selected_detail_reservation_id_missing',
  )
  const sessionId = requireText(
    selectedAllocation?.effective_session_id,
    'reservation_selected_detail_session_id_missing',
  )
  const courtId = requireText(
    selectedAllocation?.court_id,
    'reservation_selected_detail_court_id_missing',
  )
  const selectedStartsAt = requireText(
    selectedAllocation?.start_at,
    'reservation_selected_detail_start_missing',
  )
  const selectedEndsAt = requireText(
    selectedAllocation?.end_at,
    'reservation_selected_detail_end_missing',
  )
  if (selectedEndsAt <= selectedStartsAt) {
    throw detailContractError('reservation_selected_detail_range_invalid')
  }

  const detailReservationId = requireText(
    detail?.reservation?.reservationId,
    'reservation_selected_detail_payload_reservation_missing',
  )
  assertEqual(
    detailReservationId,
    reservationId,
    'reservation_selected_detail_reservation_mismatch',
  )
  const reservationCurrency = requireText(
    detail?.reservation?.currency,
    'reservation_selected_detail_reservation_currency_missing',
  )
  const paymentPlan = assertOneOf(
    requireText(
      detail?.reservation?.paymentPlan,
      'reservation_selected_detail_payment_plan_missing',
    ),
    ['single_payer', 'split_equal', 'split_custom', 'legacy_unspecified'],
    'reservation_selected_detail_payment_plan_invalid',
  )
  const paymentStatus = assertOneOf(
    requireText(
      detail?.reservation?.money?.paymentStatus,
      'reservation_selected_detail_payment_status_missing',
    ),
    ['unpaid', 'partial', 'paid', 'refunded', 'no_charge', 'inconsistent'],
    'reservation_selected_detail_payment_status_invalid',
  )

  const sessions = (Array.isArray(detail?.sessions) ? detail.sessions : [])
    .map((session) => normalizedSession(session, timeZone))
  const matchingSessions = sessions.filter((session) => session.sessionId === sessionId)
  if (matchingSessions.length !== 1) {
    throw detailContractError('reservation_selected_detail_session_match_invalid')
  }

  const allocationMatches = sessions.flatMap((session) => (
    (Array.isArray(session.allocations) ? session.allocations : [])
      .filter((allocation) => allocation.allocationId === allocationId)
      .map((allocation) => ({ allocation, session }))
  ))
  if (allocationMatches.length !== 1) {
    throw detailContractError('reservation_selected_detail_allocation_match_invalid')
  }

  const selectedMatch = allocationMatches[0]
  assertEqual(
    selectedMatch.session.sessionId,
    sessionId,
    'reservation_selected_detail_allocation_session_mismatch',
  )
  assertEqual(
    requireText(selectedMatch.allocation.courtId, 'reservation_selected_detail_payload_court_missing'),
    courtId,
    'reservation_selected_detail_court_mismatch',
  )
  assertEqual(
    selectedMatch.session.startsAt,
    selectedStartsAt,
    'reservation_selected_detail_start_mismatch',
  )
  assertEqual(
    selectedMatch.session.endsAt,
    selectedEndsAt,
    'reservation_selected_detail_end_mismatch',
  )
  assertEqual(
    requireText(selectedMatch.allocation.status, 'reservation_selected_detail_payload_status_missing'),
    requireText(selectedAllocation?.status, 'reservation_selected_detail_status_missing'),
    'reservation_selected_detail_status_mismatch',
  )
  assertEqual(
    cents(selectedMatch.allocation.amount, 'reservation_selected_detail_payload_amount_invalid'),
    cents(selectedAllocation?.total_amount, 'reservation_selected_detail_amount_invalid'),
    'reservation_selected_detail_amount_mismatch',
  )
  const selectedCurrency = requireText(
    selectedAllocation?.currency,
    'reservation_selected_detail_currency_missing',
  )
  assertEqual(
    requireText(selectedMatch.allocation.currency, 'reservation_selected_detail_payload_currency_missing'),
    selectedCurrency,
    'reservation_selected_detail_currency_mismatch',
  )
  assertEqual(
    reservationCurrency,
    selectedCurrency,
    'reservation_selected_detail_reservation_currency_mismatch',
  )

  if (selectedAllocation.membership_version != null && selectedMatch.allocation.membershipVersion != null) {
    assertEqual(
      Number(selectedMatch.allocation.membershipVersion),
      Number(selectedAllocation.membership_version),
      'reservation_selected_detail_membership_version_mismatch',
    )
  }
  if (selectedAllocation.last_transition_id != null || selectedMatch.allocation.lastTransitionId != null) {
    assertEqual(
      selectedMatch.allocation.lastTransitionId,
      selectedAllocation.last_transition_id,
      'reservation_selected_detail_transition_mismatch',
    )
  }

  const allocationCount = sessions.reduce(
    (count, session) => count + (Array.isArray(session.allocations) ? session.allocations.length : 0),
    0,
  )
  assertEqual(
    Number(detail.reservation.schedule.sessionCount),
    sessions.length,
    'reservation_selected_detail_session_count_mismatch',
  )
  assertEqual(
    Number(detail.reservation.schedule.allocationCount),
    allocationCount,
    'reservation_selected_detail_allocation_count_mismatch',
  )
  if (selectedAllocation.session_allocation_count != null) {
    assertEqual(
      Number(selectedAllocation.session_allocation_count),
      selectedMatch.session.allocations.length,
      'reservation_selected_detail_selected_session_count_mismatch',
    )
  }

  const parties = Array.isArray(detail?.parties) ? detail.parties : []
  const primaryRoleParties = parties.filter((party) => party.roles.includes('primary_contact'))
  if (primaryRoleParties.length !== 1) {
    throw detailContractError('reservation_selected_detail_primary_party_invalid')
  }
  const primaryParty = primaryRoleParties[0]
  if (detail.reservation.primaryContact.partyId != null) {
    assertEqual(
      primaryParty.partyId,
      detail.reservation.primaryContact.partyId,
      'reservation_selected_detail_primary_party_mismatch',
    )
  }
  const primaryName = requireText(
    primaryParty.displayName || detail.reservation.primaryContact.name,
    'reservation_selected_detail_primary_contact_missing',
  )

  const allocationIds = new Set(sessions.flatMap((session) => (
    session.allocations.map((allocation) => allocation.allocationId)
  )))
  for (const share of detail.paymentShares) {
    if (!parties.some((party) => party.partyId === share.partyId)) {
      throw detailContractError('reservation_selected_detail_payment_share_party_missing')
    }
  }
  for (const entry of detail.paymentAllocationEntries) {
    if (!allocationIds.has(entry.allocationId)) {
      throw detailContractError('reservation_selected_detail_payment_entry_allocation_missing')
    }
  }

  const primaryContact = {
    partyId: primaryParty.partyId,
    partyType: primaryParty.partyType,
    name: primaryName,
    email: nullableText(primaryParty.email || detail.reservation.primaryContact.email),
    phone: nullableText(primaryParty.phone || detail.reservation.primaryContact.phone),
    source: primaryParty.source,
    roles: [...primaryParty.roles],
  }
  const mappedParties = parties.map((party) => ({
    partyId: party.partyId,
    partyType: party.partyType,
    name: nullableText(party.displayName),
    email: nullableText(party.email),
    phone: nullableText(party.phone),
    source: party.source,
    roles: [...party.roles],
    isPrimaryContact: party.partyId === primaryParty.partyId,
  }))
  const mappedSessions = sessions.map((session) => ({
    sessionId: session.sessionId,
    startsAt: session.startsAt,
    endsAt: session.endsAt,
    partySize: session.partySize,
    notes: nullableText(session.notes),
    source: session.source,
    allocations: session.allocations.map((allocation) => ({ ...allocation })),
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
  }))
  const selectedSession = mappedSessions.find((session) => session.sessionId === sessionId)

  return {
    inspector_view_model_version: ADMIN_RESERVATION_INSPECTOR_VIEW_MODEL_VERSION,
    detail_read_source: RESERVATION_SELECTED_DETAIL_READ_SOURCE_CANONICAL,
    generatedAt: detail.generatedAt,
    selection: {
      allocationId,
      reservationId,
      sessionId,
      courtId,
      startsAt: selectedStartsAt,
      endsAt: selectedEndsAt,
    },
    reservation: {
      reservationId,
      referenceNumber: detail.reservation.referenceNumber,
      reference: detail.reservation.reference,
      status: detail.reservation.status,
      source: detail.reservation.source,
      notes: nullableText(detail.reservation.notes),
      createdAt: detail.reservation.createdAt,
      updatedAt: detail.reservation.updatedAt,
      sessionCount: sessions.length,
      allocationCount,
    },
    primaryContact,
    parties: mappedParties,
    otherParties: mappedParties.filter((party) => !party.isPrimaryContact),
    sessions: mappedSessions,
    selectedSession,
    payment: {
      plan: paymentPlan,
      status: paymentStatus,
      currency: reservationCurrency,
      totalAmount: detail.reservation.money.totalAmount,
      paidAmount: detail.reservation.money.paidAmount,
      refundedAmount: detail.reservation.money.refundedAmount,
      netPaidAmount: detail.reservation.money.netPaidAmount,
      outstandingAmount: detail.reservation.money.outstandingAmount,
      succeededPaymentCount: detail.reservation.money.succeededPaymentCount,
      shares: detail.paymentShares.map((share) => ({ ...share })),
      payments: detail.payments.map((payment) => ({ ...payment })),
      allocationEntries: detail.paymentAllocationEntries.map((entry) => ({ ...entry })),
    },
    lineage: {
      ...detail.reservation.lineage,
      sources: detail.sourceLineage.map((source) => ({ ...source })),
      transitions: detail.transitions.map((transition) => ({ ...transition })),
      sessionAssignments: { ...detail.sessionAssignmentSummary },
    },
  }
}

const executeDetailRpc = async (client, reservationId, signal) => {
  let request = client.rpc('admin_get_reservation_detail', {
    p_reservation_id: reservationId,
  })
  if (signal && typeof request?.abortSignal === 'function') request = request.abortSignal(signal)
  const response = await request
  if (response?.error) throw response.error
  return normalizeCanonicalReservationDetail(response?.data)
}

export const fetchCanonicalAdminReservationDetail = async ({
  client,
  reservationId,
  signal,
}) => executeDetailRpc(
  client,
  requireText(reservationId, 'reservation_selected_detail_reservation_id_missing'),
  signal,
)

const abortedDetailError = () => Object.assign(
  new Error('reservation_selected_detail_aborted'),
  { name: 'AbortError', code: 'reservation_selected_detail_aborted' },
)

export const createAdminReservationDetailLoader = ({ client }) => {
  const cache = new Map()
  const inFlight = new Map()
  const versions = new Map()
  let activeReservationId = null
  let activeController = null
  let disposed = false

  const versionFor = (reservationId) => versions.get(reservationId) || 0
  const abortEntry = (entry) => entry?.controller?.abort()

  const startRequest = (reservationId) => {
    const controller = new AbortController()
    const version = versionFor(reservationId)
    const entry = { controller, version, promise: null }
    entry.promise = fetchCanonicalAdminReservationDetail({
      client,
      reservationId,
      signal: controller.signal,
    }).then((detail) => {
      if (controller.signal.aborted) throw abortedDetailError()
      if (versionFor(reservationId) === version) cache.set(reservationId, detail)
      return detail
    }).finally(() => {
      if (inFlight.get(reservationId) === entry) inFlight.delete(reservationId)
    })
    inFlight.set(reservationId, entry)
    return entry
  }

  const load = async (selectedAllocation, options = {}) => {
    if (disposed) throw detailContractError('reservation_selected_detail_loader_disposed')
    const reservationId = requireText(
      selectedAllocation?.effective_reservation_id,
      'reservation_selected_detail_reservation_id_missing',
    )

    if (activeReservationId && activeReservationId !== reservationId) {
      abortEntry(activeController && { controller: activeController })
    }
    activeReservationId = reservationId

    let detail = cache.get(reservationId)
    if (!detail) {
      let entry = inFlight.get(reservationId)
      if (!entry || entry.controller.signal.aborted) entry = startRequest(reservationId)
      activeController = entry.controller
      detail = await entry.promise
    }

    if (activeReservationId !== reservationId) throw abortedDetailError()
    return canonicalReservationDetailToAdminInspectorViewModel(
      detail,
      selectedAllocation,
      options,
    )
  }

  const invalidate = (reservationId = null) => {
    if (reservationId) {
      versions.set(reservationId, versionFor(reservationId) + 1)
      cache.delete(reservationId)
      abortEntry(inFlight.get(reservationId))
      if (activeReservationId === reservationId) {
        activeReservationId = null
        activeController = null
      }
      return
    }
    for (const [id, entry] of inFlight) {
      versions.set(id, versionFor(id) + 1)
      abortEntry(entry)
    }
    cache.clear()
    activeReservationId = null
    activeController = null
  }

  const dispose = () => {
    invalidate()
    disposed = true
  }

  return { load, invalidate, dispose }
}

export const selectedDetailSafeErrorCode = (error) => {
  const candidate = String(error?.code || '').trim()
  if (/^reservation_selected_detail_[a-z0-9_]{1,80}$/.test(candidate)) return candidate
  if (/^(?:PGRST\d+|[0-9A-Z]{5})$/.test(candidate)) return candidate.toLowerCase()
  if (error?.name === 'AbortError') return 'reservation_selected_detail_aborted'
  return 'reservation_selected_detail_read_failed'
}
