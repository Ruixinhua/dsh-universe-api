import { closeSync, constants, fstatSync, openSync, readSync, statSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createCatalogIndex, SearchIndexLimitError } from './search.js';

/** @typedef {Record<string, any>} AnyObject */
/**
 * @typedef {object} LoadCatalogOptions
 * @property {string} [bundledPath]
 * @property {string} [catalogPath]
 * @property {string} [aliasesPath]
 */

export const MAX_CATALOG_BYTES = 16 * 1024 * 1024;
export const MAX_CATALOG_RECORDS = 10_000;

const MAX_JSON_DEPTH = 64;
const MAX_JSON_NODES = 250_000;
const MAX_JSON_STRING_CODE_UNITS = 65_536;
const MAX_JSON_OBJECT_KEYS = 1_024;
const MAX_JSON_ARRAY_ITEMS = 20_000;
const MAX_METADATA_LIST_ITEMS = 256;
const MAX_METADATA_STRING_LENGTH = 512;
const MAX_ALIAS_CONCEPTS = 512;
const MAX_ALIAS_SYNONYMS = 128;
const MAX_QUERY_ALIAS_LENGTH = 128;
const MAX_VALIDATION_ERRORS = 100;

export const CATALOG_ENUMS = Object.freeze({
  sourceTier: Object.freeze(['public', 'apilayer']),
  triState: Object.freeze(['yes', 'no', 'unknown']),
  status: Object.freeze(['active', 'coming_soon', 'stale', 'candidate', 'unknown']),
  authType: Object.freeze([
    'none',
    'api_key',
    'oauth2',
    'basic',
    'bearer',
    'signed',
    'user_agent',
    'other',
    'unknown',
  ]),
  authLocation: Object.freeze(['header', 'query', 'cookie', 'unknown']),
});

const SOURCE_TIERS = new Set(CATALOG_ENUMS.sourceTier);
const TRI_STATES = new Set(CATALOG_ENUMS.triState);
const STATUSES = new Set(CATALOG_ENUMS.status);
const AUTH_TYPES = new Set(CATALOG_ENUMS.authType);
const AUTH_LOCATIONS = new Set(CATALOG_ENUMS.authLocation);

const CATALOG_REQUIRED_KEYS = [
  'schema_version',
  'catalog_version',
  'generated_at',
  'records',
];
const RECORD_REQUIRED_KEYS = [
  'id',
  'name',
  'aliases',
  'description',
  'categories',
  'tags',
  'provider',
  'source_tier',
  'docs_url',
  'homepage_url',
  'auth',
  'https',
  'cors',
  'status',
  'openapi',
  'provenance',
  'last_checked_at',
  'quality_flags',
  'rights',
];
const AUTH_KEYS = ['type', 'location', 'name', 'source', 'confidence'];
const OPENAPI_KEYS = [
  'spec_url',
  'specification',
  'specification_version',
  'api_version',
  'title',
  'path_count',
  'operation_count',
  'tags',
  'security_schemes',
];
const PROVENANCE_KEYS = [
  'source_id',
  'source_url',
  'revision',
  'retrieved_at',
  'content_hash',
  'license',
];
const RIGHTS_KEYS = [
  'attribution',
  'license',
  'license_url',
  'terms_url',
  'authorization',
  'community_attribution',
  'community_license',
  'repository_visibility',
  'scope',
  'usage_basis',
  'notes',
];
const SENSITIVE_QUERY_KEYS = new Set([
  'api_key',
  'apikey',
  'access_key',
  'auth',
  'bearer',
  'client_secret',
  'credential',
  'googleaccessid',
  'jwt',
  'key',
  'passwd',
  'private_key',
  'refresh_token',
  'secret_key',
  'security_token',
  'sig',
  'subscription_key',
  'token',
  'access_token',
  'secret',
  'password',
  'signature',
  'authorization',
]);
const RFC3339_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/u;

const DEFAULT_CATALOG_PATH = fileURLToPath(new URL('../data/catalog.json', import.meta.url));
const DEFAULT_ALIASES_PATH = fileURLToPath(new URL('../data/query_aliases.json', import.meta.url));

