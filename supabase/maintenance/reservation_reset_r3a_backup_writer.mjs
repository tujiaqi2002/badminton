import { createHash } from 'node:crypto'
import { createWriteStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { isAbsolute, relative, resolve } from 'node:path'
import { createInterface } from 'node:readline'

function fail(message) {
  process.stderr.write(`${message}\n`)
  process.exit(1)
}

const [outputArgument] = process.argv.slice(2)

if (!outputArgument || !isAbsolute(outputArgument)) {
  fail('tiger_r3a_backup_writer_requires_absolute_output')
}

const outputPath = resolve(outputArgument)
const repositoryRoot = resolve(process.cwd())
const relativeToRepository = relative(repositoryRoot, outputPath)

if (
  relativeToRepository === '' ||
  (!relativeToRepository.startsWith('..') && !isAbsolute(relativeToRepository))
) {
  fail('tiger_r3a_backup_writer_refuses_repository_output')
}

const output = createWriteStream(outputPath, {
  encoding: 'utf8',
  flags: 'wx',
  mode: 0o600,
})
const hash = createHash('sha256')
let lineCount = 0
let chunkCount = 0
let rowCount = 0
let sawHeader = false
let sawFooter = false

const reader = createInterface({
  input: process.stdin,
  crlfDelay: Infinity,
})

for await (const line of reader) {
  if (!line) continue

  let record
  try {
    record = JSON.parse(line)
  } catch {
    fail('tiger_r3a_backup_writer_invalid_json')
  }

  if (Object.hasOwn(record, 'plaintext') || Object.hasOwn(record, 'rows')) {
    fail('tiger_r3a_backup_writer_refuses_plaintext')
  }

  if (record.type === 'header') {
    if (lineCount !== 0 || sawHeader || record.format !== 'tiger-r3a-encrypted-logical-json-v2') {
      fail('tiger_r3a_backup_writer_invalid_header')
    }
    sawHeader = true
  } else if (record.type === 'chunk') {
    if (!sawHeader || sawFooter) fail('tiger_r3a_backup_writer_invalid_chunk_order')
    if (
      typeof record.relation !== 'string' ||
      !Number.isInteger(record.chunk) ||
      record.chunk < 0 ||
      !Number.isInteger(record.row_count) ||
      record.row_count < 0 ||
      !/^[0-9a-f]{64}$/.test(record.plaintext_sha256 ?? '') ||
      !/^[A-Za-z0-9+/=\r\n]+$/.test(record.ciphertext ?? '')
    ) {
      fail('tiger_r3a_backup_writer_invalid_chunk')
    }
    chunkCount += 1
    rowCount += record.row_count
  } else if (record.type === 'footer') {
    if (!sawHeader || sawFooter) fail('tiger_r3a_backup_writer_invalid_footer_order')
    if (record.chunk_count !== chunkCount || record.row_count !== rowCount) {
      fail('tiger_r3a_backup_writer_footer_mismatch')
    }
    sawFooter = true
    reader.close()
  } else {
    fail('tiger_r3a_backup_writer_unknown_record')
  }

  const serialized = `${JSON.stringify(record)}\n`
  hash.update(serialized)
  if (!output.write(serialized)) {
    await new Promise((resolveDrain) => output.once('drain', resolveDrain))
  }
  lineCount += 1
}

if (!sawHeader || !sawFooter) fail('tiger_r3a_backup_writer_incomplete_stream')

await new Promise((resolveClose, rejectClose) => {
  output.end((error) => (error ? rejectClose(error) : resolveClose()))
})

const outputStat = await stat(outputPath)
process.stdout.write(
  `${JSON.stringify({
    status: 'tiger_r3a_ciphertext_written',
    lines: lineCount,
    chunks: chunkCount,
    rows: rowCount,
    bytes: outputStat.size,
    sha256: hash.digest('hex'),
  })}\n`,
)
