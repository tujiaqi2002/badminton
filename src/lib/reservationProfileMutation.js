export const RESERVATION_PROFILE_WRITE_SOURCE_LEGACY = 'legacy'
export const RESERVATION_PROFILE_WRITE_SOURCE_CANONICAL = 'canonical'
export const RESERVATION_PROFILE_MUTATION_CONTRACT_VERSION = 1

export const RESERVATION_PROFILE_SCOPES = Object.freeze({
  RESERVATION: 'reservation',
  SESSION: 'session',
  PARTY: 'party',
})

export const RESERVATION_PROFILE_REASONS = Object.freeze([
  'manager_edit',
  'customer_request',
  'correction',
  'operational_update',
])

const scopeFields = Object.freeze({
  reservation: new Set(['notes']),
  session: new Set(['notes', 'party_size']),
  party: new Set(['display_name', 'email', 'phone']),
})

const knownErrorCodes = new Set([
  'reservation_profile_manager_required',
  'reservation_profile_invalid_scope',
  'reservation_profile_target_required',
  'reservation_profile_target_scope_mismatch',
  'reservation_profile_invalid_reason',
  'reservation_profile_invalid_idempotency_key',
  'reservation_profile_expected_version_required',
  'reservation_profile_invalid_patch',
  'reservation_profile_patch_scope_mismatch',
  'reservation_profile_invalid_notes',
  'reservation_profile_invalid_party_size',
  'reservation_profile_invalid_display_name',
  'reservation_profile_invalid_email',
  'reservation_profile_invalid_phone',
  'reservation_profile_target_not_found',
  'reservation_profile_stale_target',
  'reservation_profile_party_lineage_split',
])

const mutationError = (code) => Object.assign(new Error(code), { code })

const requireText = (value, code) => {
  const text = String(value || '').trim()
  if (!text) throw mutationError(code)
  return text
}

const requireTimestamp = (value, code) => {
  const text = requireText(value, code)
  if (!Number.isFinite(Date.parse(text))) throw mutationError(code)
  return text
}

const normalizedPatch = (scope, patch) => {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
    throw mutationError('reservation_profile_invalid_patch')
  }
  const allowed = scopeFields[scope]
  const entries = Object.entries(patch)
  if (!allowed || !entries.length || entries.some(([key]) => !allowed.has(key))) {
    throw mutationError('reservation_profile_patch_scope_mismatch')
  }

  const result = {}
  for (const [key, value] of entries) {
    if (key === 'party_size') {
      const count = Number(value)
      if (!Number.isInteger(count) || count < 1 || count > 8) {
        throw mutationError('reservation_profile_invalid_party_size')
      }
      result[key] = count
      continue
    }
    if (value != null && typeof value !== 'string') {
      throw mutationError(`reservation_profile_invalid_${key}`)
    }
    const text = value == null ? null : value.trim()
    result[key] = text || null
  }

  if ('display_name' in result && (!result.display_name || result.display_name.length > 200)) {
    throw mutationError('reservation_profile_invalid_display_name')
  }
  if (result.email && (result.email.indexOf('@') < 1 || result.email.length > 320)) {
    throw mutationError('reservation_profile_invalid_email')
  }
  if (result.phone && result.phone.length > 40) {
    throw mutationError('reservation_profile_invalid_phone')
  }
  if (result.notes && result.notes.length > (scope === 'reservation' ? 4000 : 2000)) {
    throw mutationError('reservation_profile_invalid_notes')
  }
  return result
}

const requestFingerprint = (command) => JSON.stringify({
  scope: command.scope,
  reservationId: command.reservationId,
  targetId: command.targetId,
  patch: command.patch,
  reason: command.reason,
  expectedUpdatedAt: command.expectedUpdatedAt,
})

export const normalizeReservationProfileWriteSource = (value) => (
  value === RESERVATION_PROFILE_WRITE_SOURCE_CANONICAL
    ? RESERVATION_PROFILE_WRITE_SOURCE_CANONICAL
    : RESERVATION_PROFILE_WRITE_SOURCE_LEGACY
)

export const resolveReservationProfileWriteSource = (profileSource, selectedDetailSource) => (
  normalizeReservationProfileWriteSource(profileSource) === RESERVATION_PROFILE_WRITE_SOURCE_CANONICAL
    && selectedDetailSource === RESERVATION_PROFILE_WRITE_SOURCE_CANONICAL
    ? RESERVATION_PROFILE_WRITE_SOURCE_CANONICAL
    : RESERVATION_PROFILE_WRITE_SOURCE_LEGACY
)

