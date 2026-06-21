#!/usr/bin/env node
/**
 * Starts Firebase emulators (auth, firestore, functions, storage), waits for
 * them, seeds the database, then keeps running until Ctrl+C.
 *
 * Usage (two terminals):
 *   Terminal 1:  pnpm emulators:seed
 *   Terminal 2:  pnpm dev:web
 */

import { spawn } from 'child_process'
import { createConnection } from 'net'
import { fileURLToPath } from 'url'
import { join, dirname } from 'path'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

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
const sharedBuildCode = await runToCompletion('pnpm', ['--filter', '@linyup/shared', 'run', 'build'])
if (sharedBuildCode !== 0) {
  console.error('❌ Shared package build failed')
  process.exit(1)
}

console.log('==> Building Cloud Functions…')
const buildCode = await runToCompletion('pnpm', ['--filter', '@linyup/functions', 'run', 'build'])
if (buildCode !== 0) {
  console.error('❌ Functions build failed')
  process.exit(1)
}

console.log('==> Starting Firebase emulators (auth, firestore, functions, storage)')
const emulators = run('pnpm', ['exec', 'firebase', 'emulators:start',
  '--only', 'auth,firestore,functions,storage', '--project', 'demo-linyup'])

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
console.log('==> Waiting for Storage emulator on :9199')
await waitForPort(9199)
console.log('    emulators up')

console.log('==> Seeding emulator data')
const seedCode = await runToCompletion('pnpm', ['exec', 'tsx', 'scripts/seed-emulator.ts'])
if (seedCode !== 0) console.log('    seed failed (continuing anyway)')

console.log('\n✅ Ready — start the web app in another terminal: pnpm dev:web\n')

// Keep process alive so emulators stay up
await new Promise(() => {})
