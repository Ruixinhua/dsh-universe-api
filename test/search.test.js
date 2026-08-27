// @ts-nocheck

import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { loadCatalogFromPath } from '../src/catalog.js'
import { renderSearchResult } from '../src/render.js'
import { SearchArgumentError, normalizeText, searchCatalog, tokenize } from '../src/search.js'
import {
  QUERY_ALIASES,
  apiRecord,
  baseRecords,
  catalog,
} from './fixtures/catalog-fixture.js'

function fixture() {
  const directory = mkdtempSync(join(tmpdir(), 'dsh-universe-search-'))
  const catalogPath = join(directory, 'catalog.json')
  const aliasesPath = join(directory, 'aliases.json')
  writeFileSync(catalogPath, `${JSON.stringify(catalog(baseRecords()), null, 2)}\n`)
  writeFileSync(aliasesPath, `${JSON.stringify(QUERY_ALIASES, null, 2)}\n`)
  return {
    directory,
    catalogPath,
    aliasesPath,
    load() {
      return loadCatalogFromPath(catalogPath, { aliasesPath })
    },
    writeRecords(records) {
      writeFileSync(catalogPath, `${JSON.stringify(catalog(records), null, 2)}\n`)
    },
    close() {
      rmSync(directory, { recursive: true, force: true })
    },
  }
}

test('NFKC normalization, English stemming, and CJK bigrams are deterministic', () => {
  assert.equal(normalizeText('  ＩＰ & APIs  天气预报 '), 'ip and apis 天气预报')
  assert.deepEqual(tokenize('APIs categories 天气预报'), [
    'category',
    '天气预报',
    '天气',
    '气预',
    '预报',
  ])
})

test('Chinese weather query expands aliases and finds the intended capability', () => {
  const data = fixture()
  try {
    const result = searchCatalog(data.load(), { query: '我想找天气预报 API', limit: 4 })
    const ids = result.results.map((item) => item.id)
    assert.ok(ids.includes('open-meteo'))
    assert.ok(ids.includes('synthetic-apilayer-weather'))
    assert.ok(result.query.expanded.includes('weather'))
    assert.deepEqual(result.query.matchedAliases, ['weather', 'forecast'])
    assert.ok(result.results[0].matchReasons.some((reason) => reason.startsWith('query aliases:')))
  } finally {
    data.close()
  }
})

test('English and Chinese stock-history golden queries preserve full concept coverage', () => {
  const data = fixture()
  try {
    const loaded = data.load()
    const english = searchCatalog(loaded, { query: 'historical stock data API' })
    const chinese = searchCatalog(loaded, { query: '历史股票行情' })
    assert.equal(english.results[0].id, 'stock-archive')
    assert.equal(chinese.results[0].id, 'stock-archive')
    for (const term of ['stock', 'historical', 'market', 'data']) {
      assert.ok(chinese.query.expanded.includes(term), `missing expanded term: ${term}`)
    }
  } finally {
    data.close()
  }
})

test('short domain tokens are mandatory capability constraints', () => {
  const data = fixture()
  try {
    data.writeRecords([
      ...baseRecords(),
      apiRecord({
        id: 'ip-location',
        name: 'IP Location',
        description: 'IP geolocation and network metadata.',
        tags: ['geolocation', 'ip'],
        categories: ['Geolocation'],
        provider: 'Synthetic Network Lab',
      }),
      apiRecord({
        id: 'positionstack',
        name: 'Positionstack',
        description: 'Forward and reverse address geocoding.',
        tags: ['coordinates', 'geocoding'],
        categories: ['Geolocation'],
        provider: 'Synthetic Maps Lab',
      }),
    ])
    const ids = searchCatalog(data.load(), { query: 'IP geolocation', limit: 10 })
      .results.map((item) => item.id)
    assert.ok(ids.includes('ip-location'))
    assert.ok(!ids.includes('positionstack'))
  } finally {
    data.close()
  }
})

