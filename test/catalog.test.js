// @ts-nocheck

import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  truncateSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { inspect } from 'node:util'

import {
  CatalogError,
  MAX_CATALOG_BYTES,
  loadBundledCatalog,
  loadCatalog,
  loadCatalogFromPath,
  validateCatalog,
} from '../src/catalog.js'
import { searchCatalog } from '../src/search.js'
import {
  QUERY_ALIASES,
  apiRecord,
  baseRecords,
  catalog,
} from './fixtures/catalog-fixture.js'

function fixture(payload = catalog(baseRecords())) {
  const directory = mkdtempSync(join(tmpdir(), 'dsh-universe-catalog-'))
  const catalogPath = join(directory, 'catalog.json')
  const aliasesPath = join(directory, 'aliases.json')
  writeFileSync(catalogPath, `${JSON.stringify(payload, null, 2)}\n`)
  writeFileSync(aliasesPath, `${JSON.stringify(QUERY_ALIASES, null, 2)}\n`)
  return {
    directory,
    catalogPath,
    aliasesPath,
    close() {
      rmSync(directory, { recursive: true, force: true })
    },
  }
}

test('canonical v1 fixture validates and loads into one immutable search index', () => {
  const payload = catalog(baseRecords())
  assert.deepEqual(validateCatalog(payload), [])
  const data = fixture(payload)
  try {
    const loaded = loadCatalogFromPath(data.catalogPath, { aliasesPath: data.aliasesPath })
    assert.deepEqual(loaded.metadata, {
      schemaVersion: 1,
      catalogVersion: 'fixture-v1',
      generatedAt: '2026-01-01T00:00:00Z',
      recordCount: 4,
    })
    assert.equal(loaded.source, 'external')
    assert.equal(loaded.index.rows.length, 4)
    assert.ok(Object.isFrozen(loaded))
    assert.ok(Object.isFrozen(loaded.records))
  } finally {
    data.close()
  }
})

test('bundled loading reports bundled-public while an external catalog fully overrides it', () => {
  const data = fixture()
  const external = fixture(catalog([
    apiRecord({ id: 'external-only', name: 'External Only', tags: ['external'] }),
  ]))
  try {
    const bundled = loadBundledCatalog({
      bundledPath: data.catalogPath,
      aliasesPath: data.aliasesPath,
    })
    assert.equal(bundled.source, 'bundled-public')
    assert.equal(bundled.records.length, 4)

    const overridden = loadCatalog({
      bundledPath: join(data.directory, 'does-not-exist.json'),
      catalogPath: external.catalogPath,
      aliasesPath: data.aliasesPath,
    })
    assert.equal(overridden.source, 'external')
    assert.deepEqual(overridden.records.map((record) => record.id), ['external-only'])
  } finally {
    data.close()
    external.close()
  }
})

test('catalogPath must be absolute and an explicit failure never falls back', () => {
  const data = fixture()
  try {
    assert.throws(
      () => loadCatalogFromPath(join('relative', 'catalog.json'), { aliasesPath: data.aliasesPath }),
      /catalogPath must be an absolute path/u,
    )
    const missing = join(data.directory, 'missing.json')
    assert.throws(
      () => loadCatalog({
        bundledPath: data.catalogPath,
        catalogPath: missing,
        aliasesPath: data.aliasesPath,
      }),
      (error) => {
        assert.ok(error instanceof CatalogError)
        assert.match(error.message, /External catalog cannot be read/u)
        assert.equal(error.code, 'ENOENT')
        assert.equal(error.cause, undefined)
        assert.ok(!error.message.includes(missing))
        assert.ok(!inspect(error, { depth: null }).includes(missing))
        return true
      },
    )
  } finally {
    data.close()
  }
})

