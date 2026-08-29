import assert from 'node:assert/strict'
import { appendFileSync } from 'node:fs'

import {
  assertRegistryManifest,
  assertRegistryPackageManifest,
  assertReleaseChannel,
  compareStableVersions,
} from './lib/release-gates.mjs'

const args = process.argv.slice(2)
let expectedVersion
let expectedIntegrity
for (let index = 0; index < args.length; index += 1) {
  const argument = args[index]
  if (argument === '--version') {
    expectedVersion = args[index + 1]
    index += 1
  } else if (argument === '--integrity') {
    expectedIntegrity = args[index + 1]
    index += 1
  } else {
    throw new Error(`unknown plan-registry-promotion argument: ${String(argument)}`)
  }
}
assert.ok(expectedVersion && expectedIntegrity, '--version and --integrity are required')
assertReleaseChannel(expectedVersion, 'latest')

/** @param {string} selector */
async function fetchManifest(selector) {
  const response = await fetch(`https://registry.npmjs.org/dsh-universe-api/${encodeURIComponent(selector)}`, {
    headers: { Accept: 'application/json' },
    redirect: 'error',
    signal: AbortSignal.timeout(15_000),
  })
  if (response.status === 404) return null
  assert.equal(response.status, 200, `npm registry returned ${response.status}`)
  const text = await response.text()
  assert.ok(text.length <= 1024 * 1024, 'npm registry manifest exceeded 1 MiB')
  return JSON.parse(text)
}

const latestManifest = await fetchManifest('latest')
const exactManifest = await fetchManifest(expectedVersion)
let promotionState
let currentLatest = ''
if (latestManifest === null) {
  assert.equal(exactManifest, null, 'target stable version already exists without being npm latest')
  promotionState = 'publish'
} else {
  const latest = assertRegistryPackageManifest(latestManifest)
  currentLatest = latest.version
  const comparison = compareStableVersions(expectedVersion, latest.version)
  assert.ok(comparison >= 0, `refusing to move npm latest backwards from ${latest.version} to ${expectedVersion}`)
  if (comparison === 0) {
    assertRegistryManifest(latestManifest, { expectedVersion, expectedIntegrity })
    promotionState = 'already-published'
  } else {
    if (exactManifest !== null) {
      assertRegistryManifest(exactManifest, { expectedVersion, expectedIntegrity })
      throw new Error('target stable version already exists but is not npm latest; refusing an ambiguous re-publish')
    }
    promotionState = 'publish'
  }
}

if (process.env.GITHUB_OUTPUT) {
  appendFileSync(process.env.GITHUB_OUTPUT, [
    `promotion_state=${promotionState}`,
    `current_latest=${currentLatest}`,
    '',
  ].join('\n'))
}
console.log(JSON.stringify({ state: promotionState, currentLatest, version: expectedVersion }))