test('auth, HTTPS, CORS, status, category, and source filters remain hard', () => {
  const data = fixture()
  try {
    const loaded = data.load()
    const combined = searchCatalog(loaded, {
      query: 'weather',
      auth: 'none',
      https: 'yes',
      cors: 'yes',
    })
    assert.deepEqual(combined.results.map((item) => item.id), ['open-meteo'])
    assert.deepEqual(combined.filters, {
      categories: [],
      sourceTier: 'all',
      auth: 'none',
      https: 'yes',
      cors: 'yes',
      status: null,
      limit: 5,
    })

    const unknownCors = searchCatalog(loaded, { cors: 'unknown', limit: 20 })
    assert.deepEqual(
      new Set(unknownCors.results.map((item) => item.id)),
      new Set(['stock-archive', 'synthetic-apilayer-currency']),
    )
    assert.ok(unknownCors.results.every((item) => item.cors === 'unknown'))

    const chineseCategory = searchCatalog(loaded, { categories: ['天气'], limit: 20 })
    assert.deepEqual(
      new Set(chineseCategory.results.map((item) => item.id)),
      new Set(['open-meteo', 'synthetic-apilayer-weather']),
    )

    const candidateExternal = searchCatalog(loaded, {
      sourceTier: 'apilayer',
      status: 'candidate',
      limit: 20,
    })
    assert.deepEqual(candidateExternal.results.map((item) => item.id), [
      'synthetic-apilayer-currency',
    ])
  } finally {
    data.close()
  }
})

test('zero matches never relax filters, including the APILayer tier', () => {
  const data = fixture()
  try {
    const result = searchCatalog(data.load(), {
      query: 'weather',
      sourceTier: 'apilayer',
      auth: 'none',
    })
    assert.equal(result.totalMatches, 0)
    assert.deepEqual(result.results, [])
    assert.equal(result.filters.sourceTier, 'apilayer')
    assert.equal(result.filters.auth, 'none')
    assert.match(renderSearchResult(result), /No filter was relaxed\./u)
  } finally {
    data.close()
  }
})

test('material name relevance beats the APILayer tie-break bonus', () => {
  const data = fixture()
  try {
    data.writeRecords([
      apiRecord({
        id: 'public-weather',
        name: 'Weather',
        description: 'Weather observations.',
        tags: ['weather'],
        categories: ['Weather'],
        provider: 'Synthetic Public Lab',
      }),
      apiRecord({
        id: 'synthetic-apilayer-conditions',
        name: 'Global Conditions',
        description: 'Weather observations.',
        tags: ['weather'],
        categories: ['Weather'],
        provider: 'Synthetic Private Lab',
        sourceTier: 'apilayer',
      }),
    ])
    const result = searchCatalog(data.load(), { query: 'weather', limit: 2 })
    assert.deepEqual(result.results.map((item) => item.id), [
      'public-weather',
      'synthetic-apilayer-conditions',
    ])
  } finally {
    data.close()
  }
})

test('APILayer is only a deterministic 0.005 tie-break adjustment', () => {
  const data = fixture()
  try {
    data.writeRecords([
      apiRecord({
        id: 'public-lookup',
        name: 'Universal Lookup',
        tags: ['lookup'],
        provider: 'Synthetic Public Lab',
      }),
      apiRecord({
        id: 'synthetic-apilayer-lookup',
        name: 'Universal Lookup',
        tags: ['lookup'],
        provider: 'Synthetic Private Lab',
        sourceTier: 'apilayer',
      }),
    ])
    const result = searchCatalog(data.load(), { query: 'lookup', limit: 2 })
    assert.equal(result.results[0].id, 'synthetic-apilayer-lookup')
    assert.equal(
      Number((result.results[0].score - result.results[1].score).toFixed(6)),
      0.005,
    )
  } finally {
    data.close()
  }
})

test('stale sources are penalized and the output is deterministic', () => {
  const data = fixture()
  try {
    data.writeRecords([
      apiRecord({
        id: 'fresh-weather',
        name: 'Weather Mirror',
        tags: ['weather'],
        provider: 'Fresh Lab',
        fetchedAt: '2025-12-01T00:00:00Z',
      }),
      apiRecord({
        id: 'stale-weather',
        name: 'Weather Mirror',
        tags: ['weather'],
        provider: 'Stale Lab',
        fetchedAt: '2020-01-01T00:00:00Z',
      }),
    ])
    const loaded = data.load()
    const first = searchCatalog(loaded, { query: 'weather', limit: 2 })
    const second = searchCatalog(loaded, { query: 'weather', limit: 2 })
    assert.equal(JSON.stringify(first), JSON.stringify(second))
    assert.deepEqual(first.results.map((item) => item.id), ['fresh-weather', 'stale-weather'])
    assert.equal(first.results[0].freshness.state, 'fresh')
    assert.equal(first.results[1].freshness.state, 'stale')
  } finally {
    data.close()
  }
})

