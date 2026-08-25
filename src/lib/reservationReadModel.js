export const RESERVATION_READ_SCHEMA_VERSION = 1
export const DEFAULT_VENUE_TIMEZONE = 'America/Toronto'

const SERVER_SHADOW_MISMATCH_CODES = new Set([
  'allocation_unowned',
  'allocation_read_row_count_mismatch',
  'allocation_projection_mismatch',
  'reservation_summary_missing',
  'reservation_summary_projection_mismatch',
])

const asObject = (value) => (value && typeof value === 'object' && !Array.isArray(value) ? value : {})
const asArray = (value) => (Array.isArray(value) ? value : [])
const nullable = (value) => (value === undefined ? null : value)
const amount = (value) => {
  if (value == null || value === '') return 0
  const parsed = Number(value ?? 0)
  if (!Number.isFinite(parsed)) throw contractError('reservation_read_invalid_amount')
  return Number(parsed.toFixed(2))
}

const contractError = (code) => Object.assign(new Error(code), { code })

const requireSchemaVersion = (payload) => {
  const schemaVersion = Number(asObject(payload).schema_version)
  if (schemaVersion !== RESERVATION_READ_SCHEMA_VERSION) {
    throw contractError('reservation_read_schema_version_unsupported')
  }
  return schemaVersion
}

const formatterFor = (timeZone) => new Intl.DateTimeFormat('en-CA', {
  timeZone,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
})

const dateTimeParts = (date, timeZone) => Object.fromEntries(
  formatterFor(timeZone)
    .formatToParts(date)
    .filter((part) => part.type !== 'literal')
    .map((part) => [part.type, part.value]),
)

const localDateTimeFromParts = (parts) => (
  `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}`
)

export const venueLocalDateTime = (value, timeZone = DEFAULT_VENUE_TIMEZONE) => {
  if (!value) return null
  const text = String(value)
  if (!/(?:Z|[+-]\d{2}:?\d{2})$/i.test(text)) return text.slice(0, 19)
  const instant = new Date(text)
  if (Number.isNaN(instant.getTime())) throw contractError('reservation_read_invalid_datetime')
  return localDateTimeFromParts(dateTimeParts(instant, timeZone))
}

export const venueDateStartIso = (dateKey, timeZone = DEFAULT_VENUE_TIMEZONE) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey || '')) {
    throw contractError('reservation_read_invalid_date')
  }
  const [year, month, day] = dateKey.split('-').map(Number)
  const desired = Date.UTC(year, month - 1, day, 0, 0, 0)
  let candidate = desired

  for (let attempt = 0; attempt < 4; attempt += 1) {
    const parts = dateTimeParts(new Date(candidate), timeZone)
    const represented = Date.UTC(
      Number(parts.year),
      Number(parts.month) - 1,
      Number(parts.day),
      Number(parts.hour),
      Number(parts.minute),
      Number(parts.second),
    )
    candidate += desired - represented
  }

  const result = new Date(candidate)
  if (venueLocalDateTime(result.toISOString(), timeZone) !== `${dateKey}T00:00:00`) {
    throw contractError('reservation_read_unresolvable_date')
  }
  return result.toISOString()
}

export const addDateKeyDays = (dateKey, days) => {
  const [year, month, day] = dateKey.split('-').map(Number)
  const date = new Date(Date.UTC(year, month - 1, day + days, 12, 0, 0))
  return date.toISOString().slice(0, 10)
}

const normalizeContact = ({ id, name, email, phone }) => ({
  partyId: nullable(id),
  name: nullable(name),
  email: nullable(email),
  phone: nullable(phone),
})

