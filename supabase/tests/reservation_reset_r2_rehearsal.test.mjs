import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const fixturePath = new URL(
  '../maintenance/reservation_reset_r2_stage_fixture.sql',
  import.meta.url,
)
const rehearsalPath = new URL(
  '../maintenance/reservation_reset_r2_stage_rehearsal.sql',
  import.meta.url,
)

const productionProjectRef = 'ldbtrouofmqmnkyxiewk'
const stageProjectRef = 'vcoujmzsgdboidndtzzg'

const purgeTables = Object.freeze([
  'private.booking_admin_actions',
  'private.app_audit_events',
  'public.reservation_allocation_memberships',
  'public.reservation_transition_parties',
  'public.reservation_transition_allocations',
  'public.reservation_transition_sources',
  'public.reservation_transition_targets',
  'public.reservation_session_assignments',
  'public.reservation_transitions',
  'private.reservation_phase3b_operations',
  'public.payment_allocation_entries',
  'public.reservation_payment_shares',
  'public.payments',
  'public.reservation_party_roles',
  'public.reservation_legacy_sources',
  'public.court_slots',
  'public.bookings',
  'public.reservation_parties',
  'public.reservation_sessions',
  'public.reservations',
  'public.recurrence_series',
  'public.venue_event_courts',
  'public.venue_events',
  'public.venue_members',
])

const protectedTables = Object.freeze([
  'auth.users',
  'auth.identities',
  'auth.sessions',
  'auth.refresh_tokens',
  'public.profiles',
  'public.staff_members',
  'public.courts',
  'public.venue_settings',
  'public.venue_opening_hours',
  'public.venue_pricing_rules',
  'public.venue_member_tiers',
  'private.manager_accounts',
  'private.reservation_phase3b_writer_inventory',
  'private.reservation_phase3b_writer_baseline',
  'private.reservation_phase3b_activation_state',
  'supabase_migrations.schema_migrations',
])

function escaped(value) {
  return value.replaceAll('.', '\\.')
}

test('R2 maintenance SQL is stage-only and outside automatic migrations', async () => {
  const [fixture, rehearsal] = await Promise.all([
    readFile(fixturePath, 'utf8'),
    readFile(rehearsalPath, 'utf8'),
  ])
  const combined = `${fixture}\n${rehearsal}`

  assert.equal(fixturePath.pathname.includes('/supabase/migrations/'), false)
  assert.equal(rehearsalPath.pathname.includes('/supabase/migrations/'), false)
  assert.doesNotMatch(combined, new RegExp(productionProjectRef))
  assert.match(rehearsal, new RegExp(stageProjectRef))
  assert.match(combined, /synthetic-manager@example[.]invalid/)
  assert.doesNotMatch(combined, /service[_-]?role/i)
  assert.doesNotMatch(combined, /\btruncate\b/i)
  assert.doesNotMatch(combined, /\bcascade\b/i)
})

test('R2 reset uses explicit deletes and never deletes protected identities or config', async () => {
  const rehearsal = await readFile(rehearsalPath, 'utf8')

  for (const table of purgeTables) {
    assert.match(
      rehearsal,
      new RegExp(`delete\\s+from\\s+${escaped(table)}\\b`, 'i'),
      `missing explicit delete for ${table}`,
    )
  }

  for (const table of protectedTables) {
    assert.doesNotMatch(
      rehearsal,
      new RegExp(`delete\\s+from\\s+${escaped(table)}\\b`, 'i'),
      `protected table must not be deleted: ${table}`,
    )
  }

  assert.match(rehearsal, /auth_deleted', false/)
  assert.doesNotMatch(rehearsal, /delete\s+from\s+auth[.]/i)
})

test('R2 rehearsal is fail-closed, transaction-scoped, and idempotently rejected', async () => {
  const rehearsal = await readFile(rehearsalPath, 'utf8')

  assert.match(rehearsal, /begin;[\s\S]*commit;/)
  assert.match(rehearsal, /set transaction isolation level serializable/)
  assert.match(rehearsal, /pg_try_advisory_xact_lock/)
  assert.match(rehearsal, /in share row exclusive mode/)
  assert.match(rehearsal, /in share mode/)
  assert.match(rehearsal, /set local session_replication_role = replica/)
  assert.match(rehearsal, /set local session_replication_role = origin/)
  assert.match(rehearsal, /tiger_r2_rehearsal_injected_failure_after_reset/)
  assert.match(rehearsal, /tiger_r2_rehearsal_already_completed/)
  assert.match(rehearsal, /reservation-reset-r2-stage-20260827-v1/)
  assert.match(rehearsal, /second_run_policy', 'reject_same_operation_id'/)

  const functionDeclarations = rehearsal.match(/create function\s+[^\s(]+/gi) ?? []
  assert.equal(functionDeclarations.length, 2)
  assert.equal(
    functionDeclarations.every((declaration) =>
      declaration.toLowerCase().startsWith('create function pg_temp.'),
    ),
    true,
  )
  assert.doesNotMatch(rehearsal, /create\s+(?!temporary\s+table|function\s+pg_temp)[^\n;]+/i)
})

test('R2 manifest freezes counts, fingerprints, sequences, and restore evidence', async () => {
  const rehearsal = await readFile(rehearsalPath, 'utf8')

  assert.match(rehearsal, /'preserve_rows', 134/)
  assert.match(rehearsal, /'purge_rows', 1563/)
  assert.match(rehearsal, /5d5f491dfb3f49b9aeb11208c34c9e64/)
  assert.match(rehearsal, /d7b8917ef74c84b6dc8472966aab6203/)
  assert.match(rehearsal, /private[.]app_audit_events_id_seq/)
  assert.match(rehearsal, /private[.]booking_admin_actions_id_seq/)
  assert.match(rehearsal, /public[.]payment_allocation_entries_id_seq/)
  assert.match(rehearsal, /public[.]reservation_legacy_sources_id_seq/)
  assert.match(rehearsal, /public[.]reservation_transitions_sequence_seq/)
  assert.match(rehearsal, /public[.]reservations_reference_number_seq/)
  assert.match(rehearsal, /sequence_values_unchanged', true/)
  assert.match(rehearsal, /reset_ms/)
  assert.match(rehearsal, /restore_ms/)
  assert.match(rehearsal, /tiger_r2_stage_reset_restore_verified/)
})
