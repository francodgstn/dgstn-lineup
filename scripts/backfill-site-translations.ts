/**
 * Backfills `i18n` (site translations) onto every already-published tenant
 * site — team (`site_published`), org (`org_site_published`) and embed widget
 * sets (`embed_widgets`) — through the SAME pipeline `publishWebsite` /
 * `publishOrgWebsite` / `onEmbedWidgetsWritten` use, so a backfilled doc and
 * one produced by a fresh publish are byte-for-byte the same shape.
 *
 * ── WHY THIS IS NEEDED AT ALL ────────────────────────────────────────────────
 * `i18n` is only ever written by a WRITE to the owning doc (a publish, or a
 * widgets save). Every site published or every widget set saved before this
 * feature shipped has none, and nothing re-publishes it on its own — a
 * studio's page silently degrades to base-language-only for every visitor
 * whose UI language differs, forever, unless this runs once.
 *
 * ── IDEMPOTENT BY THE HASH CACHE ─────────────────────────────────────────────
 * `buildSiteTranslations` reuses a locale's units verbatim while their
 * `srcHash` still matches, so running this twice against the same content
 * costs zero additional provider calls the second time — safe to re-run after
 * a partial failure, or on a schedule.
 *
 * ── COST PREVIEW, NOT A DRY-RUN GUESS ────────────────────────────────────────
 * `--dry-run` extracts the REAL units for every candidate doc (the exact
 * extractor the write path uses) and reports unit + character counts, which is
 * what a DeepL bill scales with — not a placeholder estimate.
 *
 * Auth: gcloud Application Default Credentials (ADC), like the other backfill
 * scripts. Against the emulator, set FIRESTORE_EMULATOR_HOST and use the demo
 * project. DeepL key: `DEEPL_API_KEY` env var, else `packages/functions/.env.local`
 * (the same file the Functions emulator loads — NOT Secret Manager; this is a
 * one-off operator run, not a deployed function); unset in both places ⇒ every
 * doc still gets its manifest reconciled (locales: [] unless something was
 * reusable from a previous run), with one warning, exactly like a live publish
 * with no key configured.
 *
 * Usage:
 *   tsx scripts/backfill-site-translations.ts --project linyup-staging \
 *     [--only site|org|widgets] [--team <id>] [--org <id>] [--dry-run] [--yes]
 */

import { createInterface } from 'node:readline/promises'
import { parseArgs } from 'node:util'
import * as fs from 'node:fs'
import * as path from 'node:path'
import admin from 'firebase-admin'
import { applicationDefault } from 'firebase-admin/app'
import {
  SITE_PUBLISHED_COLLECTION,
  ORG_SITE_PUBLISHED_COLLECTION,
  EMBED_WIDGETS_COLLECTION,
  TEAMS_COLLECTION,
  ORGANIZATIONS_COLLECTION,
  SITE_I18N_SEPARATOR,
  PUBLIC_LOCALES,
  extractSiteUnits,
  resolveSiteSourceLocale,
  type EmbedWidget,
  type SiteMenuItem,
  type SiteMeta,
  type SiteTranslationUnits,
  type UiLanguage,
  type WebsiteSection,
  type OrgSiteSection,
} from '@linyup/shared'
// DELIBERATE cross-package import — same discipline as
// backfill-document-versions.ts / backfill-document-mirrors.ts: this must run
// through the EXACT pipeline the live writers use, not a re-implementation of
// it that could silently drift.
import { translatePublishedSite, buildSiteTranslations } from '../packages/functions/src/translate/translateSite'
import { translateBatchWithKey } from '../packages/functions/src/translate/deeplProvider'
import { googleProviderFor } from '../packages/functions/src/translate/googleProvider'
import type { TranslationProvider } from '../packages/functions/src/translate/types'

const { values } = parseArgs({
  options: {
    project: { type: 'string' },
    only: { type: 'string' }, // 'site' | 'org' | 'widgets'
    team: { type: 'string' },
    org: { type: 'string' },
    'dry-run': { type: 'boolean', default: false },
    yes: { type: 'boolean', default: false },
  },
})

if (!values.project) {
  console.error('❌ --project is required (e.g. --project linyup-staging, or demo-linyup for the emulator)')
  process.exit(1)
}
if (values.only && !['site', 'org', 'widgets'].includes(values.only)) {
  console.error("❌ --only must be one of: site, org, widgets")
  process.exit(1)
}

admin.initializeApp({ credential: applicationDefault(), projectId: values.project })
const db = admin.firestore()

