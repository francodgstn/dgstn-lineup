/**
 * CHECK 4 — every `t('key')` a component calls actually EXISTS in the namespace
 * its accessor was bound to.
 *
 * The three checks in `i18n-check.mjs` guard the locale FILES against each
 * other. Nothing guarded the files against the CODE, and the gap has a name in
 * CLAUDE.md: "message keys are untyped strings — a component referencing a key
 * that was never merged compiles, lints, and renders the raw key id to every
 * visitor". Parity cannot see it, because a key that exists in no locale is
 * perfectly consistent across all four.
 *
 * It found eight live ones on the day it was written — a contact's affiliation
 * removal dialog titled `affiliationRemoveTitle`, and four place/room labels on
 * the event form — all of them keys called through the WRONG namespace, which
 * is the shape this class almost always takes: the string exists, somebody
 * reaches it through the accessor that happened to be in scope.
 *
 * ── WHAT IT DELIBERATELY DOES NOT CATCH ─────────────────────────────────────
 *
 * COMPUTED KEYS. `t(`prefix.${x}`)` cannot be resolved without running the
 * component, so template-literal calls are counted and reported, never failed.
 * That is also why VisibleCalendarsMenu writes its section labels out as
 * literals — the comment there predates this checker and gives the reason.
 *
 * COMMENTS ARE BLANKED FIRST, offsets preserved so line numbers stay true. A
 * header that SHOWS a call — and one does, in that same file — is prose. A
 * checker that fails on prose earns a false positive, and a check with false
 * positives is one somebody switches off.
 *
 * ── HOW A CALL IS BOUND TO A NAMESPACE ──────────────────────────────────────
 *
 * The NEAREST PRECEDING `const t = useTranslations('NS')` of the same variable
 * name. Files here routinely declare several accessors all called `t`, one per
 * component, so a file-level map is wrong — it was the first thing this got
 * wrong, and it reported ninety-nine phantom failures.
 */

import { readFileSync, readdirSync, statSync } from 'fs'
import { join, relative } from 'path'

const BIND = /const\s+(\w+)\s*=\s*useTranslations(?:<[^>]*>)?\(\s*'([^']+)'\s*\)/g
const CALL = /\b(\w+)(?:\.raw)?\(\s*'([^']+)'/g
const COMMENTS = /\/\*[\s\S]*?\*\/|\/\/[^\n]*/g

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === '.next') continue
    const abs = join(dir, entry)
    if (statSync(abs).isDirectory()) walk(abs, out)
    else if (entry.endsWith('.tsx') || entry.endsWith('.ts')) out.push(abs)
  }
  return out
}

/** Walk a dotted key through the nested message tree. */
function resolves(messages, ns, key) {
  let node = messages[ns]
  if (node === undefined) return false
  for (const part of key.split('.')) {
    if (node === null || typeof node !== 'object' || !(part in node)) return false
    node = node[part]
  }
  return true
}

/**
 * @returns {{ problems: string[], checked: number, dynamic: number }}
 */
export function checkUsedKeys(srcDir, messages, root) {
  const problems = []
  let checked = 0
  let dynamic = 0

  for (const file of walk(srcDir)) {
    const raw = readFileSync(file, 'utf8')
    const src = raw.replace(COMMENTS, (m) => m.replace(/\S/g, ' '))

    const binds = []
    for (const m of src.matchAll(BIND)) binds.push({ at: m.index, name: m[1], ns: m[2] })
    if (binds.length === 0) continue
    const names = new Set(binds.map((b) => b.name))

    for (const m of src.matchAll(CALL)) {
      const [, name, key] = m
      if (!names.has(name)) continue
      let ns = null
      for (const b of binds) if (b.name === name && b.at < m.index) ns = b.ns
      if (ns === null) continue
      checked++
      if (!resolves(messages, ns, key)) {
        const line = src.slice(0, m.index).split('\n').length
        problems.push(
          `${relative(root, file).replace(/\\/g, '/')}:${line} — ${name}('${key}') has no ${ns}.${key}`
        )
      }
    }
    for (const name of names) {
      dynamic += (src.match(new RegExp(`\\b${name}\\(\\s*\``, 'g')) ?? []).length
    }
  }

  return { problems, checked, dynamic }
}
