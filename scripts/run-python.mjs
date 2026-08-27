import { spawnSync } from 'node:child_process'

const [script, ...args] = process.argv.slice(2)
if (!script) {
  console.error('usage: node scripts/run-python.mjs <script.py> [...args]')
  process.exit(2)
}

const python = process.env.PYTHON || (process.platform === 'win32' ? 'python' : 'python3')
const result = spawnSync(python, [script, ...args], { stdio: 'inherit' })

if (result.error) {
  console.error(`failed to start ${python}: ${result.error.message}`)
  process.exit(1)
}
if (result.signal) {
  console.error(`${python} terminated by signal ${result.signal}`)
  process.exit(1)
}
process.exit(result.status ?? 1)