export class CatalogError extends Error {
  /**
   * @param {string} message
   * @param {ErrorOptions} [options]
   */
  constructor(message, options) {
    super(message, options);
    this.name = 'CatalogError';
  }
}

/** @param {any} value @returns {value is AnyObject} */
function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** @param {string} left @param {string} right */
function compareStrings(left, right) {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

/** @param {AnyObject} value @param {string[]} required @param {string} path @returns {string[]} */
function requiredKeys(value, required, path) {
  return required
    .filter((key) => !Object.hasOwn(value, key))
    .sort(compareStrings)
    .map((key) => `${path}: missing required key '${key}'`);
}

/** @param {AnyObject} value @param {string[]} allowed @param {string} path @returns {string[]} */
function unexpectedKeys(value, allowed, path) {
  const allowedSet = new Set(allowed);
  return Object.keys(value)
    .filter((key) => !allowedSet.has(key))
    .sort(compareStrings)
    .slice(0, MAX_VALIDATION_ERRORS)
    .map((key) => `${path}: unexpected key '${key}'`);
}

/** @param {string} normalized */
function isSensitiveQueryKey(normalized) {
  return SENSITIVE_QUERY_KEYS.has(normalized)
    || normalized.endsWith('_api_key')
    || normalized.endsWith('_credential')
    || normalized.endsWith('_secret')
    || normalized.endsWith('_signature')
    || normalized.endsWith('_subscription_key')
    || normalized.endsWith('_token');
}

/**
 * @param {any} value
 * @param {string} path
 * @param {{nullable?: boolean}} [options]
 * @returns {string[]}
 */
function validateTimestamp(value, path, { nullable = true } = {}) {
  if (value === null && nullable) return [];
  if (typeof value !== 'string' || !RFC3339_RE.test(value) || !Number.isFinite(Date.parse(value))) {
    return [`${path}: must be RFC3339${nullable ? ' or null' : ''}`];
  }
  return [];
}

/** @param {string} value */
function normalizedQueryKey(value) {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/gu, '_').replace(/^_+|_+$/gu, '');
}

/**
 * @param {any} value
 * @param {{httpsOnly?: boolean}} [options]
 * @returns {string | null}
 */
function urlProblem(value, { httpsOnly = false } = {}) {
  if (typeof value !== 'string' || !value || /\s/u.test(value)) {
    return 'must be a non-empty absolute URL without whitespace';
  }
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    return 'must be an absolute HTTP(S) URL';
  }
  if (!['http:', 'https:'].includes(parsed.protocol) || !parsed.hostname) {
    return 'must be an absolute HTTP(S) URL';
  }
  if (httpsOnly && parsed.protocol !== 'https:') return 'must use HTTPS';
  if (parsed.username || parsed.password) return 'must not contain URL userinfo or credentials';
  /** @type {string[]} */
  const sensitive = [];
  for (const key of parsed.searchParams.keys()) {
    const normalized = normalizedQueryKey(key);
    if (isSensitiveQueryKey(normalized) && !sensitive.includes(normalized)) {
      sensitive.push(normalized);
    }
  }
  if (sensitive.length) return `must not contain sensitive query key(s): ${sensitive.sort().join(', ')}`;
  return null;
}

/**
 * @param {any} value
 * @param {string} path
 * @param {{httpsOnly?: boolean}} [options]
 * @returns {string[]}
 */
function validateUrl(value, path, options) {
  const problem = urlProblem(value, options);
  return problem ? [`${path}: ${problem}`] : [];
}

/** @param {string[]} values @returns {string[]} */
function canonicalStringSort(values) {
  return [...values].sort((left, right) => (
    compareStrings(left.toLowerCase(), right.toLowerCase()) || compareStrings(left, right)
  ));
}

