import assert from 'node:assert/strict'
import test from 'node:test'
import { Context } from '@deepseek-ai/cordis'
import { CallId } from '@deepseek-ai/dsh-llm'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { apply, inject, name } from '../index.js'

/**
 * @typedef {{
 *   catalog: { source: string },
 *   filters: { https: string | null },
 *   totalMatches: number,
 *   results: Array<{ https: string }>,
 * }} SearchValue
 */

/** @param {import('@deepseek-ai/dsh-tools').JsonValue} value */
function asSearchValue(value) {
  assert.ok(value !== null && typeof value === 'object' && !Array.isArray(value))
  return /** @type {SearchValue} */ (value)
}

async function createRuntime() {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  apply(ctx)
  return ctx
}

test('plugin exports match the bundle identity and registers one native tool', async () => {
  const ctx = await createRuntime()

  assert.equal(name, 'dsh-universe-api')
  assert.deepEqual(inject, ['tools'])
  assert.deepEqual(ctx.tools.schemas().map(schema => schema.name), ['universe_api_search'])
})

test('real DSH tool pipeline returns the canonical structured search value', async () => {
  const ctx = await createRuntime()
  const result = await ctx.tools.execute({
    signal: new AbortController().signal,
    callId: CallId('universe-weather'),
    name: 'universe_api_search',
    arguments: { query: 'weather', https: 'yes', limit: 3 },
  })

  assert.equal(result.isError, false)
  if (result.isError) return
  const value = asSearchValue(result.value)
  assert.equal(value.catalog.source, 'bundled-public')
  assert.equal(value.filters.https, 'yes')
  assert.ok(value.results.length > 0)
  assert.ok(value.results.length <= 3)
  assert.ok(value.results.every(item => item.https === 'yes'))
  assert.match(result.content[0]?.type === 'text' ? result.content[0].text : '', /snapshot/i)
})

test('real DSH tool pipeline preserves zero results and rejects an invalid limit', async () => {
  const ctx = await createRuntime()
  const noPrivateResults = await ctx.tools.execute({
    signal: new AbortController().signal,
    callId: CallId('universe-public-only'),
    name: 'universe_api_search',
    arguments: { sourceTier: 'apilayer' },
  })
  const invalidLimit = await ctx.tools.execute({
    signal: new AbortController().signal,
    callId: CallId('universe-invalid-limit'),
    name: 'universe_api_search',
    arguments: { query: 'weather', limit: 21 },
  })

  assert.equal(noPrivateResults.isError, false)
  if (!noPrivateResults.isError) {
    const value = asSearchValue(noPrivateResults.value)
    assert.equal(value.totalMatches, 0)
    assert.deepEqual(value.results, [])
  }
  assert.equal(invalidLimit.isError, true)
  assert.match(
    invalidLimit.content[0]?.type === 'text' ? invalidLimit.content[0].text : '',
    /limit must be an integer from 1 to 20/,
  )
})

test('real DSH tool pipeline rejects unknown credential-like arguments without echoing values', async () => {
  const ctx = await createRuntime()
  const secret = 'TOPSECRET-DO-NOT-ECHO'
  const result = await ctx.tools.execute({
    signal: new AbortController().signal,
    callId: CallId('universe-reject-secret'),
    name: 'universe_api_search',
    arguments: { query: 'weather', apiKey: secret },
  })

  assert.equal(result.isError, true)
  const content = result.content
    .map(block => (block.type === 'text' ? block.text : ''))
    .join('')
  assert.match(content, /unknown search argument\(s\): apiKey/u)
  assert.ok(!content.includes(secret))
})
