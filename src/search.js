const FIELD_WEIGHTS = Object.freeze({
  name: 8,
  aliasesTags: 4.5,
  categories: 2.75,
  description: 1,
});

const FIELD_ORDER = new Map(Object.keys(FIELD_WEIGHTS).map((field, index) => [field, index]));

const AUTH_TYPES = new Set([
  'none',
  'api_key',
  'oauth2',
  'basic',
  'bearer',
  'signed',
  'user_agent',
  'other',
  'unknown',
]);
const TRI_STATES = new Set(['yes', 'no', 'unknown']);
const STATUSES = new Set(['active', 'coming_soon', 'stale', 'candidate', 'unknown']);
const SOURCE_TIERS = new Set(['all', 'public', 'apilayer']);

const STOP_WORDS = new Set([
  'a',
  'an',
  'and',
  'api',
  'apis',
  'best',
  'compare',
  'find',
  'for',
  'i',
  'me',
  'need',
  'of',
  'please',
  'service',
  'services',
  'the',
  'to',
  'with',
]);

// These short identifiers normally express a hard capability requirement.
// For example, a generic geocoder must not satisfy an "IP geolocation" query.
const MANDATORY_DOMAIN_TOKENS = new Set([
  'dns',
  'iban',
  'ip',
  'pdf',
  'qr',
  'seo',
  'serp',
  'sms',
  'ssl',
  'url',
  'vat',
  'vin',
]);

const TOKEN_RE = /[a-z0-9]+(?:[._+-][a-z0-9]+)*|[\p{Script=Han}]+/giu;
const FULL_CJK_RE = /^[\p{Script=Han}]+$/u;
const ANY_CJK_RE = /[\p{Script=Han}]/u;

export const MAX_QUERY_LENGTH = 2_048;
export const MAX_EXPANDED_QUERY_TERMS = 256;
export const MAX_CATEGORIES = 20;
export const MAX_CATEGORY_LENGTH = 128;
export const MAX_RECORD_INDEX_CODE_UNITS = 16_384;
export const MAX_RECORD_INDEX_TOKENS = 16_384;
export const MAX_CATALOG_INDEX_TOKENS = 250_000;

const SEARCH_ARGUMENT_KEYS = new Set([
  'query',
  'categories',
  'sourceTier',
  'auth',
  'https',
  'cors',
  'status',
  'limit',
]);

const SENSITIVE_URL_QUERY_KEYS = new Set([
  'api_key', 'apikey', 'access_key', 'auth', 'bearer', 'client_secret',
  'credential', 'googleaccessid', 'jwt', 'key', 'passwd', 'private_key',
  'refresh_token', 'secret_key', 'security_token', 'sig', 'subscription_key',
  'token', 'access_token', 'secret', 'password', 'signature', 'authorization',
]);

/** @typedef {Record<string, any>} AnyObject */
/** @typedef {Record<string, string[]>} QueryAliases */
/** @typedef {'none'|'api_key'|'oauth2'|'basic'|'bearer'|'signed'|'user_agent'|'other'|'unknown'} AuthType */
/** @typedef {'yes'|'no'|'unknown'} TriState */
/** @typedef {'active'|'coming_soon'|'stale'|'candidate'|'unknown'} CatalogStatus */
/** @typedef {'all'|'public'|'apilayer'} SourceTierFilter */
/** @typedef {{state: string, latestFetchedAt: string|null, ageDaysAtCatalogGeneration: number|null, sourceCount: number}} Freshness */
/** @typedef {{identity: string, terms: readonly string[]}} CompiledCategoryFilter */
/**
 * @typedef {object} SearchResponse
 * @property {{version: string, generatedAt: string|null, recordCount: number, source: 'bundled-public'|'external'}} catalog
 * @property {{original: string, expanded: string[], matchedAliases: string[]}} query
 * @property {{categories: string[], sourceTier: SourceTierFilter, auth: AuthType|null, https: TriState|null, cors: TriState|null, status: CatalogStatus|null, limit: number}} filters
 * @property {number} totalMatches
 * @property {boolean} truncated
 * @property {Array<{
 *   id: string,
 *   name: string,
 *   description: string,
 *   provider: string,
 *   categories: string[],
 *   tags: string[],
 *   docsUrl: string,
 *   authTypes: string[],
 *   https: TriState,
 *   cors: TriState,
 *   status: CatalogStatus,
 *   sourceTier: 'public'|'apilayer'|'merged',
 *   score: number,
 *   matchReasons: string[],
 *   freshness: Freshness,
 *   openapi?: AnyObject
 * }>} results
 */

