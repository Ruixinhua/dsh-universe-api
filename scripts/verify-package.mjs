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
  releaseChannelForVersion,
} from './lib/release-gates.mjs'
import {
  assertExpectedPackageFiles,
  auditInstalledPackage,
} from './lib/package-audit.mjs'

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
if (channel !== 'auto' && channel !== 'next' && channel !== 'latest') {
  throw new Error('verify-package requires --channel auto|next|latest')
}
if (requestedArtifactDir === '') throw new Error('--artifact-dir requires a path')

const packageJson = JSON.parse(readFileSync(join(projectRoot, 'package.json'), 'utf8'))
const packageLock = JSON.parse(readFileSync(join(projectRoot, 'package-lock.json'), 'utf8'))
assertLockfileMatchesManifest(packageLock, packageJson)
const releaseChannel = channel === 'auto' ? releaseChannelForVersion(packageJson.version) : channel

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
  assertProjectManifest(packageJson, { channel: releaseChannel, packedFiles: files })
  assertExpectedPackageFiles(files)

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
  assertProjectManifest(installedManifest, { channel: releaseChannel, packedFiles: files })
  const audit = auditInstalledPackage(installedRoot, files)

  console.log(JSON.stringify({
    package: `${entry.name}@${entry.version}`,
    channel: releaseChannel,
    filename: entry.filename,
    files: files.size,
    records: audit.recordCount,
    sha256,
    integrity,
  }))
} finally {
  rmSync(workRoot, { recursive: true, force: true })
}
