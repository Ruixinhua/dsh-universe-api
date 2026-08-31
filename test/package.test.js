import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const ROOT = new URL('../', import.meta.url)

test('package declares an installable no-build DSH bundle', async () => {
  const packageJson = JSON.parse(await readFile(new URL('package.json', ROOT), 'utf8'))
  const packageLock = JSON.parse(await readFile(new URL('package-lock.json', ROOT), 'utf8'))

  assert.equal(packageJson.name, 'dsh-universe-api')
  assert.equal(packageLock.version, packageJson.version)
  assert.equal(packageLock.packages?.['']?.version, packageJson.version)
  assert.equal(packageJson.type, 'module')
  assert.equal(packageJson.main, 'index.js')
  assert.equal(packageJson.dsh?.bundle?.patch, './cordis.patch.yml')
  assert.equal(packageJson.scripts?.prepare, undefined)
  assert.equal(packageJson.publishConfig?.registry, 'https://registry.npmjs.org/')
  assert.equal(packageJson.publishConfig?.access, 'public')
  assert.equal(
    packageJson.scripts?.['verify:loader'],
    'node --expose-internals scripts/verify-loader-profile.mjs',
  )
  assert.match(packageJson.scripts?.check, /npm run verify:loader/u)
  assert.equal(packageJson.engines?.node, '^22.19.0 || >=24.0.0')
  assert.equal(packageJson.peerDependencies?.['@deepseek-ai/cordis'], '^4.0.1')
  assert.equal(
    packageJson.peerDependencies?.['@deepseek-ai/dsh-tools'],
    '>=0.1.1-rc.2 <0.2.0',
  )
  assert.equal(packageJson.dependencies?.['@deepseek-ai/schemastery'], undefined)
  assert.equal(packageJson.peerDependencies?.['@deepseek-ai/schemastery'], '^3.18.1')
  assert.equal(packageJson.devDependencies?.['@deepseek-ai/schemastery'], '3.18.1')
  assert.equal(packageJson.devDependencies?.['@deepseek-ai/dsh-app-boot'], '0.1.1-rc.2')
})

test('bundle patch mounts one consistently named plugin row', async () => {
  const patch = await readFile(new URL('cordis.patch.yml', ROOT), 'utf8')
  assert.match(patch, /^- insert:\n {4}- id: dsh-universe-api\n {6}name: dsh-universe-api\n$/)
})

test('CI runs the packed Loader profile smoke on every supported operating system', async () => {
  const workflow = await readFile(new URL('.github/workflows/ci.yml', ROOT), 'utf8')

  assert.match(workflow, /run: npm run check/u)
  assert.match(
    workflow,
    /- name: Run packed Loader profile smoke\n {8}run: npm run verify:loader/u,
  )
})

test('Release assets stay bound to the immutable remote tag commit', async () => {
  const workflow = await readFile(new URL('.github/workflows/release.yml', ROOT), 'utf8')
  const checks = workflow.match(
    /node scripts\/verify-github-tag\.mjs --tag "\$GITHUB_REF_NAME" --sha "\$GITHUB_SHA"/gu,
  ) ?? []

  assert.equal(checks.length, 2)
})

test('npm promotion jobs can read the accepted Draft Release', async () => {
  const workflow = await readFile(new URL('.github/workflows/publish-npm.yml', ROOT), 'utf8')
  const preflight = workflow.match(/\n  preflight:[\s\S]*?(?=\n  publish:)/u)?.[0] ?? ''
  const publish = workflow.match(/\n  publish:[\s\S]*?(?=\n  finalize-release:)/u)?.[0] ?? ''

  assert.match(preflight, /permissions:\n {6}contents: write/u)
  assert.match(publish, /permissions:\n {6}contents: write\n {6}id-token: write/u)
})