const isEmulator = !!process.env.FIRESTORE_EMULATOR_HOST
const dryRun = values['dry-run'] === true
const only = values.only as 'site' | 'org' | 'widgets' | undefined

// Prefer the env var; else read DEEPL_API_KEY from packages/functions/.env.local
// (the same file the Functions emulator loads) — same fallback
// scripts/connect-test-account.ts uses for STRIPE_SECRET_KEY.
function deeplApiKey(): string | null {
  if (process.env.DEEPL_API_KEY) return process.env.DEEPL_API_KEY
  const envPath = path.resolve(__dirname, '../packages/functions/.env.local')
  try {
    const line = fs
      .readFileSync(envPath, 'utf8')
      .split('\n')
      .find((l) => l.trim().startsWith('DEEPL_API_KEY='))
    if (line) return line.slice(line.indexOf('=') + 1).trim().replace(/^["']|["']$/g, '')
  } catch {
    /* no .env.local — fall through */
  }
  return null
}

function buildProviderFromEnv(): TranslationProvider | null {
  // TRANSLATION_PROVIDER=google uses Cloud Translation over the same ADC the
  // admin SDK is already running on, billed to --project. Default is DeepL.
  if ((process.env.TRANSLATION_PROVIDER ?? '').trim().toLowerCase() === 'google') {
    return googleProviderFor(values.project as string)
  }
  const key = deeplApiKey()
  if (!key) {
    console.warn('⚠️  DEEPL_API_KEY not set (env or packages/functions/.env.local) — manifests will be reconciled from cached units only (no new provider calls). Alternatively set TRANSLATION_PROVIDER=google to translate via Cloud Translation on ADC.\n')
    return null
  }
  return { translateBatch: (req) => translateBatchWithKey(key, req) }
}

const stats = {
  site: { docs: 0, units: 0, chars: 0 },
  org: { docs: 0, units: 0, chars: 0 },
  widgets: { docs: 0, units: 0, chars: 0 },
}

function charCount(units: { text: string }[]): number {
  return units.reduce((sum, u) => sum + u.text.length, 0)
}

async function processSites(provider: TranslationProvider | null): Promise<void> {
  let q: FirebaseFirestore.Query = db.collection(SITE_PUBLISHED_COLLECTION)
  if (values.team) q = q.where('teamId', '==', values.team)
  const snap = await q.get()

  for (const doc of snap.docs) {
    // SKIP sidecars — they live in the same collection and must never be
    // treated as a base site (see SITE_I18N_SEPARATOR, paths.ts).
    if (doc.id.includes(SITE_I18N_SEPARATOR)) continue
    const data = doc.data()
    const teamId = (data.teamId as string) ?? doc.id
    const teamSnap = await db.doc(`${TEAMS_COLLECTION}/${teamId}`).get()
    const srcLang = resolveSiteSourceLocale(teamSnap.data() as { language?: string | null } | undefined)
    const sections = (data.sections ?? []) as WebsiteSection[]
    const meta = data.meta as SiteMeta | undefined
    const menu = data.menu as SiteMenuItem[] | undefined

    const units = extractSiteUnits({ meta, menu, sections })
    stats.site.docs += 1
    stats.site.units += units.length
    stats.site.chars += charCount(units)
    console.log(`   site ${teamId} (${doc.id}): ${units.length} units, ${charCount(units)} chars, srcLang=${srcLang}`)

    if (dryRun) continue

    const manifest = await translatePublishedSite({
      db,
      collection: SITE_PUBLISHED_COLLECTION,
      id: doc.id,
      owner: { teamId },
      published: { meta, menu, sections },
      srcLang,
      provider,
    })
    await doc.ref.set({ i18n: manifest }, { merge: true })
    console.log(`      -> locales: ${manifest.locales.join(', ') || 'none'}`)
  }
}

async function processOrgs(provider: TranslationProvider | null): Promise<void> {
  let q: FirebaseFirestore.Query = db.collection(ORG_SITE_PUBLISHED_COLLECTION)
  if (values.org) q = q.where('orgId', '==', values.org)
  const snap = await q.get()

  for (const doc of snap.docs) {
    if (doc.id.includes(SITE_I18N_SEPARATOR)) continue
    const data = doc.data()
    const orgId = (data.orgId as string) ?? doc.id
    const orgSnap = await db.doc(`${ORGANIZATIONS_COLLECTION}/${orgId}`).get()
    const srcLang = resolveSiteSourceLocale(orgSnap.data() as { language?: string | null } | undefined)
    const sections = (data.sections ?? []) as OrgSiteSection[]
    const meta = data.meta as SiteMeta | undefined
    const menu = data.menu as SiteMenuItem[] | undefined

    const units = extractSiteUnits({ meta, menu, sections })
    stats.org.docs += 1
    stats.org.units += units.length
    stats.org.chars += charCount(units)
    console.log(`   org ${orgId} (${doc.id}): ${units.length} units, ${charCount(units)} chars, srcLang=${srcLang}`)

    if (dryRun) continue

    const manifest = await translatePublishedSite({
      db,
      collection: ORG_SITE_PUBLISHED_COLLECTION,
      id: doc.id,
      owner: { orgId },
      published: { meta, menu, sections },
      srcLang,
      provider,
    })
    await doc.ref.set({ i18n: manifest }, { merge: true })
    console.log(`      -> locales: ${manifest.locales.join(', ') || 'none'}`)
  }
}

async function processWidgets(provider: TranslationProvider | null): Promise<void> {
  // embed_widgets/{teamId} — doc id IS the teamId, so a --team filter is a
  // direct get rather than a query.
  const docs = values.team
    ? [await db.collection(EMBED_WIDGETS_COLLECTION).doc(values.team).get()]
    : (await db.collection(EMBED_WIDGETS_COLLECTION).get()).docs

  for (const doc of docs) {
    if (!doc.exists) continue
    const data = doc.data()!
    const teamId = (data.teamId as string) ?? doc.id
    const teamSnap = await db.doc(`${TEAMS_COLLECTION}/${teamId}`).get()
    const srcLang = resolveSiteSourceLocale(teamSnap.data() as { language?: string | null } | undefined)
    const widgets = (data.widgets ?? []) as EmbedWidget[]

    const units = extractSiteUnits({ sections: widgets })
    stats.widgets.docs += 1
    stats.widgets.units += units.length
    stats.widgets.chars += charCount(units)
    console.log(`   widgets ${teamId}: ${units.length} units, ${charCount(units)} chars, srcLang=${srcLang}`)

    if (dryRun) continue

    // No sidecar docs for widgets — the trigger writes `i18n` WHOLE onto the
    // same doc, so the backfill does the same rather than relying on the
    // trigger firing (it may not be deployed against this project yet).
    const previous = (data.i18n?.locales ?? {}) as Partial<Record<UiLanguage, SiteTranslationUnits>>
    const targets = (PUBLIC_LOCALES as readonly UiLanguage[]).filter((l) => l !== srcLang)
    const desired = await buildSiteTranslations({ units, srcLang, targets, previous, provider })
    await doc.ref.update({ i18n: { srcLang, locales: desired } })
    console.log(`      -> locales: ${Object.keys(desired).join(', ') || 'none'}`)
  }
}

async function main() {
  console.log(
    `\n🌐 Site translation backfill on '${values.project}'${only ? ` (only=${only})` : ''}${
      values.team ? ` (team ${values.team})` : ''
    }${values.org ? ` (org ${values.org})` : ''} ${dryRun ? '(dry-run)' : '(APPLY)'}\n`
  )

  if (!dryRun && !values.yes && !isEmulator) {
    const rl = createInterface({ input: process.stdin, output: process.stdout })
    const answer = await rl.question(
      `This calls a paid translation provider and writes i18n data on '${values.project}'. Type '${values.project}' to confirm: `
    )
    rl.close()
    if (answer.trim() !== values.project) {
      console.error('❌ Confirmation did not match — aborted. Nothing was written.\n')
      process.exit(1)
    }
  }

  const provider = dryRun ? null : buildProviderFromEnv()

  if (!only || only === 'site') await processSites(provider)
  if (!only || only === 'org') await processOrgs(provider)
  if (!only || only === 'widgets') await processWidgets(provider)

  console.log('\n📊 cost preview (units / chars extracted — chars is what a provider bills on):')
  console.log(`   site:    ${stats.site.docs} docs · ${stats.site.units} units · ${stats.site.chars} chars`)
  console.log(`   org:     ${stats.org.docs} docs · ${stats.org.units} units · ${stats.org.chars} chars`)
  console.log(`   widgets: ${stats.widgets.docs} docs · ${stats.widgets.units} units · ${stats.widgets.chars} chars`)
  if (dryRun) {
    console.log('\n   Re-run without --dry-run to write (the hash cache means an unchanged doc costs nothing on a re-run).\n')
  } else {
    console.log('\n✅ done.\n')
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