/** @param {any} value @param {string} path @returns {string[]} */
function validateStringList(value, path) {
  if (!Array.isArray(value)) return [`${path}: must be an array of strings`];
  if (value.length > MAX_METADATA_LIST_ITEMS) {
    return [`${path}: must contain no more than ${MAX_METADATA_LIST_ITEMS} items`];
  }
  const errors = [];
  const seen = new Set();
  for (let index = 0; index < value.length; index += 1) {
    const item = value[index];
    if (typeof item !== 'string' || !item.trim()) {
      errors.push(`${path}[${index}]: must be a non-empty string`);
      continue;
    }
    if (item.length > MAX_METADATA_STRING_LENGTH) {
      errors.push(`${path}[${index}]: must contain no more than ${MAX_METADATA_STRING_LENGTH} characters`);
      continue;
    }
    if (item !== item.trim()) errors.push(`${path}[${index}]: must not have surrounding whitespace`);
    const key = item.trim().toLowerCase();
    if (seen.has(key)) errors.push(`${path}[${index}]: duplicate value`);
    seen.add(key);
  }
  if (
    value.every((item) => typeof item === 'string' && item.trim())
    && JSON.stringify(value) !== JSON.stringify(canonicalStringSort(value))
  ) {
    errors.push(`${path}: values must be unique and canonically sorted`);
  }
  return errors;
}

/** @param {any} value @param {string} path @returns {string[]} */
function validateAuth(value, path) {
  if (!Array.isArray(value)) return [`${path}: must be an array`];
  if (!value.length) return [`${path}: must contain at least one auth entry`];
  if (value.length > 64) return [`${path}: must contain no more than 64 entries`];
  const errors = [];
  const types = [];
  const identities = new Set();
  for (let index = 0; index < value.length; index += 1) {
    const entryPath = `${path}[${index}]`;
    const entry = value[index];
    if (!isPlainObject(entry)) {
      errors.push(`${entryPath}: must be an object`);
      continue;
    }
    errors.push(...requiredKeys(entry, AUTH_KEYS, entryPath));
    errors.push(...unexpectedKeys(entry, AUTH_KEYS, entryPath).map(
      (error) => `${error}; credential values are forbidden`,
    ));
    types.push(entry.type);
    if (!AUTH_TYPES.has(entry.type)) errors.push(`${entryPath}.type: invalid auth type`);
    if (!AUTH_LOCATIONS.has(entry.location)) errors.push(`${entryPath}.location: invalid auth location`);
    if (typeof entry.name !== 'string') errors.push(`${entryPath}.name: must be a string`);
    if (typeof entry.source !== 'string') errors.push(`${entryPath}.source: must be a string`);
    if (
      typeof entry.confidence !== 'number'
      || !Number.isFinite(entry.confidence)
      || entry.confidence < 0
      || entry.confidence > 1
    ) {
      errors.push(`${entryPath}.confidence: must be a number from 0 to 1`);
    }
    const identity = JSON.stringify([
      entry.type,
      entry.location,
      String(entry.name ?? '').toLowerCase(),
      String(entry.source ?? '').toLowerCase(),
      entry.confidence,
    ]);
    if (identities.has(identity)) errors.push(`${entryPath}: duplicate auth entry`);
    identities.add(identity);
  }
  if (types.includes('none') && types.length > 1) {
    errors.push(`${path}: auth type 'none' cannot be combined with other entries`);
  }
  return errors;
}

/** @param {AnyObject} value @param {string} path @returns {string[]} */
function validateOpenApi(value, path) {
  const errors = requiredKeys(value, OPENAPI_KEYS, path);
  errors.push(...unexpectedKeys(value, OPENAPI_KEYS, path).map(
    (error) => `${error}; raw OpenAPI documents are forbidden`,
  ));
  errors.push(...validateUrl(value.spec_url, `${path}.spec_url`));
  if (!['openapi', 'swagger'].includes(value.specification)) {
    errors.push(`${path}.specification: must be 'openapi' or 'swagger'`);
  }
  for (const key of ['specification_version', 'api_version', 'title']) {
    if (typeof value[key] !== 'string') errors.push(`${path}.${key}: must be a string`);
  }
  for (const key of ['path_count', 'operation_count']) {
    if (!Number.isInteger(value[key]) || value[key] < 0) {
      errors.push(`${path}.${key}: must be a non-negative integer`);
    }
  }
  errors.push(...validateStringList(value.tags, `${path}.tags`));
  errors.push(...validateStringList(value.security_schemes, `${path}.security_schemes`));
  return errors;
}