export class SearchArgumentError extends TypeError {
  /** @param {string} message */
  constructor(message) {
    super(message);
    this.name = 'SearchArgumentError';
  }
}

export class SearchIndexLimitError extends RangeError {
  /** @param {string} message */
  constructor(message) {
    super(message);
    this.name = 'SearchIndexLimitError';
  }
}

/** @param {any} value */
export function normalizeText(value) {
  const text = String(value ?? '')
    .normalize('NFKC')
    .toLowerCase()
    .replaceAll('&', ' and ');
  return [...text.matchAll(TOKEN_RE)].map((match) => match[0]).join(' ');
}

/** @param {string} token */
function stemAscii(token) {
  if (token === 'apis') return 'api';
  if (token.length > 4 && token.endsWith('ies')) return `${token.slice(0, -3)}y`;
  if (token.length > 3 && token.endsWith('s') && !token.endsWith('ss')) {
    return token.slice(0, -1);
  }
  return token;
}

/** @param {any} value @returns {string[]} */
export function tokenize(value) {
  const tokens = [];
  for (const match of normalizeText(value).matchAll(TOKEN_RE)) {
    const raw = match[0].toLowerCase();
    if (FULL_CJK_RE.test(raw)) {
      const characters = [...raw];
      tokens.push(raw);
      if (characters.length > 2) {
        for (let index = 0; index < characters.length - 1; index += 1) {
          tokens.push(characters.slice(index, index + 2).join(''));
        }
      }
      continue;
    }
    const token = stemAscii(raw);
    if (token && !STOP_WORDS.has(token)) tokens.push(token);
  }
  return tokens;
}

/** @param {any} value */
function canonicalPhrase(value) {
  const withoutApi = normalizeText(value).replace(/\bapis?\b/gu, ' ');
  return [...withoutApi.matchAll(TOKEN_RE)].map((match) => match[0]).join('');
}

/** @param {any} value @returns {string[]} */
function textValues(value) {
  if (value === null || value === undefined) return [];
  if (typeof value === 'string') return value.trim() ? [value] : [];
  if (Array.isArray(value)) return value.flatMap((item) => textValues(item));
  if (typeof value === 'object') {
    for (const key of ['name', 'title', 'value', 'label', 'type']) {
      if (value[key]) return [String(value[key])];
    }
    return [];
  }
  return [String(value)];
}

/** @param {string[]} values @returns {string[]} */
function orderedUnique(values) {
  const seen = new Set();
  const result = [];
  for (const value of values) {
    const cleaned = String(value).trim();
    const key = normalizeText(cleaned);
    if (cleaned && !seen.has(key)) {
      seen.add(key);
      result.push(cleaned);
    }
  }
  return result;
}

/** @param {string} query @param {string} phrase */
function phraseOccurs(query, phrase) {
  const queryNorm = normalizeText(query);
  const phraseNorm = normalizeText(phrase);
  if (!phraseNorm) return false;
  if (ANY_CJK_RE.test(phraseNorm.replaceAll(' ', ''))) {
    return queryNorm.replaceAll(' ', '').includes(phraseNorm.replaceAll(' ', ''));
  }
  return ` ${queryNorm} `.includes(` ${phraseNorm} `);
}

