const PACKAGE_NAME = 'dsh-universe-api'
const REPOSITORY_PATH = '/Ruixinhua/dsh-universe-api'
const PACKAGE_NAME_RE = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/u
const EXACT_VERSION_RE = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/u
const FORBIDDEN_LIFECYCLE_SCRIPTS = [
  'preinstall',
  'install',
  'postinstall',
  'prepare',
  'prepack',
  'postpack',
  'prepublish',
  'prepublishOnly',
  'publish',
  'postpublish',
]

/** @typedef {'next' | 'latest'} ReleaseChannel */

/** @param {unknown} condition @param {string} message @returns {asserts condition} */
function invariant(condition, message) {
  if (!condition) throw new Error(message)
}

/** @param {unknown} value @returns {value is Record<string, any>} */
function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/**
 * Parse the exact SemVer subset accepted by this project. Build metadata is
 * intentionally rejected so a tag, package manifest, and registry version
 * always have one byte-for-byte identity.
 *
 * @param {unknown} version
 */
export function parseExactVersion(version) {
  invariant(typeof version === 'string', 'package version must be a string')
  const match = EXACT_VERSION_RE.exec(version)
  invariant(match, `package version must be an exact SemVer without build metadata: ${String(version)}`)
  const prerelease = match[4]
  if (prerelease !== undefined) {
    for (const identifier of prerelease.split('.')) {
      invariant(!/^0\d+$/u.test(identifier), `numeric prerelease identifier has a leading zero: ${identifier}`)
    }
  }
  return Object.freeze({
    version,
    prerelease: prerelease ?? null,
  })
}

/** @param {unknown} version @param {ReleaseChannel} channel */
export function assertReleaseChannel(version, channel) {
  const parsed = parseExactVersion(version)
  invariant(channel === 'next' || channel === 'latest', `unsupported release channel: ${String(channel)}`)
  if (channel === 'latest') {
    invariant(parsed.prerelease === null, 'latest channel requires an exact stable version')
  } else {
    invariant(
      typeof parsed.prerelease === 'string' && /^rc\.(0|[1-9]\d*)$/u.test(parsed.prerelease),
      'next channel requires an rc.N prerelease version',
    )
  }
  return parsed
}

/** @param {unknown} tag @param {unknown} version */
export function assertTagMatchesVersion(tag, version) {
  const parsed = parseExactVersion(version)
  invariant(tag === `v${parsed.version}`, `tag ${String(tag)} does not match package version ${parsed.version}`)
  if (parsed.prerelease !== null) {
    invariant(/^rc\.(0|[1-9]\d*)$/u.test(parsed.prerelease), 'release tags only support rc.N prereleases')
  }
  return parsed
}

/** @param {unknown} patch */
export function normalizeBundlePatch(patch) {
  invariant(typeof patch === 'string', 'dsh.bundle.patch must be a string')
  invariant(patch.length >= 1 && patch.length <= 512, 'dsh.bundle.patch must contain 1 through 512 characters')
  invariant(!patch.includes('\0'), 'dsh.bundle.patch must not contain NUL')
  invariant(!patch.includes('\\'), 'dsh.bundle.patch must use forward slashes')
  const normalized = patch.startsWith('./') ? patch.slice(2) : patch
  invariant(normalized.length > 0 && !normalized.startsWith('/'), 'dsh.bundle.patch must be a relative path')
  const segments = normalized.split('/')
  invariant(
    segments.every(segment => segment.length > 0 && segment !== '.' && segment !== '..' && !segment.includes(':')),
    'dsh.bundle.patch contains an unsafe path segment',
  )
  return normalized
}

/** @param {unknown} repository */
function assertRepository(repository) {
  invariant(isObject(repository), 'repository must be an object')
  invariant(repository.type === 'git', 'repository.type must equal git')
  invariant(typeof repository.url === 'string', 'repository.url must be a string')
  const rawUrl = repository.url.startsWith('git+') ? repository.url.slice(4) : repository.url
  let parsed
  try {
    parsed = new URL(rawUrl)
  } catch {
    throw new Error('repository.url must be an absolute URL')
  }
  invariant(parsed.protocol === 'https:', 'repository.url must use HTTPS')
  invariant(parsed.hostname === 'github.com' && parsed.port === '', 'repository.url must use github.com')
  invariant(!parsed.username && !parsed.password, 'repository.url must not contain credentials')
  invariant(!parsed.search && !parsed.hash, 'repository.url must not contain query or fragment data')
  const path = parsed.pathname.replace(/\.git$/u, '').replace(/\/$/u, '')
  invariant(path === REPOSITORY_PATH, `repository.url must point to github.com${REPOSITORY_PATH}`)
}

