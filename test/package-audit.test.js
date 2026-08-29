import assert from 'node:assert/strict'
import test from 'node:test'

import { normalizeTarballFileList } from '../scripts/lib/package-audit.mjs'

test('tarball listings are normalized beneath package/ and reject unsafe entries', () => {
  assert.deepEqual(
    normalizeTarballFileList('package/index.js\npackage/data/\npackage/data/catalog.json\n'),
    ['index.js', 'data/catalog.json'],
  )
  assert.throws(() => normalizeTarballFileList('outside.txt\n'), /outside package/u)
  assert.throws(() => normalizeTarballFileList('package/../outside.txt\n'), /unsafe/u)
  assert.throws(() => normalizeTarballFileList('package/index.js\npackage/index.js\n'), /duplicate/u)
})
