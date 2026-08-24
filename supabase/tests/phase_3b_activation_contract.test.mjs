import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const activationPath = new URL(
  '../migrations/20260824172041_reservation_phase_3b_atomic_writer_activation.sql',
  import.meta.url,
)
const diagnosticPath = new URL(
  '../diagnostics/phase_3b_atomic_writer_activation.sql',
  import.meta.url,
)
const rollbackPath = new URL(
  '../rollback/phase_3b_atomic_writer_activation_rollback.sql',
  import.meta.url,
)
const fkIndexPath = new URL(
  '../migrations/20260824181500_phase_3b_activation_fk_indexes.sql',
  import.meta.url,
)

const directWriters = Object.freeze([
  'admin_cancel_booking',
  'admin_create_multi_booking',
  'admin_create_multi_booking_with_price',
  'admin_create_weekly_booking',
  'admin_create_weekly_booking_with_price',
  'admin_link_booking_groups',
  'admin_mark_booking_paid',
  'admin_move_booking_group',
  'admin_reschedule_booking',
  'admin_reschedule_booking_group',
  'admin_revert_audit_operation',
  'admin_swap_booking_schedule',
  'admin_undo_booking_change',
  'admin_unlink_booking_group',
  'admin_update_booking_details',
  'cancel_booking',
  'create_multi_booking',
])

function occurrences(source, pattern) {
  return [...source.matchAll(pattern)].length
}

test('Phase 3B.2 atomically replaces the exact 17-writer inventory', async () => {
  const sql = await readFile(activationPath, 'utf8')

  assert.match(sql, /^begin;/m)
  assert.match(sql, /commit;\s*$/)
  assert.equal(occurrences(sql, /^commit;$/gm), 1)
  assert.match(sql, /v_version_count <> 44/)
  assert.match(sql, /a6f4cd3758ac93cc4deca461931511ae/)
  assert.match(sql, /assert_reservation_phase3b_kernel_inactive/)
  assert.match(sql, /assert_reservation_phase3b_writer_inventory/)
  assert.match(sql, /assert_reservation_shadow_clean/)

  for (const writer of directWriters) {
    assert.equal(
      occurrences(
        sql,
        new RegExp(`^create function public\\.${writer}\\(`, 'gm'),
      ),
      1,
      `${writer} must have exactly one activated public definition`,
    )
    assert.match(
      sql,
      new RegExp(`reservation_phase3b_legacy_${writer}`),
      `${writer} must retain a private legacy delegate`,
    )
  }

  assert.equal(directWriters.length, 17)
  assert.match(sql, /writer_count = 17/)
  assert.match(sql, /public_direct_booking_writer_count/)
  assert.match(sql, /private_legacy_writer_count/)
  assert.match(sql, /wrapper_count.*3/s)
  assert.match(sql, /admin_link_booking_groups_with_primary/)
  assert.match(sql, /primary_source_party_id/)
  assert.match(sql, /reservation_phase3b_record_payment/)
  assert.match(sql, /reservation_phase3b_refund_payment/)
  assert.match(sql, /reservation_phase3b_apply_transition/)
  assert.match(sql, /reservation_phase3b_reverse_transition/)
  assert.doesNotMatch(sql, /ldbtrouofmqmnkyxiewk/)
  assert.doesNotMatch(sql, /service[_ -]?role[_ -]?(key|secret)/i)
})

test('Phase 3B.2 diagnostics are read-only and PII-free', async () => {
  const sql = await readFile(diagnosticPath, 'utf8')

  assert.match(sql, /begin transaction read only;/i)
  assert.match(sql, /rollback;\s*$/)
  assert.match(sql, /assert_reservation_phase3b_activation/)
  assert.doesNotMatch(sql, /\b(insert|update|delete|truncate|alter|drop|create)\b/i)
  assert.doesNotMatch(
    sql,
    /select[\s\S]{0,120}\b(customer_(name|email|phone|notes)|display_name|email|phone)\b/i,
  )
})

test('Phase 3B.2 emergency rollback retains append-only history', async () => {
  const sql = await readFile(rollbackPath, 'utf8')

  assert.match(sql, /^begin;/m)
  assert.match(sql, /commit;\s*$/)
  assert.match(sql, /original_definition/)
  assert.match(sql, /legacy_writer_rollback/)
  assert.match(sql, /assert_reservation_phase3b_writer_inventory/)
  assert.match(sql, /assert_reservation_phase3b_activation/)
  assert.doesNotMatch(sql, /\b(delete|truncate|drop)\b/i)
  assert.doesNotMatch(sql, /ldbtrouofmqmnkyxiewk/)
})

test('Phase 3B.2 follow-up covers all advisor-reported composite FKs', async () => {
  const sql = await readFile(fkIndexPath, 'utf8')

  assert.match(sql, /^begin;/m)
  assert.match(sql, /commit;\s*$/)
  assert.equal(occurrences(sql, /^create index /gm), 8)
  assert.match(sql, /effective_session_id,\s*effective_reservation_id/)
  assert.match(sql, /booking_id,\s*origin_reservation_id/)
  assert.match(sql, /from_projection_session_id,\s*origin_reservation_id/)
  assert.match(sql, /to_projection_session_id,\s*origin_reservation_id/)
  assert.match(sql, /from_effective_session_id,\s*effective_reservation_id/)
  assert.match(sql, /to_effective_session_id,\s*effective_reservation_id/)
  assert.match(sql, /from_session_id,\s*from_reservation_id/)
  assert.match(sql, /to_session_id,\s*to_reservation_id/)
})