/** @param {any} value @param {string} path @returns {string[]} */
function validateProvenance(value, path) {
  if (!Array.isArray(value)) return [`${path}: must be an array`];
  if (!value.length) return [`${path}: must contain at least one source`];
  if (value.length > 64) return [`${path}: must contain no more than 64 sources`];
  const errors = [];
  const identities = new Set();
  for (let index = 0; index < value.length; index += 1) {
    const entryPath = `${path}[${index}]`;
    const entry = value[index];
    if (!isPlainObject(entry)) {
      errors.push(`${entryPath}: must be an object`);
      continue;
    }
    errors.push(...requiredKeys(entry, PROVENANCE_KEYS, entryPath));
    errors.push(...unexpectedKeys(entry, PROVENANCE_KEYS, entryPath));
    if (typeof entry.source_id !== 'string' || !entry.source_id.trim()) {
      errors.push(`${entryPath}.source_id: must be a non-empty string`);
    }
    errors.push(...validateUrl(entry.source_url, `${entryPath}.source_url`, { httpsOnly: true }));
    if (entry.revision !== null && typeof entry.revision !== 'string') {
      errors.push(`${entryPath}.revision: must be a string or null`);
    }
    errors.push(...validateTimestamp(entry.retrieved_at, `${entryPath}.retrieved_at`));
    if (typeof entry.content_hash !== 'string' || !entry.content_hash.trim()) {
      errors.push(`${entryPath}.content_hash: must be a non-empty string`);
    }
    if (
      entry.license !== null
      && typeof entry.license !== 'string'
      && !isPlainObject(entry.license)
    ) {
      errors.push(`${entryPath}.license: must be a string, object, or null`);
    }
    const identity = JSON.stringify([
      entry.source_id,
      entry.source_url,
      entry.revision,
      entry.content_hash,
    ]);
    if (identities.has(identity)) errors.push(`${entryPath}: duplicate provenance entry`);
    identities.add(identity);
  }
  return errors;
}

/** @param {any} value */
function identityLabel(value) {
  const normalized = String(value)
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[\p{Mark}]/gu, '')
    .replace(/[^\p{Letter}\p{Number}]+/gu, '-')
    .replace(/^-+|-+$/gu, '');
  const withoutGenericWords = normalized
    .split('-')
    .filter((part) => part && !['api', 'service'].includes(part))
    .join('-');
  return withoutGenericWords || normalized;
}

/** @param {any} value @returns {string | null} */
function canonicalUrlIdentity(value) {
  try {
    const parsed = new URL(value);
    parsed.hash = '';
    const path = parsed.pathname || '/';
    return `${parsed.protocol}//${parsed.host}${path}${parsed.search}`.toLowerCase();
  } catch {
    return null;
  }
}

