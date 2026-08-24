import assert from 'node:assert/strict'
import test from 'node:test'

import {
  bookingSeedSql,
  buildBookings,
  linkedAuditBookingIds,
  paymentAuditSql,
  productionFingerprintOccurrences,
  productionFingerprints,
  specializePhase2,
  stageProjectRef,
} from '../staging/generate_synthetic_legacy_fixture.mjs'

test('staging fixture is deterministic, synthetic, and Phase 2 shaped', () => {
  const first = buildBookings()
  const second = buildBookings()

  assert.deepEqual(first, second)
  assert.equal(first.length, 192)
  assert.equal(first.some(({ customerEmail }) => !customerEmail.endsWith('@example.invalid')), false)
  assert.equal(first.filter(({ status }) => status === 'confirmed').length, 139)
  assert.equal(linkedAuditBookingIds(first).length, 5)
  assert.match(stageProjectRef, /^[a-z]{20}$/)

  const seed = bookingSeedSql(first)
  assert.match(seed, /set local session_replication_role = replica/)
  assert.match(seed, /requires an empty legacy bookings table/)
  assert.match(seed, /synthetic-manager@example\.invalid/)
  assert.doesNotMatch(seed, /@gmail\.com|@hotmail\.com|@outlook\.com/)

  const audit = paymentAuditSql(first)
  assert.match(audit, /synthetic-payment-operation-a/)
  assert.match(audit, /synthetic-payment-operation-b/)
})

test('Phase 2 specialization replaces exactly the frozen production fingerprints', () => {
  const source = Object.entries(productionFingerprints)
    .flatMap(([key, value]) => Array(productionFingerprintOccurrences[key]).fill(value))
    .join('\n')
  const local = {
    booking: '11111111111111111111111111111111',
    bookingPayload: '22222222222222222222222222222222',
    slots: '33333333333333333333333333333333',
    paymentAudit: '44444444444444444444444444444444',
  }
  const specialized = specializePhase2(source, local)

  const expected = Object.entries(local)
    .flatMap(([key, value]) => Array(productionFingerprintOccurrences[key]).fill(value))
    .join('\n')
  assert.equal(specialized, expected)
  for (const fingerprint of Object.values(productionFingerprints)) {
    assert.equal(specialized.includes(fingerprint), false)
  }
})

test('Phase 2 specialization rejects incomplete fingerprints', () => {
  const source = Object.entries(productionFingerprints)
    .flatMap(([key, value]) => Array(productionFingerprintOccurrences[key]).fill(value))
    .join('\n')
  assert.throws(
    () => specializePhase2(source, { booking: '1'.repeat(32) }),
    /Invalid bookingPayload fingerprint/,
  )
})
