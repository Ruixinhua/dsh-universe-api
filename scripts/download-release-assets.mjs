import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const args = process.argv.slice(2)
/** @type {string | undefined} */
let tag
/** @type {string | undefined} */
let outputDir
let expectedState = 'either'
for (let index = 0; index < args.length; index += 1) {
  const argument = args[index]
  if (argument === '--tag') {
    tag = args[index + 1]
    index += 1
  } else if (argument === '--output-dir') {
    outputDir = args[index + 1]
    index += 1
  } else if (argument === '--state') {
    expectedState = args[index + 1] ?? ''
    index += 1
  } else {
    throw new Error(`unknown download-release-assets argument: ${String(argument)}`)
  }
}

assert.ok(tag, '--tag is required')
assert.match(tag, /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-rc\.(0|[1-9]\d*))?$/u)
assert.ok(outputDir, '--output-dir is required')
assert.ok(['draft', 'published', 'either'].includes(expectedState), '--state must be draft|published|either')
const repository = process.env.GITHUB_REPOSITORY
const token = process.env.GITHUB_TOKEN
assert.ok(repository, 'GITHUB_REPOSITORY is required')
assert.match(repository, /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u, 'GITHUB_REPOSITORY is invalid')
assert.ok(token, 'GITHUB_TOKEN is required')

const version = tag.slice(1)
const expectedNames = [
  `dsh-universe-api-${version}.tgz`,
  `dsh-universe-api-${version}.tgz.sha256`,
  'catalog-update-report.json',
]
const apiRoot = process.env.GITHUB_API_URL ?? 'https://api.github.com'
const headers = {
  Accept: 'application/vnd.github+json',
  Authorization: `Bearer ${token}`,
  'X-GitHub-Api-Version': '2022-11-28',
}

/** @typedef {{name: string, size: number, digest: string, url: string}} GitHubAsset */
/** @typedef {{id: number, tag_name: string, draft: boolean, prerelease: boolean, assets: GitHubAsset[]}} GitHubRelease */
/** @type {GitHubRelease[]} */
const releases = []
let paginationComplete = false
for (let page = 1; page <= 20; page += 1) {
  const releasesResponse = await fetch(`${apiRoot}/repos/${repository}/releases?per_page=100&page=${page}`, {
    headers,
    redirect: 'error',
    signal: AbortSignal.timeout(15_000),
  })
  assert.equal(releasesResponse.status, 200, `GitHub releases API returned ${releasesResponse.status}`)
  const pageReleases = /** @type {GitHubRelease[]} */ (await releasesResponse.json())
  assert.ok(Array.isArray(pageReleases), 'GitHub releases API did not return an array')
  releases.push(...pageReleases)
  if (pageReleases.length < 100) {
    paginationComplete = true
    break
  }
}
assert.ok(paginationComplete, 'GitHub releases pagination exceeded 20 pages')
const matches = releases.filter(release => release?.tag_name === tag)
assert.equal(matches.length, 1, `expected exactly one GitHub Release for ${tag}`)
const release = matches[0]
assert.ok(release)
assert.equal(release.prerelease, tag.includes('-rc.'), 'GitHub Release prerelease state does not match its tag')
if (expectedState === 'draft') assert.equal(release.draft, true, 'GitHub Release must still be a draft')
if (expectedState === 'published') assert.equal(release.draft, false, 'GitHub Release must already be published')
assert.ok(Array.isArray(release.assets), 'GitHub Release assets are missing')
assert.deepEqual(
  release.assets.map(asset => asset.name).sort(),
  [...expectedNames].sort(),
  'GitHub Release must contain exactly the three reviewed assets',
)

const destination = resolve(outputDir)
mkdirSync(destination, { recursive: true })
const assetDigestLines = []
for (const name of expectedNames) {
  /** @type {GitHubAsset | undefined} */
  const asset = release.assets.find((candidate) => candidate.name === name)
  assert.ok(asset)
  assert.ok(Number.isInteger(asset.size) && asset.size >= 1 && asset.size <= 20 * 1024 * 1024, `unsafe asset size for ${name}`)
  const response = await fetch(asset.url, {
    headers: { ...headers, Accept: 'application/octet-stream' },
    redirect: 'follow',
    signal: AbortSignal.timeout(30_000),
  })
  assert.equal(response.status, 200, `GitHub asset download returned ${response.status} for ${name}`)
  const bytes = Buffer.from(await response.arrayBuffer())
  assert.equal(bytes.length, asset.size, `GitHub asset size changed for ${name}`)
  const digest = `sha256:${createHash('sha256').update(bytes).digest('hex')}`
  assert.equal(asset.digest, digest, `GitHub asset digest changed for ${name}`)
  assetDigestLines.push(`${name}\0${digest}`)
  writeFileSync(resolve(destination, name), bytes, { mode: 0o600 })
}
const assetSetDigest = `sha256:${createHash('sha256').update(assetDigestLines.join('\n')).digest('hex')}`

if (process.env.GITHUB_OUTPUT) {
  appendFileSync(process.env.GITHUB_OUTPUT, [
    `asset_set_digest=${assetSetDigest}`,
    `release_id=${String(release.id)}`,
    `release_draft=${String(release.draft)}`,
    `version=${version}`,
    '',
  ].join('\n'))
}
console.log(JSON.stringify({
  releaseId: release.id,
  draft: release.draft,
  tag,
  version,
  assets: expectedNames,
  assetSetDigest,
}))
