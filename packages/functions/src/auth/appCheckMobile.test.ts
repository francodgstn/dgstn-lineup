import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

// A10 — App Check enforcement must never be turned on for a callable the MOBILE
// app reaches: the Expo JS SDK cannot produce attestation tokens, so enforcing
// there takes the student app's only login path offline with no interpretable
// error. The two auth callables (sendContactVerificationCode, loginContactWithCode)
// used to declare the SAME APP_CHECK_ENFORCE flag as the web callables while a
// doc claimed they were excluded, so `APP_CHECK_ENFORCE=true` was a landmine.
//
// This test DERIVES the mobile-reachable set from source rather than trusting a
// hand list (the list is what rotted): it fails if any callable the mobile app
// calls is declared with the bare web flag.

const ROOT = join(__dirname, '..', '..', '..', '..')

function walk(dir: string, exts: string[]): string[] {
  let out: string[] = []
  for (const name of readdirSync(dir)) {
    if (['node_modules', '.next', 'dist', 'lib', '.expo', 'build'].includes(name)) continue
    const p = join(dir, name)
    if (statSync(p).isDirectory()) out = out.concat(walk(p, exts))
    else if (exts.some((e) => p.endsWith(e))) out.push(p)
  }
  return out
}

const fnFiles = walk(join(ROOT, 'packages', 'functions', 'src'), ['.ts']).filter(
  (f) => !f.endsWith('.test.ts') && !f.endsWith('.rules-test.ts')
)
const mobileSrc = walk(join(ROOT, 'apps', 'mobile', 'src'), ['.ts', '.tsx'])
  .map((f) => readFileSync(f, 'utf8'))
  .join('\n')

/** Callable names in files that declare the given enforcement flag. `onCall`'s
 *  options can sit on a later line, so match the flag per FILE and collect that
 *  file's `export const NAME = onCall` names. */
function enforcedCallableNames(flagMatch: RegExp): { names: Set<string>; files: string[] } {
  const names = new Set<string>()
  const files: string[] = []
  for (const f of fnFiles) {
    const src = readFileSync(f, 'utf8')
    if (!flagMatch.test(src)) continue
    files.push(f)
    for (const m of src.matchAll(/export const (\w+) = onCall/g)) names.add(m[1])
  }
  return { names, files }
}

describe('A10 — App Check enforcement never lands on a mobile-reachable callable', () => {
  it('the two auth callables declare the SEPARATE mobile flag', () => {
    for (const rel of ['sendContactVerificationCode.ts', 'loginContactWithCode.ts']) {
      const src = readFileSync(join(__dirname, rel), 'utf8')
      assert.match(src, /enforceAppCheck: APP_CHECK_ENFORCE_MOBILE/, `${rel} must use the mobile flag`)
    }
  })

  it('the mobile flag is declared by EXACTLY those two callables', () => {
    const { names } = enforcedCallableNames(/enforceAppCheck: APP_CHECK_ENFORCE_MOBILE/)
    assert.deepEqual(
      [...names].sort(),
      ['loginContactWithCode', 'sendContactVerificationCode'],
      'only the two auth callables may carry the mobile flag'
    )
  })

  it('no WEB-flagged callable is called from the mobile app', () => {
    // APP_CHECK_ENFORCE, but not APP_CHECK_ENFORCE_MOBILE.
    const { names } = enforcedCallableNames(/enforceAppCheck: APP_CHECK_ENFORCE(?!_MOBILE)/)
    const leaked = [...names].filter((n) => new RegExp(`['"]${n}['"]`).test(mobileSrc))
    assert.deepEqual(
      leaked,
      [],
      `these web-App-Check callables are reachable from apps/mobile and would 403 its clients: ${leaked.join(', ')}`
    )
  })

  it('sanity — the mobile app really does call the two auth callables', () => {
    assert.match(mobileSrc, /['"]sendContactVerificationCode['"]/)
    assert.match(mobileSrc, /['"]loginContactWithCode['"]/)
  })
})
