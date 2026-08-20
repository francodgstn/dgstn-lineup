#!/usr/bin/env node
/**
 * Thin launcher for `firebase emulators:start` that sets
 * FUNCTIONS_DISCOVERY_TIMEOUT before spawning it.
 *
 * ── WHY THIS FILE EXISTS ─────────────────────────────────────────────────────
 * firebase-tools gives the functions runtime 10 SECONDS to enumerate its
 * exports, and packages/functions is now big enough to miss that on a cold
 * start. When it misses, the emulator prints one line —
 *
 *   !! functions: Failed to load function definition from source: ...
 *      Cannot determine backend specification. Timeout after 10000.
 *
 * — and then cheerfully reports "All emulators ready!". Firestore, Auth and
 * Storage are all fine; ZERO functions are loaded, and every callable the app
 * makes fails with a bare `internal`. Nothing in the app says why.
 *
 * The variable cannot live in packages/functions/.env.local: that file is read
 * by the functions RUNTIME, and this timeout is consumed by firebase-tools in
 * the parent process, before any runtime exists. And an inline `VAR=x pnpm …`
 * prefix in package.json does not work under Windows' cmd.exe, which is where
 * this bites most. So it is set here, once, for every emulator entry point.
 *
 * Args are passed straight through, so each package.json script keeps owning
 * its own --import / --export-on-exit choices.
 */
import { spawn } from 'node:child_process'

// Generous rather than merely sufficient: the cost of being wrong is a silent
// functions-less emulator, and the cost of a high ceiling is nothing at all —
// discovery finishes when it finishes, the timeout is only the give-up point.
process.env.FUNCTIONS_DISCOVERY_TIMEOUT ??= '120'

const child = spawn(
  'pnpm',
  ['exec', 'firebase', 'emulators:start', ...process.argv.slice(2)],
  { stdio: 'inherit', shell: true }
)
child.on('exit', (code) => process.exit(code ?? 0))
