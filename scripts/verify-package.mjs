import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  assertLockfileMatchesManifest,
  assertProjectManifest,
} from './lib/release-gates.mjs'

const projectRoot = fileURLToPath(new URL('../', import.meta.url))
const args = process.argv.slice(2)
let channel
let requestedArtifactDir
for (let index = 0; index < args.length; index += 1) {
  const argument = args[index]
  if (argument === '--channel') {
    channel = args[index + 1]
    index += 1
  } else if (argument === '--artifact-dir') {
    requestedArtifactDir = args[index + 1]
    index += 1
  } else {
    throw new Error(`unknown verify-package argument: ${String(argument)}`)
  }
}
if (channel !== 'next' && channel !== 'latest') {
  throw new Error('verify-package requires --channel next|latest')
}
if (requestedArtifactDir === '') throw new Error('--artifact-dir requires a path')

const packageJson = JSON.parse(readFileSync(join(projectRoot, 'package.json'), 'utf8'))
const packageLock = JSON.parse(readFileSync(join(projectRoot, 'package-lock.json'), 'utf8'))
assertLockfileMatchesManifest(packageLock, packageJson)

const expectedFiles = [
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
  'docs/PRIVATE_CATALOG.md',
  'index.js',
  'package.json',
  'src/catalog.js',
  'src/render.js',
  'src/search.js',
]

const workRoot = mkdtempSync(join(tmpdir(), 'dsh-universe-package-audit-'))
const artifactDir = requestedArtifactDir === undefined
  ? join(workRoot, 'artifacts')
  : resolve(projectRoot, requestedArtifactDir)
const installDir = join(workRoot, 'install')

try {
  mkdirSync(artifactDir, { recursive: true })
  mkdirSync(installDir, { recursive: true })
  const output = execFileSync('npm', [
    'pack',
    '--ignore-scripts',
    '--json',
    '--pack-destination',
    artifactDir,
  ], {
    cwd: projectRoot,
    encoding: 'utf8',
    env: { ...process.env, npm_config_update_notifier: 'false' },
  })
  /** @type {Array<{name: string, version: string, filename: string, integrity: string, shasum: string, files: Array<{path: string}>}>} */
  const report = JSON.parse(output)
  assert.equal(report.length, 1)
  const entry = report[0]
  assert.ok(entry)
  assert.equal(entry.name, packageJson.name)
  assert.equal(entry.version, packageJson.version)
  assert.equal(entry.filename, `${packageJson.name}-${packageJson.version}.tgz`)

  const files = new Set(entry.files.map(file => file.path))
  assertProjectManifest(packageJson, { channel, packedFiles: files })
  assert.deepEqual(
    [...files].sort(),
    [...expectedFiles].sort(),
    'packed file list changed; review and update the explicit release allowlist',
  )

  const tarballPath = join(artifactDir, entry.filename)
  const tarball = readFileSync(tarballPath)
  const sha1 = createHash('sha1').update(tarball).digest('hex')
  const sha256 = createHash('sha256').update(tarball).digest('hex')
  const integrity = `sha512-${createHash('sha512').update(tarball).digest('base64')}`
  assert.equal(entry.shasum, sha1)
  assert.equal(entry.integrity, integrity)
  writeFileSync(`${tarballPath}.sha256`, `${sha256}  ${basename(tarballPath)}\n`)

  execFileSync('npm', [
    'install',
    '--ignore-scripts',
    '--no-audit',
    '--no-fund',
    '--no-package-lock',
    '--omit=peer',
    '--prefix',
    installDir,
    tarballPath,
  ], {
    cwd: projectRoot,
    encoding: 'utf8',
    env: {
      ...process.env,
      npm_config_registry: 'https://registry.npmjs.org/',
      npm_config_update_notifier: 'false',
    },
  })

  const installedRoot = join(installDir, 'node_modules', packageJson.name)
  const installedManifest = JSON.parse(readFileSync(join(installedRoot, 'package.json'), 'utf8'))
  assert.equal(installedManifest.name, packageJson.name)
  assert.equal(installedManifest.version, packageJson.version)
  assertProjectManifest(installedManifest, { channel, packedFiles: files })

  const privatePathPatterns = [
    /(?:^|[\s"'`])\/Users\/[^/\s]+/mu,
    /(?:^|[\s"'`])\/home\/[^/\s]+/mu,
    /(?:^|[\s"'`])[A-Za-z]:\\Users\\[^\\\s]+/mu,
  ]
  for (const file of files) {
    const contents = readFileSync(join(installedRoot, file), 'utf8')
    assert.ok(
      privatePathPatterns.every(pattern => !pattern.test(contents)),
      `packed artifact contains a private user path in ${file}`,
    )
  }

  for (const forbidden of ['source_records.json', 'source_state.json', 'review_queue.json']) {
    assert.ok(
      [...files].every(file => !file.endsWith(forbidden)),
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

  console.log(JSON.stringify({
    package: `${entry.name}@${entry.version}`,
    channel,
    filename: entry.filename,
    files: files.size,
    records: catalog.records.length,
    sha256,
    integrity,
  }))
} finally {
  rmSync(workRoot, { recursive: true, force: true })
}
