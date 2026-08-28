#!/usr/bin/env node
/**
 * Guards the four locale files. Run by CI and by `pnpm i18n:check`.
 *
 * Nothing enforced any of this before 2026-08-17 — `apps/web` has no test
 * runner, so locale parity was held by discipline alone across 5,360 keys. It
 * happened to be intact, which is luck rather than a system, and the whole
 * point of parallelising UI work is that more hands will now be adding keys.
 *
 * Four checks, in order of how quietly they fail in production:
 *
 *   1. PARITY — a key present in en and absent in de renders the raw key id
 *      ("Namespace.someKey") to a German user. Silent in every English test.
 *   2. PLACEHOLDERS — a translation that drops `{count}` is a next-intl RUNTIME
 *      ERROR, and only in the locale nobody clicks through.
 *   3. USED KEYS — every `t('key')` a component calls exists in the namespace
 *      its accessor was bound to. Checks 1 and 2 guard the locale files against
 *      EACH OTHER; nothing guarded them against the CODE, and a key that exists
 *      in no locale is perfectly consistent across all four. See lib/usedKeys.
 *   4. UNTRANSLATED — a non-English value byte-identical to English is usually
 *      an agent that filled three locales by copy-paste. Reported, NOT failed:
 *      short strings ("OK", "Stripe", "E-Mail") legitimately match, so this one
 *      is advice, and pretending otherwise would make the whole check ignorable.
 */

import { readFileSync, readdirSync, existsSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { LOCALES, flatten, placeholderProblems } from './lib/icuMessages.mjs'
import { checkUsedKeys } from './lib/usedKeys.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const MESSAGES = join(ROOT, 'apps/web/messages')

// An UNMERGED fragment is the failure mode this whole scheme introduces: the
// lane's components ship referencing keys that were never applied, so every
// visitor sees the raw key id. Typecheck cannot catch it — there is no
// IntlMessages augmentation, so message keys are untyped strings.
const PENDING = join(MESSAGES, '_pending')
const stranded = existsSync(PENDING) ? readdirSync(PENDING).filter((f) => f.endsWith('.json')) : []
if (stranded.length) {
  console.error(
    `\n✗ ${stranded.length} unmerged message fragment(s): ${stranded.join(', ')}` +
      `\n  Run: pnpm i18n:merge\n`
  )
  process.exit(1)
}

// The NESTED tree, for check 3 — a dotted key has to be walked, not looked up
// in the flattened map (a namespace can hold an object).
const enMessages = JSON.parse(readFileSync(join(MESSAGES, 'en.json'), 'utf8'))

const flat = Object.fromEntries(
  LOCALES.map((l) => [l, flatten(JSON.parse(readFileSync(join(MESSAGES, `${l}.json`), 'utf8')))])
)

const errors = []
const enKeys = Object.keys(flat.en)

for (const locale of LOCALES.slice(1)) {
  for (const key of enKeys) {
    if (!(key in flat[locale])) errors.push(`${key} — missing in ${locale}`)
  }
  for (const key of Object.keys(flat[locale])) {
    if (!(key in flat.en)) errors.push(`${key} — present in ${locale} but not in en`)
  }
}

for (const key of enKeys) {
  for (const locale of LOCALES.slice(1)) {
    if (!(key in flat[locale])) continue
    const problem = placeholderProblems(key, flat.en[key], flat[locale][key], locale)
    if (problem) errors.push(problem)
  }
}

// ── 3. USED KEYS ────────────────────────────────────────────────────────────
const used = checkUsedKeys(join(ROOT, 'apps/web/src'), enMessages, ROOT)
for (const p of used.problems) errors.push(p)

// Advisory only — see the header.
const suspect = []
for (const key of enKeys) {
  const copies = LOCALES.slice(1).filter((l) => flat[l][key] === flat.en[key])
  if (copies.length === 3 && flat.en[key].length > 30) suspect.push(`${key} — identical in all four`)
}

if (errors.length) {
  console.error(`\n✗ ${errors.length} locale problem${errors.length === 1 ? '' : 's'}:\n`)
  for (const e of errors.slice(0, 40)) console.error(`  • ${e}`)
  if (errors.length > 40) console.error(`  … and ${errors.length - 40} more`)
  console.error('')
  process.exit(1)
}

console.log(
  `✓ ${enKeys.length} keys, four locales in parity, placeholders consistent; ` +
    `${used.checked} key use(s) resolve`
)
if (suspect.length) {
  console.log(`\n  ${suspect.length} key(s) identical across all four locales — check if untranslated:`)
  for (const s of suspect.slice(0, 15)) console.log(`    ? ${s}`)
  if (suspect.length > 15) console.log(`    … and ${suspect.length - 15} more`)
}