/** @param {any} record @param {number} index @returns {string[]} */
function validateRecord(record, index) {
  const path = `records[${index}]`;
  if (!isPlainObject(record)) return [`${path}: must be an object`];
  const errors = [
    ...requiredKeys(record, RECORD_REQUIRED_KEYS, path),
    ...unexpectedKeys(record, RECORD_REQUIRED_KEYS, path),
  ];
  for (const key of ['id', 'name', 'provider']) {
    if (typeof record[key] !== 'string' || !record[key].trim()) {
      errors.push(`${path}.${key}: must be a non-empty string`);
    } else if (record[key].length > 512) {
      errors.push(`${path}.${key}: must contain no more than 512 characters`);
    }
  }
  if (typeof record.description !== 'string') {
    errors.push(`${path}.description: must be a string`);
  } else if (record.description.length > 8_192) {
    errors.push(`${path}.description: must contain no more than 8192 characters`);
  }
  for (const key of ['aliases', 'categories', 'tags', 'quality_flags']) {
    errors.push(...validateStringList(record[key], `${path}.${key}`));
  }
  if (!SOURCE_TIERS.has(record.source_tier)) errors.push(`${path}.source_tier: invalid source tier`);
  errors.push(...validateUrl(record.docs_url, `${path}.docs_url`));
  errors.push(...validateUrl(record.homepage_url, `${path}.homepage_url`));
  if (!TRI_STATES.has(record.https)) errors.push(`${path}.https: invalid tri-state`);
  if (!TRI_STATES.has(record.cors)) errors.push(`${path}.cors: invalid tri-state`);
  if (!STATUSES.has(record.status)) errors.push(`${path}.status: invalid status`);
  errors.push(...validateAuth(record.auth, `${path}.auth`));
  if (record.openapi !== null && !isPlainObject(record.openapi)) {
    errors.push(`${path}.openapi: must be an object or null`);
  } else if (isPlainObject(record.openapi)) {
    errors.push(...validateOpenApi(record.openapi, `${path}.openapi`));
  }
  errors.push(...validateTimestamp(record.last_checked_at, `${path}.last_checked_at`));
  errors.push(...validateProvenance(record.provenance, `${path}.provenance`));
  if (!isPlainObject(record.rights)) {
    errors.push(`${path}.rights: must be an object`);
  } else {
    errors.push(...unexpectedKeys(record.rights, RIGHTS_KEYS, `${path}.rights`));
    for (const [key, value] of Object.entries(record.rights)) {
      if (value !== null && typeof value !== 'string') {
        errors.push(`${path}.rights.${key}: must be a string or null`);
        continue;
      }
      if (typeof value === 'string' && value.length > 4_096) {
        errors.push(`${path}.rights.${key}: must contain no more than 4096 characters`);
      }
      if (['license_url', 'terms_url'].includes(key) && value !== null) {
        errors.push(...validateUrl(value, `${path}.rights.${key}`));
      }
    }
  }
  return errors;
}

/** @param {any} payload @returns {string[]} */
export function validateCatalog(payload) {
  if (!isPlainObject(payload)) return ['catalog: root must be an object'];
  const errors = [
    ...requiredKeys(payload, CATALOG_REQUIRED_KEYS, 'catalog'),
    ...unexpectedKeys(payload, CATALOG_REQUIRED_KEYS, 'catalog'),
  ];
  const boundedErrors = () => [
    ...errors.slice(0, MAX_VALIDATION_ERRORS),
    `catalog: validation stopped after ${MAX_VALIDATION_ERRORS} errors`,
  ];
  if (payload.schema_version !== 1 || typeof payload.schema_version !== 'number') {
    errors.push('catalog.schema_version: must equal 1');
  }
  if (typeof payload.catalog_version !== 'string' || !payload.catalog_version.trim()) {
    errors.push('catalog.catalog_version: must be a non-empty string');
  }
  errors.push(...validateTimestamp(payload.generated_at, 'catalog.generated_at'));
  if (errors.length >= MAX_VALIDATION_ERRORS) return boundedErrors();
  if (!Array.isArray(payload.records)) {
    errors.push('catalog.records: must be an array');
    return errors;
  }
  if (payload.records.length > MAX_CATALOG_RECORDS) {
    errors.push(`catalog.records: must contain no more than ${MAX_CATALOG_RECORDS} records`);
    return errors;
  }

  for (let index = 0; index < payload.records.length; index += 1) {
    errors.push(...validateRecord(payload.records[index], index));
    if (errors.length >= MAX_VALIDATION_ERRORS) {
      return boundedErrors();
    }
  }

  const ids = payload.records.map((record) => (isPlainObject(record) ? record.id : undefined));
  if (ids.every((id) => typeof id === 'string')) {
    const sorted = [...ids].sort(compareStrings);
    if (JSON.stringify(ids) !== JSON.stringify(sorted)) {
      errors.push('catalog.records: records must be sorted by id');
    }
    const seen = new Set();
    for (let index = 0; index < ids.length; index += 1) {
      const id = ids[index];
      if (seen.has(id)) errors.push(`records[${index}].id: duplicate id`);
      seen.add(id);
      if (errors.length >= MAX_VALIDATION_ERRORS) return boundedErrors();
    }
  }

  const identities = new Map();
  for (let index = 0; index < payload.records.length; index += 1) {
    const record = payload.records[index];
    if (!isPlainObject(record)) continue;
    const provider = typeof record.provider === 'string' ? identityLabel(record.provider) : '';
    const names = [record.name, ...(Array.isArray(record.aliases) ? record.aliases : [])];
    const tokens = [];
    if (provider) {
      for (const name of names) {
        if (typeof name === 'string' && name.trim()) {
          tokens.push(`provider-name:${provider}:${identityLabel(name)}`);
        }
      }
    }
    const docs = canonicalUrlIdentity(record.docs_url);
    if (docs) tokens.push(`docs:${docs}`);
    for (const token of new Set(tokens)) {
      if (identities.has(token)) {
        const kind = token.startsWith('docs:') ? 'canonical docs URL' : 'semantic identity';
        errors.push(`records[${index}].id: duplicate ${kind}; records must be merged`);
        if (errors.length >= MAX_VALIDATION_ERRORS) return boundedErrors();
      } else {
        identities.set(token, index);
      }
    }
  }
  return errors;
}

