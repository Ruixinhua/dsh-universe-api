import assert from 'node:assert/strict'

import { assertRegistryManifest } from './lib/release-gates.mjs'

const args = process.argv.slice(2)
let selector
let expectedVersion
let expectedIntegrity
let allowMissing = false
let attempts = 1
for (let index = 0; index < args.length; index += 1) {
  const argument = args[index]
  if (argument === '--selector') {
    selector = args[index + 1]
    index += 1
  } else if (argument === '--version') {
    expectedVersion = args[index + 1]
    index += 1
  } else if (argument === '--integrity') {
    expectedIntegrity = args[index + 1]
    index += 1
  } else if (argument === '--attempts') {
    attempts = Number(args[index + 1])
    index += 1
  } else if (argument === '--allow-missing') {
    allowMissing = true
  } else {
    throw new Error(`unknown verify-registry-release argument: ${String(argument)}`)
  }
}
assert.ok(selector && expectedVersion && expectedIntegrity, '--selector, --version, and --integrity are required')
assert.ok(selector === 'latest' || selector === expectedVersion, '--selector must be latest or the expected version')
assert.ok(Number.isInteger(attempts) && attempts >= 1 && attempts <= 181, '--attempts must be an integer from 1 through 181')

const registryUrl = `https://registry.npmjs.org/dsh-universe-api/${encodeURIComponent(selector)}`
let lastError
for (let attempt = 1; attempt <= attempts; attempt += 1) {
  try {
    const response = await fetch(registryUrl, {
      headers: { Accept: 'application/json' },
      redirect: 'error',
      signal: AbortSignal.timeout(15_000),
    })
    if (response.status === 404 && allowMissing && attempt === 1) {
      process.exitCode = 3
      break
    }
    assert.equal(response.status, 200, `npm registry returned ${response.status}`)
    const text = await response.text()
    assert.ok(text.length <= 1024 * 1024, 'npm registry manifest exceeded 1 MiB')
    const manifest = JSON.parse(text)
    assertRegistryManifest(manifest, { expectedVersion, expectedIntegrity })
    console.log(JSON.stringify({ selector, version: manifest.version, integrity: manifest.dist.integrity }))
    lastError = undefined
    break
  } catch (error) {
    lastError = error
    if (attempt === attempts) break
    console.error(`registry verification attempt ${attempt} failed; retrying`)
    await new Promise(resolveDelay => setTimeout(resolveDelay, 5_000))
  }
}
if (lastError !== undefined) throw lastError
