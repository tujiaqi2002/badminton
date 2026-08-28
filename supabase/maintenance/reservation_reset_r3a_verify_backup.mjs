import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

import { PGlite } from '@electric-sql/pglite'
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto'

function assert(condition, code) {
  if (!condition) throw new Error(code)
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex')
}

function relationRows(relations, name) {
  const rows = relations.get(name)
  assert(rows, `tiger_r3a_restore_missing_relation:${name}`)
  return rows
}

const [artifactArgument, keyArgument] = process.argv.slice(2)
assert(artifactArgument && keyArgument, 'tiger_r3a_restore_requires_artifact_and_key')

const artifactPath = resolve(artifactArgument)
const keyPath = resolve(keyArgument)
const rawArtifact = await readFile(artifactPath, 'utf8')
const records = rawArtifact
  .split(/\r?\n/)
  .filter(Boolean)
  .map((line) => JSON.parse(line))

const header = records[0]
const footer = records.at(-1)
const chunks = records.slice(1, -1)

assert(header?.type === 'header', 'tiger_r3a_restore_missing_header')
assert(header.format === 'tiger-r3a-encrypted-logical-json-v2', 'tiger_r3a_restore_wrong_format')
assert(footer?.type === 'footer', 'tiger_r3a_restore_missing_footer')
assert(footer.artifact_sha256_excludes_footer === sha256(records.slice(0, -1).map((record) => `${JSON.stringify(record)}\n`).join('')), 'tiger_r3a_restore_footer_hash_mismatch')
assert(footer.chunk_count === chunks.length, 'tiger_r3a_restore_chunk_count_mismatch')
assert(footer.row_count === chunks.reduce((sum, chunk) => sum + chunk.row_count, 0), 'tiger_r3a_restore_row_count_mismatch')

const powershell = process.env.PWSH_PATH || 'pwsh'
const escapedKeyPath = keyPath.replaceAll("'", "''")
const key = execFileSync(
  powershell,
  [
    '-NoProfile',
    '-NonInteractive',
    '-Command',
    `Add-Type -AssemblyName System.Security; $b=[IO.File]::ReadAllBytes('${escapedKeyPath}'); $p=[Security.Cryptography.ProtectedData]::Unprotect($b,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser); [Console]::Out.Write([Text.Encoding]::UTF8.GetString($p)); [Array]::Clear($p,0,$p.Length)`,
  ],
  { encoding: 'utf8', windowsHide: true },
).trim()

assert(/^[A-Za-z0-9+/=]{44}$/.test(key), 'tiger_r3a_restore_invalid_key')

const db = new PGlite({ extensions: { pgcrypto } })
await db.waitReady
await db.exec('create extension if not exists pgcrypto')

const relations = new Map()
const chunkHashesByRelation = new Map()
const canonicalRowsByRelation = new Map()

for (const chunk of chunks) {
  assert(chunk.type === 'chunk', 'tiger_r3a_restore_invalid_record')
  const decrypted = await db.query(
    "select pgp_sym_decrypt(decode($1, 'base64'), $2) as plaintext",
    [chunk.ciphertext, key],
  )
  const plaintext = decrypted.rows[0]?.plaintext
  assert(typeof plaintext === 'string', 'tiger_r3a_restore_decrypt_failed')
  assert(sha256(plaintext) === chunk.plaintext_sha256, 'tiger_r3a_restore_chunk_hash_mismatch')

  const rows = JSON.parse(plaintext)
  assert(Array.isArray(rows) && rows.length === chunk.row_count, 'tiger_r3a_restore_chunk_rows_mismatch')
  const relation = relations.get(chunk.relation) ?? []
  relation.push(...rows)
  relations.set(chunk.relation, relation)
  const canonicalRows = canonicalRowsByRelation.get(chunk.relation) ?? []
  const canonicalChunk = await db.query(
    'select md5(value::text) as row_md5, value::text as row_text from jsonb_array_elements($1::jsonb)',
    [plaintext],
  )
  canonicalRows.push(...canonicalChunk.rows)
  canonicalRowsByRelation.set(chunk.relation, canonicalRows)
  const hashes = chunkHashesByRelation.get(chunk.relation) ?? []
  hashes.push(`${chunk.chunk}:${chunk.row_count}:${chunk.plaintext_sha256}`)
  chunkHashesByRelation.set(chunk.relation, hashes)
}