/**
 * Scan one JSON document before `JSON.parse` so duplicate keys and hostile
 * nesting cannot be hidden by the native parser's last-key-wins behavior.
 *
 * @param {string} text
 * @param {string} label
 */
function scanJsonDocument(text, label) {
  let index = 0;
  let nodes = 0;

  /** @param {string} reason */
  function fail(reason) {
    throw new CatalogError(`${label} is not valid JSON: ${reason}`);
  }

  function skipWhitespace() {
    while (index < text.length && /[\t\n\r ]/u.test(text.charAt(index))) index += 1;
  }

  /** @param {boolean} decode */
  function scanString(decode) {
    const start = index;
    index += 1;
    while (index < text.length) {
      const character = text.charAt(index);
      index += 1;
      if (character === '"') {
        const raw = text.slice(start, index);
        if (raw.length > MAX_JSON_STRING_CODE_UNITS + 2) fail('string value is too long');
        if (!decode) return '';
        try {
          return JSON.parse(raw);
        } catch {
          fail('invalid object key string');
        }
      }
      if (character === '\\') {
        if (index >= text.length) fail('unterminated string escape');
        const escape = text.charAt(index);
        index += 1;
        if (escape === 'u') {
          const code = text.slice(index, index + 4);
          if (!/^[0-9a-fA-F]{4}$/u.test(code)) fail('invalid unicode escape');
          index += 4;
        } else if (!'"\\/bfnrt'.includes(escape)) {
          fail('invalid string escape');
        }
      } else if (character.charCodeAt(0) < 0x20) {
        fail('unescaped control character in string');
      }
    }
    fail('unterminated string');
  }

  /** @param {number} depth */
  function scanValue(depth) {
    skipWhitespace();
    if (depth > MAX_JSON_DEPTH) fail(`nesting exceeds ${MAX_JSON_DEPTH}`);
    if (index >= text.length) fail('missing value');
    nodes += 1;
    if (nodes > MAX_JSON_NODES) fail(`node count exceeds ${MAX_JSON_NODES}`);

    const character = text.charAt(index);
    if (character === '{') {
      scanObject(depth);
      return;
    }
    if (character === '[') {
      scanArray(depth);
      return;
    }
    if (character === '"') {
      scanString(false);
      return;
    }

    const start = index;
    while (index < text.length && !/[\t\n\r ,\]}]/u.test(text.charAt(index))) index += 1;
    if (start === index) fail('invalid scalar value');
    try {
      const scalar = JSON.parse(text.slice(start, index));
      if (scalar !== null && !['boolean', 'number'].includes(typeof scalar)) {
        fail('invalid scalar value');
      }
    } catch (error) {
      if (error instanceof CatalogError) throw error;
      fail('invalid scalar value');
    }
  }

  /** @param {number} depth */
  function scanObject(depth) {
    index += 1;
    skipWhitespace();
    if (text[index] === '}') {
      index += 1;
      return;
    }
    const keys = new Set();
    let items = 0;
    while (index < text.length) {
      skipWhitespace();
      if (text[index] !== '"') fail('object key must be a string');
      const key = scanString(true);
      if (keys.has(key)) fail('duplicate object key');
      keys.add(key);
      items += 1;
      if (items > MAX_JSON_OBJECT_KEYS) {
        fail(`object contains more than ${MAX_JSON_OBJECT_KEYS} keys`);
      }
      skipWhitespace();
      if (text[index] !== ':') fail('object key must be followed by a colon');
      index += 1;
      scanValue(depth + 1);
      skipWhitespace();
      if (text[index] === '}') {
        index += 1;
        return;
      }
      if (text[index] !== ',') fail('object entries must be comma-separated');
      index += 1;
    }
    fail('unterminated object');
  }

  /** @param {number} depth */
  function scanArray(depth) {
    index += 1;
    skipWhitespace();
    if (text[index] === ']') {
      index += 1;
      return;
    }
    let items = 0;
    while (index < text.length) {
      scanValue(depth + 1);
      items += 1;
      if (items > MAX_JSON_ARRAY_ITEMS) {
        fail(`array contains more than ${MAX_JSON_ARRAY_ITEMS} items`);
      }
      skipWhitespace();
      if (text[index] === ']') {
        index += 1;
        return;
      }
      if (text[index] !== ',') fail('array items must be comma-separated');
      index += 1;
    }
    fail('unterminated array');
  }

  scanValue(0);
  skipWhitespace();
  if (index !== text.length) fail('unexpected trailing content');
}

