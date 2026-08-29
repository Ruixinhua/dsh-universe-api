import assert from 'node:assert/strict'

const args = process.argv.slice(2)
/** @type {string | undefined} */
let tag
/** @type {string | undefined} */
let expectedSha
for (let index = 0; index < args.length; index += 1) {
  const argument = args[index]
  if (argument === '--tag') {
    tag = args[index + 1]
    index += 1
  } else if (argument === '--sha') {
    expectedSha = args[index + 1]
    index += 1
  } else {
    throw new Error(`unknown verify-github-tag argument: ${String(argument)}`)
  }
}
assert.ok(tag, '--tag is required')
assert.match(
  tag,
  /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-rc\.(0|[1-9]\d*))?$/u,
  '--tag must be a stable or rc.N version tag',
)
assert.ok(expectedSha, '--sha is required')
assert.match(expectedSha, /^[0-9a-f]{40,64}$/u, '--sha must be a full Git object ID')
const repository = process.env.GITHUB_REPOSITORY
const token = process.env.GITHUB_TOKEN
assert.ok(repository, 'GITHUB_REPOSITORY is required')
assert.match(repository, /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u, 'GITHUB_REPOSITORY is invalid')
assert.ok(token, 'GITHUB_TOKEN is required')
const apiRoot = process.env.GITHUB_API_URL ?? 'https://api.github.com'
const headers = {
  Accept: 'application/vnd.github+json',
  Authorization: `Bearer ${token}`,
  'X-GitHub-Api-Version': '2022-11-28',
}

/** @param {string} url @returns {Promise<any>} */
async function getJson(url) {
  const response = await fetch(url, {
    headers,
    redirect: 'error',
    signal: AbortSignal.timeout(15_000),
  })
  assert.equal(response.status, 200, `GitHub Git Data API returned ${response.status}`)
  return response.json()
}

const reference = await getJson(`${apiRoot}/repos/${repository}/git/ref/tags/${encodeURIComponent(tag)}`)
let object = reference.object
for (let depth = 0; object?.type === 'tag' && depth < 5; depth += 1) {
  const annotated = await getJson(`${apiRoot}/repos/${repository}/git/tags/${object.sha}`)
  object = annotated.object
}
assert.equal(object?.type, 'commit', 'tag did not resolve to a commit')
assert.equal(object.sha, expectedSha, `remote tag ${tag} no longer points to the accepted commit`)
console.log(JSON.stringify({ tag, sha: object.sha }))
