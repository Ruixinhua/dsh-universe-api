/** Headless smoke for the published tarball through a real DSH profile and Loader. */

import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import {
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import {
  boot,
  initProfile,
  loadProfile,
  readProfileManifest,
  writeProfileManifest,
} from '@deepseek-ai/dsh-app-boot'
import { CallId } from '@deepseek-ai/dsh-llm'

const BIN_NAME = 'dsh-universe-api-loader-smoke'
const PROFILE_NAME = 'universe-api-smoke'
const PACKAGE_NAME = 'dsh-universe-api'
const projectRoot = fileURLToPath(new URL('../', import.meta.url))
const installAnchor = join(projectRoot, 'package.json')
const projectManifest = JSON.parse(readFileSync(installAnchor, 'utf8'))
const npmExecPath = process.env.npm_execpath ?? ''
if (npmExecPath.length === 0) {
  throw new Error('Loader smoke must run through npm run verify:loader')
}
const smokeRoot = mkdtempSync(join(tmpdir(), 'dsh-universe-api-loader-'))
const artifactsDir = join(smokeRoot, 'artifacts')
const homeDir = join(smokeRoot, 'home')
const profileDir = join(homeDir, 'profiles', PROFILE_NAME)

/**
 * @typedef {{
 *   catalog: { source: string },
 *   filters: { https: string | null },
 *   results: Array<{ https: string }>,
 * }} SearchValue
 */

/** Run npm without a shell and surface complete diagnostics on failure. */
/** @param {string[]} args @param {string} cwd */
function runNpm(args, cwd) {
  const result = spawnSync(process.execPath, [npmExecPath, ...args], {
    cwd,
    encoding: 'utf8',
    env: {
      ...process.env,
      npm_config_update_notifier: 'false',
    },
  })
  if (result.error !== undefined) throw result.error
  if (result.status !== 0) {
    throw new Error([
      `npm ${args.join(' ')} exited with ${String(result.status)}`,
      result.stdout,
      result.stderr,
    ].filter(Boolean).join('\n'))
  }
  return result.stdout
}

let ctx
try {
  mkdirSync(artifactsDir, { recursive: true })
  const packOutput = runNpm([
    'pack',
    '--json',
    '--ignore-scripts',
    '--pack-destination',
    artifactsDir,
  ], projectRoot)
  const packResult = JSON.parse(packOutput)
  assert.ok(Array.isArray(packResult) && packResult.length === 1)
  const packed = packResult[0]
  assert.equal(packed?.name, PACKAGE_NAME)
  assert.equal(packed?.version, projectManifest.version)
  assert.equal(typeof packed?.filename, 'string')
  const tarballPath = join(artifactsDir, packed.filename)
  const profileTarballSpec = relative(profileDir, tarballPath).replaceAll('\\', '/')
  assert.ok(profileTarballSpec.length > 0 && !profileTarballSpec.startsWith('/'))

  initProfile(profileDir, [PACKAGE_NAME])
  const manifest = readProfileManifest(BIN_NAME, profileDir)
  writeProfileManifest(profileDir, {
    ...manifest,
    dependencies: {
      [PACKAGE_NAME]: `file:${profileTarballSpec}`,
      '@deepseek-ai/cordis': projectManifest.devDependencies['@deepseek-ai/cordis'],
      '@deepseek-ai/dsh-system-prompt':
        projectManifest.devDependencies['@deepseek-ai/dsh-system-prompt'],
      '@deepseek-ai/dsh-tools': projectManifest.devDependencies['@deepseek-ai/dsh-tools'],
    },
  })
  runNpm([
    'install',
    '--offline',
    '--ignore-scripts',
    '--no-audit',
    '--no-fund',
    '--no-package-lock',
  ], profileDir)

  const installedPackageDir = join(profileDir, 'node_modules', PACKAGE_NAME)
  const installedManifest = JSON.parse(
    readFileSync(join(installedPackageDir, 'package.json'), 'utf8'),
  )
  assert.equal(lstatSync(installedPackageDir).isSymbolicLink(), false)
  assert.equal(installedManifest.name, PACKAGE_NAME)
  assert.equal(installedManifest.version, projectManifest.version)
  assert.equal(installedManifest.dsh?.bundle?.patch, './cordis.patch.yml')
  assert.equal(installedManifest.scripts?.prepare, undefined)

  const profile = loadProfile(BIN_NAME, PROFILE_NAME, installAnchor, homeDir)
  assert.equal(profile.layers.length, 1)
  assert.equal(profile.layers[0]?.packageName, PACKAGE_NAME)
  assert.equal(realpathSync(profile.layers[0].packageDir), realpathSync(installedPackageDir))
  assert.equal(
    realpathSync(profile.layers[0].patchPath),
    realpathSync(join(installedPackageDir, 'cordis.patch.yml')),
  )

  const rootConfig = join(profileDir, 'cordis.yml')
  writeFileSync(rootConfig, [
    '- id: system-prompt',
    "  name: '@deepseek-ai/dsh-system-prompt'",
    '- id: tools',
    "  name: '@deepseek-ai/dsh-tools'",
    '',
  ].join('\n'))
  const patches = [
    ...profile.layers.flatMap(layer => layer.patches),
    ...profile.patches,
  ]
  ctx = await boot(
    BIN_NAME,
    rootConfig,
    patches,
    undefined,
    pathToFileURL(join(profileDir, 'package.json')).href,
  )

  const pluginEntry = ctx.loader.resolve(`include:${PACKAGE_NAME}`)
  assert.equal(pluginEntry?.options.name, PACKAGE_NAME)
  assert.deepEqual(ctx.tools.schemas().map(schema => schema.name), ['universe_api_search'])

  const result = await ctx.tools.execute({
    signal: new AbortController().signal,
    callId: CallId('packed-loader-weather'),
    name: 'universe_api_search',
    arguments: { query: 'weather', https: 'yes', limit: 2 },
  })
  assert.equal(result.isError, false)
  if (result.isError) throw new Error('packed Loader smoke returned a tool error')
  assert.ok(result.value !== null && typeof result.value === 'object' && !Array.isArray(result.value))
  const value = /** @type {SearchValue} */ (/** @type {unknown} */ (result.value))
  assert.equal(value.catalog?.source, 'bundled-public')
  assert.equal(value.filters?.https, 'yes')
  assert.ok(Array.isArray(value.results) && value.results.length > 0)
  assert.ok(value.results.length <= 2)
  assert.ok(value.results.every(item => item.https === 'yes'))

  process.stdout.write(
    `Loader smoke activated ${PACKAGE_NAME}@${installedManifest.version} from ${packed.filename}\n`,
  )
} finally {
  await ctx?.fiber.dispose()
  rmSync(smokeRoot, { recursive: true, force: true })
}