for (const [relation, manifest] of Object.entries(header.relations)) {
  const footerManifest = footer.relations?.[relation]
  assert(footerManifest, `tiger_r3a_restore_missing_footer_relation:${relation}`)
  assert(
    footerManifest.count === manifest.count &&
      footerManifest.fingerprint === manifest.fingerprint,
    `tiger_r3a_restore_footer_relation_mismatch:${relation}`,
  )
  const rows = relationRows(relations, relation)
  assert(rows.length === manifest.count, `tiger_r3a_restore_relation_count_mismatch:${relation}`)
  const canonicalRows = canonicalRowsByRelation.get(relation)
  const fingerprint = await db.query(
    "select encode(digest(coalesce(string_agg(row_md5, '' order by row_md5, row_text), ''), 'sha256'), 'hex') as fingerprint from jsonb_to_recordset($1::jsonb) as x(row_md5 text, row_text text)",
    [JSON.stringify(canonicalRows)],
  )
  assert(fingerprint.rows[0]?.fingerprint === manifest.fingerprint, `tiger_r3a_restore_relation_fingerprint_mismatch:${relation}`)
  assert(
    sha256(chunkHashesByRelation.get(relation).join('|')) === footerManifest.chunk_chain_sha256,
    `tiger_r3a_restore_chunk_chain_mismatch:${relation}`,
  )
}

assert(relations.size === header.relation_count, 'tiger_r3a_restore_relation_total_mismatch')

async function canonicalValues(relation, key) {
  const rowTexts = canonicalRowsByRelation.get(relation)?.map((row) => row.row_text)
  assert(rowTexts, `tiger_r3a_restore_missing_canonical_relation:${relation}`)
  const values = await db.query(
    'select value::jsonb ->> $2 as value from jsonb_array_elements_text($1::jsonb)',
    [JSON.stringify(rowTexts), key],
  )
  return values.rows.map((row) => row.value)
}

async function canonicalIds(relation, key = 'id') {
  return new Set((await canonicalValues(relation, key)).filter(Boolean))
}

async function requireCanonicalReferences(
  relation,
  key,
  parentIds,
  code,
  { nullable = false } = {},
) {
  for (const value of await canonicalValues(relation, key)) {
    if (value == null && nullable) continue
    assert(parentIds.has(value), `${code}:${key}`)
  }
}

const authUsers = await canonicalIds('auth.users')
const staff = relationRows(relations, 'public.staff_members')
const managerUsers = new Set(staff.filter((row) => row.role === 'admin').map((row) => row.user_id))
assert(authUsers.size === 4 && managerUsers.size === 3, 'tiger_r3a_restore_auth_cardinality_mismatch')
for (const managerId of managerUsers) assert(authUsers.has(managerId), 'tiger_r3a_restore_manager_auth_missing')
await requireCanonicalReferences('auth.identities', 'user_id', authUsers, 'tiger_r3a_restore_identity_user')
await requireCanonicalReferences('auth.sessions', 'user_id', authUsers, 'tiger_r3a_restore_session_user')
await requireCanonicalReferences('public.profiles', 'id', authUsers, 'tiger_r3a_restore_profile_user')
await requireCanonicalReferences('public.staff_members', 'user_id', authUsers, 'tiger_r3a_restore_staff_user')
await requireCanonicalReferences('private.manager_accounts', 'user_id', authUsers, 'tiger_r3a_restore_manager_user')

const courts = await canonicalIds('public.courts')
const bookings = relationRows(relations, 'public.bookings')
const bookingIds = await canonicalIds('public.bookings')
const reservations = relationRows(relations, 'public.reservations')
const reservationIds = await canonicalIds('public.reservations')
const sessions = relationRows(relations, 'public.reservation_sessions')
const sessionIds = await canonicalIds('public.reservation_sessions')
const parties = relationRows(relations, 'public.reservation_parties')
const partyIds = await canonicalIds('public.reservation_parties')
const payments = relationRows(relations, 'public.payments')
const paymentIds = await canonicalIds('public.payments')