export const normalizeReservationProfileCommand = (input) => {
  const scope = requireText(input?.scope, 'reservation_profile_invalid_scope')
  if (!scopeFields[scope]) throw mutationError('reservation_profile_invalid_scope')
  const reservationId = requireText(input?.reservationId, 'reservation_profile_target_required')
  const targetId = requireText(input?.targetId, 'reservation_profile_target_required')
  if (scope === 'reservation' && targetId !== reservationId) {
    throw mutationError('reservation_profile_target_scope_mismatch')
  }
  const reason = requireText(input?.reason, 'reservation_profile_invalid_reason')
  if (!RESERVATION_PROFILE_REASONS.includes(reason)) {
    throw mutationError('reservation_profile_invalid_reason')
  }
  return {
    scope,
    reservationId,
    targetId,
    patch: normalizedPatch(scope, input.patch),
    reason,
    expectedUpdatedAt: requireTimestamp(
      input?.expectedUpdatedAt,
      'reservation_profile_expected_version_required',
    ),
  }
}

export const normalizeReservationProfileMutationResult = (payload, command) => {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw mutationError('reservation_profile_invalid_response')
  }
  if (Number(payload.schema_version) !== RESERVATION_PROFILE_MUTATION_CONTRACT_VERSION
    || payload.contract !== 'admin_reservation_profile_mutation'
    || payload.operation_type !== 'update_profile') {
    throw mutationError('reservation_profile_invalid_response')
  }
  if (payload.scope !== command.scope
    || payload.reservation_id !== command.reservationId
    || payload.target_id !== command.targetId
    || payload.reason !== command.reason) {
    throw mutationError('reservation_profile_response_identity_mismatch')
  }
  if (!['updated', 'unchanged'].includes(payload.status)) {
    throw mutationError('reservation_profile_invalid_response')
  }
  const changedFields = Array.isArray(payload.changed_fields) ? payload.changed_fields : null
  if (!changedFields
    || changedFields.some((field) => !scopeFields[command.scope].has(field))
    || (payload.status === 'unchanged' && changedFields.length)
    || (payload.status === 'updated' && !changedFields.length)) {
    throw mutationError('reservation_profile_invalid_response')
  }

  return {
    schemaVersion: RESERVATION_PROFILE_MUTATION_CONTRACT_VERSION,
    operationId: requireText(payload.operation_id, 'reservation_profile_invalid_response'),
    operationType: 'update_profile',
    scope: payload.scope,
    reservationId: payload.reservation_id,
    targetId: payload.target_id,
    status: payload.status,
    changedFields: [...changedFields],
    reason: payload.reason,
    auditEventType: requireText(payload.audit_event_type, 'reservation_profile_invalid_response'),
    targetUpdatedAt: requireTimestamp(payload.target_updated_at, 'reservation_profile_invalid_response'),
    completedAt: requireTimestamp(payload.completed_at, 'reservation_profile_invalid_response'),
  }
}

export const reservationProfileSafeErrorCode = (error) => {
  const direct = String(error?.code || '')
  if (knownErrorCodes.has(direct)) return direct
  const message = String(error?.message || '')
  if (message.includes('Manager access required')) return 'reservation_profile_manager_required'
  for (const code of knownErrorCodes) {
    if (message.includes(code)) return code
  }
  if (message.includes('idempotency key was reused')) return 'reservation_profile_idempotency_conflict'
  if (message.includes('Committed incomplete')) return 'reservation_profile_incomplete_operation'
  if (message.toLowerCase().includes('lock timeout') || error?.code === '55P03') {
    return 'reservation_profile_busy'
  }
  return 'reservation_profile_failed'
}

const defaultIdempotencyKey = () => {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID()
  throw mutationError('reservation_profile_idempotency_unavailable')
}

export const createAdminReservationProfileMutationExecutor = ({
  client,
  createIdempotencyKey = defaultIdempotencyKey,
} = {}) => {
  if (!client?.rpc) throw mutationError('reservation_profile_client_required')
  const retryKeys = new Map()

  return {
    async mutate(input, { signal } = {}) {
      const command = normalizeReservationProfileCommand(input)
      const fingerprint = requestFingerprint(command)
      const idempotencyKey = retryKeys.get(fingerprint) || createIdempotencyKey()
      retryKeys.set(fingerprint, idempotencyKey)

      try {
        let request = client.rpc('admin_update_reservation_profile', {
          p_scope: command.scope,
          p_reservation_id: command.reservationId,
          p_target_id: command.targetId,
          p_patch: command.patch,
          p_reason: command.reason,
          p_idempotency_key: idempotencyKey,
          p_expected_updated_at: command.expectedUpdatedAt,
        })
        if (signal && typeof request?.abortSignal === 'function') request = request.abortSignal(signal)
        const response = await request
        if (response?.error) throw response.error
        const result = normalizeReservationProfileMutationResult(response?.data, command)
        retryKeys.delete(fingerprint)
        return result
      } catch (error) {
        const safeCode = reservationProfileSafeErrorCode(error)
        if (safeCode !== 'reservation_profile_failed'
          && safeCode !== 'reservation_profile_busy') {
          retryKeys.delete(fingerprint)
        }
        throw Object.assign(error instanceof Error ? error : new Error(safeCode), { safeCode })
      }
    },
    clear() {
      retryKeys.clear()
    },
  }
}
