#!/usr/bin/env node
/**
 * Starts Firebase emulators with the demo snapshot (no seed wipe).
 *
 * Bootstrap (first time):
 *   pnpm emulators:seed          ← fresh seed + keep running
 *   pnpm emulators:export:demo   ← save to snapshots/demo/
 *   pnpm emulators:demo          ← from now on, use this
 *
 * Usage:
 *   Terminal 1:  pnpm emulators:demo
 *   Terminal 2:  pnpm dev:web
 *
 * State is auto-saved to snapshots/demo/ on exit (--export-on-exit).
 * To discard changes and reset to saved state: Ctrl+C then pnpm emulators:demo again.
 */

import { spawn } from 'child_process'
import { createConnection } from 'net'
import { existsSync } from 'fs'
import { fileURLToPath } from 'url'
import { join, dirname } from 'path'

const ROOT     = join(dirname(fileURLToPath(import.meta.url)), '..')
const SNAPSHOT = join(ROOT, 'snapshots', 'demo')

if (!existsSync(SNAPSHOT)) {
  console.error('❌ Demo snapshot not found at snapshots/demo/')
  console.error('   Bootstrap it first:')
  console.error('     pnpm emulators:seed          ← start fresh + seed')
  console.error('     pnpm emulators:export:demo   ← save snapshot (while emulators:seed is running)')
  process.exit(1)
}

function run(cmd, args, opts = {}) {
  return spawn(cmd, args, { stdio: 'inherit', shell: true, cwd: ROOT, ...opts })
}

function waitForPort(port, timeoutMs = 120_000) {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + timeoutMs
    function attempt() {
      const sock = createConnection(port, '127.0.0.1')
      sock.on('connect', () => { sock.destroy(); resolve() })
      sock.on('error', () => {
        sock.destroy()
        if (Date.now() > deadline) reject(new Error(`Port ${port} not available after ${timeoutMs}ms`))
        else setTimeout(attempt, 1000)
      })
    }
    attempt()
  })
}

function runToCompletion(cmd, args) {
  return new Promise((resolve) => {
    const p = run(cmd, args)
    p.on('exit', (code) => resolve(code ?? 0))
  })
}

console.log('==> Building @linyup/shared…')
const sharedCode = await runToCompletion('pnpm', ['--filter', '@linyup/shared', 'run', 'build'])
if (sharedCode !== 0) { console.error('❌ Shared build failed'); process.exit(1) }

console.log('==> Building Cloud Functions…')
const fnCode = await runToCompletion('pnpm', ['--filter', '@linyup/functions', 'run', 'build'])
if (fnCode !== 0) { console.error('❌ Functions build failed'); process.exit(1) }

console.log(`==> Starting Firebase emulators with demo snapshot (${SNAPSHOT})`)
const emulators = run('pnpm', [
  'exec', 'firebase', 'emulators:start',
  '--only', 'auth,firestore,functions',
  '--project', 'demo-linyup',
  `--import=${SNAPSHOT}`,
  `--export-on-exit=${SNAPSHOT}`,
])

function cleanup() { try { emulators.kill() } catch {} }
process.on('exit', cleanup)
process.on('SIGINT', () => process.exit(0))
process.on('SIGTERM', () => process.exit(0))

console.log('==> Waiting for Firestore emulator on :8080')
await waitForPort(8080)
console.log('==> Waiting for Auth emulator on :9099')
await waitForPort(9099)
console.log('==> Waiting for Functions emulator on :5001')
await waitForPort(5001)

console.log('\n✅ Demo snapshot loaded — start the web app: pnpm dev:web')
console.log('   State will be auto-saved to snapshots/demo/ on exit.\n')

await new Promise(() => {})