export const normalizeLegacyAllocation = (row, options = {}) => {
  const source = asObject(row)
  const timeZone = options.timeZone || DEFAULT_VENUE_TIMEZONE
  return {
    dtoVersion: RESERVATION_READ_SCHEMA_VERSION,
    source: 'legacy',
    allocationId: nullable(source.id),
    originReservationId: nullable(source.reservation_id),
    originSessionId: nullable(source.session_id),
    projectionReservationId: nullable(source.reservation_id),
    projectionSessionId: nullable(source.session_id),
    effectiveReservationId: null,
    effectiveSessionId: null,
    membershipVersion: null,
    lastTransitionId: null,
    courtId: nullable(source.court_id),
    courtNameZh: null,
    courtNameEn: null,
    courtSortOrder: null,
    startsAt: venueLocalDateTime(source.start_at, timeZone),
    endsAt: venueLocalDateTime(source.end_at, timeZone),
    partySize: nullable(source.party_size),
    allocationStatus: nullable(source.status),
    allocationAmount: amount(source.total_amount),
    currency: nullable(source.currency),
    systemCalculatedAmount: amount(source.system_calculated_amount),
    priceSource: nullable(source.price_source),
    priceOverrideAmount: source.price_override_amount == null ? null : amount(source.price_override_amount),
    hasNotes: Boolean(String(source.customer_notes || '').trim()),
    legacySourceGroupId: nullable(source.booking_group_id),
    legacySourceLinkId: nullable(source.booking_link_id),
    sessionAllocationCount: null,
    reservation: {
      reference: null,
      status: null,
      paymentStatus: nullable(source.payment_status),
      paymentPlan: null,
      totalAmount: amount(source.total_amount),
      paidAmount: source.payment_status === 'paid' ? amount(source.total_amount) : 0,
      refundedAmount: source.payment_status === 'refunded' ? amount(source.total_amount) : 0,
      netPaidAmount: source.payment_status === 'paid' ? amount(source.total_amount) : 0,
      outstandingAmount: source.payment_status === 'paid' ? 0 : amount(source.total_amount),
      sessionCount: null,
      allocationCount: null,
      recurrenceSeriesId: nullable(source.recurrence_series_id),
      recurrenceSequence: nullable(source.recurrence_week),
      transitionCount: null,
      sourceLineageCount: null,
    },
    primaryContact: normalizeContact({
      name: source.customer_name,
      email: source.customer_email,
      phone: source.customer_phone,
    }),
    createdAt: nullable(source.created_at),
    updatedAt: nullable(source.updated_at),
  }
}

export const normalizeCanonicalAllocation = (row, options = {}) => {
  const source = asObject(row)
  const timeZone = options.timeZone || DEFAULT_VENUE_TIMEZONE
  return {
    dtoVersion: RESERVATION_READ_SCHEMA_VERSION,
    source: 'canonical',
    allocationId: nullable(source.allocation_id),
    originReservationId: nullable(source.origin_reservation_id),
    originSessionId: nullable(source.origin_session_id),
    projectionReservationId: nullable(source.projection_reservation_id),
    projectionSessionId: nullable(source.projection_session_id),
    effectiveReservationId: nullable(source.effective_reservation_id),
    effectiveSessionId: nullable(source.effective_session_id),
    membershipVersion: nullable(source.membership_version),
    lastTransitionId: nullable(source.last_transition_id),
    courtId: nullable(source.court_id),
    courtNameZh: nullable(source.court_name_zh),
    courtNameEn: nullable(source.court_name_en),
    courtSortOrder: nullable(source.court_sort_order),
    startsAt: venueLocalDateTime(source.starts_at, timeZone),
    endsAt: venueLocalDateTime(source.ends_at, timeZone),
    partySize: nullable(source.party_size),
    allocationStatus: nullable(source.allocation_status),
    allocationAmount: amount(source.allocation_amount),
    currency: nullable(source.currency),
    systemCalculatedAmount: amount(source.system_calculated_amount),
    priceSource: nullable(source.price_source),
    priceOverrideAmount: source.price_override_amount == null ? null : amount(source.price_override_amount),
    hasNotes: Boolean(source.has_notes),
    legacySourceGroupId: nullable(source.legacy_source_group_id),
    legacySourceLinkId: nullable(source.legacy_source_link_id),
    sessionAllocationCount: nullable(source.session_allocation_count),
    reservation: {
      reference: nullable(source.reservation_reference),
      status: nullable(source.reservation_status),
      paymentStatus: nullable(source.payment_status),
      paymentPlan: nullable(source.payment_plan),
      totalAmount: amount(source.reservation_total_amount),
      paidAmount: amount(source.reservation_paid_amount),
      refundedAmount: amount(source.reservation_refunded_amount),
      netPaidAmount: amount(source.reservation_net_paid_amount),
      outstandingAmount: amount(source.reservation_outstanding_amount),
      sessionCount: nullable(source.reservation_session_count),
      allocationCount: nullable(source.reservation_allocation_count),
      recurrenceSeriesId: nullable(source.recurrence_series_id),
      recurrenceSequence: nullable(source.recurrence_sequence),
      transitionCount: nullable(source.transition_count),
      sourceLineageCount: nullable(source.source_lineage_count),
    },
    primaryContact: normalizeContact({
      id: source.primary_party_id,
      name: source.primary_contact_name,
      email: source.primary_contact_email,
      phone: source.primary_contact_phone,
    }),
    createdAt: nullable(source.allocation_created_at),
    updatedAt: nullable(source.allocation_updated_at),
  }
}

