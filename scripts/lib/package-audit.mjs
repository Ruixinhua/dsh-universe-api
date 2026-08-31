import assert from 'node:assert/strict'
import { lstatSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

export const EXPECTED_PACKAGE_FILES = Object.freeze([
  'CHANGELOG.md',
  'CONTRIBUTING.md',
  'LICENSE',
  'README.md',
  'README.zh-CN.md',
  'SECURITY.md',
  'THIRD_PARTY_NOTICES.md',
  'cordis.patch.yml',
  'data/catalog.json',
  'data/query_aliases.json',
  'docs/CATALOG_MAINTENANCE.md',
  'docs/DEVELOPMENT.md',
  'docs/MANUAL_TESTING.md',
  'docs/MARKET_RELEASE.md',
  'docs/MARKET_RELEASE.zh-CN.md',
  'docs/PRIVATE_CATALOG.md',
  'docs/RELEASE_ACCEPTANCE_0.1.0.md',
  'docs/RELEASE_ACCEPTANCE_0.1.0-rc.3.md',
  'index.js',
  'package.json',
  'src/catalog.js',
  'src/render.js',
  'src/search.js',
])

/** @param {string} listing */
export function normalizeTarballFileList(listing) {
  const files = listing
    .split(/\r?\n/gu)
    .filter(Boolean)
    .filter(entry => !entry.endsWith('/'))
    .map((entry) => {
      assert.ok(entry.startsWith('package/'), `tarball entry is outside package/: ${entry}`)
      const path = entry.slice('package/'.length)
      assert.ok(path && !path.startsWith('/') && !path.split('/').includes('..'), `unsafe tarball entry: ${entry}`)
      return path
    })
  assert.equal(new Set(files).size, files.length, 'tarball contains duplicate file entries')
  return files
}

/** @param {Iterable<string>} packedFiles */
export function assertExpectedPackageFiles(packedFiles) {
  const files = [...packedFiles]
  assert.deepEqual(
    files.sort(),
    [...EXPECTED_PACKAGE_FILES].sort(),
    'packed file list changed; review and update the explicit release allowlist',
  )
}

/**
 * Audit the extracted bytes rather than the source checkout.
 *
 * @param {string} installedRoot
 * @param {Iterable<string>} packedFiles
 */
export function auditInstalledPackage(installedRoot, packedFiles) {
  const files = [...packedFiles]
  const privatePathPatterns = [
    /(?:^|[\s"'`])\/Users\/[^/\s]+/mu,
    /(?:^|[\s"'`])\/home\/[^/\s]+/mu,
    /(?:^|[\s"'`])[A-Za-z]:\\Users\\[^\\\s]+/mu,
  ]
  for (const file of files) {
    const path = join(installedRoot, file)
    const stats = lstatSync(path)
    assert.ok(stats.isFile() && !stats.isSymbolicLink(), `packed entry must be a regular file: ${file}`)
    const contents = readFileSync(path, 'utf8')
    assert.ok(
      privatePathPatterns.every(pattern => !pattern.test(contents)),
      `packed artifact contains a private user path in ${file}`,
    )
  }

  for (const forbidden of ['source_records.json', 'source_state.json', 'review_queue.json']) {
    assert.ok(
      files.every(file => !file.endsWith(forbidden)),
      `packed artifact contains private maintenance state ${forbidden}`,
    )
  }

  const catalog = JSON.parse(readFileSync(join(installedRoot, 'data', 'catalog.json'), 'utf8'))
  for (const record of catalog.records ?? []) {
    assert.notEqual(record.source_tier, 'apilayer', `public catalog contains private record ${record.id}`)
    for (const provenance of record.provenance ?? []) {
      assert.ok(
        !String(provenance.source_id ?? '').startsWith('apilayer'),
        `public catalog contains APILayer provenance in ${record.id}`,
      )
    }
  }
  return Object.freeze({ recordCount: catalog.records.length })
}