test('sidecar must be a regular UTF-8 JSON file no larger than 16 MiB', () => {
  const data = fixture()
  try {
    const directoryPath = join(data.directory, 'catalog-directory')
    mkdirSync(directoryPath)
    assert.throws(
      () => loadCatalogFromPath(directoryPath, { aliasesPath: data.aliasesPath }),
      /must be a regular file/u,
    )

    const oversized = join(data.directory, 'oversized.json')
    writeFileSync(oversized, '')
    truncateSync(oversized, MAX_CATALOG_BYTES + 1)
    assert.throws(
      () => loadCatalogFromPath(oversized, { aliasesPath: data.aliasesPath }),
      /exceeds the 16 MiB size limit/u,
    )

    const malformed = join(data.directory, 'malformed.json')
    writeFileSync(malformed, '{ not json')
    assert.throws(
      () => loadCatalogFromPath(malformed, { aliasesPath: data.aliasesPath }),
      /not valid JSON/u,
    )

    const invalidUtf8 = join(data.directory, 'invalid-utf8.json')
    writeFileSync(invalidUtf8, Buffer.from([0xff, 0xfe, 0xfd]))
    assert.throws(
      () => loadCatalogFromPath(invalidUtf8, { aliasesPath: data.aliasesPath }),
      /not valid UTF-8/u,
    )
  } finally {
    data.close()
  }
})

test('Unix special-file sidecars fail closed without blocking startup', {
  skip: process.platform === 'win32',
}, () => {
  const data = fixture()
  try {
    const fifoPath = join(data.directory, 'catalog.fifo')
    execFileSync('mkfifo', [fifoPath])
    const moduleUrl = new URL('../src/catalog.js', import.meta.url).href
    const result = spawnSync(process.execPath, [
      '--input-type=module',
      '-e',
      [
        'const { loadCatalogFromPath } = await import(process.argv[1])',
        'try {',
        '  loadCatalogFromPath(process.argv[2])',
        "  process.stderr.write('special-file sidecar unexpectedly loaded')",
        '  process.exitCode = 2',
        '} catch (error) {',
        '  process.stdout.write(JSON.stringify({ name: error.name, message: error.message }))',
        '}',
      ].join('\n'),
      moduleUrl,
      fifoPath,
    ], {
      encoding: 'utf8',
      killSignal: 'SIGKILL',
      timeout: 750,
    })

    assert.equal(result.error, undefined, 'special-file validation blocked until timeout')
    assert.equal(result.status, 0, result.stderr)
    assert.deepEqual(JSON.parse(result.stdout), {
      name: 'CatalogError',
      message: 'External catalog must be a regular file',
    })
  } finally {
    data.close()
  }
})

test('sidecar indexing rejects per-record and catalog-wide token expansion before activation', () => {
  const aliases = Array.from(
    { length: 256 },
    (_, index) => `${'汉'.repeat(64)}-${String(index).padStart(3, '0')}`,
  )
  const perRecord = fixture(catalog([
    apiRecord({ id: 'wide-record', name: 'Wide Record', aliases }),
  ]))
  const cjkDescription = Array.from(
    { length: 8_192 },
    (_, index) => String.fromCodePoint(0x4e00 + (index % 20_000)),
  ).join('')
  const catalogWide = fixture(catalog(Array.from({ length: 31 }, (_, index) => apiRecord({
    id: `cjk-${String(index).padStart(2, '0')}`,
    name: `CJK ${index}`,
    provider: `Provider ${index}`,
    description: cjkDescription,
  }))))

  try {
    assert.throws(
      () => loadCatalogFromPath(perRecord.catalogPath, { aliasesPath: perRecord.aliasesPath }),
      /record search text exceeds 16384 code units/u,
    )
    assert.throws(
      () => loadCatalogFromPath(catalogWide.catalogPath, { aliasesPath: catalogWide.aliasesPath }),
      /catalog search index exceeds 250000 tokens/u,
    )
  } finally {
    perRecord.close()
    catalogWide.close()
  }
})

test('canonical validation rejects legacy roots, invalid schema versions, and missing fields', () => {
  assert.deepEqual(validateCatalog([]), ['catalog: root must be an object'])
  assert.ok(validateCatalog({ apis: [] }).some((error) => error.includes('schema_version')))

  const payload = catalog(baseRecords(), { schema_version: 2 })
  const data = fixture(payload)
  try {
    assert.throws(
      () => loadCatalogFromPath(data.catalogPath, { aliasesPath: data.aliasesPath }),
      /schema_version: must equal 1/u,
    )
  } finally {
    data.close()
  }
})