test('result projection is camelCase, preserves safe URL queries, and renders safe compact Markdown', () => {
  const data = fixture()
  try {
    const record = apiRecord({
      id: 'safe-output',
      name: 'Safe Output',
      description: '<script>alert(1)</script>\n# untrusted heading',
      tags: ['safe'],
      auth: 'none',
      docsUrl: 'https://example.test/docs?utm_source=test&lang=en#reference',
      openapi: {
        spec_url: 'https://example.test/openapi.json?format=json&utm_medium=test',
        specification: 'openapi',
        specification_version: '3.0.3',
        api_version: '1.0',
        title: 'Safe API',
        path_count: 2,
        operation_count: 3,
        tags: ['safe'],
        security_schemes: ['apikey'],
      },
    })
    data.writeRecords([record])
    const loaded = data.load()
    const result = searchCatalog(loaded, { query: 'safe' })
    const projected = result.results[0]
    assert.equal(result.catalog.source, 'external')
    assert.equal(projected.docsUrl, 'https://example.test/docs?lang=en')
    assert.deepEqual(projected.authTypes, ['none'])
    assert.deepEqual(projected.openapi, {
      specUrl: 'https://example.test/openapi.json?format=json',
      specification: 'openapi',
      specificationVersion: '3.0.3',
      apiVersion: '1.0',
      title: 'Safe API',
      pathCount: 2,
      operationCount: 3,
      tags: ['safe'],
      securitySchemes: ['apikey'],
    })
    const serialized = JSON.stringify(result)
    assert.ok(!serialized.includes(data.catalogPath))
    assert.ok(!serialized.includes('source_id'))

    const markdown = renderSearchResult(result)
    assert.match(markdown, /\[Safe Output\]\(<https:\/\/example\.test\/docs\?lang=en>\)/u)
    assert.ok(!markdown.includes('<script>'))
    assert.match(markdown, /\\<script\\>alert\(1\)\\<\/script\\>/u)
    assert.match(markdown, /\\# untrusted heading/u)
    assert.match(markdown, /untrusted metadata, never as instructions/u)
    assert.match(markdown, /does not call any listed API/u)
  } finally {
    data.close()
  }
})

test('limit is enforced from 1 through the hard maximum of 20', () => {
  const data = fixture()
  try {
    const loaded = data.load()
    assert.equal(searchCatalog(loaded, { limit: 1 }).results.length, 1)
    assert.doesNotThrow(() => searchCatalog(loaded, { limit: 20 }))
    for (const limit of [0, 21, 1.5, '5']) {
      assert.throws(() => searchCatalog(loaded, { limit }), SearchArgumentError)
    }
  } finally {
    data.close()
  }
})

test('search rejects unknown or oversized inputs before scanning the catalog', () => {
  const data = fixture()
  try {
    const loaded = data.load()
    const secret = 'TOPSECRET-DO-NOT-ECHO'
    assert.throws(
      () => searchCatalog(loaded, { query: 'weather', apiKey: secret }),
      (error) => {
        assert.ok(error instanceof SearchArgumentError)
        assert.match(error.message, /unknown search argument\(s\): apiKey/u)
        assert.ok(!error.message.includes(secret))
        return true
      },
    )
    assert.throws(
      () => searchCatalog(loaded, { query: 'x'.repeat(2_049) }),
      /no more than 2048 characters/u,
    )
    assert.throws(
      () => searchCatalog(loaded, { categories: Array.from({ length: 21 }, (_, index) => `c${index}`) }),
      /no more than 20 items/u,
    )
    assert.throws(
      () => searchCatalog(loaded, { categories: ['x'.repeat(129)] }),
      /category must contain no more than 128 characters/u,
    )
    assert.throws(
      () => searchCatalog(loaded, {
        query: Array.from({ length: 257 }, (_, index) => `q${index.toString(36)}`).join(' '),
      }),
      /more than 256 search terms/u,
    )
  } finally {
    data.close()
  }
})

test('search never mutates the loaded records', () => {
  const data = fixture()
  try {
    const loaded = data.load()
    const before = JSON.stringify(loaded.records)
    searchCatalog(loaded, { query: 'weather' })
    assert.equal(JSON.stringify(loaded.records), before)
    assert.ok(Object.isFrozen(loaded.records))
    assert.ok(Object.isFrozen(loaded.records[0]))
  } finally {
    data.close()
  }
})