/**
 * Validate the local shipping policy. Only package identity, stable latest,
 * and a safe bundle patch are DSH Desktop Market eligibility requirements;
 * the remaining checks are deliberately stricter project policy.
 *
 * @param {any} manifest
 * @param {{channel: ReleaseChannel, packedFiles?: Iterable<string>}} options
 */
export function assertProjectManifest(manifest, { channel, packedFiles } = { channel: 'next' }) {
  invariant(isObject(manifest), 'package manifest must be an object')
  invariant(typeof manifest.name === 'string' && PACKAGE_NAME_RE.test(manifest.name), 'package name is invalid')
  invariant(manifest.name === PACKAGE_NAME, `package name must equal ${PACKAGE_NAME}`)
  assertReleaseChannel(manifest.version, channel)
  invariant(manifest.private !== true, 'package must be public')
  invariant(manifest.type === 'module' && manifest.main === 'index.js', 'package must expose the ESM entrypoint')
  invariant(manifest.engines?.node === '^22.19.0 || >=24.0.0', 'Node engine support changed unexpectedly')
  assertRepository(manifest.repository)

  invariant(manifest.publishConfig?.registry === 'https://registry.npmjs.org/', 'publishConfig.registry must use the official npm registry')
  invariant(manifest.publishConfig?.access === 'public', 'publishConfig.access must equal public')
  invariant(manifest.publishConfig?.provenance !== false, 'npm provenance must not be disabled')

  const runtimeDependencies = Object.keys(manifest.dependencies ?? {})
  invariant(runtimeDependencies.length === 0, `runtime dependencies are forbidden: ${runtimeDependencies.join(', ')}`)
  invariant(manifest.peerDependencies?.['@deepseek-ai/cordis'] === '^4.0.1', 'Cordis peer range changed unexpectedly')
  invariant(
    manifest.peerDependencies?.['@deepseek-ai/dsh-tools'] === '>=0.1.1-rc.2 <0.2.0',
    'DSH tools peer range changed unexpectedly',
  )
  invariant(manifest.peerDependencies?.['@deepseek-ai/schemastery'] === '^3.18.1', 'Schemastery peer range changed unexpectedly')
  invariant(manifest.devDependencies?.['@deepseek-ai/schemastery'] === '3.18.1', 'Schemastery development version must be exact')

  for (const script of FORBIDDEN_LIFECYCLE_SCRIPTS) {
    invariant(manifest.scripts?.[script] === undefined, `forbidden npm lifecycle script: ${script}`)
  }

  const patchPath = normalizeBundlePatch(manifest.dsh?.bundle?.patch)
  invariant(manifest.exports?.['.'] === './index.js', 'package root export must resolve to index.js')
  invariant(manifest.exports?.['./cordis.patch.yml'] === './cordis.patch.yml', 'bundle patch export is missing')
  invariant(manifest.exports?.['./package.json'] === './package.json', 'package.json export is missing')

  if (packedFiles !== undefined) {
    const files = new Set(packedFiles)
    for (const required of ['index.js', patchPath, 'data/catalog.json', 'data/query_aliases.json', 'package.json']) {
      invariant(files.has(required), `packed artifact is missing ${required}`)
    }
  }
  return Object.freeze({ patchPath })
}

/** @param {any} lockfile @param {any} manifest */
export function assertLockfileMatchesManifest(lockfile, manifest) {
  invariant(lockfile?.name === manifest.name, 'package-lock name does not match package.json')
  invariant(lockfile?.version === manifest.version, 'package-lock version does not match package.json')
  invariant(lockfile?.packages?.['']?.name === manifest.name, 'package-lock root name does not match package.json')
  invariant(lockfile?.packages?.['']?.version === manifest.version, 'package-lock root version does not match package.json')
}

/**
 * Validate the official npm latest response after publication. The integrity
 * equality is project policy layered on top of the Desktop Market boundary.
 *
 * @param {any} manifest
 * @param {{expectedVersion: string, expectedIntegrity: string}} expected
 */
export function assertRegistryManifest(manifest, { expectedVersion, expectedIntegrity }) {
  invariant(isObject(manifest), 'registry manifest must be an object')
  invariant(manifest.name === PACKAGE_NAME, `registry package name must equal ${PACKAGE_NAME}`)
  assertReleaseChannel(manifest.version, 'latest')
  invariant(manifest.version === expectedVersion, 'registry latest version does not match the promoted version')
  normalizeBundlePatch(manifest.dsh?.bundle?.patch)
  invariant(manifest.dist?.integrity === expectedIntegrity, 'registry tarball integrity does not match the accepted Release asset')
}

export { FORBIDDEN_LIFECYCLE_SCRIPTS, PACKAGE_NAME }