test('runtime JSON loading rejects duplicate keys, hostile nesting, and unknown canonical fields', () => {
  const data = fixture()
  try {
    const validText = JSON.stringify(catalog(baseRecords()))
    writeFileSync(data.catalogPath, validText.replace('{', '{"schema_version":1,'))
    assert.throws(
      () => loadCatalogFromPath(data.catalogPath, { aliasesPath: data.aliasesPath }),
      /duplicate object key/u,
    )

    let nested = 'leaf'
    for (let depth = 0; depth < 70; depth += 1) nested = { child: nested }
    const deeplyNested = catalog(baseRecords())
    deeplyNested.records[0].rights.nested = nested
    writeFileSync(data.catalogPath, JSON.stringify(deeplyNested))
    assert.throws(
      () => loadCatalogFromPath(data.catalogPath, { aliasesPath: data.aliasesPath }),
      /nesting exceeds 64/u,
    )

    const extraRoot = catalog(baseRecords(), { private_state: true })
    assert.ok(validateCatalog(extraRoot).some((error) => error.includes("unexpected key 'private_state'")))
    const extraRecord = catalog(baseRecords())
    extraRecord.records[0].credential = 'must-not-be-accepted'
    assert.ok(validateCatalog(extraRecord).some((error) => error.includes("unexpected key 'credential'")))
  } finally {
    data.close()
  }
})

test('catalog validation fails fast on oversized or broadly invalid record sets', () => {
  const noisyRoot = catalog([])
  for (let index = 0; index < 1_000; index += 1) noisyRoot[`extra_${index}`] = true
  const rootErrors = validateCatalog(noisyRoot)
  assert.ok(rootErrors.length <= 101)
  assert.match(rootErrors.at(-1), /validation stopped after 100 errors/u)

  const oversized = catalog([])
  oversized.records = Array.from({ length: 10_001 }, () => ({}))
  const oversizedErrors = validateCatalog(oversized)
  assert.equal(oversizedErrors.length, 1)
  assert.match(oversizedErrors[0], /no more than 10000 records/u)

  const invalid = catalog([])
  invalid.records = Array.from({ length: 100 }, () => ({}))
  const invalidErrors = validateCatalog(invalid)
  assert.ok(invalidErrors.length <= 101)
  assert.match(invalidErrors.at(-1), /validation stopped after 100 errors/u)

  const semanticDuplicates = catalog(Array.from({ length: 500 }, (_, index) => apiRecord({
    id: `same-${String(index).padStart(3, '0')}`,
    name: 'Same API',
    provider: 'Same Provider',
  })))
  const duplicateErrors = validateCatalog(semanticDuplicates)
  assert.ok(duplicateErrors.length <= 101)
  assert.match(duplicateErrors.at(-1), /validation stopped after 100 errors/u)
})

test('validation enforces deterministic record sorting, unique IDs, and merged identities', () => {
  const alpha = apiRecord({ id: 'alpha', name: 'Alpha', provider: 'Fixture A' })
  const zulu = apiRecord({ id: 'zulu', name: 'Zulu', provider: 'Fixture Z' })
  const unsorted = catalog([alpha, zulu])
  unsorted.records.reverse()
  assert.ok(validateCatalog(unsorted).includes('catalog.records: records must be sorted by id'))

  const duplicateId = catalog([alpha, { ...alpha }])
  assert.ok(validateCatalog(duplicateId).some((error) => error.includes('duplicate id')))

  const semanticDuplicate = catalog([
    apiRecord({ id: 'duplicate-a', name: 'Duplicate Weather', provider: 'Same Provider' }),
    apiRecord({ id: 'duplicate-b', name: 'Duplicate Weather', provider: 'Same Provider' }),
  ])
  assert.ok(validateCatalog(semanticDuplicate).some((error) => error.includes('semantic identity')))
})

