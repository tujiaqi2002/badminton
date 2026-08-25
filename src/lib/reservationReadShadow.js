import {
  addDateKeyDays,
  DEFAULT_VENUE_TIMEZONE,
  normalizeCanonicalAllocationResponse,
  normalizeCanonicalShadowStatus,
  normalizeLegacyAllocationRows,
  venueDateStartIso,
} from './reservationReadModel.js'

const SHADOW_EVENT = 'reservation_read_shadow_v1'
const MAX_PAGES = 100

export const isReservationReadShadowEnabled = (value) => value === 'true'

const safeCode = (value, fallback = 'reservation_read_shadow_failed') => {
  const candidate = String(value || '').trim()
  if (/^[0-9A-Z]{5}$/.test(candidate) || /^PGRST\d+$/.test(candidate)) return candidate.toLowerCase()
  if (/^reservation_read_[a-z0-9_-]{1,63}$/.test(candidate)) return candidate
  return fallback
}

const mismatch = (rows, code, allocationId) => rows.push({ code, allocationId })

export const compareAllocationReadModels = (legacyModel, canonicalModel) => {
  const legacyItems = legacyModel?.items || []
  const canonicalItems = canonicalModel?.items || []
  const legacyById = new Map(legacyItems.map((item) => [item.allocationId, item]))
  const canonicalById = new Map(canonicalItems.map((item) => [item.allocationId, item]))
  const mismatches = []

  const addDuplicateMismatches = (items, code) => {
    const seen = new Set()
    for (const item of items) {
      if (seen.has(item.allocationId)) mismatch(mismatches, code, item.allocationId)
      seen.add(item.allocationId)
    }
  }
  addDuplicateMismatches(legacyItems, 'allocation_duplicate_in_legacy')
  addDuplicateMismatches(canonicalItems, 'allocation_duplicate_in_canonical')

  for (const [allocationId, legacy] of legacyById) {
    const canonical = canonicalById.get(allocationId)
    if (!canonical) {
      mismatch(mismatches, 'allocation_missing_in_canonical', allocationId)
      continue
    }
    if (legacy.courtId !== canonical.courtId) mismatch(mismatches, 'allocation_court_mismatch', allocationId)
    if (legacy.startsAt !== canonical.startsAt) mismatch(mismatches, 'allocation_start_mismatch', allocationId)
    if (legacy.endsAt !== canonical.endsAt) mismatch(mismatches, 'allocation_end_mismatch', allocationId)
    if (legacy.allocationStatus !== canonical.allocationStatus) mismatch(mismatches, 'allocation_status_mismatch', allocationId)
    if (legacy.allocationAmount !== canonical.allocationAmount) mismatch(mismatches, 'allocation_amount_mismatch', allocationId)
    if (legacy.currency !== canonical.currency) mismatch(mismatches, 'allocation_currency_mismatch', allocationId)
    if (legacy.originReservationId !== canonical.originReservationId) mismatch(mismatches, 'allocation_origin_reservation_mismatch', allocationId)
    if (legacy.projectionSessionId !== canonical.projectionSessionId) mismatch(mismatches, 'allocation_projection_session_mismatch', allocationId)
    if (legacy.legacySourceGroupId !== canonical.legacySourceGroupId) mismatch(mismatches, 'allocation_legacy_group_mismatch', allocationId)
    if (legacy.legacySourceLinkId !== canonical.legacySourceLinkId) mismatch(mismatches, 'allocation_legacy_link_mismatch', allocationId)
  }

  for (const allocationId of canonicalById.keys()) {
    if (!legacyById.has(allocationId)) mismatch(mismatches, 'allocation_missing_in_legacy', allocationId)
  }

  const mismatchCounts = mismatches.reduce((counts, item) => ({
    ...counts,
    [item.code]: (counts[item.code] || 0) + 1,
  }), {})

  return {
    status: mismatches.length === 0 ? 'clean' : 'mismatch',
    legacyAllocationCount: legacyItems.length,
    canonicalAllocationCount: canonicalItems.length,
    comparedAllocationCount: [...legacyById.keys()].filter((id) => canonicalById.has(id)).length,
    mismatchCount: mismatches.length,
    mismatchCounts,
    mismatches,
  }
}

const executeRpc = async (client, name, parameters, signal) => {
  let request = client.rpc(name, parameters)
  if (signal && typeof request?.abortSignal === 'function') request = request.abortSignal(signal)
  const response = await request
  if (response?.error) throw response.error
  return response?.data
}