/** @param {string} query @param {QueryAliases} [aliases] */
export function expandQuery(query, aliases = {}) {
  const originalTerms = tokenize(query);
  const aliasWeight = ANY_CJK_RE.test(query) ? 0.6 : 0.25;
  const terms = [];
  const weights = new Map();

  for (const term of originalTerms) {
    if (!weights.has(term)) terms.push(term);
    weights.set(term, 1);
  }

  const matchedAliases = [];
  const conceptTerms = new Map();
  for (const [concept, synonyms] of Object.entries(aliases)) {
    const group = orderedUnique([concept, ...textValues(synonyms)]);
    if (!group.some((phrase) => phraseOccurs(query, phrase))) continue;

    matchedAliases.push(concept);
    const canonicalTerms = orderedUnique(tokenize(concept));
    conceptTerms.set(concept, canonicalTerms);
    for (const term of canonicalTerms) {
      if (!weights.has(term)) terms.push(term);
      weights.set(term, Math.max(weights.get(term) ?? 0, aliasWeight));
    }
  }

  return Object.freeze({
    original: query,
    terms: Object.freeze(terms),
    weights,
    matchedAliases: Object.freeze(matchedAliases),
    conceptTerms,
  });
}

/** @param {string[]} tokens @returns {Map<string, number>} */
function countTokens(tokens) {
  const counts = new Map();
  for (const token of tokens) counts.set(token, (counts.get(token) ?? 0) + 1);
  return counts;
}

/** @param {AnyObject} record @returns {string[]} */
function recordAliases(record) {
  return orderedUnique(textValues(record.aliases));
}

/** @param {AnyObject} record @returns {string[]} */
function recordTags(record) {
  return orderedUnique(textValues(record.tags));
}

/** @param {AnyObject} record @returns {string[]} */
function recordCategories(record) {
  return orderedUnique(textValues(record.categories));
}

/** @param {AnyObject} record @returns {AnyObject[]} */
function provenance(record) {
  return Array.isArray(record.provenance)
    ? record.provenance.filter((item) => item && typeof item === 'object' && !Array.isArray(item))
    : [];
}

/** @param {AnyObject} record @returns {string[]} */
function sourceTiers(record) {
  const tiers = new Set();
  if (record.source_tier === 'public' || record.source_tier === 'apilayer') {
    tiers.add(record.source_tier);
  }
  for (const item of provenance(record)) {
    if (item.source_id === 'public-apis-readme') tiers.add('public');
    if (typeof item.source_id === 'string' && item.source_id.startsWith('apilayer-')) {
      tiers.add('apilayer');
    }
  }
  return ['apilayer', 'public'].filter((tier) => tiers.has(tier));
}

/** @param {AnyObject} record @returns {string[]} */
function authTypes(record) {
  /** @type {string[]} */
  const result = [];
  if (!Array.isArray(record.auth)) return result;
  for (const entry of record.auth) {
    const value = entry && typeof entry === 'object' ? entry.type : undefined;
    if (AUTH_TYPES.has(value) && !result.includes(value)) result.push(value);
  }
  return result;
}

/** @param {any} value @returns {TriState} */
function canonicalTriState(value) {
  return /** @type {TriState} */ (TRI_STATES.has(value) ? value : 'unknown');
}

/** @param {any} value @returns {CatalogStatus} */
function canonicalStatus(value) {
  return /** @type {CatalogStatus} */ (STATUSES.has(value) ? value : 'unknown');
}

/** @param {any} value @returns {number | null} */
function parseTimestamp(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : null;
}

/** @param {AnyObject} record @returns {Array<[number, string]>} */
function timestampCandidates(record) {
  /** @type {Array<[number, string]>} */
  const candidates = [];
  const keys = [
    'fetched_at',
    'retrieved_at',
    'checked_at',
    'last_checked_at',
    'updated_at',
    'harvested_at',
  ];
  for (const key of keys) {
    const timestamp = parseTimestamp(record[key]);
    if (timestamp !== null) candidates.push([timestamp, String(record[key])]);
  }
  for (const source of provenance(record)) {
    for (const key of keys) {
      const timestamp = parseTimestamp(source[key]);
      if (timestamp !== null) candidates.push([timestamp, String(source[key])]);
    }
  }
  return candidates;
}