export const normalizeLegacyAllocationRows = (rows, options = {}) => ({
  dtoVersion: RESERVATION_READ_SCHEMA_VERSION,
  source: 'legacy',
  items: asArray(rows).map((row) => normalizeLegacyAllocation(row, options)),
  hasMore: false,
  nextCursor: null,
})

export const normalizeCanonicalAllocationResponse = (payload, options = {}) => {
  const source = asObject(payload)
  const schemaVersion = requireSchemaVersion(source)
  return {
    dtoVersion: RESERVATION_READ_SCHEMA_VERSION,
    contractSchemaVersion: schemaVersion,
    source: 'canonical',
    generatedAt: nullable(source.generated_at),
    limit: nullable(source.limit),
    items: asArray(source.items).map((row) => normalizeCanonicalAllocation(row, options)),
    hasMore: Boolean(source.has_more),
    nextCursor: source.next_cursor ? {
      startsAt: nullable(source.next_cursor.starts_at),
      allocationId: nullable(source.next_cursor.allocation_id),
    } : null,
  }
}

export const normalizeCanonicalReservationSummary = (row) => {
  const source = asObject(row)
  return {
    dtoVersion: RESERVATION_READ_SCHEMA_VERSION,
    reservationId: nullable(source.reservation_id),
    referenceNumber: nullable(source.reference_number),
    reference: nullable(source.reservation_reference),
    status: nullable(source.reservation_status),
    currency: nullable(source.currency),
    paymentPlan: nullable(source.payment_plan),
    source: nullable(source.source),
    createdAt: nullable(source.created_at),
    updatedAt: nullable(source.updated_at),
    schedule: {
      firstStartsAt: nullable(source.first_session_starts_at),
      lastEndsAt: nullable(source.last_session_ends_at),
      nextStartsAt: nullable(source.next_session_starts_at),
      matchedStartsAt: nullable(source.matched_start_at),
      sessionCount: Number(source.session_count || 0),
      allocationCount: Number(source.allocation_count || 0),
      allocationMinutes: Number(source.allocation_minutes || 0),
      matchedAllocationMinutes: Number(source.matched_allocation_minutes || 0),
      courtIds: asArray(source.court_ids),
      allocationStatusCounts: asObject(source.allocation_status_counts),
      hasNotes: Boolean(source.has_notes),
    },
    primaryContact: normalizeContact({
      id: source.primary_party_id,
      name: source.primary_contact_name,
      email: source.primary_contact_email,
      phone: source.primary_contact_phone,
    }),
    money: {
      totalAmount: amount(source.total_amount),
      paidAmount: amount(source.paid_amount),
      refundedAmount: amount(source.refunded_amount),
      netPaidAmount: amount(source.net_paid_amount),
      outstandingAmount: amount(source.outstanding_amount),
      paymentStatus: nullable(source.payment_status),
      succeededPaymentCount: Number(source.succeeded_payment_count || 0),
    },
    recurrence: {
      seriesId: nullable(source.recurrence_series_id),
      sequence: nullable(source.recurrence_sequence),
      timezone: nullable(source.recurrence_timezone),
      frequency: nullable(source.recurrence_frequency),
      intervalCount: nullable(source.recurrence_interval_count),
      dayOfWeek: nullable(source.recurrence_day_of_week),
      startsOn: nullable(source.recurrence_starts_on),
      endsOn: nullable(source.recurrence_ends_on),
      occurrenceCount: nullable(source.recurrence_occurrence_count),
    },
    lineage: {
      legacyGroupCount: Number(source.legacy_group_count || 0),
      legacyLinkCount: Number(source.legacy_link_count || 0),
      sourceLineageCount: Number(source.source_lineage_count || 0),
      transitionCount: Number(source.transition_count || 0),
      latestTransitionSequence: nullable(source.latest_transition_sequence),
    },
  }
}

