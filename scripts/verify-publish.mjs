import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

import { releaseChannelForVersion } from './lib/release-gates.mjs'

const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
const channel = releaseChannelForVersion(manifest.version)
execFileSync('npm', [
  'publish',
  '--dry-run',
  '--tag',
  channel,
  '--access',
  'public',
  '--ignore-scripts',
  '--json',
], {
  cwd: new URL('../', import.meta.url),
  encoding: 'utf8',
  stdio: 'inherit',
})