/** @param {AnyObject} record @returns {string | null} */
function freshnessState(record) {
  let freshness = record.freshness;
  if (freshness && typeof freshness === 'object' && !Array.isArray(freshness)) {
    freshness = freshness.state ?? freshness.status;
  }
  let normalized = normalizeText(freshness);
  if (['fresh', 'current', 'verified'].includes(normalized)) return 'fresh';
  if (['stale', 'expired', 'outdated'].includes(normalized)) return 'stale';

  for (const source of provenance(record)) {
    const sourceState = normalizeText(source.freshness);
    if (['stale', 'expired', 'outdated'].includes(sourceState)) return 'stale';
    if (['fresh', 'current', 'verified'].includes(sourceState)) normalized = 'fresh';
  }

  const warnings = [
    ...textValues(record.quality_warnings),
    ...textValues(record.quality_flags),
  ]
    .join(' ')
    .toLowerCase();
  if (warnings.includes('stale') || warnings.includes('outdated')) return 'stale';
  if (canonicalStatus(record.status) === 'stale') return 'stale';
  return normalized || null;
}

/** @param {AnyObject} record @param {number | null} referenceTime */
function freshnessInfo(record, referenceTime) {
  const candidates = timestampCandidates(record);
  const latest = candidates.length
    ? candidates.reduce((best, candidate) => (candidate[0] > best[0] ? candidate : best))
    : null;
  const ageDays = latest && referenceTime !== null
    ? Math.max(0, Math.floor((referenceTime - latest[0]) / 86_400_000))
    : null;

  let state = freshnessState(record);
  if (!state && ageDays !== null) state = ageDays <= 365 ? 'fresh' : 'stale';
  state ??= 'unknown';

  let adjustment = 0;
  const reasons = [];
  if (state === 'fresh') {
    adjustment += 0.04;
    reasons.push('fresh source snapshot');
  } else if (state === 'stale') {
    adjustment -= 0.18;
    reasons.push('stale source penalty');
  } else if (ageDays !== null && ageDays <= 180) {
    adjustment += 0.02;
  }
  if (ageDays !== null && ageDays > 730) adjustment -= 0.08;

  return {
    value: Object.freeze({
      state,
      latestFetchedAt: latest?.[1] ?? null,
      ageDaysAtCatalogGeneration: ageDays,
      sourceCount: provenance(record).length,
    }),
    adjustment,
    reasons,
  };
}

/**
 * @param {{metadata: AnyObject, records: AnyObject[], aliases?: QueryAliases}} input
 */
export function createCatalogIndex({ metadata, records, aliases = {} }) {
  let totalIndexTokens = 0;
  const rows = records.map((record) => {
    const name = String(record.name).trim();
    const aliases = recordAliases(record);
    const tags = recordTags(record);
    const categories = recordCategories(record);
    const description = String(record.description ?? '').trim();
    const aliasesTagsText = [...aliases, ...tags].join(' ');
    const categoriesText = categories.join(' ');
    const searchableTexts = [
      name,
      aliasesTagsText,
      categoriesText,
      description,
    ];
    const searchableLength = searchableTexts.reduce((sum, value) => sum + value.length, 0);
    if (searchableLength > MAX_RECORD_INDEX_CODE_UNITS) {
      throw new SearchIndexLimitError(
        `record search text exceeds ${MAX_RECORD_INDEX_CODE_UNITS} code units`,
      );
    }
    let recordIndexTokens = 0;
    /** @param {any} value */
    const indexTokens = (value) => {
      const tokens = tokenize(value);
      recordIndexTokens += tokens.length;
      totalIndexTokens += tokens.length;
      if (recordIndexTokens > MAX_RECORD_INDEX_TOKENS) {
        throw new SearchIndexLimitError(
          `record search index exceeds ${MAX_RECORD_INDEX_TOKENS} tokens`,
        );
      }
      if (totalIndexTokens > MAX_CATALOG_INDEX_TOKENS) {
        throw new SearchIndexLimitError(
          `catalog search index exceeds ${MAX_CATALOG_INDEX_TOKENS} tokens`,
        );
      }
      return tokens;
    };
    const fields = {
      name: countTokens(indexTokens(name)),
      aliasesTags: countTokens(indexTokens(aliasesTagsText)),
      categories: countTokens(indexTokens(categoriesText)),
      description: countTokens(indexTokens(description)),
    };
    const fieldLengths = Object.fromEntries(
      Object.entries(fields).map(([field, counts]) => [
        field,
        [...counts.values()].reduce((sum, count) => sum + count, 0),
      ]),
    );
    return Object.freeze({
      record,
      name,
      canonicalName: canonicalPhrase(name),
      categoryIdentities: Object.freeze(categories.map((value) => canonicalPhrase(value))),
      fields: Object.freeze(fields),
      fieldLengths: Object.freeze(fieldLengths),
      sourceTiers: Object.freeze(sourceTiers(record)),
    });
  });

  /** @type {Record<string, number>} */
  const averageLengths = {};
  for (const field of Object.keys(FIELD_WEIGHTS)) {
    const sum = rows.reduce((total, row) => total + (row.fieldLengths[field] ?? 0), 0);
    averageLengths[field] = Math.max(1, rows.length ? sum / rows.length : 1);
  }

  const documentFrequencies = new Map();
  for (const row of rows) {
    const present = new Set();
    for (const counts of Object.values(row.fields)) {
      for (const token of counts.keys()) present.add(token);
    }
    for (const token of present) {
      documentFrequencies.set(token, (documentFrequencies.get(token) ?? 0) + 1);
    }
  }

  const generatedAt = parseTimestamp(metadata.generatedAt);
  let referenceTime = generatedAt;
  if (referenceTime === null) {
    const timestamps = records.flatMap((record) => timestampCandidates(record).map(([value]) => value));
    referenceTime = timestamps.length ? Math.max(...timestamps) : null;
  }

  return Object.freeze({
    rows: Object.freeze(rows),
    aliases,
    averageLengths: Object.freeze(averageLengths),
    documentFrequencies,
    referenceTime,
    totalIndexTokens,
  });
}

