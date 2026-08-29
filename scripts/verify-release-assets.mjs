import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  appendFileSync,
  mkdtempSync,
  readFileSync,
  rmSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join, resolve } from 'node:path'

import {
  assertProjectManifest,
  assertTagMatchesVersion,
  parseSha256File,
} from './lib/release-gates.mjs'
import {
  assertExpectedPackageFiles,
  auditInstalledPackage,
  normalizeTarballFileList,
} from './lib/package-audit.mjs'

const args = process.argv.slice(2)
let tag
let assetDir
let channel
for (let index = 0; index < args.length; index += 1) {
  const argument = args[index]
  if (argument === '--tag') {
    tag = args[index + 1]
    index += 1
  } else if (argument === '--asset-dir') {
    assetDir = args[index + 1]
    index += 1
  } else if (argument === '--channel') {
    channel = args[index + 1]
    index += 1
  } else {
    throw new Error(`unknown verify-release-assets argument: ${String(argument)}`)
  }
}
assert.ok(tag, '--tag is required')
assert.ok(assetDir, '--asset-dir is required')
assert.ok(channel === 'next' || channel === 'latest', '--channel must be next|latest')

const version = tag.slice(1)
const directory = resolve(assetDir)
const filename = `dsh-universe-api-${version}.tgz`
const tarballPath = join(directory, filename)
const checksumPath = `${tarballPath}.sha256`
const reportPath = join(directory, 'catalog-update-report.json')
const tarball = readFileSync(tarballPath)
const sha256 = createHash('sha256').update(tarball).digest('hex')
const integrity = `sha512-${createHash('sha512').update(tarball).digest('base64')}`
assert.equal(parseSha256File(readFileSync(checksumPath, 'utf8'), filename), sha256)
const updateReport = JSON.parse(readFileSync(reportPath, 'utf8'))
assert.equal(updateReport.schema_version, 1, 'catalog update report schema changed unexpectedly')
const packedFiles = normalizeTarballFileList(execFileSync('tar', ['-tzf', tarballPath], {
  encoding: 'utf8',
}))
assertExpectedPackageFiles(packedFiles)

const workRoot = mkdtempSync(join(tmpdir(), 'dsh-universe-release-asset-'))
try {
  execFileSync('npm', [
    'install',
    '--ignore-scripts',
    '--no-audit',
    '--no-fund',
    '--no-package-lock',
    '--omit=peer',
    '--prefix',
    workRoot,
    tarballPath,
  ], {
    encoding: 'utf8',
    env: {
      ...process.env,
      npm_config_registry: 'https://registry.npmjs.org/',
      npm_config_update_notifier: 'false',
    },
  })
  const installedRoot = join(
    workRoot,
    'node_modules',
    'dsh-universe-api',
  )
  const manifest = JSON.parse(readFileSync(join(installedRoot, 'package.json'), 'utf8'))
  assert.equal(manifest.version, version)
  assertTagMatchesVersion(tag, manifest.version)
  assertProjectManifest(manifest, { channel, packedFiles })
  auditInstalledPackage(installedRoot, packedFiles)
} finally {
  rmSync(workRoot, { recursive: true, force: true })
}

if (process.env.GITHUB_OUTPUT) {
  appendFileSync(process.env.GITHUB_OUTPUT, [
    `version=${version}`,
    `filename=${basename(tarballPath)}`,
    `sha256=${sha256}`,
    `integrity=${integrity}`,
    '',
  ].join('\n'))
}
console.log(JSON.stringify({ version, filename, sha256, integrity }))
