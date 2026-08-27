import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

const packageJson = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
const catalog = JSON.parse(readFileSync(new URL('../data/catalog.json', import.meta.url), 'utf8'))

assert.equal(packageJson.dsh?.bundle?.patch, './cordis.patch.yml')
assert.equal(packageJson.scripts?.prepare, undefined, 'Git installs must not execute a prepare build')

for (const record of catalog.records ?? []) {
  assert.notEqual(record.source_tier, 'apilayer', `public catalog contains private record ${record.id}`)
  for (const provenance of record.provenance ?? []) {
    assert.ok(
      !String(provenance.source_id ?? '').startsWith('apilayer'),
      `public catalog contains APILayer provenance in ${record.id}`,
    )
  }
}

const output = execFileSync('npm', ['pack', '--dry-run', '--json'], {
  cwd: new URL('..', import.meta.url),
  encoding: 'utf8',
})
/** @type {Array<{ files: Array<{ path: string }> }>} */
const report = JSON.parse(output)
assert.equal(report.length, 1)
const [entry] = report
assert.ok(entry)
const files = new Set(entry.files.map(file => file.path))

const expectedFiles = [
  'CHANGELOG.md',
  'CONTRIBUTING.md',
  'LICENSE',
  'README.md',
  'README.zh-CN.md',
  'SECURITY.md',
  'THIRD_PARTY_NOTICES.md',
  'cordis.patch.yml',
  'data/catalog.json',
  'data/query_aliases.json',
  'docs/CATALOG_MAINTENANCE.md',
  'docs/DEVELOPMENT.md',
  'docs/MANUAL_TESTING.md',
  'docs/PRIVATE_CATALOG.md',
  'index.js',
  'package.json',
  'src/catalog.js',
  'src/render.js',
  'src/search.js',
]
assert.deepEqual(
  [...files].sort(),
  [...expectedFiles].sort(),
  'packed file list changed; review and update the explicit release allowlist',
)

for (const required of [
  'index.js',
  'cordis.patch.yml',
  'data/catalog.json',
  'data/query_aliases.json',
  'README.md',
  'README.zh-CN.md',
  'LICENSE',
  'THIRD_PARTY_NOTICES.md',
]) {
  assert.ok(files.has(required), `packed artifact is missing ${required}`)
}

for (const forbidden of ['source_records.json', 'source_state.json', 'review_queue.json']) {
  assert.ok(
    [...files].every(file => !file.endsWith(forbidden)),
    `packed artifact contains private maintenance state ${forbidden}`,
  )
}

const privatePathPatterns = [
  /(?:^|[\s"'`])\/Users\/[^/\s]+/mu,
  /(?:^|[\s"'`])\/home\/[^/\s]+/mu,
  /(?:^|[\s"'`])[A-Za-z]:\\Users\\[^\\\s]+/mu,
]
for (const file of files) {
  if (file === 'data/catalog.json') continue
  const contents = readFileSync(new URL(`../${file}`, import.meta.url), 'utf8')
  assert.ok(
    privatePathPatterns.every(pattern => !pattern.test(contents)),
    `packed artifact contains a private user path in ${file}`,
  )
}

console.log(`package audit ok (${files.size} files, ${catalog.records.length} public records)`)