/** @param {string[]} requested @param {QueryAliases} aliases @returns {CompiledCategoryFilter[]} */
function compileCategoryFilters(requested, aliases) {
  return requested.map((selection) => {
    const expanded = expandQuery(selection, aliases);
    return Object.freeze({
      identity: canonicalPhrase(selection),
      terms: Object.freeze([...expanded.terms]),
    });
  });
}

/** @param {AnyObject} row @param {CompiledCategoryFilter[]} requested */
function matchesCategories(row, requested) {
  if (!requested.length) return true;
  return requested.some((selection) => {
    if (row.categoryIdentities.includes(selection.identity)) return true;
    return selection.terms.some((term) => row.fields.categories.has(term));
  });
}

/** @param {AnyObject} row @param {AnyObject} filters @param {CompiledCategoryFilter[]} categoryFilters */
function matchesFilters(row, filters, categoryFilters) {
  const { record } = row;
  if (!matchesCategories(row, categoryFilters)) return false;
  if (filters.sourceTier !== 'all' && !row.sourceTiers.includes(filters.sourceTier)) return false;
  if (filters.auth !== null && !authTypes(record).includes(filters.auth)) return false;
  if (filters.https !== null && canonicalTriState(record.https) !== filters.https) return false;
  if (filters.cors !== null && canonicalTriState(record.cors) !== filters.cors) return false;
  if (filters.status !== null && canonicalStatus(record.status) !== filters.status) return false;
  return true;
}