export const normalizeCanonicalReservationSearch = (payload) => {
  const source = asObject(payload)
  const schemaVersion = requireSchemaVersion(source)
  const summary = asObject(source.summary)
  return {
    dtoVersion: RESERVATION_READ_SCHEMA_VERSION,
    contractSchemaVersion: schemaVersion,
    generatedAt: nullable(source.generated_at),
    items: asArray(source.items).map(normalizeCanonicalReservationSummary),
    summary: {
      results: Number(summary.results || 0),
      totalMinutes: Number(summary.total_minutes || 0),
      primaryContacts: Number(summary.primary_contacts || 0),
      today: Number(summary.today || 0),
    },
    hasMore: Boolean(source.has_more),
    nextCursor: source.next_cursor ? {
      sortAt: nullable(source.next_cursor.sort_at),
      reservationId: nullable(source.next_cursor.reservation_id),
    } : null,
  }
}

const normalizeParty = (row) => {
  const source = asObject(row)
  return {
    partyId: nullable(source.party_id),
    partyType: nullable(source.party_type),
    displayName: nullable(source.display_name),
    email: nullable(source.email),
    phone: nullable(source.phone),
    source: nullable(source.source),
    roles: asArray(source.roles),
    createdAt: nullable(source.created_at),
    updatedAt: nullable(source.updated_at),
  }
}

const normalizeDetailAllocation = (row) => {
  const source = asObject(row)
  return {
    allocationId: nullable(source.allocation_id),
    originReservationId: nullable(source.origin_reservation_id),
    originSessionId: nullable(source.origin_session_id),
    projectionReservationId: nullable(source.projection_reservation_id),
    projectionSessionId: nullable(source.projection_session_id),
    courtId: nullable(source.court_id),
    courtNameZh: nullable(source.court_name_zh),
    courtNameEn: nullable(source.court_name_en),
    courtSortOrder: nullable(source.court_sort_order),
    status: nullable(source.status),
    amount: amount(source.amount),
    currency: nullable(source.currency),
    systemCalculatedAmount: amount(source.system_calculated_amount),
    priceSource: nullable(source.price_source),
    priceOverrideAmount: source.price_override_amount == null ? null : amount(source.price_override_amount),
    legacySourceGroupId: nullable(source.legacy_source_group_id),
    legacySourceLinkId: nullable(source.legacy_source_link_id),
    membershipVersion: nullable(source.membership_version),
    lastTransitionId: nullable(source.last_transition_id),
    createdAt: nullable(source.created_at),
    updatedAt: nullable(source.updated_at),
  }
}

