import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const writerPath = new URL(
  '../maintenance/reservation_reset_r3a_backup_writer.mjs',
  import.meta.url,
)
const verifierPath = new URL(
  '../maintenance/reservation_reset_r3a_verify_backup.mjs',
  import.meta.url,
)
const productionDraftPath = new URL(
  '../maintenance/reservation_reset_r3b_production_draft.sql',
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
  'public.profiles',
  'public.venue_event_courts',
  'public.venue_events',
  'public.venue_members',
])

const protectedTables = Object.freeze([
  'auth.users',
  'auth.identities',
  'auth.sessions',
  'auth.refresh_tokens',
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

test('R3A backup tools accept ciphertext only and keep plaintext in memory', async () => {
  const [writer, verifier] = await Promise.all([
    readFile(writerPath, 'utf8'),
    readFile(verifierPath, 'utf8'),
  ])

  assert.match(writer, /tiger-r3a-encrypted-logical-json-v2/)
  assert.match(writer, /flags: 'wx'/)
  assert.match(writer, /mode: 0o600/)
  assert.match(writer, /refuses_repository_output/)
  assert.match(writer, /refuses_plaintext/)
  assert.match(writer, /Object[.]hasOwn\(record, 'plaintext'\)/)
  assert.match(writer, /Object[.]hasOwn\(record, 'rows'\)/)

  assert.match(verifier, /pgp_sym_decrypt/)
  assert.match(verifier, /ProtectedData\]::Unprotect/)
  assert.match(verifier, /chunk_hash_mismatch/)
  assert.match(verifier, /relation_fingerprint_mismatch/)
  assert.match(verifier, /plaintext_persisted: false/)
  assert.match(verifier, /canonicalRowsByRelation/)
  assert.doesNotMatch(`${writer}\n${verifier}`, /ldbtrouofmqmnkyxiewk/)
})

test('R3B production SQL is outside migrations and disabled by default', async () => {
  const draft = await readFile(productionDraftPath, 'utf8')

  assert.equal(productionDraftPath.pathname.includes('/supabase/migrations/'), false)
  assert.match(draft, new RegExp(productionProjectRef))
  assert.doesNotMatch(draft, new RegExp(stageProjectRef))
  assert.match(draft, /set tiger[.]r3b[.]execution_authorized = 'false';/)
  assert.match(draft, /tiger_r3b_production_draft_not_authorized/)
  assert.match(draft, /tiger_r3b_production_already_completed/)
  assert.match(draft, /reservation-reset-r3b-production-20260828-v1/)
  assert.doesNotMatch(draft, /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i)
  assert.doesNotMatch(draft, /\S+@\S+/)
})

test('R3B draft explicitly deletes only the approved database purge set', async () => {
  const draft = await readFile(productionDraftPath, 'utf8')

  for (const table of purgeTables) {
    assert.match(
      draft,
      new RegExp(`delete\\s+from\\s+${escaped(table)}\\b`, 'i'),
      `missing explicit delete for ${table}`,
    )
  }

  for (const table of protectedTables) {
    assert.doesNotMatch(
      draft,
      new RegExp(`delete\\s+from\\s+${escaped(table)}\\b`, 'i'),
      `protected table must not be deleted: ${table}`,
    )
  }

  assert.doesNotMatch(draft, /delete\s+from\s+auth[.]/i)
  assert.doesNotMatch(draft, /\btruncate\b/i)
  assert.doesNotMatch(draft, /\bsetval\s*\(/i)
  assert.doesNotMatch(draft, /alter\s+sequence/i)
  assert.match(draft, /auth_deleted', false/)
  assert.match(draft, /auth_next_step_required', true/)
})

test('R3B draft freezes the reviewed production manifest and Auth selector', async () => {
  const draft = await readFile(productionDraftPath, 'utf8')

  assert.match(draft, /'preserve_rows', 206/)
  assert.match(draft, /'purge_rows', 4327/)
  assert.match(draft, /d5c5186d647d6f5a9d8f552d886e92773733905821694be1d28b381ac045310f/)
  assert.match(draft, /c945049e3725602fd00a9e963591962e74744f96bf89852d32143f384a8cb39c/)
  assert.match(draft, /71b3e7bbce898d4cce09ef50c3457f25877dec9d5ce9f2a46578f3ad04d294b6/)
  assert.match(draft, /7e4e3f877940cc92e79268ae28f71211097e71efaa12bdb9775b256fd377f115/)
  assert.match(draft, /auth_fk_catalog_drift/)
  assert.match(draft, /auth_reference_mismatch/)
  assert.match(draft, /provider_reference is not null/)
  assert.match(draft, /1642[.]00/)

  const expectedRows = draft.match(/^  \('(preserve|purge)',/gm) ?? []
  assert.equal(expectedRows.length, 40)
  const authReferenceRows = draft.match(/^  \('(public|private)[.][^']+'::regclass, '[^']+', \d+\)[,;]/gm) ?? []
  assert.equal(authReferenceRows.length, 28)
})

test('R3B draft is transaction-scoped, fail-closed, and sequence-preserving', async () => {
  const draft = await readFile(productionDraftPath, 'utf8')

  assert.match(draft, /begin;[\s\S]*commit;/)
  assert.match(draft, /set transaction isolation level serializable/)
  assert.match(draft, /lock_timeout = '5s'/)
  assert.match(draft, /pg_try_advisory_xact_lock/)
  assert.match(draft, /in share row exclusive mode/)
  assert.match(draft, /set local session_replication_role = replica/)
  assert.match(draft, /set local session_replication_role = origin/)
  assert.match(draft, /sequence_values_unchanged', true/)
  assert.match(draft, /tiger_r3b_production_preserve_drift/)
  assert.match(draft, /tiger_r3b_production_purge_incomplete/)
  assert.match(draft, /tiger_r3b_database_reset_committed_auth_pending/)
  assert.match(draft, /second_run_policy', 'reject_same_operation_id'/)

  const functionDeclarations = draft.match(/create function\s+[^\s(]+/gi) ?? []
  assert.equal(functionDeclarations.length, 3)
  assert.equal(
    functionDeclarations.every((declaration) =>
      declaration.toLowerCase().startsWith('create function pg_temp.'),
    ),
    true,
  )
  assert.doesNotMatch(
    draft,
    /create\s+(?!temporary\s+table|function\s+pg_temp)[^\n;]+/i,
  )
})