/** @param {AnyObject} row @param {AnyObject} expanded @param {AnyObject} index */
function lexicalScore(row, expanded, index) {
  if (!expanded.terms.length) return { score: 0, reasons: [] };

  const presentTerms = new Set();
  for (const counts of Object.values(row.fields)) {
    for (const token of counts.keys()) presentTerms.add(token);
  }
  for (const [term, weight] of expanded.weights.entries()) {
    if (weight === 1 && MANDATORY_DOMAIN_TOKENS.has(term) && !presentTerms.has(term)) {
      return { score: 0, reasons: [] };
    }
  }

  /** @type {string[]} */
  const matchedConcepts = [];
  const conceptTerms = /** @type {Map<string, string[]>} */ (expanded.conceptTerms);
  for (const [concept, terms] of conceptTerms.entries()) {
    if (terms.length && terms.every((term) => presentTerms.has(term))) matchedConcepts.push(concept);
  }
  if (conceptTerms.size >= 2 && matchedConcepts.length < conceptTerms.size) {
    return { score: 0, reasons: [] };
  }

  const k1 = 1.2;
  const b = 0.75;
  let score = 0;
  const contributions = [];
  const documentCount = Math.max(1, index.rows.length);
  for (const term of expanded.terms) {
    const frequency = index.documentFrequencies.get(term) ?? 0;
    const idf = Math.log1p((documentCount - frequency + 0.5) / (frequency + 0.5));
    const queryWeight = expanded.weights.get(term) ?? 0;
    for (const [field, fieldWeight] of Object.entries(FIELD_WEIGHTS)) {
      const termFrequency = row.fields[field].get(term) ?? 0;
      if (!termFrequency) continue;
      const denominator = termFrequency
        + k1 * (1 - b + (b * row.fieldLengths[field]) / index.averageLengths[field]);
      const contribution = fieldWeight
        * queryWeight
        * idf
        * ((termFrequency * (k1 + 1)) / denominator);
      score += contribution;
      contributions.push({ contribution, field, term });
    }
  }

  const queryName = canonicalPhrase(expanded.original);
  const reasons = [];
  if (queryName && row.canonicalName === queryName) {
    score += 14;
    reasons.push('exact name match');
  } else if (queryName && queryName.length >= 3 && row.canonicalName.startsWith(queryName)) {
    score += 7;
    reasons.push('name prefix match');
  } else if (
    row.canonicalName
    && row.canonicalName.length >= 3
    && queryName.startsWith(row.canonicalName)
  ) {
    score += 2;
    reasons.push('query starts with API name');
  }

  contributions.sort((left, right) => (
    right.contribution - left.contribution
    || (FIELD_ORDER.get(left.field) ?? Number.MAX_SAFE_INTEGER)
      - (FIELD_ORDER.get(right.field) ?? Number.MAX_SAFE_INTEGER)
    || compareStrings(left.term, right.term)
  ));
  for (const { field, term } of contributions) {
    const label = field === 'aliasesTags' ? 'aliases/tags' : field;
    const reason = `${label} matches '${term}'`;
    if (!reasons.includes(reason)) reasons.push(reason);
    if (reasons.length >= 6) break;
  }
  if (expanded.matchedAliases.length) {
    reasons.push(`query aliases: ${expanded.matchedAliases.join(', ')}`);
  }
  if (matchedConcepts.length) reasons.push(`concept coverage: ${matchedConcepts.join(', ')}`);
  return { score, reasons };
}

/** @param {string} value */
function normalizedQueryKey(value) {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/gu, '_').replace(/^_+|_+$/gu, '');
}

/** @param {string} normalized */
function isSensitiveQueryKey(normalized) {
  return SENSITIVE_URL_QUERY_KEYS.has(normalized)
    || normalized.endsWith('_api_key')
    || normalized.endsWith('_credential')
    || normalized.endsWith('_secret')
    || normalized.endsWith('_signature')
    || normalized.endsWith('_subscription_key')
    || normalized.endsWith('_token');
}

/** @param {any} value @returns {string | null} */
function safePublicUrl(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    const parsed = new URL(value.trim());
    if (!['http:', 'https:'].includes(parsed.protocol) || !parsed.hostname) return null;
    if (parsed.username || parsed.password) return null;
    const trackingKeys = [];
    for (const key of parsed.searchParams.keys()) {
      const normalized = normalizedQueryKey(key);
      if (isSensitiveQueryKey(normalized)) return null;
      if (normalized.startsWith('utm_')) trackingKeys.push(key);
    }
    for (const key of trackingKeys) parsed.searchParams.delete(key);
    return `${parsed.protocol}//${parsed.host}${parsed.pathname}${parsed.search}`;
  } catch {
    return null;
  }
}

