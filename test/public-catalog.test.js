import assert from 'node:assert/strict'
import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('../', import.meta.url))
const DATA = join(ROOT, 'data')
const REVISION = '988c57be4616cc9507fd3e8c34adedba5387f079'
const EXPECTED_FILES = [
  'catalog.json',
  'query_aliases.json',
  'source_policy.json',
  'update_report.json',
]
const SENSITIVE_QUERY_KEYS = new Set([
  'access_key',
  'access_token',
  'api_key',
  'apikey',
  'auth',
  'authorization',
  'bearer',
  'client_secret',
  'credential',
  'googleaccessid',
  'jwt',
  'key',
  'passwd',
  'password',
  'private_key',
  'refresh_token',
  'secret',
  'secret_key',
  'security_token',
  'sig',
  'signature',
  'subscription_key',
  'token',
])

function isSensitiveQueryKey(value) {
  return SENSITIVE_QUERY_KEYS.has(value)
    || value.endsWith('_api_key')
    || value.endsWith('_credential')
    || value.endsWith('_secret')
    || value.endsWith('_signature')
    || value.endsWith('_subscription_key')
    || value.endsWith('_token')
}

async function json(name) {
  return JSON.parse(await readFile(join(DATA, name), 'utf8'))
}

test('bundled catalog is the 1693-record pinned public-only snapshot', async () => {
  const catalog = await json('catalog.json')

  assert.equal(catalog.schema_version, 1)
  assert.match(catalog.catalog_version, /^v1-[0-9a-f]{16}$/)
  assert.equal(catalog.records.length, 1693)
  assert.deepEqual(
    catalog.records.map((record) => record.id),
    catalog.records.map((record) => record.id).toSorted(),
  )
  assert.equal(new Set(catalog.records.map((record) => record.id)).size, 1693)

  for (const record of catalog.records) {
    assert.equal(record.source_tier, 'public', record.id)
    assert.equal(record.openapi, null, record.id)
    assert.deepEqual(
      record.rights,
      {
        attribution: 'public-apis/public-apis contributors',
        license: 'MIT',
        license_url: 'https://github.com/public-apis/public-apis/blob/master/LICENSE',
      },
      record.id,
    )
    assert.ok(record.provenance.length >= 1, record.id)
    for (const source of record.provenance) {
      assert.equal(source.source_id, 'public-apis-readme', record.id)
      assert.equal(source.revision, REVISION, record.id)
      assert.equal(source.license, 'MIT', record.id)
      assert.equal(
        source.source_url,
        `https://raw.githubusercontent.com/public-apis/public-apis/${REVISION}/README.md`,
        record.id,
      )
    }
    for (const auth of record.auth) {
      assert.equal(auth.source, 'public-apis', record.id)
    }
  }
})

test('public data contains no private sync state, credentials, or vendor provenance', async () => {
  assert.deepEqual((await readdir(DATA)).toSorted(), EXPECTED_FILES)
  const catalog = await json('catalog.json')

  for (const record of catalog.records) {
    for (const field of ['docs_url', 'homepage_url']) {
      const url = new URL(record[field])
      assert.equal(url.username, '', `${record.id}.${field}`)
      assert.equal(url.password, '', `${record.id}.${field}`)
      for (const key of url.searchParams.keys()) {
        const normalized = key.toLowerCase().replace(/[^a-z0-9]+/g, '_')
        assert.equal(
          isSensitiveQueryKey(normalized),
          false,
          `${record.id}.${field} has sensitive query key ${key}`,
        )
      }
    }
    assert.equal(
      record.provenance.some((source) => source.source_id.startsWith('apilayer-')),
      false,
      record.id,
    )
  }
})

test('source policy, aliases, and update report agree with the snapshot', async () => {
  const [catalog, aliases, policy, report] = await Promise.all([
    json('catalog.json'),
    json('query_aliases.json'),
    json('source_policy.json'),
    json('update_report.json'),
  ])

  assert.equal(policy.public_only, true)
  assert.equal(policy.source.source_id, 'public-apis-readme')
  assert.equal(aliases.version, 1)
  assert.ok(aliases.aliases.weather.includes('天气'))
  assert.equal(report.catalog_version, catalog.catalog_version)
  assert.equal(report.source.revision, REVISION)
  assert.equal(report.counts.parsed, 1706)
  assert.equal(report.counts.normalized, 1701)
  assert.equal(report.counts.after, 1693)
})

test('standard-library validator accepts every distributable data file', () => {
  const result = spawnSync(
    process.env.PYTHON || (process.platform === 'win32' ? 'python' : 'python3'),
    [join(ROOT, 'maintenance', 'validate_catalog.py')],
    { cwd: ROOT, encoding: 'utf8' },
  )

  assert.equal(result.status, 0, result.stderr || result.stdout)
  assert.equal(JSON.parse(result.stdout).status, 'ok')
})
