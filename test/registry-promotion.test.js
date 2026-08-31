import assert from 'node:assert/strict'
import test from 'node:test'

import { planRegistryPromotion } from '../scripts/lib/registry-promotion.mjs'

const integrity = 'sha512-fixture'

/** @param {string} version @param {string} [distIntegrity] */
function registryManifest(version, distIntegrity = integrity) {
  return {
    name: 'dsh-universe-api',
    version,
    dsh: { bundle: { patch: './cordis.patch.yml' } },
    dist: { integrity: distIntegrity },
  }
}

test('stable promotion accepts npm first-publish prerelease latest', () => {
  assert.deepEqual(planRegistryPromotion({
    expectedVersion: '0.1.0',
    expectedIntegrity: integrity,
    latestManifest: registryManifest('0.1.0-rc.3'),
    exactManifest: null,
  }), {
    state: 'publish',
    currentLatest: '0.1.0-rc.3',
    version: '0.1.0',
  })
})

test('stable promotion remains monotonic across prerelease latest values', () => {
  assert.throws(() => planRegistryPromotion({
    expectedVersion: '0.1.0',
    expectedIntegrity: integrity,
    latestManifest: registryManifest('0.2.0-rc.1'),
    exactManifest: null,
  }), /backwards from 0\.2\.0-rc\.1/u)
})

test('stable promotion is idempotent only for identical registry bytes', () => {
  assert.deepEqual(planRegistryPromotion({
    expectedVersion: '0.1.0',
    expectedIntegrity: integrity,
    latestManifest: registryManifest('0.1.0'),
    exactManifest: registryManifest('0.1.0'),
  }), {
    state: 'already-published',
    currentLatest: '0.1.0',
    version: '0.1.0',
  })

  assert.throws(() => planRegistryPromotion({
    expectedVersion: '0.1.0',
    expectedIntegrity: integrity,
    latestManifest: registryManifest('0.1.0', 'sha512-other'),
    exactManifest: registryManifest('0.1.0', 'sha512-other'),
  }), /integrity/u)
})

test('stable promotion rejects an existing target that is not latest', () => {
  assert.throws(() => planRegistryPromotion({
    expectedVersion: '0.1.0',
    expectedIntegrity: integrity,
    latestManifest: registryManifest('0.1.0-rc.3'),
    exactManifest: registryManifest('0.1.0'),
  }), /already exists but is not npm latest/u)
})