/** @param {AnyObject} record @returns {AnyObject | null} */
function projectOpenApi(record) {
  const value = record.openapi;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  /** @type {AnyObject} */
  const projected = {};
  const specUrl = safePublicUrl(value.spec_url ?? value.url);
  if (specUrl) projected.specUrl = specUrl;
  const stringFields = {
    specification: 'specification',
    specification_version: 'specificationVersion',
    version: 'version',
    api_version: 'apiVersion',
    title: 'title',
  };
  for (const [input, output] of Object.entries(stringFields)) {
    if (typeof value[input] === 'string') projected[output] = value[input];
  }
  const integerFields = { path_count: 'pathCount', operation_count: 'operationCount' };
  for (const [input, output] of Object.entries(integerFields)) {
    if (Number.isInteger(value[input])) projected[output] = value[input];
  }
  if (
    Array.isArray(value.tags)
    && /** @type {any[]} */ (value.tags).every((item) => typeof item === 'string')
  ) {
    projected.tags = [...value.tags];
  }
  if (
    Array.isArray(value.security_schemes)
    && /** @type {any[]} */ (value.security_schemes).every((item) => typeof item === 'string')
  ) {
    projected.securitySchemes = [...value.security_schemes];
  }
  return Object.keys(projected).length ? projected : null;
}

/** @param {number} value */
function roundSix(value) {
  const rounded = Number(value.toFixed(6));
  return Object.is(rounded, -0) ? 0 : rounded;
}

/**
 * @param {AnyObject} row
 * @param {number} score
 * @param {string[]} reasons
 * @param {Freshness} freshness
 * @returns {SearchResponse['results'][number]}
 */
function projectResult(row, score, reasons, freshness) {
  const { record } = row;
  /** @type {SearchResponse['results'][number]} */
  const result = {
    id: String(record.id),
    name: row.name,
    description: String(record.description ?? '').trim(),
    provider: String(record.provider ?? '').trim(),
    categories: recordCategories(record),
    tags: recordTags(record),
    docsUrl: safePublicUrl(record.docs_url) ?? '',
    authTypes: authTypes(record),
    https: canonicalTriState(record.https),
    cors: canonicalTriState(record.cors),
    status: canonicalStatus(record.status),
    sourceTier: row.sourceTiers.length === 1 ? row.sourceTiers[0] : 'merged',
    score: roundSix(score),
    matchReasons: [...reasons],
    freshness,
  };
  const openapi = projectOpenApi(record);
  if (openapi) result.openapi = openapi;
  return result;
}