export const normalizeCanonicalReservationDetail = (payload) => {
  const source = asObject(payload)
  const schemaVersion = requireSchemaVersion(source)
  const assignment = asObject(source.session_assignment_summary)
  return {
    dtoVersion: RESERVATION_READ_SCHEMA_VERSION,
    contractSchemaVersion: schemaVersion,
    generatedAt: nullable(source.generated_at),
    reservation: {
      ...normalizeCanonicalReservationSummary(source.reservation),
      notes: nullable(asObject(source.reservation).notes),
    },
    parties: asArray(source.parties).map(normalizeParty),
    sessions: asArray(source.sessions).map((row) => {
      const session = asObject(row)
      return {
        sessionId: nullable(session.session_id),
        startsAt: nullable(session.starts_at),
        endsAt: nullable(session.ends_at),
        partySize: nullable(session.party_size),
        notes: nullable(session.notes),
        source: nullable(session.source),
        allocations: asArray(session.allocations).map(normalizeDetailAllocation),
        createdAt: nullable(session.created_at),
        updatedAt: nullable(session.updated_at),
      }
    }),
    paymentShares: asArray(source.payment_shares).map((row) => ({
      shareId: nullable(row.share_id),
      partyId: nullable(row.party_id),
      shareType: nullable(row.share_type),
      targetAmount: row.target_amount == null ? null : amount(row.target_amount),
      targetPercentage: row.target_percentage == null ? null : Number(row.target_percentage),
      createdAt: nullable(row.created_at),
      updatedAt: nullable(row.updated_at),
    })),
    payments: asArray(source.payments).map((row) => ({
      paymentId: nullable(row.payment_id),
      originalReservationId: nullable(row.original_reservation_id),
      payerPartyId: nullable(row.payer_party_id),
      kind: nullable(row.kind),
      amount: amount(row.amount),
      currency: nullable(row.currency),
      method: nullable(row.method),
      status: nullable(row.status),
      provider: nullable(row.provider),
      source: nullable(row.source),
      reversesPaymentId: nullable(row.reverses_payment_id),
      occurredAt: nullable(row.occurred_at),
      currentReservationAmount: amount(row.current_reservation_amount),
      createdAt: nullable(row.created_at),
      updatedAt: nullable(row.updated_at),
    })),
    paymentAllocationEntries: asArray(source.payment_allocation_entries).map((row) => ({
      entryId: nullable(row.entry_id),
      paymentId: nullable(row.payment_id),
      allocationId: nullable(row.allocation_id),
      originalPaymentReservationId: nullable(row.original_payment_reservation_id),
      entryKind: nullable(row.entry_kind),
      amount: amount(row.amount),
      reversesEntryId: nullable(row.reverses_entry_id),
      createdAt: nullable(row.created_at),
    })),
    sourceLineage: asArray(source.source_lineage).map((row) => ({
      sourceType: nullable(row.source_type),
      sourceId: nullable(row.source_id),
      createdAt: nullable(row.created_at),
    })),
    transitions: asArray(source.transitions).map((row) => ({
      transitionId: nullable(row.transition_id),
      sequence: nullable(row.sequence),
      type: nullable(row.type),
      reversesTransitionId: nullable(row.reverses_transition_id),
      createdAt: nullable(row.created_at),
    })),
    sessionAssignmentSummary: {
      assignmentCount: Number(assignment.assignment_count || 0),
      allocationCount: Number(assignment.allocation_count || 0),
      latestAssignmentAt: nullable(assignment.latest_assignment_at),
    },
  }
}

export const normalizeCanonicalShadowStatus = (payload) => {
  const source = asObject(payload)
  const schemaVersion = requireSchemaVersion(source)
  const totals = asObject(source.totals)
  return {
    dtoVersion: RESERVATION_READ_SCHEMA_VERSION,
    contractSchemaVersion: schemaVersion,
    contractVersion: Number(source.contract_version || 0),
    status: source.status === 'clean' ? 'clean' : 'mismatch',
    mismatchCount: Number(source.mismatch_count || 0),
    mismatchCounts: Object.entries(asObject(source.mismatch_counts)).reduce((counts, [code, count]) => {
      const safeCode = SERVER_SHADOW_MISMATCH_CODES.has(code)
        ? code
        : 'unrecognized_server_mismatch_code'
      return { ...counts, [safeCode]: (counts[safeCode] || 0) + Number(count || 0) }
    }, {}),
    totals: {
      allocations: Number(totals.allocations || 0),
      effectiveMemberships: Number(totals.effective_memberships || 0),
      effectiveReservations: Number(totals.effective_reservations || 0),
      effectiveSessions: Number(totals.effective_sessions || 0),
      summaryRows: Number(totals.summary_rows || 0),
      scheduleRows: Number(totals.schedule_rows || 0),
    },
  }
}