test('URL credentials and sensitive query keys are rejected without echoing values', () => {
  const secret = 'TOPSECRET-DO-NOT-ECHO'
  const userinfo = apiRecord({ id: 'userinfo', name: 'Userinfo' })
  userinfo.docs_url = `https://user:${secret}@example.test/docs`
  const sensitiveQuery = apiRecord({ id: 'sensitive', name: 'Sensitive' })
  sensitiveQuery.docs_url = `https://example.test/docs?api_key=${secret}`
  const data = fixture(catalog([sensitiveQuery, userinfo]))
  try {
    assert.throws(
      () => loadCatalogFromPath(data.catalogPath, { aliasesPath: data.aliasesPath }),
      (error) => {
        assert.ok(error instanceof CatalogError)
        assert.match(error.message, /credentials|sensitive query/u)
        assert.ok(!error.message.includes(secret))
        return true
      },
    )
  } finally {
    data.close()
  }
})

test('credential-like query key variants are rejected without echoing values', () => {
  const secret = 'TOPSECRET-DO-NOT-ECHO'
  const keys = [
    'client_secret',
    'x-api-key',
    'subscription-key',
    'refresh_token',
    'X-Amz-Credential',
    'X-Amz-Signature',
    'X-Goog-Signature',
    'sig',
    'key',
    'auth',
  ]

  for (const [index, key] of keys.entries()) {
    const record = apiRecord({ id: `sensitive-${String(index).padStart(2, '0')}`, name: `Sensitive ${index}` })
    record.docs_url = `https://example.test/docs?${encodeURIComponent(key)}=${secret}`
    const data = fixture(catalog([record]))
    try {
      assert.throws(
        () => loadCatalogFromPath(data.catalogPath, { aliasesPath: data.aliasesPath }),
        (error) => {
          assert.ok(error instanceof CatalogError)
          assert.match(error.message, /sensitive query/u)
          assert.ok(!error.message.includes(secret))
          return true
        },
      )
    } finally {
      data.close()
    }
  }
})

test('rights metadata rejects credential URLs, structured secrets, and unknown fields', () => {
  const secret = 'TOPSECRET-DO-NOT-ECHO'
  const record = apiRecord({ id: 'unsafe-rights', name: 'Unsafe Rights' })
  record.rights = {
    license_url: `https://example.test/license?client_secret=${secret}`,
    authorization: { api_key: secret },
    private_state: secret,
  }
  const errors = validateCatalog(catalog([record]))
  const message = errors.join('; ')

  assert.match(message, /rights: unexpected key 'private_state'/u)
  assert.match(message, /rights\.authorization: must be a string or null/u)
  assert.match(message, /rights\.license_url: must not contain sensitive query/u)
  assert.ok(!message.includes(secret))
})

test('unknown and no remain distinct valid tri-state values', () => {
  const data = fixture(catalog([
    apiRecord({ id: 'cors-no', name: 'CORS No', cors: 'no', provider: 'No Lab' }),
    apiRecord({
      id: 'cors-unknown',
      name: 'CORS Unknown',
      cors: 'unknown',
      provider: 'Unknown Lab',
    }),
  ]))
  try {
    const loaded = loadCatalogFromPath(data.catalogPath, { aliasesPath: data.aliasesPath })
    assert.deepEqual(
      searchCatalog(loaded, { cors: 'no' }).results.map((record) => record.id),
      ['cors-no'],
    )
    assert.deepEqual(
      searchCatalog(loaded, { cors: 'unknown' }).results.map((record) => record.id),
      ['cors-unknown'],
    )
  } finally {
    data.close()
  }
})

test('generated_at may be null and remains null in canonical output', () => {
  const data = fixture(catalog(baseRecords(), { generated_at: null }))
  try {
    const loaded = loadCatalogFromPath(data.catalogPath, { aliasesPath: data.aliasesPath })
    const result = searchCatalog(loaded, { query: 'weather' })
    assert.equal(loaded.metadata.generatedAt, null)
    assert.equal(result.catalog.generatedAt, null)
  } finally {
    data.close()
  }
})

test('malformed aliases fail closed instead of disabling expansion silently', () => {
  const data = fixture()
  try {
    writeFileSync(data.aliasesPath, JSON.stringify({ aliases: [] }))
    assert.throws(
      () => loadCatalogFromPath(data.catalogPath, { aliasesPath: data.aliasesPath }),
      /Query aliases must be a JSON object/u,
    )
  } finally {
    data.close()
  }
})
