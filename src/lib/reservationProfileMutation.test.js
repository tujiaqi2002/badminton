import assert from 'node:assert/strict'
import test from 'node:test'
import {
  createAdminReservationProfileMutationExecutor,
  normalizeReservationProfileCommand,
  normalizeReservationProfileMutationResult,
  normalizeReservationProfileWriteSource,
  reservationProfileSafeErrorCode,
  resolveReservationProfileWriteSource,
  RESERVATION_PROFILE_WRITE_SOURCE_CANONICAL,
  RESERVATION_PROFILE_WRITE_SOURCE_LEGACY,
} from './reservationProfileMutation.js'

const ids = Object.freeze({
  reservation: '10000000-0000-4000-8000-000000000001',
  session: '20000000-0000-4000-8000-000000000001',
})

const command = (overrides = {}) => ({
  scope: 'session',
  reservationId: ids.reservation,
  targetId: ids.session,
  patch: { notes: 'Bring shuttles', party_size: 4 },
  reason: 'manager_edit',
  expectedUpdatedAt: '2026-08-27T12:00:00.000Z',
  ...overrides,
})

const response = (overrides = {}) => ({
  schema_version: 1,
  contract: 'admin_reservation_profile_mutation',
  operation_id: 'phase4c1:request-1',
  operation_type: 'update_profile',
  scope: 'session',
  reservation_id: ids.reservation,
  target_id: ids.session,
  status: 'updated',
  changed_fields: ['notes', 'party_size'],
  reason: 'manager_edit',
  audit_event_type: 'session.profile_updated',
  target_updated_at: '2026-08-27T12:01:00.000Z',
  completed_at: '2026-08-27T12:01:00.000Z',
  ...overrides,
})

test('profile write source fails closed to legacy', () => {
  assert.equal(normalizeReservationProfileWriteSource('canonical'), RESERVATION_PROFILE_WRITE_SOURCE_CANONICAL)
  assert.equal(normalizeReservationProfileWriteSource('legacy'), RESERVATION_PROFILE_WRITE_SOURCE_LEGACY)
  assert.equal(normalizeReservationProfileWriteSource('CANONICAL'), RESERVATION_PROFILE_WRITE_SOURCE_LEGACY)
  assert.equal(normalizeReservationProfileWriteSource(undefined), RESERVATION_PROFILE_WRITE_SOURCE_LEGACY)
  assert.equal(resolveReservationProfileWriteSource('canonical', 'canonical'), RESERVATION_PROFILE_WRITE_SOURCE_CANONICAL)
  assert.equal(resolveReservationProfileWriteSource('canonical', 'legacy'), RESERVATION_PROFILE_WRITE_SOURCE_LEGACY)
  assert.equal(resolveReservationProfileWriteSource('legacy', 'canonical'), RESERVATION_PROFILE_WRITE_SOURCE_LEGACY)
})

test('profile command keeps explicit scope, target, patch, reason and stale version', () => {
  assert.deepEqual(normalizeReservationProfileCommand(command()), command())
  assert.throws(
    () => normalizeReservationProfileCommand(command({ scope: 'reservation' })),
    { code: 'reservation_profile_target_scope_mismatch' },
  )
  assert.throws(
    () => normalizeReservationProfileCommand(command({ patch: { payment_status: 'paid' } })),
    { code: 'reservation_profile_patch_scope_mismatch' },
  )
  assert.throws(
    () => normalizeReservationProfileCommand(command({ reason: 'free-form PII' })),
    { code: 'reservation_profile_invalid_reason' },
  )
  assert.throws(
    () => normalizeReservationProfileCommand(command({
      scope: 'party',
      targetId: ids.session,
      patch: { display_name: 'x'.repeat(201) },
    })),
    { code: 'reservation_profile_invalid_display_name' },
  )
})

test('profile result whitelists a PII-free versioned envelope', () => {
  const result = normalizeReservationProfileMutationResult(response({ secret_patch: 'do not copy' }), command())
  assert.equal(result.operationId, 'phase4c1:request-1')
  assert.deepEqual(result.changedFields, ['notes', 'party_size'])
  assert.equal('secret_patch' in result, false)
  assert.throws(
    () => normalizeReservationProfileMutationResult(response({ target_id: ids.reservation }), command()),
    { code: 'reservation_profile_response_identity_mismatch' },
  )
})

test('executor preserves one idempotency key across ambiguous retry', async () => {
  const calls = []
  let attempt = 0
  const client = {
    rpc(name, params) {
      calls.push({ name, params })
      attempt += 1
      if (attempt === 1) return Promise.resolve({ error: new Error('network unavailable') })
      return Promise.resolve({ data: response() })
    },
  }
  const executor = createAdminReservationProfileMutationExecutor({
    client,
    createIdempotencyKey: () => 'request-1',
  })

  await assert.rejects(() => executor.mutate(command()), { safeCode: 'reservation_profile_failed' })
  const result = await executor.mutate(command())

  assert.equal(result.status, 'updated')
  assert.equal(calls.length, 2)
  assert.equal(calls[0].name, 'admin_update_reservation_profile')
  assert.equal(calls[0].params.p_idempotency_key, 'request-1')
  assert.equal(calls[1].params.p_idempotency_key, 'request-1')
  assert.equal(calls[0].params.p_patch.payment_status, undefined)
})

test('safe error mapper exposes only allowlisted codes', () => {
  assert.equal(
    reservationProfileSafeErrorCode({ message: 'reservation_profile_stale_target' }),
    'reservation_profile_stale_target',
  )
  assert.equal(
    reservationProfileSafeErrorCode({ message: 'raw database detail with a customer name' }),
    'reservation_profile_failed',
  )
  assert.equal(
    reservationProfileSafeErrorCode({ message: 'Manager access required' }),
    'reservation_profile_manager_required',
  )
})