/** @param {Uint8Array} bytes @param {string} label @returns {any} */
function parseJson(bytes, label) {
  let text;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch (error) {
    throw new CatalogError(`${label} is not valid UTF-8`, { cause: error });
  }
  scanJsonDocument(text, label);
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new CatalogError(`${label} is not valid JSON`, { cause: error });
  }
}

/** @param {string} path @param {string} label @returns {any} */
function readJsonFile(path, label) {
  let pathStats;
  try {
    pathStats = statSync(path);
  } catch (error) {
    throw new CatalogError(`${label} cannot be read`, { cause: error });
  }
  if (!pathStats.isFile()) throw new CatalogError(`${label} must be a regular file`);

  let descriptor;
  try {
    const flags = constants.O_RDONLY
      | (typeof constants.O_NONBLOCK === 'number' ? constants.O_NONBLOCK : 0);
    descriptor = openSync(path, flags);
  } catch (error) {
    throw new CatalogError(`${label} cannot be read`, { cause: error });
  }
  try {
    const stats = fstatSync(descriptor);
    if (!stats.isFile()) throw new CatalogError(`${label} must be a regular file`);
    if (stats.dev !== pathStats.dev || stats.ino !== pathStats.ino) {
      throw new CatalogError(`${label} changed while it was being opened`);
    }
    if (stats.size > MAX_CATALOG_BYTES) {
      throw new CatalogError(`${label} exceeds the 16 MiB size limit`);
    }
    const capacity = Math.min(stats.size + 1, MAX_CATALOG_BYTES + 1);
    const bytes = Buffer.allocUnsafe(capacity);
    let offset = 0;
    while (offset < capacity) {
      const count = readSync(descriptor, bytes, offset, capacity - offset, null);
      if (count === 0) break;
      offset += count;
    }
    if (offset > MAX_CATALOG_BYTES) {
      throw new CatalogError(`${label} exceeds the 16 MiB size limit`);
    }
    if (offset !== stats.size) {
      throw new CatalogError(`${label} changed while it was being read`);
    }
    return parseJson(bytes.subarray(0, offset), label);
  } catch (error) {
    if (error instanceof CatalogError) throw error;
    throw new CatalogError(`${label} cannot be read`, { cause: error });
  } finally {
    closeSync(descriptor);
  }
}

/**
 * @param {string} path
 * @param {{optional: boolean}} options
 * @returns {Readonly<Record<string, string[]>>}
 */
