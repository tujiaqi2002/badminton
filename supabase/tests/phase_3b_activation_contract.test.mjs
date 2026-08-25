import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { PGlite } from '@electric-sql/pglite'

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
const zeroPriceRecoveryPath = new URL(
  '../migrations/20260825074102_phase_3b_zero_price_activation_assertion.sql',
  import.meta.url,
)
const hostedWriterMatrixPath = new URL(
  './phase_3b_hosted_writer_matrix.sql',
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
  assert.doesNotMatch(
    sql,
    /where \(balance\.allocated_amount >= balance\.total_amount\s+and balance\.payment_status <> 'paid'\)/,
  )
  assert.match(sql, /where balance\.allocated_amount > balance\.total_amount/)
  assert.match(
    sql,
    /balance\.payment_status = 'paid'\s+and balance\.allocated_amount is distinct from balance\.total_amount/,
  )
  assert.match(
    sql,
    /balance\.total_amount > 0\s+and balance\.allocated_amount = balance\.total_amount\s+and balance\.payment_status <> 'paid'/,
  )
  assert.doesNotMatch(sql, /ldbtrouofmqmnkyxiewk/)
  assert.doesNotMatch(sql, /service[_ -]?role[_ -]?(key|secret)/i)
})

test('Phase 3B.2 payment assertion accepts zero-price bookings and rejects ledger drift', async () => {
  const sql = await readFile(activationPath, 'utf8')
  const predicate = sql.match(
    /\) as balance\s+(where balance\.allocated_amount[\s\S]*?balance\.payment_status <> 'refunded'\));/,
  )?.[1]
  assert.ok(predicate, 'payment assertion predicate must be extractable')

  const db = new PGlite()
  try {
    const result = await db.query(`
      select case_name
      from (values
        ('valid_zero_unpaid', 'pay_at_venue', 0::numeric, 0::numeric, false),
        ('valid_zero_paid', 'paid', 0::numeric, 0::numeric, false),
        ('valid_positive_unpaid', 'pay_at_venue', 40::numeric, 0::numeric, false),
        ('valid_positive_partial', 'pay_at_venue', 40::numeric, 15::numeric, false),
        ('valid_positive_paid', 'paid', 40::numeric, 40::numeric, false),
        ('valid_refunded', 'refunded', 40::numeric, 0::numeric, true),
        ('invalid_full_unpaid', 'pay_at_venue', 40::numeric, 40::numeric, false),
        ('invalid_overallocated_paid', 'paid', 40::numeric, 41::numeric, false),
        ('invalid_paid_without_ledger', 'paid', 40::numeric, 0::numeric, false),
        ('invalid_partial_paid', 'paid', 40::numeric, 15::numeric, false),
        ('invalid_refund_status', 'pay_at_venue', 40::numeric, 0::numeric, true)
      ) as balance(
        case_name,
        payment_status,
        total_amount,
        allocated_amount,
        has_refund
      )
      ${predicate}
      order by case_name
    `)

    assert.deepEqual(result.rows.map((row) => row.case_name), [
      'invalid_full_unpaid',
      'invalid_overallocated_paid',
      'invalid_paid_without_ledger',
      'invalid_partial_paid',
      'invalid_refund_status',
    ])
  } finally {
    await db.close()
  }
})

test('Phase 3B.2 zero-price recovery converges old and corrected hosted schemas fail closed', async () => {
  const sql = await readFile(zeroPriceRecoveryPath, 'utf8')
  const hostedMatrix = await readFile(hostedWriterMatrixPath, 'utf8')

  assert.match(sql, /^begin;/m)
  assert.match(sql, /commit;\s*$/)
  assert.equal(occurrences(sql, /^commit;$/gm), 1)
  assert.match(sql, /v_version_count <> 46/)
  assert.match(sql, /v_latest_version <> '20260824181500'/)
  assert.match(sql, /pg_get_functiondef/)
  assert.match(sql, /v_old_count = 1 and v_new_count = 0/)
  assert.match(sql, /v_old_count = 0 and v_new_count = 1/)
  assert.match(sql, /assertion source drifted/)
  assert.match(sql, /security shape drifted/)
  assert.match(
    sql,
    /revoke all on function private\.assert_reservation_phase3b_activation\(\)\s+from public, anon, authenticated, service_role/,
  )
  assert.match(sql, /select private\.assert_reservation_phase3b_activation\(\)/)
  assert.doesNotMatch(
    sql,
    /\b(update|insert|delete|truncate)\s+(?:table\s+)?(?:public\.)?(?:bookings|payments|payment_allocation_entries)\b/i,
  )
  assert.doesNotMatch(sql, /ldbtrouofmqmnkyxiewk/)
  assert.doesNotMatch(sql, /service[_ -]?role[_ -]?(key|secret)/i)

  assert.match(hostedMatrix, /zero-price override/)
  assert.match(hostedMatrix, /admin_create_multi_booking_with_price[\s\S]*?0::numeric/)
  assert.match(hostedMatrix, /private\.assert_reservation_phase3b_activation\(\)/)
})

test('Phase 3B.2 diagnostics are read-only and PII-free', async () => {
  const sql = await readFile(diagnosticPath, 'utf8')

  assert.match(sql, /begin transaction read only;/i)
  assert.match(sql, /rollback;\s*$/)
  assert.match(sql, /v_version_count <> 47/)
  assert.match(sql, /v_latest_version <> '20260825074102'/)
  assert.match(sql, /10799dd49909e684c3eb035fa05fbf91/)
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
