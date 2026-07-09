// Launch `next dev` against the CLOUD sandbox (linyup-sandbox) with the values
// in .env.sandbox overriding the emulator config in .env.local.
//
// We can't use `node --env-file=.env.sandbox next dev`: Next's dev worker
// re-execs Node and forwards the launcher's flags via NODE_OPTIONS, and Node
// rejects `--env-file=` there ("--env-file= is not allowed in NODE_OPTIONS",
// exit 9). Instead we load the file into process.env HERE, then spawn a plain
// `next dev` child (clean NODE_OPTIONS) that inherits it. Next's own @next/env
// won't override keys already present in process.env, so .env.sandbox wins —
// which is why .env.sandbox must also blank the emulator-host vars that
// .env.local sets, or they'd leak in and point the console back at the emulator.
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const dir = dirname(fileURLToPath(import.meta.url))
process.loadEnvFile(join(dir, '.env.sandbox'))

const child = spawn(
  process.execPath,
  [join(dir, 'node_modules/next/dist/bin/next'), 'dev', '--turbopack', '--port', '3002'],
  { stdio: 'inherit', env: process.env, cwd: dir },
)
child.on('exit', (code) => process.exit(code ?? 0))