export const fetchCanonicalAllocationWindow = async ({
  client,
  startDate,
  endDate,
  timeZone = DEFAULT_VENUE_TIMEZONE,
  signal,
  pageSize = 1000,
}) => {
  const startAt = venueDateStartIso(startDate, timeZone)
  const endAt = venueDateStartIso(addDateKeyDays(endDate, 1), timeZone)
  if ((new Date(endAt) - new Date(startAt)) > 31 * 24 * 60 * 60 * 1000) {
    throw Object.assign(new Error('reservation_read_shadow_window_too_large'), { code: 'reservation_read_shadow_window_too_large' })
  }

  const items = []
  let cursor = null
  let generatedAt = null
  const seenCursors = new Set()

  for (let page = 0; page < MAX_PAGES; page += 1) {
    const payload = await executeRpc(client, 'admin_list_reservation_allocations', {
      p_start_at: startAt,
      p_end_at: endAt,
      p_limit: pageSize,
      p_after_starts_at: cursor?.startsAt || null,
      p_after_allocation_id: cursor?.allocationId || null,
    }, signal)
    const normalized = normalizeCanonicalAllocationResponse(payload, { timeZone })
    generatedAt ||= normalized.generatedAt
    items.push(...normalized.items)
    if (!normalized.hasMore) {
      return { ...normalized, generatedAt, items, hasMore: false, nextCursor: null }
    }
    if (!normalized.nextCursor?.startsAt || !normalized.nextCursor?.allocationId) {
      throw Object.assign(new Error('reservation_read_shadow_cursor_missing'), { code: 'reservation_read_shadow_cursor_missing' })
    }
    const cursorKey = `${normalized.nextCursor.startsAt}|${normalized.nextCursor.allocationId}`
    if (seenCursors.has(cursorKey)) {
      throw Object.assign(new Error('reservation_read_shadow_cursor_repeated'), { code: 'reservation_read_shadow_cursor_repeated' })
    }
    seenCursors.add(cursorKey)
    cursor = normalized.nextCursor
  }

  throw Object.assign(new Error('reservation_read_shadow_page_limit'), { code: 'reservation_read_shadow_page_limit' })
}

export const createShadowLogEvent = ({ comparison, serverStatus }) => ({
  event: SHADOW_EVENT,
  schema_version: 1,
  status: comparison.status === 'clean' && serverStatus.status === 'clean' ? 'clean' : 'mismatch',
  legacy_allocation_count: comparison.legacyAllocationCount,
  canonical_allocation_count: comparison.canonicalAllocationCount,
  compared_allocation_count: comparison.comparedAllocationCount,
  client_mismatch_count: comparison.mismatchCount,
  client_mismatch_counts: comparison.mismatchCounts,
  server_status: serverStatus.status,
  server_mismatch_count: serverStatus.mismatchCount,
  server_mismatch_counts: serverStatus.mismatchCounts,
  server_totals: serverStatus.totals,
})

export const runReservationScheduleShadow = async ({
  client,
  legacyRows,
  startDate,
  endDate,
  timeZone = DEFAULT_VENUE_TIMEZONE,
  signal,
  logger = console,
}) => {
  try {
    const [canonicalModel, serverPayload] = await Promise.all([
      fetchCanonicalAllocationWindow({ client, startDate, endDate, timeZone, signal }),
      executeRpc(client, 'admin_get_reservation_read_shadow_status', { p_sample_limit: 0 }, signal),
    ])
    const legacyModel = normalizeLegacyAllocationRows(legacyRows, { timeZone })
    const comparableStart = `${startDate}T00:00:00`
    const comparableEnd = `${addDateKeyDays(endDate, 1)}T00:00:00`
    const comparableCanonicalModel = {
      ...canonicalModel,
      items: canonicalModel.items.filter((item) => (
        item.startsAt >= comparableStart && item.startsAt < comparableEnd
      )),
    }
    const comparison = compareAllocationReadModels(legacyModel, comparableCanonicalModel)
    const serverStatus = normalizeCanonicalShadowStatus(serverPayload)
    const event = createShadowLogEvent({ comparison, serverStatus })
    const method = event.status === 'clean' ? 'info' : 'warn'
    logger?.[method]?.(SHADOW_EVENT, event)
    return event
  } catch (error) {
    if (signal?.aborted || error?.name === 'AbortError') {
      return { event: SHADOW_EVENT, schema_version: 1, status: 'aborted' }
    }
    const event = {
      event: SHADOW_EVENT,
      schema_version: 1,
      status: 'error',
      error_code: safeCode(error?.code),
    }
    logger?.warn?.(SHADOW_EVENT, event)
    return event
  }
}
