// @ts-nocheck

export const GENERATED_AT = '2026-01-01T00:00:00Z'

export const QUERY_ALIASES = {
  version: 1,
  aliases: {
    weather: ['meteorology', 'climate', '天气', '气象'],
    forecast: ['weather forecast', '天气预报', '预报'],
    stocks: ['stock', 'equities', 'stock market', '股票', '股价'],
    'historical data': ['history', 'historical', 'time series', '历史', '历史数据'],
    'market data': ['market quotes', '行情', '市场行情'],
    geolocation: ['location', 'geocoding', '地理位置'],
  },
}

export function authEntry(type = 'api_key') {
  return {
    type,
    location: type === 'none' ? 'unknown' : 'header',
    name: type === 'none' ? '' : 'apikey',
    source: 'synthetic fixture',
    confidence: 1,
  }
}

export function apiRecord({
  id,
  name,
  description = '',
  aliases = [],
  tags = [],
  categories = ['Tools'],
  provider = 'Synthetic Community',
  sourceTier = 'public',
  auth = 'api_key',
  https = 'yes',
  cors = 'yes',
  status = 'active',
  fetchedAt = '2025-12-01T00:00:00Z',
  docsUrl = `https://example.test/${id}/docs`,
  homepageUrl = `https://example.test/${id}`,
  openapi = null,
}) {
  const sourceId = sourceTier === 'apilayer'
    ? 'apilayer-synthetic-fixture'
    : 'public-apis-readme'
  return {
    id,
    name,
    aliases: canonicalStrings(aliases),
    description,
    categories: canonicalStrings(categories),
    tags: canonicalStrings(tags),
    provider,
    source_tier: sourceTier,
    docs_url: docsUrl,
    homepage_url: homepageUrl,
    auth: [authEntry(auth)],
    https,
    cors,
    status,
    openapi,
    provenance: [
      {
        source_id: sourceId,
        source_url: `https://fixtures.invalid/${sourceId}/${id}`,
        revision: 'fixture-1',
        retrieved_at: fetchedAt,
        content_hash: 'a'.repeat(64),
        license: sourceTier === 'public' ? 'MIT' : 'synthetic test data',
      },
    ],
    last_checked_at: fetchedAt,
    quality_flags: [],
    rights: { license: sourceTier === 'public' ? 'MIT' : 'synthetic test data' },
  }
}

export function catalog(records, overrides = {}) {
  return {
    schema_version: 1,
    catalog_version: 'fixture-v1',
    generated_at: GENERATED_AT,
    records: [...records].sort((left, right) => compareStrings(left.id, right.id)),
    ...overrides,
  }
}

export function baseRecords() {
  return [
    apiRecord({
      id: 'open-meteo',
      name: 'Open-Meteo',
      description: 'Free weather forecasts and historical climate observations.',
      aliases: ['Open Meteo Weather'],
      tags: ['weather', 'forecast', 'meteorology'],
      categories: ['Weather'],
      provider: 'Open-Meteo',
      auth: 'none',
      cors: 'yes',
    }),
    apiRecord({
      id: 'stock-archive',
      name: 'Stock Archive',
      description: 'Historical stock prices and equity market time series.',
      tags: ['stocks', 'historical data', 'OHLCV'],
      categories: ['Finance'],
      provider: 'Market Data Lab',
      cors: 'unknown',
    }),
    apiRecord({
      id: 'synthetic-apilayer-weather',
      name: 'Synthetic Weather Service',
      description: 'Current and forecast weather observations.',
      tags: ['weather', 'forecast'],
      categories: ['Weather'],
      provider: 'Synthetic Vendor',
      sourceTier: 'apilayer',
      cors: 'no',
    }),
    apiRecord({
      id: 'synthetic-apilayer-currency',
      name: 'Synthetic Currency Service',
      description: 'Foreign exchange rates and currency conversion.',
      tags: ['currency', 'forex'],
      categories: ['Finance'],
      provider: 'Synthetic Vendor',
      sourceTier: 'apilayer',
      cors: 'unknown',
      status: 'candidate',
    }),
  ]
}

function canonicalStrings(values) {
  return [...new Set(values)].sort((left, right) => (
    compareStrings(left.toLowerCase(), right.toLowerCase()) || compareStrings(left, right)
  ))
}

function compareStrings(left, right) {
  if (left === right) return 0
  return left < right ? -1 : 1
}