function loadAliases(path, { optional }) {
  let payload;
  try {
    payload = readJsonFile(path, 'Query aliases file');
  } catch (error) {
    const cause = error instanceof CatalogError
      ? /** @type {NodeJS.ErrnoException | undefined} */ (error.cause)
      : undefined;
    if (optional && cause?.code === 'ENOENT') return Object.freeze({});
    throw error;
  }
  const aliases = isPlainObject(payload) && Object.hasOwn(payload, 'aliases')
    ? payload.aliases
    : payload;
  if (!isPlainObject(aliases)) throw new CatalogError('Query aliases must be a JSON object');
  if (Object.keys(aliases).length > MAX_ALIAS_CONCEPTS) {
    throw new CatalogError(`Query aliases must contain no more than ${MAX_ALIAS_CONCEPTS} concepts`);
  }
  /** @type {Record<string, string[]>} */
  const result = {};
  for (const [concept, synonyms] of Object.entries(aliases)) {
    if (!concept.trim() || !Array.isArray(synonyms)) {
      throw new CatalogError('Query aliases contain an invalid concept');
    }
    if (concept.length > MAX_QUERY_ALIAS_LENGTH || synonyms.length > MAX_ALIAS_SYNONYMS) {
      throw new CatalogError('Query aliases exceed the supported bounds');
    }
    if (synonyms.some((item) => typeof item !== 'string' || !item.trim())) {
      throw new CatalogError('Query aliases must contain only non-empty strings');
    }
    if (synonyms.some((item) => item.length > MAX_QUERY_ALIAS_LENGTH)) {
      throw new CatalogError('Query aliases contain an overlong synonym');
    }
    result[concept] = [...synonyms];
  }
  return deepFreeze(result);
}

/** @param {any} value @returns {any} */
function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

/** @param {any} payload @param {string} label */
function assertValidCatalog(payload, label) {
  const errors = validateCatalog(payload);
  if (!errors.length) return;
  const visible = errors.slice(0, 20).join('; ');
  const remainder = errors.length > 20 ? `; and ${errors.length - 20} more error(s)` : '';
  throw new CatalogError(`${label} failed canonical catalog v1 validation: ${visible}${remainder}`);
}

/**
 * @param {string} path
 * @param {'bundled-public' | 'external'} source
 * @param {string} aliasesPath
 * @param {boolean} aliasesOptional
 */
function loadCatalogFile(path, source, aliasesPath, aliasesOptional) {
  const label = source === 'external' ? 'External catalog' : 'Bundled catalog';
  const payload = readJsonFile(path, label);
  assertValidCatalog(payload, label);
  const aliases = loadAliases(aliasesPath, { optional: aliasesOptional });
  const records = deepFreeze(
    /** @type {AnyObject[]} */ (payload.records).map((record) => ({ ...record })),
  );
  const metadata = Object.freeze({
    schemaVersion: 1,
    catalogVersion: payload.catalog_version,
    generatedAt: payload.generated_at,
    recordCount: records.length,
  });
  let index;
  try {
    index = createCatalogIndex({ metadata, records, aliases });
  } catch (error) {
    if (error instanceof SearchIndexLimitError) {
      throw new CatalogError(`Catalog cannot be indexed safely: ${error.message}`, { cause: error });
    }
    throw error;
  }
  return Object.freeze({ metadata, records, aliases, index, source });
}

/**
 * Read, validate, and index exactly one catalog snapshot.
 *
 * An explicitly configured external catalog replaces the bundled snapshot. It
 * never falls back to the bundled data after a read or validation failure.
 *
 * @param {LoadCatalogOptions} [options]
 */
export function loadCatalog({
  bundledPath = DEFAULT_CATALOG_PATH,
  catalogPath,
  aliasesPath = DEFAULT_ALIASES_PATH,
} = {}) {
  const resolvedAliases = resolve(aliasesPath);
  if (catalogPath !== undefined && catalogPath !== null && catalogPath !== '') {
    if (typeof catalogPath !== 'string' || !isAbsolute(catalogPath)) {
      throw new CatalogError('catalogPath must be an absolute path');
    }
    return loadCatalogFile(catalogPath, 'external', resolvedAliases, aliasesPath === DEFAULT_ALIASES_PATH);
  }
  return loadCatalogFile(resolve(bundledPath), 'bundled-public', resolvedAliases, aliasesPath === DEFAULT_ALIASES_PATH);
}

/** @param {LoadCatalogOptions} [options] */
export function loadBundledCatalog(options = {}) {
  return loadCatalog(options);
}

/** @param {string} catalogPath @param {LoadCatalogOptions} [options] */
export function loadCatalogFromPath(catalogPath, options = {}) {
  return loadCatalog({ ...options, catalogPath });
}
