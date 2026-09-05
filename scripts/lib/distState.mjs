// scripts/lib/distState.mjs — is a workspace package's `dist/` older than its
// `src/`?
//
// `@linyup/shared` resolves to its BUILT `dist/` (package.json `main`), and so
// does the functions emulator for `packages/functions`. Nothing rebuilds them
// on its own: `pnpm install` never does, and every dev entry point that
// bypasses turbo (`dev:*`, a filtered `typecheck`, the emulator, the seeders,
// the backfill scripts) reads whatever is on disk. A stale dist fails as
// "X is not a function" or as code that quietly behaves like last week's
// branch — never as "please rebuild". So two places ask the same question and
// they must agree: `pnpm bootstrap` (decides whether to build) and
// `local-env status` (warns). This is the ONE implementation.
import { statSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

/** The packages whose dist other code reads. Add here, nowhere else. */
export const BUILT_PACKAGES = [
  { name: '@linyup/shared', dir: 'packages/shared', src: 'src', dist: 'dist/index.js' },
  { name: '@linyup/functions', dir: 'packages/functions', src: 'src', dist: 'dist/index.js' },
]

// Test files are excluded from tsconfig.build, so editing one changes no
// output — counting it would report a stale dist that a rebuild cannot fix.
const NOT_BUILT = /\.(test|rules-test|spec)\.tsx?$|\.test\.json$/

function newestMtime(dir) {
  let newest = 0
  let entries
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return 0
  }
  for (const e of entries) {
    const p = join(dir, e.name)
    if (e.isDirectory()) {
      if (e.name === '__fixtures__' || e.name === 'node_modules') continue
      newest = Math.max(newest, newestMtime(p))
    } else if (!NOT_BUILT.test(e.name)) {
      try {
        newest = Math.max(newest, statSync(p).mtimeMs)
      } catch {
        /* vanished mid-walk — ignore */
      }
    }
  }
  return newest
}

/**
 * @returns {{ state: 'missing'|'stale'|'fresh', built: Date|null, srcChanged: Date|null }}
 */
export function distState(root, pkg) {
  let built = null
  try {
    built = statSync(join(root, pkg.dir, pkg.dist)).mtime
  } catch {
    return { state: 'missing', built: null, srcChanged: null }
  }
  const src = newestMtime(join(root, pkg.dir, pkg.src))
  const srcChanged = src ? new Date(src) : null
  return { state: srcChanged && srcChanged > built ? 'stale' : 'fresh', built, srcChanged }
}
