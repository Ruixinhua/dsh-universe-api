import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('../', import.meta.url))
const SYNC = join(ROOT, 'maintenance', 'sync_catalog.py')
const FIXTURE = join(ROOT, 'maintenance', 'fixtures', 'public_apis_sample.md')
const REVISION = 'a'.repeat(40)
const PYTHON = process.env.PYTHON || (process.platform === 'win32' ? 'python' : 'python3')

function runSync(args) {
  return spawnSync(PYTHON, [SYNC, ...args], {
    cwd: ROOT,
    encoding: 'utf8',
  })
}

async function digest(path) {
  const bytes = await readFile(path)
  return createHash('sha256').update(bytes).digest('hex')
}

test('offline dry-run parses only Index tables and changes no files', async (t) => {
  const dataDir = await mkdtemp(join(tmpdir(), 'dsh-universe-dry-run-'))
  t.after(() => rm(dataDir, { recursive: true, force: true }))

  const result = runSync([
    '--ref',
    REVISION,
    '--source-file',
    FIXTURE,
    '--data-dir',
    dataDir,
    '--dry-run',
  ])

  assert.equal(result.status, 0, result.stderr)
  const report = JSON.parse(result.stdout)
  assert.equal(report.status, 'dry_run')
  assert.deepEqual(report.counts, {
    after: 2,
    before: 0,
    normalized: 2,
    parsed: 2,
  })
  assert.deepEqual(await readdir(dataDir), [])
})

test('explicit write creates a valid deterministic snapshot without network', async (t) => {
  const dataDir = await mkdtemp(join(tmpdir(), 'dsh-universe-write-'))
  t.after(() => rm(dataDir, { recursive: true, force: true }))

  const written = runSync([
    '--ref',
    REVISION,
    '--source-file',
    FIXTURE,
    '--data-dir',
    dataDir,
    '--write',
  ])
  assert.equal(written.status, 0, written.stderr)

  const catalogPath = join(dataDir, 'catalog.json')
  const firstBytes = await readFile(catalogPath, 'utf8')
  const catalog = JSON.parse(firstBytes)
  assert.equal(catalog.schema_version, 1)
  assert.equal(catalog.records.length, 2)
  assert.deepEqual(
    catalog.records.map((record) => record.name),
    ['Cat Facts', 'Forecast Test'],
  )
  assert.match(firstBytes, /\n$/)

  const second = runSync([
    '--ref',
    REVISION,
    '--source-file',
    FIXTURE,
    '--data-dir',
    dataDir,
    '--write',
  ])
  assert.equal(second.status, 0, second.stderr)
  assert.equal(await readFile(catalogPath, 'utf8'), firstBytes)
  assert.deepEqual(JSON.parse(second.stdout).changes, {
    added: [],
    changed: [],
    removed: [],
  })
})

test('a failed refresh preserves the last-good catalog and report', async (t) => {
  const dataDir = await mkdtemp(join(tmpdir(), 'dsh-universe-last-good-'))
  t.after(() => rm(dataDir, { recursive: true, force: true }))
  const initial = runSync([
    '--ref',
    REVISION,
    '--source-file',
    FIXTURE,
    '--data-dir',
    dataDir,
    '--write',
  ])
  assert.equal(initial.status, 0, initial.stderr)

  const invalid = join(dataDir, 'invalid.md')
  await writeFile(invalid, '# no catalog tables\n', 'utf8')
  const catalogPath = join(dataDir, 'catalog.json')
  const reportPath = join(dataDir, 'update_report.json')
  const before = [await digest(catalogPath), await digest(reportPath)]
  const failed = runSync([
    '--ref',
    REVISION,
    '--source-file',
    invalid,
    '--data-dir',
    dataDir,
    '--write',
  ])

  assert.equal(failed.status, 1)
  assert.match(failed.stderr, /contained no category API rows/)
  assert.deepEqual(
    [await digest(catalogPath), await digest(reportPath)],
    before,
  )
})

test('atomic bundle replacement rolls back the first file if the second fails', async (t) => {
  const dataDir = await mkdtemp(join(tmpdir(), 'dsh-universe-rollback-'))
  t.after(() => rm(dataDir, { recursive: true, force: true }))
  const helper = String.raw`
import sys
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, sys.argv[1])
import catalog

root = Path(sys.argv[2])
first = root / "first.json"
second = root / "second.json"
first.write_text('{"old":1}\n', encoding="utf-8")
second.write_text('{"old":2}\n', encoding="utf-8")
real_replace = catalog.os.replace
calls = 0

def fail_second(source, destination):
    global calls
    calls += 1
    if calls == 2:
        raise OSError("synthetic second replace failure")
    return real_replace(source, destination)

try:
    with patch.object(catalog.os, "replace", side_effect=fail_second):
        catalog.atomic_write_bundle([(first, {"new": 1}), (second, {"new": 2})])
except catalog.CatalogError:
    pass
else:
    raise AssertionError("transaction unexpectedly succeeded")

assert first.read_text(encoding="utf-8") == '{"old":1}\n'
assert second.read_text(encoding="utf-8") == '{"old":2}\n'
`
  const result = spawnSync(
    PYTHON,
    [
      '-c',
      helper,
      join(ROOT, 'maintenance'),
      dataDir,
    ],
    { cwd: ROOT, encoding: 'utf8' },
  )

  assert.equal(result.status, 0, result.stderr)
})

test('sync rejects unsafe refs before reading or resolving them', () => {
  const result = runSync([
    '--ref',
    '../master',
    '--source-file',
    FIXTURE,
    '--dry-run',
  ])

  assert.equal(result.status, 1)
  assert.match(result.stderr, /unsafe or invalid public-apis ref/)
})

test('sync requires an explicit dry-run or write mode', () => {
  const result = runSync(['--ref', REVISION, '--source-file', FIXTURE])
  assert.equal(result.status, 2)
  assert.match(result.stderr, /one of the arguments --dry-run --write is required/)
})

test('maintenance URL policy rejects credential-like query key variants', () => {
  const helper = String.raw`
import copy
import sys
from pathlib import Path
sys.path.insert(0, sys.argv[1])
from catalog import load_json, url_problem, validate_catalog

keys = [
    "client_secret", "x-api-key", "subscription-key", "refresh_token",
    "X-Amz-Credential", "X-Amz-Signature", "X-Goog-Signature",
    "sig", "key", "auth",
]
for key in keys:
    problem = url_problem(f"https://example.test/docs?{key}=TOPSECRET")
    assert problem is not None and "sensitive query" in problem, (key, problem)

catalog = load_json(Path(sys.argv[2]))
catalog["records"] = [copy.deepcopy(catalog["records"][0])]
catalog["records"][0]["rights"] = {
    "license_url": "https://example.test/license?client_secret=TOPSECRET",
    "authorization": {"api_key": "TOPSECRET"},
    "private_state": "TOPSECRET",
}
errors = validate_catalog(catalog)
message = "; ".join(errors)
assert "rights: unexpected key 'private_state'" in message
assert "rights.authorization: must be a string or null" in message
assert "rights.license_url: must not contain sensitive query" in message
assert "TOPSECRET" not in message
`
  const result = spawnSync(
    PYTHON,
    ['-c', helper, join(ROOT, 'maintenance'), join(ROOT, 'data', 'catalog.json')],
    { cwd: ROOT, encoding: 'utf8' },
  )
  assert.equal(result.status, 0, result.stderr)
})