/** @param {string} left @param {string} right */
function compareStrings(left, right) {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

/** @param {any} args */
function normalizeArguments(args) {
  if (args === null || typeof args !== 'object' || Array.isArray(args)) {
    throw new SearchArgumentError('search arguments must be an object');
  }
  const unknown = Object.keys(args)
    .filter((key) => !SEARCH_ARGUMENT_KEYS.has(key))
    .sort(compareStrings);
  if (unknown.length) {
    throw new SearchArgumentError(`unknown search argument(s): ${unknown.join(', ')}`);
  }
  const query = args.query ?? '';
  if (typeof query !== 'string') throw new SearchArgumentError('query must be a string');
  if (query.length > MAX_QUERY_LENGTH) {
    throw new SearchArgumentError(`query must contain no more than ${MAX_QUERY_LENGTH} characters`);
  }

  const rawCategories = args.categories ?? [];
  if (!Array.isArray(rawCategories)) {
    throw new SearchArgumentError('categories must be an array of strings');
  }
  if (rawCategories.length > MAX_CATEGORIES) {
    throw new SearchArgumentError(`categories must contain no more than ${MAX_CATEGORIES} items`);
  }
  if (rawCategories.some((item) => typeof item !== 'string' || !item.trim())) {
    throw new SearchArgumentError('categories must contain only non-empty strings');
  }
  if (rawCategories.some((item) => item.length > MAX_CATEGORY_LENGTH)) {
    throw new SearchArgumentError(
      `each category must contain no more than ${MAX_CATEGORY_LENGTH} characters`,
    );
  }
  const categories = orderedUnique(rawCategories);

  const sourceTier = args.sourceTier ?? 'all';
  if (!SOURCE_TIERS.has(sourceTier)) {
    throw new SearchArgumentError('sourceTier must be one of: all, public, apilayer');
  }
  const auth = args.auth ?? null;
  if (auth !== null && !AUTH_TYPES.has(auth)) {
    throw new SearchArgumentError(`auth must be one of: ${[...AUTH_TYPES].join(', ')}`);
  }
  const https = args.https ?? null;
  if (https !== null && !TRI_STATES.has(https)) {
    throw new SearchArgumentError('https must be one of: yes, no, unknown');
  }
  const cors = args.cors ?? null;
  if (cors !== null && !TRI_STATES.has(cors)) {
    throw new SearchArgumentError('cors must be one of: yes, no, unknown');
  }
  const status = args.status ?? null;
  if (status !== null && !STATUSES.has(status)) {
    throw new SearchArgumentError(`status must be one of: ${[...STATUSES].join(', ')}`);
  }
  const limit = args.limit ?? 5;
  if (!Number.isInteger(limit) || limit < 1 || limit > 20) {
    throw new SearchArgumentError('limit must be an integer from 1 to 20');
  }

  return Object.freeze({ query, categories, sourceTier, auth, https, cors, status, limit });
}

/** @param {AnyObject} loaded @param {AnyObject} [args] @returns {SearchResponse} */
export function searchCatalog(loaded, args = {}) {
  if (!loaded || typeof loaded !== 'object' || !loaded.index || !loaded.metadata) {
    throw new TypeError('loaded catalog is required');
  }
  const filters = normalizeArguments(args);
  const expanded = expandQuery(filters.query, loaded.aliases);
  if (expanded.terms.length > MAX_EXPANDED_QUERY_TERMS) {
    throw new SearchArgumentError(
      `query expands to more than ${MAX_EXPANDED_QUERY_TERMS} search terms`,
    );
  }
  const categoryFilters = compileCategoryFilters(filters.categories, loaded.aliases);
  const hasNonBlankQuery = filters.query.trim().length > 0;
  const ranked = [];

  for (const row of loaded.index.rows) {
    if (!matchesFilters(row, filters, categoryFilters)) continue;
    const lexical = lexicalScore(row, expanded, loaded.index);
    if (hasNonBlankQuery && lexical.score <= 0) continue;

    const freshness = freshnessInfo(row.record, loaded.index.referenceTime);
    const activeAdjustment = canonicalStatus(row.record.status) === 'active' ? 0.04 : 0;
    const apilayerAdjustment = row.sourceTiers.includes('apilayer') ? 0.005 : 0;
    const score = lexical.score + freshness.adjustment + activeAdjustment + apilayerAdjustment;
    const reasons = [...lexical.reasons, ...freshness.reasons];
    if (activeAdjustment) reasons.push('active product boost');
    ranked.push({
      score,
      apilayer: row.sourceTiers.includes('apilayer') ? 1 : 0,
      normalizedName: normalizeText(row.name),
      id: String(row.record.id),
      result: projectResult(row, score, reasons, freshness.value),
    });
  }

  ranked.sort((left, right) => (
    right.score - left.score
    || right.apilayer - left.apilayer
    || compareStrings(left.normalizedName, right.normalizedName)
    || compareStrings(left.id, right.id)
  ));

  return {
    catalog: {
      version: loaded.metadata.catalogVersion,
      generatedAt: loaded.metadata.generatedAt,
      recordCount: loaded.metadata.recordCount,
      source: loaded.source,
    },
    query: {
      original: filters.query,
      expanded: [...expanded.terms],
      matchedAliases: [...expanded.matchedAliases],
    },
    filters: {
      categories: [...filters.categories],
      sourceTier: filters.sourceTier,
      auth: filters.auth,
      https: filters.https,
      cors: filters.cors,
      status: filters.status,
      limit: filters.limit,
    },
    totalMatches: ranked.length,
    truncated: ranked.length > filters.limit,
    results: ranked.slice(0, filters.limit).map(({ result }) => result),
  };
}

export const SEARCH_ENUMS = Object.freeze({
  auth: Object.freeze([...AUTH_TYPES]),
  triState: Object.freeze([...TRI_STATES]),
  status: Object.freeze([...STATUSES]),
  sourceTier: Object.freeze([...SOURCE_TIERS]),
});
