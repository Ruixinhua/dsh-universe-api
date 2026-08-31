import {
  assertRegistryManifest,
  assertRegistryPackageManifest,
  assertReleaseChannel,
  compareExactVersions,
} from './release-gates.mjs'

/** @param {unknown} condition @param {string} message @returns {asserts condition} */
function invariant(condition, message) {
  if (!condition) throw new Error(message)
}

/**
 * Plan a stable npm promotion without mutating registry state. npm may create a
 * prerelease `latest` tag when a package is first published under `next`; that
 * observable state is valid input, but the target itself must remain stable.
 *
 * @param {{
 *   expectedVersion: string,
 *   expectedIntegrity: string,
 *   latestManifest: any | null,
 *   exactManifest: any | null,
 * }} input
 */
export function planRegistryPromotion({
  expectedVersion,
  expectedIntegrity,
  latestManifest,
  exactManifest,
}) {
  assertReleaseChannel(expectedVersion, 'latest')

  if (latestManifest === null) {
    invariant(exactManifest === null, 'target stable version already exists without being npm latest')
    return Object.freeze({ state: 'publish', currentLatest: '', version: expectedVersion })
  }

  const latest = assertRegistryPackageManifest(latestManifest, { requireStable: false })
  const comparison = compareExactVersions(expectedVersion, latest.version)
  invariant(
    comparison >= 0,
    `refusing to move npm latest backwards from ${latest.version} to ${expectedVersion}`,
  )

  if (comparison === 0) {
    assertRegistryManifest(latestManifest, { expectedVersion, expectedIntegrity })
    return Object.freeze({ state: 'already-published', currentLatest: latest.version, version: expectedVersion })
  }

  if (exactManifest !== null) {
    assertRegistryManifest(exactManifest, { expectedVersion, expectedIntegrity })
    throw new Error('target stable version already exists but is not npm latest; refusing an ambiguous re-publish')
  }

  return Object.freeze({ state: 'publish', currentLatest: latest.version, version: expectedVersion })
}