await requireCanonicalReferences('public.bookings', 'court_id', courts, 'tiger_r3a_restore_booking_court')
await requireCanonicalReferences('public.bookings', 'reservation_id', reservationIds, 'tiger_r3a_restore_booking_reservation')
await requireCanonicalReferences('public.bookings', 'session_id', sessionIds, 'tiger_r3a_restore_booking_session')
await requireCanonicalReferences('public.court_slots', 'id', bookingIds, 'tiger_r3a_restore_slot_booking')
await requireCanonicalReferences('public.court_slots', 'court_id', courts, 'tiger_r3a_restore_slot_court')
await requireCanonicalReferences('public.reservation_sessions', 'reservation_id', reservationIds, 'tiger_r3a_restore_session_reservation')
await requireCanonicalReferences('public.reservation_parties', 'reservation_id', reservationIds, 'tiger_r3a_restore_party_reservation')
await requireCanonicalReferences('public.reservation_parties', 'auth_user_id', authUsers, 'tiger_r3a_restore_party_auth', { nullable: true })
await requireCanonicalReferences('public.reservation_party_roles', 'reservation_id', reservationIds, 'tiger_r3a_restore_role_reservation')
await requireCanonicalReferences('public.reservation_party_roles', 'party_id', partyIds, 'tiger_r3a_restore_role_party')
await requireCanonicalReferences('public.payments', 'reservation_id', reservationIds, 'tiger_r3a_restore_payment_reservation')
await requireCanonicalReferences('public.payments', 'payer_party_id', partyIds, 'tiger_r3a_restore_payment_party', { nullable: true })

const allocations = relationRows(relations, 'public.payment_allocation_entries')
await requireCanonicalReferences('public.payment_allocation_entries', 'reservation_id', reservationIds, 'tiger_r3a_restore_allocation_reservation')
await requireCanonicalReferences('public.payment_allocation_entries', 'payment_id', paymentIds, 'tiger_r3a_restore_allocation_payment')
await requireCanonicalReferences('public.payment_allocation_entries', 'booking_id', bookingIds, 'tiger_r3a_restore_allocation_booking')

const memberships = relationRows(relations, 'public.reservation_allocation_memberships')
await requireCanonicalReferences('public.reservation_allocation_memberships', 'booking_id', bookingIds, 'tiger_r3a_restore_membership_booking')
await requireCanonicalReferences('public.reservation_allocation_memberships', 'effective_reservation_id', reservationIds, 'tiger_r3a_restore_membership_reservation')
await requireCanonicalReferences('public.reservation_allocation_memberships', 'effective_session_id', sessionIds, 'tiger_r3a_restore_membership_session')

const ledgerCents = allocations.reduce((sum, row) => sum + Math.round(Number(row.amount) * 100), 0)
assert(ledgerCents === 164200, 'tiger_r3a_restore_ledger_mismatch')
assert(reservations.every((row) => row.source === 'legacy_migration'), 'tiger_r3a_restore_nonlegacy_reservation')
assert(payments.every((row) => row.provider_reference == null), 'tiger_r3a_restore_provider_reference_present')
assert(relationRows(relations, 'supabase_migrations.schema_migrations').length === 51, 'tiger_r3a_restore_migration_count_mismatch')

const result = {
  status: 'tiger_r3a_encrypted_recovery_verified',
  postgres_version: (await db.query('select version() as version')).rows[0].version,
  relations: relations.size,
  rows: [...relations.values()].reduce((sum, rows) => sum + rows.length, 0),
  chunks: chunks.length,
  relation_fingerprints: Object.keys(header.relations).length,
  manager_users: managerUsers.size,
  nonmanager_users: authUsers.size - managerUsers.size,
  bookings: bookings.length,
  reservations: reservations.length,
  ledger_cad: (ledgerCents / 100).toFixed(2),
  migrations: relationRows(relations, 'supabase_migrations.schema_migrations').length,
  plaintext_persisted: false,
}

await db.close()
process.stdout.write(`${JSON.stringify(result)}\n`)
