import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import {
  assertLockfileMatchesManifest,
  assertProjectManifest,
  assertRegistryManifest,
  assertRegistryPackageManifest,
  assertReleaseChannel,
  assertTagMatchesVersion,
  compareExactVersions,
  compareStableVersions,
  normalizeBundlePatch,
  parseExactVersion,
  parseSha256File,
  releaseChannelForVersion,
} from '../scripts/lib/release-gates.mjs'

const ROOT = new URL('../', import.meta.url)
const manifest = JSON.parse(await readFile(new URL('package.json', ROOT), 'utf8'))
const lockfile = JSON.parse(await readFile(new URL('package-lock.json', ROOT), 'utf8'))

/** @param {Record<string, any>} [changes] */
function candidate(changes = {}) {
  return structuredClone({ ...manifest, ...changes })
}

test('release versions and tags use exact stable or rc.N identities', () => {
  assert.deepEqual(parseExactVersion('0.1.0'), { version: '0.1.0', prerelease: null })
  assert.deepEqual(parseExactVersion('0.1.0-rc.3'), { version: '0.1.0-rc.3', prerelease: 'rc.3' })
  assert.equal(assertReleaseChannel('0.1.0', 'latest').version, '0.1.0')
  assert.equal(assertReleaseChannel('0.1.0-rc.3', 'next').version, '0.1.0-rc.3')
  assert.equal(releaseChannelForVersion('0.1.0'), 'latest')
  assert.equal(releaseChannelForVersion('0.1.0-rc.3'), 'next')
  assert.equal(compareStableVersions('0.1.0', '0.1.0'), 0)
  assert.equal(compareStableVersions('0.2.0', '0.1.999'), 1)
  assert.equal(compareStableVersions('0.1.9', '0.2.0'), -1)
  assert.equal(compareExactVersions('0.1.0', '0.1.0-rc.3'), 1)
  assert.equal(compareExactVersions('0.1.0-rc.4', '0.1.0-rc.3'), 1)
  assert.equal(compareExactVersions('0.1.0-rc.10', '0.1.0-rc.9'), 1)
  assert.equal(compareExactVersions('0.1.0-rc.3', '0.1.0-rc.3'), 0)
  assert.equal(compareExactVersions('0.1.0', '0.2.0-rc.1'), -1)
  assert.equal(compareExactVersions('1.0.0-1', '1.0.0-alpha'), -1)
  assert.equal(compareExactVersions('1.0.0-alpha', '1.0.0-alpha.1'), -1)
  assert.equal(assertTagMatchesVersion('v0.1.0-rc.3', '0.1.0-rc.3').prerelease, 'rc.3')

  for (const invalid of ['latest', 'v0.1.0', '0.1', '01.0.0', '0.1.0+build', '0.1.0-rc.03']) {
    assert.throws(() => parseExactVersion(invalid))
  }
  assert.throws(() => assertReleaseChannel('0.1.0-rc.3', 'latest'), /stable/u)
  assert.throws(() => assertReleaseChannel('0.1.0', 'next'), /rc\.N/u)
  assert.throws(() => assertTagMatchesVersion('v0.1.1', '0.1.0'), /does not match/u)
  assert.throws(() => assertTagMatchesVersion('v0.1.0-beta.1', '0.1.0-beta.1'), /only support rc\.N/u)
})

test('bundle patch paths are normalized and unsafe paths are rejected', () => {
  assert.equal(normalizeBundlePatch('./cordis.patch.yml'), 'cordis.patch.yml')
  assert.equal(normalizeBundlePatch('nested/cordis.patch.yml'), 'nested/cordis.patch.yml')
  for (const invalid of ['', '/', '../cordis.patch.yml', 'nested//patch.yml', 'nested/./patch.yml', 'C:/patch.yml', 'nested\\patch.yml', `bad\0path`]) {
    assert.throws(() => normalizeBundlePatch(invalid))
  }
  assert.throws(() => normalizeBundlePatch('a'.repeat(513)), /512/u)
})

test('release checksum files bind one lowercase digest to the exact tarball name', () => {
  const digest = 'a'.repeat(64)
  assert.equal(parseSha256File(`${digest}  package.tgz\n`, 'package.tgz'), digest)
  assert.throws(() => parseSha256File(`${digest}  other.tgz\n`, 'package.tgz'), /filename/u)
  assert.throws(() => parseSha256File(`${digest} package.tgz\n`, 'package.tgz'), /must contain one/u)
  assert.throws(() => parseSha256File(`${digest.toUpperCase()}  package.tgz\n`, 'package.tgz'), /must contain one/u)
})

test('project manifest enforces package identity and stricter shipping policy', () => {
  assert.doesNotThrow(() => assertProjectManifest(manifest, {
    channel: releaseChannelForVersion(manifest.version),
  }))
  assert.doesNotThrow(() => assertLockfileMatchesManifest(lockfile, manifest))

  const cases = [
    [candidate({ name: 'different-package' }), /must equal dsh-universe-api/u],
    [candidate({ private: true }), /must be public/u],
    [candidate({ dependencies: { unexpected: '1.0.0' } }), /runtime dependencies are forbidden/u],
    [candidate({ repository: { type: 'git', url: 'https://user:secret@github.com/Ruixinhua/dsh-universe-api.git' } }), /credentials/u],
    [candidate({ repository: { type: 'git', url: 'https://github.com/someone/else.git' } }), /must point/u],
    [candidate({ publishConfig: { registry: 'https://registry.example.test/', access: 'public' } }), /official npm registry/u],
    [candidate({ publishConfig: { registry: 'https://registry.npmjs.org/', access: 'restricted' } }), /access/u],
    [candidate({ scripts: { ...manifest.scripts, install: 'node surprise.js' } }), /lifecycle script: install/u],
    [candidate({ dsh: { bundle: { patch: '../escape.yml' } } }), /unsafe path segment/u],
  ]
  for (const [invalid, expected] of cases) {
    assert.throws(() => assertProjectManifest(invalid, {
      channel: releaseChannelForVersion(invalid.version),
    }), expected)
  }
})

test('registry latest validation binds stable npm metadata to the accepted tarball', () => {
  const integrity = 'sha512-fixture'
  const registryManifest = {
    name: 'dsh-universe-api',
    version: '0.1.0',
    dsh: { bundle: { patch: './cordis.patch.yml' } },
    dist: { integrity },
  }
  assert.doesNotThrow(() => assertRegistryManifest(registryManifest, {
    expectedVersion: '0.1.0',
    expectedIntegrity: integrity,
  }))
  const prereleaseManifest = { ...registryManifest, version: '0.1.0-rc.3' }
  assert.doesNotThrow(() => assertRegistryPackageManifest(prereleaseManifest, { requireStable: false }))
  assert.throws(() => assertRegistryPackageManifest(prereleaseManifest), /stable/u)
  assert.throws(() => assertRegistryManifest({ ...registryManifest, version: '0.1.0-rc.3' }, {
    expectedVersion: '0.1.0-rc.3',
    expectedIntegrity: integrity,
  }), /stable/u)
  assert.throws(() => assertRegistryManifest(registryManifest, {
    expectedVersion: '0.1.0',
    expectedIntegrity: 'sha512-other',
  }), /integrity/u)
})
