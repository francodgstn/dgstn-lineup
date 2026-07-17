/**
 * Seed script for **lead demo tenants** — prospective-customer sandboxes that
 * mirror a lead's real public data (schedule, offerings, pricing, site copy,
 * images — used with their permission) plus fully synthetic contacts.
 *
 * Generic engine: all lead-specific data lives in a LeadProfile module at
 * scripts/leads/{lead}/profile.ts (see scripts/leads/README.md for the
 * contract). Add a lead = add a profile folder under scripts/leads/{lead}/ (kept
 * local-only — gitignored). Lead tenants are NOT listed on the public
 * /try picker (apps/web/src/lib/demo.ts) — access is via their direct logins
 * and /public/{slug} URLs only.
 *
 * ──────────────────────────────────────────────────────────────────────────────
 * Usage:
 *   pnpm lead:seed --lead swimli            # cloud linyup-sandbox via ADC
 *   pnpm lead:seed --lead swimli --reset    # tear the lead's tenant down first
 *
 *   # Local emulator (rehearsal) — the easy way: --target emulator sets the
 *   # Firestore/Auth/Storage host env vars for you (start the emulators first):
 *   pnpm lead:seed --lead swimli --target emulator
 *
 *   # Also wire "pay with Linyup" (Stripe Connect) for the seeded team — pass an
 *   # already-onboarded Stripe TEST account (acct_…). Precedence: --connect flag >
 *   # STRIPE_CONNECT_TEST_ACCOUNT env > profile.stripeConnectTestAccount. Grab an
 *   # acct id with `pnpm connect:test-account --list`. Survives reseeds:
 *   pnpm lead:seed --lead swimli --target emulator --connect acct_123
 *
 *   # ...or set the hosts yourself (an already-set host wins over --target):
 *   FIRESTORE_EMULATOR_HOST=localhost:8080 \
 *   FIREBASE_AUTH_EMULATOR_HOST=localhost:9099 \
 *   FIREBASE_STORAGE_EMULATOR_HOST=localhost:9199 \
 *   pnpm lead:seed --lead swimli
 *
 * Targets (same dual-target pattern as seed-sandbox.ts):
 *   • Emulator when FIRESTORE_EMULATOR_HOST is set → `demo-linyup` namespace.
 *   • Otherwise the real `linyup-sandbox` project via ADC
 *     (`gcloud auth application-default login`).
 *
 * Storage bucket: `demo-linyup.appspot.com` (emulator) /
 * `linyup-sandbox.firebasestorage.app` (cloud) — override with
 * LEAD_STORAGE_BUCKET if the sandbox project uses the legacy .appspot.com name.
 *
 * Idempotent: deterministic IDs + set(), so re-running overwrites in place.
 * Renamed/removed profile entries leave stale docs behind — use --reset for a
 * clean slate (lead-scoped teardown; NEVER `pnpm sandbox:reset`, which wipes
 * the six /try playground teams too).
 */

import * as fs from 'node:fs'
import * as path from 'node:path'
import * as crypto from 'node:crypto'
import { parseArgs } from 'node:util'
import admin from 'firebase-admin'
import { applicationDefault } from 'firebase-admin/app'
import { DEFAULT_PAYMENT_MODES } from '@linyup/shared'
import {
  CONTACT_AFFILIATIONS_SUBCOLLECTION,
  AFFILIATION_TYPES_SUBCOLLECTION,
  teamAffiliationTypes,
  buildAffiliationDoc,
  buildAffiliationSummary,
  statusCountsAsActive,
} from './lib/affiliations'
import { buildStorefrontPageLinks } from './lib/storefront'
import { memberCapsFor, COACH_DEFAULT_CAPABILITIES } from './lib/roles'
import { linkConnectAccount } from './lib/connect'
import {
  appointmentOccurrences,
  buildAppointmentSessionDocs,
  buildAppointmentBookingDoc,
} from './lib/appointments'
import type {
  LeadProfile,
  LeadContactDef,
  LeadSubscriptionDef,
  LeadSiteSection,
} from './leads/types'

// ── CLI + target resolution ─────────────────────────────────────────────────
// NOTE: no Date construction may happen before the profile's timezone is
// applied in main() — Node caches the TZ on first use.

const { values: cli } = parseArgs({
  options: {
    lead: { type: 'string' },
    reset: { type: 'boolean', default: false },
    // `--target emulator` fills in the emulator host env vars below so you don't
    // have to; `cloud` (the default) targets linyup-sandbox via ADC.
    target: { type: 'string' },
    // Wire a Stripe TEST connected account (acct_…) for the "pay with Linyup" flow.
    // Precedence: --connect > STRIPE_CONNECT_TEST_ACCOUNT env > profile field. The
    // account must already be onboarded in Stripe test mode (see connect-test-account.ts).
    connect: { type: 'string' },
    // Pin the staff-login password instead of generating a random one — use it
    // when reseeding so the lead's known password keeps working.
    password: { type: 'string' },
  },
})
const LEAD = cli.lead ?? process.env.LEAD
if (!LEAD || !/^[a-z0-9-]+$/.test(LEAD)) {
  console.error(
    '❌ Missing/invalid --lead <id> (or LEAD env). Example: pnpm lead:seed --lead swimli'
  )
  process.exit(1)
}

// Convenience for local rehearsal: `--target emulator` points the run at the
// local Firebase emulators by setting the three host env vars (Firestore + Auth +
// Storage) to their defaults. A host already set in the environment always wins,
// so you can still override a port. Everything below keys off these env vars.
const TARGET = (cli.target ?? process.env.LEAD_TARGET ?? '').toLowerCase()
if (TARGET && !['emulator', 'emulators', 'cloud', 'sandbox'].includes(TARGET)) {
  console.error(`❌ Invalid --target '${TARGET}'. Use 'emulator' or 'cloud'.`)
  process.exit(1)
}
if (TARGET === 'emulator' || TARGET === 'emulators') {
  process.env.FIRESTORE_EMULATOR_HOST ??= 'localhost:8080'
  process.env.FIREBASE_AUTH_EMULATOR_HOST ??= 'localhost:9099'
  process.env.FIREBASE_STORAGE_EMULATOR_HOST ??= 'localhost:9199'
}

const USE_EMULATOR = !!process.env.FIRESTORE_EMULATOR_HOST
// Emulator convenience: the Auth host is required alongside Firestore — default
// it so a forgotten env var doesn't silently create users on a real project.
if (USE_EMULATOR && !process.env.FIREBASE_AUTH_EMULATOR_HOST) {
  process.env.FIREBASE_AUTH_EMULATOR_HOST = 'localhost:9099'
}
const HAS_STORAGE_EMULATOR = !!process.env.FIREBASE_STORAGE_EMULATOR_HOST
const PROJECT_ID = USE_EMULATOR ? process.env.GCLOUD_PROJECT || 'demo-linyup' : 'linyup-sandbox'
const BUCKET =
  process.env.LEAD_STORAGE_BUCKET ??
  (USE_EMULATOR ? 'demo-linyup.appspot.com' : 'linyup-sandbox.firebasestorage.app')

// Guard: this script only ever targets the sandbox project (or the emulator).
const envProject = process.env.GOOGLE_CLOUD_PROJECT || process.env.GCLOUD_PROJECT
if (!USE_EMULATOR && envProject && envProject !== PROJECT_ID) {
  console.error(`❌ Refusing to run: ambient project '${envProject}' != '${PROJECT_ID}'.`)
  process.exit(1)
}

admin.initializeApp(
  USE_EMULATOR
    ? { projectId: PROJECT_ID, storageBucket: BUCKET }
    : { credential: applicationDefault(), projectId: PROJECT_ID, storageBucket: BUCKET }
)

const auth = admin.auth()
const db = admin.firestore()
db.settings({ ignoreUndefinedProperties: true })

const STUDENT_SESSION_MS = 30 * 24 * 60 * 60 * 1000 // matches generateAuthToken

// Lead tenants go on the PUBLIC sandbox with real-lead owner logins, so no
// shared demo password: generate a strong random one per seed run (printed in
// the summary — note it before the terminal scrolls away). Pass --password to
// pin a specific value (e.g. re-running without rotating the lead's password).
// Unambiguous base58-ish alphabet — no 0/O/1/l/I.
function generateLeadPassword(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789'
  const bytes = crypto.randomBytes(16)
  let out = ''
  for (const b of bytes) out += alphabet[b % alphabet.length]
  return out
}
const DEMO_PASSWORD = cli.password || generateLeadPassword()

// ── generic helpers (mirroring seed-sandbox.ts) ─────────────────────────────

const ts = (date: Date) => admin.firestore.Timestamp.fromDate(date)
const now = () => new Date()

function daysFromNow(n: number) {
  const d = new Date()
  d.setDate(d.getDate() + n)
  return d
}
function minutesOffset(base: Date, minutes: number) {
  return new Date(base.getTime() + minutes * 60_000)
}
function hoursOffset(base: Date, hours: number) {
  return new Date(base.getTime() + hours * 3_600_000)
}
function isoWeekLabel(date: Date): string {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()))
  const dayNum = d.getUTCDay() || 7
  d.setUTCDate(d.getUTCDate() + 4 - dayNum)
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1))
  const week = Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7)
  return `${d.getUTCFullYear()}-W${week.toString().padStart(2, '0')}`
}
function mondayOfWeeksAgo(n: number): Date {
  const d = new Date()
  const day = d.getDay()
  d.setDate(d.getDate() - (day === 0 ? 6 : day - 1) - n * 7)
  d.setHours(0, 0, 0, 0)
  return d
}
function monthLabel(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}
function monthsAgo(n: number): Date {
  const d = new Date()
  d.setMonth(d.getMonth() - n)
  return d
}
// Deterministic pseudo-random in [0,1) from a string seed — keeps reruns stable.
function seededRand(seed: string): number {
  let h = 2166136261
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return ((h >>> 0) % 100000) / 100000
}

const SEED_SOURCES = ['website', 'referral', 'social', 'event', 'other'] as const
function pickSource(seed: string): (typeof SEED_SOURCES)[number] {
  return SEED_SOURCES[Math.floor(seededRand(seed + 'src') * SEED_SOURCES.length)]
}

// Derive the acquisition-axis fields written to a contact doc from the authoring
// `type` + whether the contact has attended (the authoring type/status are never
// written to the doc).
function acquisitionFieldsFor(opts: {
  type: 'student' | 'trial' | 'external'
  hasAttended: boolean
  milestoneTs: admin.firestore.Timestamp
  seed: string
  /** Authored acquisition source (profile override; default seeded-random). */
  source?: string
  /** Free-text detail shown with the source (e.g. 'QR poster', 'Meta ads'). */
  sourceDetail?: string
}): Record<string, unknown> {
  const { type, hasAttended, milestoneTs, seed } = opts
  const out: Record<string, unknown> = {
    acquisition_stage_updated_at: milestoneTs,
    source: opts.source ?? pickSource(seed),
    ...(opts.sourceDetail ? { source_detail: opts.sourceDetail } : {}),
  }
  if (type === 'student') {
    out.acquisition_stage = 'joined'
    out.entry = 'signup'
    out.converted_at = milestoneTs
  } else if (type === 'external') {
    out.acquisition_stage = 'joined'
    out.entry = 'import'
    out.converted_at = milestoneTs
  } else {
    out.entry = 'booking'
    if (hasAttended) {
      out.acquisition_stage = 'trial_attended'
      out.trial_attended_at = milestoneTs
    } else {
      out.acquisition_stage = 'trial_booked'
      out.lead_acknowledged = false
    }
  }
  return out
}

function stageForPoolEntry(type: 'student' | 'trial' | 'external', totalSessions: number): string {
  if (type === 'student' || type === 'external') return 'joined'
  return totalSessions > 0 ? 'trial_attended' : 'trial_booked'
}

function badgesFor(totalSessions: number, streak: number, seed: string): string[] {
  const out: string[] = []
  if (totalSessions >= 50) out.push('50_sessions')
  if (totalSessions >= 100) out.push('100_sessions')
  if (totalSessions >= 200) out.push('200_sessions')
  if (streak >= 4) out.push('streak_master')
  if (seededRand(seed + 'eb') > 0.6) out.push('early_bird')
  if (seededRand(seed + 'wr') > 0.75) out.push('weekend_warrior')
  return out
}

function slugEmail(c: { firstname: string; lastname: string }): string {
  return `${c.firstname}.${c.lastname}`
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // strip combining diacritics
    .replace(/[^a-z]+/g, '.')
    .replace(/\.+/g, '.')
    .replace(/^\.|\.$/g, '')
}

async function upsertAuthUser(opts: {
  uid: string
  email: string
  displayName: string
  password: string
  claims?: Record<string, unknown>
}) {
  const { uid, email, displayName, password, claims } = opts
  try {
    await auth.createUser({ uid, email, password, displayName, emailVerified: true })
  } catch (e: unknown) {
    const code = (e as { code?: string }).code
    if (code === 'auth/uid-already-exists' || code === 'auth/email-already-exists') {
      await auth
        .updateUser(uid, { email, password, displayName, emailVerified: true })
        .catch(() => {})
    } else {
      throw e
    }
  }
  if (claims) await auth.setCustomUserClaims(uid, claims)
}

// Provision Identity Platform + enable email/password sign-in on a fresh real
// project (the Auth emulator already has it enabled).
async function enableEmailPasswordSignIn() {
  const credential = admin.app().options.credential!
  const token = await (
    credential as { getAccessToken(): Promise<{ access_token: string }> }
  ).getAccessToken()
  const headers = {
    Authorization: `Bearer ${token.access_token}`,
    'Content-Type': 'application/json',
    'X-Goog-User-Project': PROJECT_ID,
  }
  const initRes = await fetch(
    `https://identitytoolkit.googleapis.com/v2/projects/${PROJECT_ID}/identityPlatform:initializeAuth`,
    { method: 'POST', headers, body: '{}' }
  )
  if (!initRes.ok) {
    const body = await initRes.text()
    if (initRes.status !== 409 && !/ALREADY/i.test(body)) {
      throw new Error(`Failed to initialize Identity Platform: ${initRes.status} ${body}`)
    }
  }
  const res = await fetch(
    `https://identitytoolkit.googleapis.com/v2/projects/${PROJECT_ID}/config` +
      `?updateMask=signIn.email.enabled,signIn.email.passwordRequired`,
    {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ signIn: { email: { enabled: true, passwordRequired: true } } }),
    }
  )
  if (!res.ok) {
    throw new Error(`Failed to enable email/password sign-in: ${res.status} ${await res.text()}`)
  }
  console.log('   ✓ Email/password sign-in enabled')
}

// ── asset uploads ───────────────────────────────────────────────────────────
// Drop-folder contract: scripts/leads/{lead}/assets/{baseName}.{jpg,jpeg,png,webp}.
// Uploads carry a firebaseStorageDownloadTokens metadata token and the seed
// stores the tokened download URL — the exact shape the app's own
// getDownloadURL() writes produce, so storage.rules need no changes and the
// admin UI can replace any image later. Missing files fall back to null
// (accent-color branding) with a warning.

const ASSET_EXTS = ['jpg', 'jpeg', 'png', 'webp'] as const
const MIME_BY_EXT: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
}

let assetsDir = '' // set in main() once the lead is known
const uploadedUrls = new Map<string, string | null>()
let uploadsDisabled = false
let uploadsDisabledReason = ''

function findAsset(baseName: string): { file: string; ext: string } | null {
  for (const ext of ASSET_EXTS) {
    const p = path.join(assetsDir, `${baseName}.${ext}`)
    if (fs.existsSync(p)) return { file: p, ext }
  }
  return null
}

async function uploadAsset(baseName: string, destBasePath: string): Promise<string | null> {
  const cacheKey = `${baseName}→${destBasePath}`
  if (uploadedUrls.has(cacheKey)) return uploadedUrls.get(cacheKey)!
  const found = findAsset(baseName)
  let url: string | null = null
  if (!found) {
    console.log(
      `   ⚠ asset '${baseName}' not found in ${path.relative(process.cwd(), assetsDir)} — using fallback`
    )
  } else if (uploadsDisabled) {
    console.log(`   ⚠ asset '${baseName}' skipped — ${uploadsDisabledReason}`)
  } else {
    const destPath = `${destBasePath}.${found.ext}`
    const token = crypto.randomUUID()
    await admin
      .storage()
      .bucket()
      .upload(found.file, {
        destination: destPath,
        metadata: {
          contentType: MIME_BY_EXT[found.ext],
          cacheControl: 'public,max-age=3600',
          metadata: { firebaseStorageDownloadTokens: token },
        },
      })
    const enc = encodeURIComponent(destPath)
    url = USE_EMULATOR
      ? `http://${process.env.FIREBASE_STORAGE_EMULATOR_HOST}/v0/b/${BUCKET}/o/${enc}?alt=media&token=${token}`
      : `https://firebasestorage.googleapis.com/v0/b/${BUCKET}/o/${enc}?alt=media&token=${token}`
  }
  uploadedUrls.set(cacheKey, url)
  return url
}

// Resolve *Asset keys on a website section into uploaded image URLs.
async function resolveSectionAssets(
  section: LeadSiteSection,
  teamId: string
): Promise<Record<string, unknown>> {
  const { imageAsset, bgImageAsset, imagesAssets, ...rest } = section
  const out: Record<string, unknown> = { ...rest }
  const dest = (base: string) => `teams/${teamId}/site/${section.id}/${base}`
  if (imageAsset) out.imageUrl = await uploadAsset(imageAsset, dest(imageAsset))
  if (bgImageAsset) out.bgImageUrl = await uploadAsset(bgImageAsset, dest(bgImageAsset))
  if (imagesAssets) {
    const urls: string[] = []
    for (const base of imagesAssets) {
      const u = await uploadAsset(base, dest(base))
      if (u) urls.push(u)
    }
    out.images = urls
  }
  return out
}

// ── lead-scoped reset (--reset) ─────────────────────────────────────────────
// Tears down ONLY this lead's tenant. Mirrors TENANT_DATA_COLLECTIONS +
// tenantStoragePrefix in packages/shared/src/tenantData.ts (re-declared here —
// scripts don't resolve the workspace import; keep in sync with that file).

const TENANT_FIELD_COLLECTIONS: { collection: string; field: string }[] = [
  { collection: 'contacts', field: 'teamId' },
  { collection: 'sessions', field: 'teamId' },
  { collection: 'activities', field: 'teamId' },
  { collection: 'events', field: 'teamId' },
  { collection: 'checkins', field: 'teamId' },
  { collection: 'session_series', field: 'teamId' },
  { collection: 'courses', field: 'teamId' },
  { collection: 'forms', field: 'teamId' },
  { collection: 'documents', field: 'teamId' },
  { collection: 'availability', field: 'teamId' },
  { collection: 'referrals', field: 'team_id' },
  { collection: 'referral_codes', field: 'teamId' },
  { collection: 'connect_accounts', field: 'teamId' },
  { collection: 'saas_checkout_attempts', field: 'teamId' },
  // Legacy: nothing writes auth_tokens any more (the mechanism was dead and was
  // removed 2026-07-17), but keep purging it so docs left by earlier seed runs of
  // an already-provisioned sandbox still get cleaned up on --reset.
  { collection: 'auth_tokens', field: 'teamId' },
]
const TENANT_DOCID_COLLECTIONS = [
  'saas_subscriptions',
  'site_drafts',
  'site_published',
  'embed_widgets',
  'messaging_policies',
]

async function resetLeadTenant(teamId: string) {
  console.log(`   ⟲ resetting tenant '${teamId}'…`)

  // teams/{teamId} subtree (members, plugins, subscription_types, products, …)
  await db.recursiveDelete(db.collection('teams').doc(teamId))

  for (const { collection, field } of TENANT_FIELD_COLLECTIONS) {
    const snap = await db.collection(collection).where(field, '==', teamId).get()
    for (const doc of snap.docs) await db.recursiveDelete(doc.ref)
    if (snap.size > 0) console.log(`     · ${collection}: ${snap.size} docs`)
  }
  for (const collection of TENANT_DOCID_COLLECTIONS) {
    await db.recursiveDelete(db.collection(collection).doc(teamId))
  }

  // Storage prefix (tenantStoragePrefix)
  if (!USE_EMULATOR || HAS_STORAGE_EMULATOR) {
    await admin
      .storage()
      .bucket()
      .deleteFiles({ prefix: `teams/${teamId}/` })
      .catch((e) => console.log(`     · storage cleanup skipped: ${(e as Error).message}`))
  }

  // Auth users: staff (uid prefix `{teamId}-`) + student logins (`contact:{teamId}:…`)
  // + users/{uid} profile docs.
  let pageToken: string | undefined
  const toDelete: string[] = []
  do {
    const page = await auth.listUsers(1000, pageToken)
    for (const u of page.users) {
      if (u.uid.startsWith(`${teamId}-`) || u.uid.startsWith(`contact:${teamId}:`)) {
        toDelete.push(u.uid)
      }
    }
    pageToken = page.pageToken
  } while (pageToken)
  if (toDelete.length > 0) {
    await auth.deleteUsers(toDelete)
    for (const uid of toDelete) {
      await db
        .collection('users')
        .doc(uid)
        .delete()
        .catch(() => {})
    }
    console.log(`     · auth users: ${toDelete.length}`)
  }
  console.log('   ✓ tenant reset complete')
}

// ── the seed ────────────────────────────────────────────────────────────────

async function seedLeadTenant(profile: LeadProfile) {
  const teamId = `lead-${profile.id}`
  const owner = profile.staff.find((s) => s.role === 'owner')
  if (!owner) throw new Error('LeadProfile.staff must contain an owner')
  const uidOf = (staffKey: string) =>
    staffKey === owner.key ? `${teamId}-uid` : `${teamId}-${staffKey}`
  const uid = uidOf(owner.key)
  // The operator who runs demos — receives all mail under the redirect policy AND
  // can sign in as the demo-login contact. Shared by the messaging policy + the
  // demo-login contact's login_emails.
  const OPERATOR_EMAIL = (process.env.LEAD_OPERATOR_EMAIL || 'franco.dgstn@gmail.com')
    .trim()
    .toLowerCase()
  // Real emails allowed to sign in AS the demo-login contact (operator + profile).
  const demoLoginEmails = [
    ...new Set(
      [OPERATOR_EMAIL, ...(profile.demoLoginEmails ?? [])]
        .map((e) => e.trim().toLowerCase())
        .filter(Boolean)
    ),
  ].slice(0, 5) // Contact.login_emails is capped at 5
  // How many FUTURE weeks of the weekly grid to materialize as bookable sessions
  // (default 3). A lead trying the system for a while wants a schedule that lasts,
  // so leads can extend it (swimli: ~3 months). The public booking window is
  // derived from this below so the extended sessions actually show.
  // NB: these are individually materialized session docs — the eventual scalable
  // path is recurring `session_series` + the generateRecurringSessions scheduled
  // function, which would roll the window forward on its own.
  const scheduleWeeksAhead = Math.max(1, profile.scheduleWeeksAhead ?? 3)
  const scheduleWeeksBack = Math.max(0, profile.scheduleWeeksBack ?? 4)
  const bookingWindowMonths = Math.max(2, Math.ceil(scheduleWeeksAhead / 4))
  const staffByKey = new Map(profile.staff.map((s) => [s.key, s]))
  const staffName = (key: string) => {
    const s = staffByKey.get(key)
    if (!s) throw new Error(`Unknown staffKey '${key}' in profile '${profile.id}'`)
    return `${s.firstname} ${s.lastname}`.trim()
  }

  // ── subscription types ────────────────────────────────────────────────────
  const subByKey = new Map(profile.subscriptions.map((s) => [s.key, s]))
  const subIdOf = (key: string) => `${teamId}-sub-${key}`
  // Firestore price entries for a subscription type: multi-price `prices[]` when
  // authored, else the legacy single price/recurrence/includedMonths fields.
  function subPricesOf(st: (typeof profile.subscriptions)[number]) {
    const id = subIdOf(st.key)
    if (st.prices?.length) {
      return st.prices.map((p) => ({
        id: `${id}-price-${p.key}`,
        amount: p.amount,
        recurrence: p.recurrence,
        active: true,
        ...(p.label ? { label: p.label } : {}),
        ...(p.includedMonths ? { included_months: p.includedMonths } : {}),
        ...(p.credits ? { credits: p.credits } : {}),
      }))
    }
    if (st.price != null && st.recurrence) {
      return [
        {
          id: `${id}-price`,
          amount: st.price,
          recurrence: st.recurrence,
          active: true,
          ...(st.includedMonths ? { included_months: st.includedMonths } : {}),
        },
      ]
    }
    return []
  }
  // Shop contact-capture mode: 'full' when any price creates a lasting membership.
  function subCheckoutMode(st: (typeof profile.subscriptions)[number]) {
    const prices = subPricesOf(st)
    return prices.some((p) => p.recurrence !== 'per_class') ? 'full' : 'minimal'
  }
  function resolveSub(subKey: string | null): {
    id: string
    name: string
    recurrence: string | null
    priceId?: string
    amount?: number
  } | null {
    if (!subKey) return null
    const found = subByKey.get(subKey)
    if (!found) throw new Error(`Unknown subKey '${subKey}' in profile '${profile.id}'`)
    const id = subIdOf(found.key)
    const prices = subPricesOf(found)
    if (prices.length > 0) {
      // Contacts snapshot the first authored price (the "standard" one).
      const p = prices[0]
      return { id, name: found.name, recurrence: p.recurrence, priceId: p.id, amount: p.amount }
    }
    return { id, name: found.name, recurrence: found.recurrence }
  }

  // ── places ────────────────────────────────────────────────────────────────
  const placeByKey = new Map((profile.places ?? []).map((p) => [p.key, p]))
  const placeIdOf = (key: string) => `${teamId}-place-${key}`
  function resolvePlace(placeKey?: string): {
    placeId: string | null
    label: string
    address: string
    mapsUrl: string | null
  } {
    if (placeKey) {
      const p = placeByKey.get(placeKey)
      if (!p) throw new Error(`Unknown placeKey '${placeKey}' in profile '${profile.id}'`)
      return {
        placeId: placeIdOf(p.key),
        label: p.name,
        address: p.address,
        mapsUrl: p.mapsUrl ?? null,
      }
    }
    return {
      placeId: null,
      label: profile.location.label,
      address: profile.location.address,
      mapsUrl: profile.location.mapsUrl ?? null,
    }
  }
  const primaryPlace = (profile.places ?? []).find((p) => p.isPrimary) ?? profile.places?.[0]

  const rankingSystem = profile.rankingSystem
  const rankSystemId = rankingSystem?.id ?? null
  function rankFor(entry: LeadContactDef): number | null {
    if (!rankingSystem || entry.type !== 'student' || entry.kid) return null
    const n = rankingSystem.levels.length
    const s = entry.totalSessions
    if (s < 15) return 0
    if (s < 50) return Math.min(1, n - 1)
    if (s < 100) return Math.min(2, n - 1)
    if (s < 160) return Math.min(3, n - 1)
    return n - 1
  }

  // ── auth users + team members (owner first, then the rest of the staff) ───
  for (const s of profile.staff) {
    await upsertAuthUser({
      uid: uidOf(s.key),
      email: s.email,
      displayName: `${s.firstname} ${s.lastname}`.trim(),
      password: DEMO_PASSWORD,
    })
  }

  // ── team doc + public profile ─────────────────────────────────────────────
  const portalLinks = buildStorefrontPageLinks()
  // Branded-surface background (bio-link home / shop / Space). A custom
  // publicBackground overrides the named gradient — the renderer uses the CSS
  // value verbatim when it isn't a BIO_LINK_GRADIENTS key. 'solid' for a bare
  // hex, 'gradient' for a linear-/radial-gradient string.
  const bioLinkBackground = profile.publicBackground
    ? {
        type: /gradient\s*\(/i.test(profile.publicBackground) ? 'gradient' : 'solid',
        color: profile.publicBackground,
      }
    : { type: 'gradient', color: profile.portalGradient }
  const profileImage = await uploadAsset(
    profile.profileImageAsset ?? 'profile',
    `teams/${teamId}/portal/profile`
  )
  const heroImage = await uploadAsset(
    profile.heroImageAsset ?? 'hero',
    `teams/${teamId}/portal/hero`
  )

  // Booking settings — seeded to BOTH the public_profile (read by the public
  // booking flow + the mobile app) and the team-doc mirror (re-hydrates the
  // admin Settings → Booking form).
  const bookingSettings = {
    flowType: 'activity-first',
    // Cover the materialized future window so the booking page shows it all.
    windowMonths: bookingWindowMonths,
    showPhone: true,
    ctaUrl: null,
    ctaLabel: null,
    showActivityDescription: true,
    // Lead tenants seed appointment activities + availability (profile.appointments).
    appointmentsEnabled: true,
  }

  await db
    .collection('teams')
    .doc(teamId)
    .set({
      name: profile.teamName,
      description: profile.description,
      slug: profile.slug,
      sport_type: profile.sportType,
      language: profile.language,
      createdBy: uid,
      created: ts(daysFromNow(-220)),
      plan: 'studio',
      plan_status: 'active',
      default_currency: profile.currency,
      payment_modes: [...DEFAULT_PAYMENT_MODES],
      affiliations_enabled: true,
      ranking_systems: rankingSystem ? [{ ...rankingSystem, is_primary: true }] : [],
      settings: {
        gamification: profile.gamification,
        teamEmail: profile.contactEmail,
        booking: bookingSettings,
        ...(profile.bookingConfirmationInstructions
          ? { bookingConfirmationInstructions: profile.bookingConfirmationInstructions }
          : {}),
        ...(profile.reminders?.steps?.length
          ? {
              bookingRemindersEnabled: true,
              bookingReminderSteps: profile.reminders.steps.map((s, i) => ({
                id: `step-${i}-${s.channel}-${s.offsetHours}h`,
                channel: s.channel,
                offsetHours: s.offsetHours,
              })),
            }
          : {}),
      },
      ...(profile.customFieldDefinitions?.length
        ? { custom_field_definitions: profile.customFieldDefinitions }
        : {}),
      bioLinkTheme: 'light',
      bioLinkAccentColor: profile.accentColor,
      bioLinkBackground,
      profileImage,
      heroImage,
      links: portalLinks,
      socialLinks: profile.socialLinks,
    })

  // ── places (teams/{id}/team_places) ───────────────────────────────────────
  for (let i = 0; i < (profile.places ?? []).length; i++) {
    const p = (profile.places ?? [])[i]
    await db
      .collection('teams')
      .doc(teamId)
      .collection('team_places')
      .doc(placeIdOf(p.key))
      .set({
        teamId,
        scope: 'team',
        name: p.name,
        address: p.address,
        ...(p.mapsUrl ? { mapsLink: p.mapsUrl } : {}),
        isPrimary: p === primaryPlace,
        order: i,
        created_at: ts(daysFromNow(-200)),
        createdBy: uid,
      })
  }

  // ── contact groups (teams/{id}/contact_groups; Contact Groups plugin) ──────
  // Nested member groups à la association tools — used to split the member base
  // by discipline/area (e.g. Dance, Breathwork, Coaching). Membership lives on
  // each contact's group_ids array (set below); nesting via parent_id.
  const groupIdOf = (key: string) => `${teamId}-group-${key}`
  const groupByKey = new Map((profile.contactGroups ?? []).map((g) => [g.key, g]))
  for (const g of profile.contactGroups ?? []) {
    if (g.parentKey && !groupByKey.has(g.parentKey)) {
      throw new Error(`Unknown parentKey '${g.parentKey}' for group '${g.key}' in '${profile.id}'`)
    }
    await db
      .collection('teams')
      .doc(teamId)
      .collection('contact_groups')
      .doc(groupIdOf(g.key))
      .set({
        name: g.name,
        parent_id: g.parentKey ? groupIdOf(g.parentKey) : null,
        color: g.color ?? null,
        ...(g.description ? { description: g.description } : {}),
        created_at: ts(daysFromNow(-180)),
        created_by: uid,
      })
  }

  // ── SMS sender config (integrations/sms_sender; consumed by the SMS service) ──
  if (profile.smsSenderName) {
    await db
      .collection('teams')
      .doc(teamId)
      .collection('integrations')
      .doc('sms_sender')
      .set({
        type: 'sms_sender',
        senderName: profile.smsSenderName.replace(/[^a-zA-Z0-9]/g, '').slice(0, 11),
        enabled: true,
        updated_at: ts(now()),
        updatedBy: uid,
      })
  }

  // ── Messaging policy (messaging_policies/{teamId}; operator-only) ──────────
  // GENERAL RULE for lead seeds: the initial setup delivers ONLY to the operator
  // (you). Default mode = 'redirect' → OPERATOR_EMAIL, so EVERYTHING the tenant
  // produces (your own test OTP/confirmations AND the owner notifications that
  // would otherwise go to the lead's studio inbox) funnels to your inbox, while
  // the lead's real addresses and the synthetic contact pool receive nothing.
  // Handing the sandbox to the lead is a DELIBERATE later step: flip to
  // 'allowlist' (add the lead) or 'live' in the operator console / via
  // `pnpm messaging:policy`. A profile may override via `profile.messagingPolicy`,
  // but the operator email is always kept reachable so you never lose oversight.
  {
    const mp = profile.messagingPolicy ?? {}
    const mode = mp.mode ?? 'redirect'
    const redirectEmail = (mp.redirectEmail || OPERATOR_EMAIL).trim().toLowerCase()
    // In allowlist mode the operator is always included (retains visibility).
    const allowEmails = [
      ...new Set(
        [OPERATOR_EMAIL, ...(mp.allowEmails ?? [])].map((e) => e.trim().toLowerCase()).filter(Boolean)
      ),
    ]
    const policyDoc: Record<string, unknown> = {
      entityId: teamId,
      mode,
      note:
        mp.note ??
        `Lead demo '${profile.id}' — initial setup delivers only to the operator (${OPERATOR_EMAIL}). Switch to allowlist/live at handover.`,
      updated_at: ts(now()),
      updated_by: 'seed-lead',
    }
    if (mode === 'redirect') policyDoc.redirectEmail = redirectEmail
    if (mode === 'allowlist') policyDoc.allowEmails = allowEmails
    if (mp.allowPhones?.length) policyDoc.allowPhones = mp.allowPhones
    await db.collection('messaging_policies').doc(teamId).set(policyDoc)
    const target = mode === 'redirect' ? redirectEmail : mode === 'allowlist' ? allowEmails.join(', ') : '—'
    console.log(`   ✉️  Messaging policy: ${mode}${target !== '—' ? ` → ${target}` : ''}`)
  }

  // Stripe Connect — wire a TEST connected account so "pay with Linyup" works out
  // of the box (survives reseeds). Source: --connect flag > env > profile field.
  // MUST run after the full team set() above, since it merge-adds teams/{id}.payments.
  const connectAccount = cli.connect ?? process.env.STRIPE_CONNECT_TEST_ACCOUNT ?? profile.stripeConnectTestAccount
  if (connectAccount) {
    if (!connectAccount.startsWith('acct_')) {
      console.warn(`   ⚠️  Ignoring Connect account '${connectAccount}' — expected an acct_… id.`)
    } else {
      await linkConnectAccount({ db, teamId, accountId: connectAccount })
      console.log(`   💳 Wired Stripe Connect (${connectAccount}) — "pay with Linyup" ready.`)
    }
  }

  // Public mirror of the subscription types (what syncSubscriptionTypesToPublicProfile
  // would produce). price.id must equal the raw subscription_types price id or the
  // shop's Buy button stays disabled.
  const publicSubTypes = profile.subscriptions.map((st) => {
    const entry: {
      id: string
      name: string
      description?: string
      checkout_contact_mode?: string
      prices?: {
        id: string
        amount: number
        recurrence: string
        label?: string
        included_months?: number
        credits?: number
      }[]
    } = {
      id: subIdOf(st.key),
      name: st.name,
      checkout_contact_mode: subCheckoutMode(st),
    }
    if (st.description) entry.description = st.description
    const prices = subPricesOf(st)
    if (prices.length > 0) {
      entry.prices = prices.map(({ active: _active, ...p }) => p)
    }
    return entry
  })

  await db
    .collection('teams')
    .doc(teamId)
    .collection('public_profile')
    .doc(teamId)
    .set({
      type: 'team',
      name: profile.teamName,
      description: profile.description,
      slug: profile.slug,
      sport_type: profile.sportType,
      profileImage,
      heroImage,
      bioLinkTheme: 'light',
      bioLinkAccentColor: profile.accentColor,
      bioLinkBackground,
      socialLinks: profile.socialLinks,
      links: portalLinks,
      bookingSettings,
      showBranding: false, // studio plan carries no "Powered by Linyup" badge
      default_currency: profile.currency,
      default_public_surface: 'bio-link',
      // Written directly (sync triggers may not be deployed on the sandbox):
      // site + shop + space are all live for a seeded lead tenant.
      active_public_surfaces: { site: true, shop: true, space: true },
      // Main Address for the bio-link map (normally denormalised on place write).
      mainAddress: primaryPlace
        ? {
            name: primaryPlace.name,
            address: primaryPlace.address,
            ...(primaryPlace.mapsUrl ? { mapsLink: primaryPlace.mapsUrl } : {}),
          }
        : { name: profile.location.label, address: profile.location.address },
      aggregator_subscription_types: publicSubTypes,
      membershipRequiredFields: null,
      membershipOptionalFields: null,
      updated_at: ts(now()),
    })

  // ── team members + users docs ─────────────────────────────────────────────
  for (const s of profile.staff) {
    const sUid = uidOf(s.key)
    await db
      .collection('teams')
      .doc(teamId)
      .collection('team_members')
      .doc(sUid)
      .set({
        teamId,
        userId: sUid,
        role: s.role,
        email: s.email,
        ...memberCapsFor(s.role),
        joined: ts(daysFromNow(s.role === 'owner' ? -220 : -180)),
        ...(s.role !== 'owner' ? { addedBy: uid } : {}),
      })
    await db
      .collection('users')
      .doc(sUid)
      .set(
        {
          email: s.email,
          displayName: `${s.firstname} ${s.lastname}`.trim(),
          firstname: s.firstname,
          lastname: s.lastname,
          currentTeam: teamId,
          created_at: ts(daysFromNow(s.role === 'owner' ? -220 : -180)),
        },
        { merge: true }
      )
  }

  await db
    .collection('teams')
    .doc(teamId)
    .collection('role_config')
    .doc('coach')
    .set({
      role: 'coach',
      capabilities: COACH_DEFAULT_CAPABILITIES,
      coachRoles: ['owner', 'manager', 'coach'],
      updatedBy: uid,
      updated_at: ts(daysFromNow(-180)),
    })

  // ── affiliation type catalog (team-local 'club') ──────────────────────────
  const affiliationTypeDefs = teamAffiliationTypes()
  const clubAffiliationType = affiliationTypeDefs.find((t) => t.key === 'club')!
  for (const at of affiliationTypeDefs) {
    await db
      .collection('teams')
      .doc(teamId)
      .collection(AFFILIATION_TYPES_SUBCOLLECTION)
      .doc(at.id)
      .set(at)
  }

  // ── activities (group classes + appointments) ─────────────────────────────────
  const actIds = profile.activities.map((_, i) => `${teamId}-act-${i}`)
  const actImageUrls: (string | null)[] = []
  for (let i = 0; i < profile.activities.length; i++) {
    const a = profile.activities[i]
    const imageUrl = a.imageAsset
      ? await uploadAsset(a.imageAsset, `teams/${teamId}/activities/${actIds[i]}/cover`)
      : null
    actImageUrls.push(imageUrl)
    // Paid-access gate; keep isFreeTrial in sync (legacy queries read it).
    const accessRule = {
      type: a.accessTier ?? (a.isFreeTrial ? 'open' : 'members'),
      ...(a.accessTier === 'subscription'
        ? { subscriptionTypeIds: (a.accessSubKeys ?? []).map(subIdOf) }
        : {}),
    }
    const dropIn =
      a.dropInPrice != null ? { enabled: true, priceAmount: a.dropInPrice } : { enabled: false }
    await db
      .collection('activities')
      .doc(actIds[i])
      .set({
        teamId,
        name: a.name,
        slug: a.slug,
        color: a.color,
        level: a.level,
        description: a.description,
        ...(a.prerequisites ? { prerequisites: a.prerequisites } : {}),
        ...(a.confirmationInstructions
          ? { confirmationInstructions: a.confirmationInstructions }
          : {}),
        isFreeTrial: accessRule.type === 'open',
        accessRule,
        // Independent of the tier: a gated class still accepts a newcomer's
        // trial booking (guest path identical to 'open').
        ...(a.trialEnabled ? { trialEnabled: true } : {}),
        dropIn,
        base_score: a.base_score,
        type: 'class',
        // Classes don't auto-confirm: a booking holds a seat but stays
        // unconfirmed until check-in. Written explicitly (it's the 'class'
        // default in resolveAutoConfirm) so the seed exercises the field.
        autoConfirm: false,
        isActive: true,
        // Also on the raw doc (not just the public mirror) — the manager
        // activities list reads Activity.image_url.
        ...(imageUrl ? { image_url: imageUrl } : {}),
        created_at: ts(daysFromNow(-200)),
      })
    await db
      .collection('activities')
      .doc(actIds[i])
      .collection('public_profile')
      .doc(actIds[i])
      .set({
        type: 'activity',
        activityType: 'class',
        teamId,
        name: a.name,
        slug: a.slug,
        color: a.color,
        description: a.description,
        ...(a.prerequisites ? { prerequisites: a.prerequisites } : {}),
        image_url: imageUrl,
        isFreeTrial: accessRule.type === 'open',
        accessRule,
        ...(dropIn.enabled ? { dropIn } : {}),
        // Mirrored so the public flow can OFFER the newcomer trial door on a
        // gated class (matches syncActivityPublicProfile).
        ...(a.trialEnabled ? { trialEnabled: true } : {}),
        level: a.level,
      })
  }

  // ── appointment activities (the WHAT) ────────────────────────────────────────
  // Each is an offering: its name, the lengths it can be booked at (with their
  // base prices) and its ONE member-benefit rule. Appointments carry NO access
  // rule — the price is the gate (unpriced = anyone books free, priced = anyone
  // pays, benefit holders less). A lead may publish several offerings (e.g. a
  // free intro call and a paid 1:1) — different products with different
  // pricing. The availability docs below publish only the WHEN and link to them.
  const aptActIdOf = (key: string) => `${teamId}-act-appointment-${key}`
  // The provider is whoever's schedule first offers it (owner as a fallback).
  const aptProviderKeyOf = (key: string) =>
    profile.appointments.availability.find((av) =>
      (av.activityKeys ?? profile.appointments.activities.map((a) => a.key)).includes(key)
    )?.staffKey ?? owner.key
  const aptDefOf = (key: string) => profile.appointments.activities.find((a) => a.key === key)

  for (const apt of profile.appointments.activities) {
    const aptActId = aptActIdOf(apt.key)
    const providerKey = aptProviderKeyOf(apt.key)
    const imageUrl = apt.imageAsset
      ? await uploadAsset(apt.imageAsset, `teams/${teamId}/activities/${aptActId}/cover`)
      : null
    // The ONE member-benefit rule — the profile references subscriptions by key;
    // resolve them to the seeded subscription-type ids here.
    const memberBenefit = apt.memberBenefit
      ? {
          subscriptionTypeIds: apt.memberBenefit.subKeys.map(subIdOf),
          kind: apt.memberBenefit.kind,
          ...(apt.memberBenefit.kind === 'discount'
            ? { discountPercent: apt.memberBenefit.discountPercent }
            : {}),
        }
      : null
    await db
      .collection('activities')
      .doc(aptActId)
      .set({
        teamId,
        name: apt.activityName,
        slug: apt.slug,
        color: profile.accentColor,
        description: apt.description,
        type: 'appointment',
        providerId: uidOf(providerKey),
        providerName: staffName(providerKey),
        level: 'all',
        // Per-duration BASE pricing (major units, team currency). No access
        // rule / isFreeTrial: the price is the only gate for appointments.
        durations: apt.durations.map((d) => ({
          minutes: d.minutes,
          priceAmount: d.priceAmount ?? null,
        })),
        ...(memberBenefit ? { memberBenefit } : {}),
        // A 1:1 slot has no roster-review step — the time is taken the moment
        // it's booked, so the booking is written 'confirmed' on the spot.
        autoConfirm: true,
        isActive: true,
        ...(imageUrl ? { image_url: imageUrl } : {}),
        created_at: ts(daysFromNow(-180)),
      })
    await db
      .collection('activities')
      .doc(aptActId)
      .collection('public_profile')
      .doc(aptActId)
      .set({
        type: 'activity',
        // Routes the public booking/site cards to the appointment flow.
        activityType: 'appointment',
        teamId,
        name: apt.activityName,
        slug: apt.slug,
        color: profile.accentColor,
        description: apt.description,
        image_url: imageUrl,
        // The doc carries no isFreeTrial; the live sync mirrors `|| false`.
        // No accessRule — appointment mirrors dropped the access gate.
        isFreeTrial: false,
        level: 'all',
        // Duration menu ("from CHF 45" on public cards) + the member-benefit
        // rule, both mirrored verbatim, exactly as syncActivityPublicProfile
        // does (public-safe: the type ids are already public in the shop).
        durations: apt.durations.map((d) => ({
          minutes: d.minutes,
          priceAmount: d.priceAmount ?? null,
        })),
        ...(memberBenefit ? { memberBenefit } : {}),
      })
  }

  // ── appointments: availability docs + a few already-BOOKED sessions ───────────
  // Availability publishes only WHEN each coach is free; it generates NOTHING.
  // An appointment session exists only once a client books one, so the only
  // sessions seeded here are the profile's `booked` entries — shaped exactly as
  // the `bookAppointment` callable writes them.
  const firstAdultIdx = profile.contacts.findIndex((c) => c.type === 'student' && !c.kid)
  for (let tplIdx = 0; tplIdx < profile.appointments.availability.length; tplIdx++) {
    const av = profile.appointments.availability[tplIdx]
    const providerUid = uidOf(av.staffKey)
    const providerName = staffName(av.staffKey)
    // Index-suffixed so one coach can hold several availabilities.
    const templateId = `${teamId}-tpl-${av.staffKey}-${tplIdx}`
    const tplPlace = resolvePlace(av.placeKey)
    // The offerings bookable in this window — all of them unless narrowed. The
    // availability carries ONLY these ids: no durations, no capacity, no access
    // rule (those are the activity's), and no isFreeTrial.
    const avActivityKeys = av.activityKeys ?? profile.appointments.activities.map((a) => a.key)
    await db
      .collection('availability')
      .doc(templateId)
      .set({
        teamId,
        providerId: providerUid,
        providerName,
        // The SCHEDULE's name — the offering's name lives on the activity.
        title: av.title,
        description: aptDefOf(avActivityKeys[0])?.description ?? '',
        activityIds: avActivityKeys.map(aptActIdOf),
        location: tplPlace.label,
        ...(tplPlace.placeId ? { placeId: tplPlace.placeId } : {}),
        onlineUrl: null,
        status: 'active',
        mode: av.mode,
        ...(av.mode === 'range'
          ? { window: av.window, granularityMinutes: av.granularityMinutes ?? 30 }
          : { times: av.times ?? [] }),
        bufferMinutes: av.bufferMinutes ?? 0,
        recurrence: {
          daysOfWeek: av.daysOfWeek,
          startDate: ts(daysFromNow(-40)),
          endDate: null,
        },
        created_at: ts(daysFromNow(-40)),
        createdBy: providerUid,
      })

    for (const b of av.booked ?? []) {
      const past = b.occurrence < 0
      const dates = appointmentOccurrences({
        daysOfWeek: av.daysOfWeek,
        time: b.time,
        count: Math.abs(b.occurrence),
        direction: past ? -1 : 1,
        maxDayspan: (past ? scheduleWeeksBack : scheduleWeeksAhead) * 7 + 14,
      })
      const start = dates[dates.length - 1]
      if (!start) continue

      const contactIdx = b.contactIdx ?? firstAdultIdx
      const client = profile.contacts[contactIdx]
      if (!client) continue
      const contactId = `${teamId}-contact-${contactIdx.toString().padStart(3, '0')}`
      const clientEmail = `${slugEmail(client)}.${teamId}@example.com`

      // Which offering was booked — the session INHERITS the activity's name,
      // exactly as bookAppointment does (no accessRule/isFreeTrial: appointment
      // sessions dropped the access gate).
      const bookedApt = aptDefOf(b.activityKey ?? avActivityKeys[0])
      if (!bookedApt) continue

      const { id: sid, session, publicProfile } = buildAppointmentSessionDocs({
        teamId,
        templateId,
        activityId: aptActIdOf(bookedApt.key),
        activityName: bookedApt.activityName,
        autoConfirm: true,
        providerId: providerUid,
        providerName,
        start,
        durationMinutes: b.durationMinutes,
        location: tplPlace.label,
        extra: {
          locationAddress: tplPlace.address,
          ...(tplPlace.placeId ? { placeId: tplPlace.placeId } : {}),
        },
        past,
        createdAt: daysFromNow(past ? -scheduleWeeksBack * 7 - 7 : -7),
      })
      await db.collection('sessions').doc(sid).set(session)
      await db.collection('sessions').doc(sid).collection('public_profile').doc(sid).set(publicProfile)
      await db
        .collection('sessions')
        .doc(sid)
        .collection('bookings')
        .doc(contactId)
        .set(
          buildAppointmentBookingDoc({
            teamId,
            sessionId: sid,
            contactId,
            firstname: client.firstname,
            lastname: client.lastname,
            email: clientEmail,
            bookedAt: daysFromNow(past ? -scheduleWeeksBack * 7 : -2),
          })
        )
      // Past appointments were attended — reports read the participants subcollection.
      if (past) {
        await db
          .collection('sessions')
          .doc(sid)
          .collection('participants')
          .doc(contactId)
          .set({
            contactId,
            session: sid,
            firstname: client.firstname,
            lastname: client.lastname,
            fullname: `${client.lastname} ${client.firstname}`,
            joinedAt: ts(start),
            checkedInBy: 'seed',
          })
      }
    }
  }

  // ── subscription types (raw docs) ─────────────────────────────────────────
  for (const st of profile.subscriptions) {
    const id = subIdOf(st.key)
    const prices = subPricesOf(st)
    await db
      .collection('teams')
      .doc(teamId)
      .collection('subscription_types')
      .doc(id)
      .set({
        name: st.name,
        description: st.description,
        source: st.source,
        active: true,
        public: true,
        checkout_contact_mode: subCheckoutMode(st),
        prices,
        teamId,
        created_at: ts(daysFromNow(-120)),
      })
  }

  // ── group sessions: weekday-aligned weekly grid, weeks −4…+3 ──────────────
  // (Unlike seed-sandbox, slots align to the REAL weekday — the lead's actual
  // schedule must land on the right days of the calendar.)
  type SessionDef = {
    date: Date
    end: Date
    actIdx: number
    staffKey: string
    placeKey?: string
    allowBooking: boolean
    isPast: boolean
  }
  const sessionDefs: SessionDef[] = []
  const nowDate = now()
  // `scheduleWeeksBack` weeks of history (for reports/attendance) +
  // `scheduleWeeksAhead` future weeks.
  for (let week = -scheduleWeeksBack; week <= scheduleWeeksAhead; week++) {
    const monday = mondayOfWeeksAgo(-week)
    for (const slot of profile.weeklyGrid) {
      const date = new Date(monday)
      date.setDate(date.getDate() + ((slot.day + 6) % 7)) // Mon-based offset
      date.setHours(slot.hh, slot.mm, 0, 0)
      const isPast = date.getTime() < nowDate.getTime()
      if (slot.upcomingOnly && isPast) continue
      sessionDefs.push({
        date,
        end: minutesOffset(date, slot.durMin),
        actIdx: slot.activityIdx,
        staffKey: slot.staffKey,
        placeKey: slot.placeKey,
        // Stays true after the session passes — matches production, where nothing
        // flips it off, so past sessions keep their public mirror and the public
        // weekly calendar can show the current week as a timetable. Public
        // booking queries bound on `start`, so nothing past is ever bookable.
        allowBooking: true,
        isPast,
      })
    }
  }
  sessionDefs.sort((a, b) => a.date.getTime() - b.date.getTime())
  const pastDefs = sessionDefs.filter((s) => s.isPast)

  const sessionIds: string[] = []
  for (let i = 0; i < sessionDefs.length; i++) {
    const s = sessionDefs[i]
    const a = profile.activities[s.actIdx]
    const id = `${teamId}-session-${i.toString().padStart(3, '0')}`
    sessionIds.push(id)
    const providerName = staffName(s.staffKey)
    const place = resolvePlace(s.placeKey)

    await db
      .collection('sessions')
      .doc(id)
      .set({
        teamId,
        activityId: actIds[s.actIdx],
        activityName: a.name,
        start: ts(s.date),
        end: ts(s.end),
        location: place.label,
        locationAddress: place.address,
        ...(place.placeId ? { placeId: place.placeId } : {}),
        providerName,
        providerId: uidOf(s.staffKey),
        ...(a.capacity != null ? { max_participants: a.capacity } : {}),
        allowBooking: s.allowBooking,
        // Denormalised from the activity — classes confirm at check-in.
        autoConfirm: false,
        participants_count: 0,
        created_at: ts(daysFromNow(-200)),
        createdBy: uid,
      })
    // Mirror every session — past included, so the public timetable sees them
    // (the live syncSessionPublicProfile function would produce the same).
    await db
      .collection('sessions')
      .doc(id)
      .collection('public_profile')
      .doc(id)
      .set({
        type: 'session',
        teamId,
        activityId: actIds[s.actIdx],
        activityName: a.name,
        activityColor: a.color,
        activitySlug: a.slug,
        activityIsFreeTrial: a.isFreeTrial,
        activityLevel: a.level,
        activityImage: actImageUrls[s.actIdx],
        start: ts(s.date),
        end: ts(s.end),
        location: place.label,
        providerName,
        locationAddress: place.address,
        locationMapsUrl: place.mapsUrl,
        capacity: a.capacity,
        participants_count: 0,
        allowBooking: true,
        slug: null,
      })
  }

  // ── contacts ───────────────────────────────────────────────────────────────
  const pool = profile.contacts
  const contactIds: string[] = []
  for (let i = 0; i < pool.length; i++) {
    const c = pool[i]
    const id = `${teamId}-contact-${i.toString().padStart(3, '0')}`
    contactIds.push(id)
    const seed = `${teamId}-${i}`
    const sub = resolveSub(c.subKey)
    const rank = rankFor(c)
    const isKid = !!c.kid
    const streak = !isKid && c.totalSessions > 0 ? Math.floor(seededRand(seed + 'st') * 6) : 0
    const maxStreak = isKid ? 0 : Math.max(streak, Math.floor(seededRand(seed + 'ms') * 10))
    const monthScore = !isKid && c.totalSessions > 0 ? Math.floor(seededRand(seed + 'sc') * 140) : 0
    const birthdate = c.kid
      ? new Date(c.kid.birthdate)
      : c.birthYear
        ? new Date(
            c.birthYear,
            Math.floor(seededRand(seed + 'mo') * 12),
            1 + Math.floor(seededRand(seed + 'dy') * 27)
          )
        : null

    const createdTs = ts(daysFromNow(-Math.floor(seededRand(seed + 'cr') * 200) - 10))
    const acquisition = acquisitionFieldsFor({
      type: c.type,
      hasAttended: c.totalSessions > 0,
      milestoneTs: createdTs,
      seed,
      source: c.source,
      sourceDetail: c.sourceDetail,
    })
    const baseTags = c.status === 'expired' ? ['win-back'] : c.type === 'trial' ? ['lead'] : []
    const tags = c.type === 'external' ? [...baseTags, 'external'] : baseTags

    const writeAffiliation = c.type !== 'external' && c.status !== 'guest'
    const affiliationDoc = writeAffiliation
      ? buildAffiliationDoc({
          teamId,
          type: clubAffiliationType,
          statusId: c.status,
          validUntil: statusCountsAsActive(c.status)
            ? ts(daysFromNow(300))
            : c.status === 'expired'
              ? ts(daysFromNow(-20))
              : undefined,
          validFrom: ts(daysFromNow(-200)),
          createdAt: createdTs,
          createdBy: 'seed',
        })
      : null

    await db
      .collection('contacts')
      .doc(id)
      .set({
        teamId,
        firstname: c.firstname,
        lastname: c.lastname,
        email: c.kid ? c.kid.parentEmail : `${slugEmail(c)}.${teamId}@example.com`,
        phone: c.kid
          ? c.kid.parentPhone
          : `+417${(60000000 + Math.floor(seededRand(seed + 'ph') * 9999999)).toString().slice(0, 8)}`,
        gender: c.gender,
        birthplace: c.birthplace,
        birthdate: birthdate ? ts(birthdate) : null,
        total_sessions: c.totalSessions,
        last_session_at:
          c.totalSessions > 0 ? ts(daysFromNow(-Math.floor(seededRand(seed + 'ls') * 14))) : null,
        notes: c.kid
          ? c.kid.note
          : c.type === 'student' && c.totalSessions > 20
            ? 'Consistent attendance. Progressing well — review focus areas next month.'
            : c.type === 'trial'
              ? 'Came in via the public booking page — follow up after first session.'
              : '',
        ...(c.kid
          ? {
              emergency_contacts: [
                { name: c.kid.parentName, phone: c.kid.parentPhone, email: c.kid.parentEmail },
              ],
            }
          : {}),
        // login_emails = passwordless sign-in allow-list. Kids: the parent email.
        // A demo-login contact ALSO gets the operator (+ profile) emails so you /
        // the lead can sign in AS this member. Deduped, real addresses only.
        ...(() => {
          const emails = [
            ...(c.kid ? [c.kid.parentEmail] : []),
            ...(c.demoLogin ? demoLoginEmails : []),
          ]
            .map((e) => e.trim().toLowerCase())
            .filter(Boolean)
          const deduped = [...new Set(emails)].slice(0, 5)
          return deduped.length ? { login_emails: deduped } : {}
        })(),
        ...(c.assignedToStaffKey ? { assigned_coach_ids: [uidOf(c.assignedToStaffKey)] } : {}),
        ...(c.groupKeys?.length
          ? {
              group_ids: c.groupKeys.map((k) => {
                if (!groupByKey.has(k))
                  throw new Error(`Unknown groupKey '${k}' on contact in '${profile.id}'`)
                return groupIdOf(k)
              }),
            }
          : {}),
        ...(c.customFields ? { custom_fields: c.customFields } : {}),
        created_at: createdTs,
        deleted_at: null,
        archived_at: null,
        ...acquisition,
        ...(affiliationDoc
          ? {
              affiliation_summary: buildAffiliationSummary([
                affiliationDoc as { active: boolean; type_key?: string; org_id?: string },
              ]),
            }
          : {}),
        // Kids stay out of gamification: no scores, streaks, or badges.
        current_month_score: monthScore,
        current_streak: streak,
        max_streak: maxStreak,
        times_leader: isKid ? 0 : Math.floor(seededRand(seed + 'tl') * 3),
        times_top5: isKid ? 0 : Math.floor(seededRand(seed + 't5') * 6),
        distinct_activities: isKid
          ? []
          : profile.activities
              .slice(0, 1 + Math.floor(seededRand(seed + 'da') * 2))
              .map((a) => a.slug),
        custom_badges: isKid ? [] : badgesFor(c.totalSessions, maxStreak, seed),
        ...(sub
          ? {
              subscription_type_id: sub.id,
              subscription_type_name: sub.name,
              subscription_recurrence: sub.recurrence,
              ...(sub.priceId
                ? { subscription_price_id: sub.priceId, subscription_amount: sub.amount }
                : {}),
              subscription_type_updated_at: ts(daysFromNow(-30)),
            }
          : {}),
        ...(rank != null && rankSystemId ? { ranks: { [rankSystemId]: rank } } : {}),
        tags,
      })

    if (affiliationDoc) {
      await db
        .collection('contacts')
        .doc(id)
        .collection(CONTACT_AFFILIATIONS_SUBCOLLECTION)
        .doc(`${id}-aff-club`)
        .set(affiliationDoc)
    }

    if (sub) {
      const startedAt = daysFromNow(-Math.floor(seededRand(seed + 'sh') * 90) - 30)
      if (i % 4 === 0) {
        const prevStartedAt = daysFromNow(-Math.floor(seededRand(seed + 'ph2') * 120) - 90)
        await db
          .collection('contacts')
          .doc(id)
          .collection('subscription_history')
          .doc(`${id}-sub-prev`)
          .set({
            subscription_type_id: sub.id,
            subscription_type_name: sub.name,
            recurrence: sub.recurrence,
            ...(sub.priceId ? { subscription_price_id: sub.priceId, amount: sub.amount } : {}),
            start_date: ts(prevStartedAt),
            end_date: ts(new Date(startedAt.getTime() - 1)),
            created_at: ts(prevStartedAt),
          })
      }
      await db
        .collection('contacts')
        .doc(id)
        .collection('subscription_history')
        .doc(`${id}-sub-current`)
        .set({
          subscription_type_id: sub.id,
          subscription_type_name: sub.name,
          recurrence: sub.recurrence,
          ...(sub.priceId ? { subscription_price_id: sub.priceId, amount: sub.amount } : {}),
          start_date: ts(startedAt),
          end_date: null,
          created_at: ts(startedAt),
        })

      // Lesson-credit grant — when the held subscription type carries credit-pack
      // prices, seed one partially-consumed grant (first credit price) + the
      // credit_summary rollup the onCreditGrantWrite sync would compute, so pack
      // holders can book credit-gated classes without live functions.
      const subDef = subByKey.get(c.subKey!)
      const creditPrice = subDef?.prices?.find((p) => p.credits)
      if (subDef && creditPrice?.credits) {
        const used = Math.min(
          creditPrice.credits - 1,
          Math.floor(seededRand(seed + 'cu') * creditPrice.credits)
        )
        const remaining = creditPrice.credits - used
        const expiresAt = ts(daysFromNow(30 * (creditPrice.includedMonths ?? 6) - 20))
        await db
          .collection('contacts')
          .doc(id)
          .collection('credit_grants')
          .doc(`${id}-grant-0`)
          .set({
            teamId,
            subscription_type_id: sub.id,
            subscription_type_name: sub.name,
            price_id: `${sub.id}-price-${creditPrice.key}`,
            credits_total: creditPrice.credits,
            credits_used: used,
            expires_at: expiresAt,
            source: 'seed',
            created_at: ts(startedAt),
          })
        await db
          .collection('contacts')
          .doc(id)
          .set(
            {
              credit_summary: [
                {
                  subscription_type_id: sub.id,
                  subscription_type_name: sub.name,
                  remaining,
                  next_expires_at: expiresAt,
                },
              ],
            },
            { merge: true }
          )
      }
    }

    // monthly scores (gamification) — adults with attendance only
    if (!isKid && c.totalSessions > 0) {
      for (let m = 0; m < 4; m++) {
        const md = monthsAgo(m)
        const label = monthLabel(md)
        const sessions = Math.floor(seededRand(seed + 'mscount' + m) * 12)
        const totalPoints = sessions * (10 + Math.floor(seededRand(seed + 'mp' + m) * 6))
        const cap = (profile.gamification as { monthly_cap?: number }).monthly_cap ?? 200
        await db
          .collection('contacts')
          .doc(id)
          .collection('monthly_scores')
          .doc(`${id}-${label}`)
          .set({
            month: label,
            team_id: teamId,
            total_points: totalPoints,
            final_score: Math.min(totalPoints, cap),
            sessions_count: sessions,
            updated_at: ts(md),
          })
      }
    }

    // weekly reports
    if (c.totalSessions > 0) {
      const maxPerWeek = Math.min(3, Math.ceil(c.totalSessions / 40) + 1)
      for (let w = 7; w >= 0; w--) {
        const monday = mondayOfWeeksAgo(w)
        const label = isoWeekLabel(monday)
        const attendChance = Math.min(0.9, c.totalSessions / 60)
        const count =
          seededRand(seed + 'wk' + w) < attendChance
            ? 1 + Math.floor(seededRand(seed + 'wc' + w) * maxPerWeek)
            : 0
        await db
          .collection('contacts')
          .doc(id)
          .collection('contact_weekly_reports')
          .doc(label)
          .set({
            iso_week: label,
            sessions_count: count,
            generated_at: ts(monday),
          })
      }
    }
  }

  // ── contact alerts (show_in_app) ───────────────────────────────────────────
  const adultIdxs = pool.map((c, i) => ({ c, i })).filter((x) => !x.c.kid)
  const alertTargets = adultIdxs.slice(0, Math.min(4, adultIdxs.length)).map((x) => contactIds[x.i])
  const alertDefs = [
    {
      schedule_type: 'sessions_countdown' as const,
      schedule_value: 10,
      message: 'Progress check-in approaching — review goals together.',
      show_in_app: true,
    },
    {
      schedule_type: 'datetime' as const,
      schedule_value: ts(daysFromNow(7)),
      message: 'Membership renewal due this week.',
      show_in_app: true,
    },
    {
      schedule_type: 'sessions_countdown' as const,
      schedule_value: 50,
      message: '50-session milestone — celebrate in class!',
      show_in_app: false,
    },
  ]
  for (let i = 0; i < alertTargets.length; i++) {
    const def = alertDefs[i % alertDefs.length]
    await db
      .collection('contacts')
      .doc(alertTargets[i])
      .collection('contact_alerts')
      .doc(`${alertTargets[i]}-alert-0`)
      .set({
        teamId,
        schedule_type: def.schedule_type,
        schedule_value: def.schedule_value,
        message: def.message,
        show_in_app: def.show_in_app,
        archived_at: null,
        created_at: ts(daysFromNow(-3)),
      })
  }

  // ── goals & tasks (adult students only) ────────────────────────────────────
  let goalRound = 0
  for (let i = 0; i < pool.length; i++) {
    const c = pool[i]
    if (c.type !== 'student' || c.totalSessions < 5 || c.kid) continue
    const id = contactIds[i]
    const numGoals = goalRound < 4 ? 2 : 1
    for (let g = 0; g < numGoals; g++) {
      const def = profile.goals[(i + g) % profile.goals.length]
      const goalId = `${id}-goal-${g}`
      const status = goalRound < 3 && g === 0 ? 'in_progress' : 'open'
      await db
        .collection('contacts')
        .doc(id)
        .collection('goals')
        .doc(goalId)
        .set({
          type: 'goal',
          title: def.title,
          description: def.description,
          status,
          categories: def.categories,
          created_by: 'coach',
          created_at: ts(daysFromNow(-28)),
          target_date: ts(daysFromNow(60)),
          completed_at: null,
        })
      if (status === 'in_progress') {
        for (let e = 0; e < 2; e++) {
          await db
            .collection('contacts')
            .doc(id)
            .collection('goals')
            .doc(goalId)
            .collection('evaluations')
            .doc(`${goalId}-eval-${e}`)
            .set({
              evaluated_at: ts(daysFromNow(-14 + e * 7)),
              evaluated_by: 'coach',
              score: 3 + e,
              notes:
                e === 0
                  ? 'Good start — keep practising.'
                  : 'Visible improvement over last session.',
              status_after: 'in_progress',
              edited: false,
            })
        }
      }
    }
    const taskId = `${id}-task-0`
    const taskDone = goalRound % 3 === 0
    await db
      .collection('contacts')
      .doc(id)
      .collection('goals')
      .doc(taskId)
      .set({
        type: 'task',
        title: profile.tasks[goalRound % profile.tasks.length],
        description: null,
        status: taskDone ? 'achieved' : 'open',
        categories: [],
        created_by: 'coach',
        created_at: ts(daysFromNow(-7)),
        target_date: ts(daysFromNow(7)),
        completed_at: taskDone ? ts(daysFromNow(-2)) : null,
      })
    goalRound++
  }

  // ── past-session participants ──────────────────────────────────────────────
  const studentIdxs = pool
    .map((c, i) => ({ c, i }))
    .filter((x) => x.c.type === 'student' && !x.c.kid)
    .map((x) => x.i)
  const kidIdxs = pool
    .map((c, i) => ({ c, i }))
    .filter((x) => !!x.c.kid)
    .map((x) => x.i)
  const kidActivityIdxs = new Set(
    profile.activities
      .map((a, i) => ({ a, i }))
      .filter((x) => /baby|toddler|kids?/i.test(x.a.name))
      .map((x) => x.i)
  )
  for (let i = 0; i < pastDefs.length; i++) {
    const sid = sessionIds[sessionDefs.indexOf(pastDefs[i])]
    if (!sid) continue
    const def = pastDefs[i]
    const capacity = profile.activities[def.actIdx].capacity ?? 12
    // Kids attend the kids classes; adults everything else.
    const eligible = kidActivityIdxs.has(def.actIdx) ? kidIdxs : studentIdxs
    if (eligible.length === 0) continue
    const target = Math.min(capacity, Math.max(2, 4 + ((i * 3) % 6)), eligible.length)
    const attending = eligible.filter((_, k) => (k + i) % eligible.length < target).slice(0, target)
    for (const idx of attending) {
      const cs = pool[idx]
      const contactId = contactIds[idx]
      await db
        .collection('sessions')
        .doc(sid)
        .collection('participants')
        .doc(contactId)
        .set({
          contactId,
          session: sid,
          firstname: cs.firstname,
          lastname: cs.lastname,
          fullname: `${cs.lastname} ${cs.firstname}`,
          joinedAt: ts(def.date),
          checkedInBy: 'seed',
        })
    }
    await db.collection('sessions').doc(sid).update({ participants_count: attending.length })
  }

  // ── upcoming-session trial bookings ────────────────────────────────────────
  const upcomingIds = sessionDefs
    .map((s, i) => ({ s, id: sessionIds[i] }))
    .filter((x) => !x.s.isPast && !kidActivityIdxs.has(x.s.actIdx))
    .map((x) => x.id)
  const bookingIdxs = pool
    .map((c, i) => ({ c, i }))
    .filter((x) => x.c.type !== 'student' && !x.c.kid)
    .map((x) => x.i)
    .slice(0, 4)
  const sessionBookingCounts = new Map<
    string,
    { bookings_count: number; trial_bookings_count: number }
  >()
  for (let i = 0; i < bookingIdxs.length; i++) {
    const idx = bookingIdxs[i]
    const b = pool[idx]
    const sessionId = upcomingIds[(i < 2 ? 1 : 3) % Math.max(1, upcomingIds.length)]
    if (!sessionId) continue
    await db
      .collection('sessions')
      .doc(sessionId)
      .collection('bookings')
      .doc(`${teamId}-booking-${i}`)
      .set({
        teamId,
        contact: contactIds[idx],
        session: sessionId,
        email: `${slugEmail(b)}.${teamId}@example.com`,
        firstname: b.firstname,
        lastname: b.lastname,
        phone: '',
        is_new_contact: true,
        fromBioLink: true,
        joinedAt: ts(daysFromNow(-2)),
        status: 'pending',
        booking_token: `tok-${teamId}-${i}`,
      })
    const cur = sessionBookingCounts.get(sessionId) ?? {
      bookings_count: 0,
      trial_bookings_count: 0,
    }
    cur.bookings_count++
    cur.trial_bookings_count++
    sessionBookingCounts.set(sessionId, cur)
  }
  for (const [sessionId, counts] of sessionBookingCounts) {
    await db.collection('sessions').doc(sessionId).update(counts)
  }

  // ── team activity log ──────────────────────────────────────────────────────
  const logEntries = [
    {
      event: 'contact_add',
      desc: `New trial contact ${pool[bookingIdxs[0]]?.firstname ?? 'lead'} added from portal.`,
      contact: contactIds[bookingIdxs[0]],
    },
    {
      event: 'session_participant_add',
      desc: `${pool[studentIdxs[0]].firstname} ${pool[studentIdxs[0]].lastname} checked into ${profile.activities[0].name}.`,
      contact: contactIds[studentIdxs[0]],
    },
    {
      event: 'booking_confirmed',
      desc: 'Trial booking confirmed for an upcoming session.',
      contact: contactIds[bookingIdxs[0]],
    },
  ]
  for (let i = 0; i < logEntries.length; i++) {
    const e = logEntries[i]
    if (!e.contact) continue
    await db
      .collection('teams')
      .doc(teamId)
      .collection('activity_log')
      .doc(`${teamId}-log-${i}`)
      .set({
        event: e.event,
        created_at: ts(daysFromNow(-i - 1)),
        parameters: { description: e.desc },
        refs: { contact: e.contact, user: teamId },
      })
  }

  // ── automations (sector-neutral, {{placeholders}}) ─────────────────────────
  await seedAutomations(profile, teamId, profile.language)

  // ── events ─────────────────────────────────────────────────────────────────
  for (let ei = 0; ei < profile.events.length; ei++) {
    const e = profile.events[ei]
    const eventId = `${teamId}-event-${ei}`
    const maxInvite = Math.min(10, adultIdxs.length)
    let sentCount = 0,
      attendeeCount = 0
    const startIdx = ei * 3

    await db
      .collection('events')
      .doc(eventId)
      .set({
        teamId,
        title: e.title,
        type: e.type,
        fee: e.fee,
        description: e.description,
        location: e.location,
        start: ts(daysFromNow(e.startOffset)),
        end: ts(hoursOffset(daysFromNow(e.startOffset), e.durationH)),
        status: 'open',
        participants_count: 0,
        attendees_count: 0,
        invitations_sent_count: 0,
        deleted_at: null,
        createdBy: uid,
        created_at: ts(daysFromNow(-10)),
      })

    for (let j = 0; j < maxInvite; j++) {
      const cidx = adultIdxs[(startIdx + j) % adultIdxs.length].i
      const c = pool[cidx]
      const contactId = contactIds[cidx]
      const status = j < 3 ? 'responded' : j < 5 ? 'declined' : j < 8 ? 'opened' : 'sent'
      const token = `seed${teamId}ev${ei}c${cidx}`.padEnd(32, '0').repeat(2).slice(0, 64)
      const hasOpened = ['opened', 'responded', 'declined'].includes(status)
      const hasRsvp = ['responded', 'declined'].includes(status)

      await db
        .collection('events')
        .doc(eventId)
        .collection('invitations')
        .doc(contactId)
        .set({
          contactId,
          firstname: c.firstname,
          lastname: c.lastname,
          email: `${slugEmail(c)}.${teamId}@example.com`,
          status,
          token,
          link: `https://linyup.com/public/event-invitation?token=${token}`,
          eventId,
          sentBy: uid,
          sentAt: ts(daysFromNow(-7)),
          firstOpenedAt: hasOpened ? ts(daysFromNow(-5)) : null,
          lastOpenedAt: hasOpened ? ts(daysFromNow(-3)) : null,
          respondedAt: hasRsvp ? ts(daysFromNow(-2)) : null,
        })
      sentCount++
      if (status === 'responded') {
        attendeeCount++
        await db
          .collection('events')
          .doc(eventId)
          .collection('attendees')
          .doc(contactId)
          .set({
            contactId,
            firstname: c.firstname,
            lastname: c.lastname,
            email: `${slugEmail(c)}.${teamId}@example.com`,
            notes: j === 0 ? 'Really looking forward to this!' : null,
            respondedAt: ts(daysFromNow(-2)),
          })
      }
    }
    await db
      .collection('events')
      .doc(eventId)
      .update({
        invitations_sent_count: sentCount,
        attendees_count: attendeeCount,
        last_invitation_sent_at: ts(daysFromNow(-7)),
      })
  }

  // ── plugins: gamification, website, online-courses, products, documents ────
  await seedLeadPlugins(profile, teamId, uid)

  // ── team weekly reports (1 year → dashboard trend charts) ──────────────────
  await seedWeeklyReports(profile, teamId)

  // ── saas_subscriptions (active Studio, manually managed) ───────────────────
  await db
    .collection('saas_subscriptions')
    .doc(teamId)
    .set({
      teamId,
      plan: 'studio',
      status: 'active',
      trial_ends_at: null,
      current_period_start: ts(daysFromNow(-30)),
      current_period_end: ts(daysFromNow(1)),
      cancel_at_period_end: false,
      gateway_type: null,
      gateway_data: null,
      created_at: ts(daysFromNow(-220)),
      updated_at: ts(now()),
    })

  // ── student login (contact-session identity matching buildContactSession) ───────
  const studentIdx = studentIdxs.find((i) => pool[i].status === 'active') ?? studentIdxs[0]
  const studentContactId = contactIds[studentIdx]
  const studentUid = `contact:${teamId}:${studentContactId}`
  const sessionExpires = Date.now() + STUDENT_SESSION_MS
  const studentEmail = `${slugEmail(pool[studentIdx])}.${teamId}@example.com`
  await upsertAuthUser({
    uid: studentUid,
    email: studentEmail,
    displayName: `${pool[studentIdx].firstname} ${pool[studentIdx].lastname}`,
    password: DEMO_PASSWORD,
    claims: { contactId: studentContactId, teamId, sessionExpires, email: studentEmail },
  })

  // Demo-login contact (if any) — surfaced in the seed summary so you know which
  // member to sign in as, and with which emails.
  const demoIdx = pool.findIndex((c) => c.demoLogin)
  const demoContact =
    demoIdx >= 0
      ? { name: `${pool[demoIdx].firstname} ${pool[demoIdx].lastname}`.trim(), emails: demoLoginEmails }
      : null

  return { teamId, studentEmail, sessionCount: sessionDefs.length, demoContact }
}

// ── automations ───────────────────────────────────────────────────────────────
// Profile-authored templates + rules when present (profile.automations), else the
// sector-neutral welcome/win-back pair. The lib_trial_cleanup hygiene rule is
// always installed (fixed doc id converges with the onTeamCreated trigger).

async function seedAutomations(profile: LeadProfile, teamId: string, language: string) {
  const teamRef = db.collection('teams').doc(teamId)

  if (profile.automations) {
    const tmplIdOf = (key: string) => `${teamId}-tmpl-${key}`
    const templateKeys = new Set(profile.automations.templates.map((t) => t.key))
    for (const t of profile.automations.templates) {
      await teamRef
        .collection('outreach_templates')
        .doc(tmplIdOf(t.key))
        .set({
          name: t.name,
          subject: t.subject,
          body: t.body,
          body_mode: 'markdown',
          language,
          active: true,
          ...(t.systemKey ? { system_key: t.systemKey } : {}),
          created_at: ts(daysFromNow(-60)),
        })
    }
    for (const r of profile.automations.rules) {
      const actions = r.actions.map((a) => {
        const { templateKey, ...rest } = a
        if (!templateKey) return rest
        if (!templateKeys.has(templateKey))
          throw new Error(`Unknown templateKey '${templateKey}' in rule '${r.key}'`)
        return { ...rest, templateId: tmplIdOf(templateKey) }
      })
      await teamRef
        .collection('automation_rules')
        .doc(`${teamId}-rule-${r.key}`)
        .set({
          name: r.name,
          active: r.active ?? true,
          trigger: r.trigger,
          conditions: r.conditions ?? [],
          actions,
          ...(r.systemKey ? { system_key: r.systemKey } : {}),
          created_at: ts(daysFromNow(-60)),
          updated_at: ts(daysFromNow(-5)),
        })
    }
    // Always keep the default lead-hygiene rule (same doc id as onTeamCreated).
    await teamRef.collection('automation_rules').doc('lib_trial_cleanup').set({
      name: 'Archive stale trial bookings',
      active: true,
      system_key: 'lib_trial_cleanup',
      trigger: { type: 'schedule_daily' },
      conditions: [
        { type: 'acquisition_stage', value: 'trial_booked' },
        { type: 'sessions_attended_exactly', value: 0 },
        { type: 'days_since_created', value: 30 },
      ],
      actions: [{ type: 'archive_contact' }],
      created_at: ts(daysFromNow(-60)),
      updated_at: ts(daysFromNow(-5)),
    })
    return
  }

  const templates = [
    {
      id: `${teamId}-tmpl-welcome`,
      system_key: `lib_trial_welcome:${language}`,
      name: 'Welcome to your first session',
      body_mode: 'markdown',
      language,
      active: true,
      subject: 'Welcome to {{teamName}}, {{firstname}}!',
      body: 'Hi {{firstname}},\n\nWe are delighted to welcome you to **{{teamName}}** for your first session!\n\nArrive a few minutes early so we can welcome you and answer any questions — no experience needed, we will guide you through everything.\n\nWe look forward to meeting you!\n\nThe {{teamName}} team',
    },
    {
      id: `${teamId}-tmpl-winback`,
      system_key: `lib_winback:${language}`,
      name: 'We miss you',
      body_mode: 'markdown',
      language,
      active: true,
      subject: '{{firstname}}, we miss you at {{teamName}}',
      body: 'Hi {{firstname}},\n\nIt has been a while since your last session. Whenever you are ready to come back, we will be here.\n\nReply to this email and we will help you find a time that fits your schedule.\n\nThe {{teamName}} team',
    },
  ]
  for (const t of templates) {
    await teamRef
      .collection('outreach_templates')
      .doc(t.id)
      .set({
        name: t.name,
        subject: t.subject,
        body: t.body,
        body_mode: t.body_mode,
        language: t.language,
        active: t.active,
        system_key: t.system_key,
        created_at: ts(daysFromNow(-60)),
      })
  }

  const rules = [
    {
      id: `${teamId}-rule-welcome`,
      name: 'Welcome new trial',
      active: true,
      system_key: 'lib_trial_welcome',
      trigger: { type: 'contact_created' },
      // Trial-funnel contacts only — off-funnel entries (shop/form, no stage) must
      // NOT get the "first session" welcome. (The old contact_type condition is dead;
      // the engine now fails closed on unknown types.)
      conditions: [{ type: 'acquisition_stage', value: 'trial_booked' }],
      actions: [{ type: 'send_email', templateId: `${teamId}-tmpl-welcome` }],
    },
    {
      id: `${teamId}-rule-winback`,
      name: 'Win back inactive members',
      active: true,
      system_key: 'lib_winback',
      trigger: { type: 'schedule_daily' },
      conditions: [
        { type: 'acquisition_stage', value: 'joined' },
        { type: 'inactivity_days', value: 30 },
      ],
      actions: [
        { type: 'send_email', templateId: `${teamId}-tmpl-winback` },
        { type: 'assign_tag', tag: 'win-back' },
      ],
    },
    {
      // Default lead-hygiene rule — also installed by the onTeamCreated trigger
      // (@linyup/shared TRIAL_CLEANUP_RULE). Fixed doc id 'lib_trial_cleanup'
      // converges with the trigger, so no duplicate whether or not functions run.
      id: 'lib_trial_cleanup',
      name: 'Archive stale trial bookings',
      active: true,
      system_key: 'lib_trial_cleanup',
      trigger: { type: 'schedule_daily' },
      conditions: [
        { type: 'acquisition_stage', value: 'trial_booked' },
        { type: 'sessions_attended_exactly', value: 0 },
        { type: 'days_since_created', value: 30 },
      ],
      actions: [{ type: 'archive_contact' }],
    },
  ]
  for (const r of rules) {
    await teamRef
      .collection('automation_rules')
      .doc(r.id)
      .set({
        name: r.name,
        active: r.active,
        trigger: r.trigger,
        conditions: r.conditions,
        actions: r.actions,
        system_key: r.system_key,
        created_at: ts(daysFromNow(-60)),
        updated_at: ts(daysFromNow(-5)),
      })
  }
}

// ── plugins + storefront content ──────────────────────────────────────────────

async function seedLeadPlugins(profile: LeadProfile, teamId: string, uid: string) {
  const signupDocIds = profile.documents
    .filter((d) => d.inSignup)
    .map((d) => `${teamId}-doc-${d.key}`)
  const plugins: { id: string; config?: Record<string, unknown> }[] = [
    { id: 'gamification' },
    { id: 'website' },
    { id: 'online-courses' },
    { id: 'products' },
    ...(profile.customFieldDefinitions?.length ? [{ id: 'custom-fields' }] : []),
    ...(profile.contactGroups?.length ? [{ id: 'contact-groups' }] : []),
    ...(profile.documents.length > 0
      ? [{ id: 'documents', config: { signupDocumentIds: signupDocIds } }]
      : []),
  ]
  for (const p of plugins) {
    await db
      .collection('teams')
      .doc(teamId)
      .collection('installed_plugins')
      .doc(p.id)
      .set({
        pluginId: p.id,
        teamId,
        installedAt: ts(daysFromNow(-200)),
        installedBy: uid,
        status: 'active',
        config: p.config ?? {},
        updated_at: ts(daysFromNow(-200)),
      })
  }

  // ── website: profile-authored sections with asset resolution ───────────────
  const sections: Record<string, unknown>[] = []
  for (const s of profile.siteSections) {
    sections.push(await resolveSectionAssets(s, teamId))
  }
  const siteMeta = {
    title: profile.teamName,
    theme: 'light',
    accentColor: profile.accentColor,
    font: 'sans',
    // Match the branded public surfaces (bio-link / shop / Space) — a light
    // custom page background pairs with the light theme's dark text.
    ...(profile.publicBackground ? { background: profile.publicBackground } : {}),
    seo: { title: profile.teamName, description: profile.description },
    header: { showNav: true, ctaLabel: 'Book now', ctaAction: 'booking' },
    footer: { showSocial: true },
  }
  await db
    .collection('site_drafts')
    .doc(teamId)
    .set({
      teamId,
      slug: profile.slug,
      name: profile.teamName,
      enabled: true,
      meta: siteMeta,
      sections,
      updated_at: ts(daysFromNow(-12)),
      updatedBy: uid,
    })
  await db
    .collection('site_published')
    .doc(teamId)
    .set({
      teamId,
      slug: profile.slug,
      name: profile.teamName,
      meta: siteMeta,
      sections,
      socialLinks: profile.socialLinks,
      showBranding: false, // studio plan
      published_at: ts(daysFromNow(-12)),
      updated_at: ts(daysFromNow(-12)),
    })

  // ── online courses ─────────────────────────────────────────────────────────
  for (const c of profile.courses) {
    const courseId = `${teamId}-course-${c.key}`
    const courseRef = db.collection('courses').doc(courseId)
    const coverImageUrl = c.coverAsset
      ? await uploadAsset(c.coverAsset, `teams/${teamId}/courses/${courseId}/cover`)
      : null
    let moduleCount = 0,
      lessonCount = 0
    for (let mi = 0; mi < c.modules.length; mi++) {
      const m = c.modules[mi]
      const moduleId = `${courseId}-m${mi}`
      await courseRef
        .collection('modules')
        .doc(moduleId)
        .set({
          courseId,
          teamId,
          title: m.title,
          order: mi,
          created_at: ts(daysFromNow(-90)),
          updated_at: ts(daysFromNow(-90)),
        })
      moduleCount++
      for (let li = 0; li < m.lessons.length; li++) {
        const l = m.lessons[li]
        await courseRef
          .collection('lessons')
          .doc(`${moduleId}-l${li}`)
          .set({
            courseId,
            moduleId,
            teamId,
            title: l.title,
            type: l.type,
            order: li,
            body: l.body,
            ...(l.type === 'video'
              ? { mediaSource: 'youtube', mediaUrl: l.media, durationSeconds: l.dur ?? null }
              : {}),
            attachments: [],
            created_at: ts(daysFromNow(-90)),
            updated_at: ts(daysFromNow(-90)),
          })
        lessonCount++
      }
    }
    // Course access rule (Course.accessRule): 'subscription' unlocks for holders
    // of the mapped types; 'purchase' sells one-off in the shop for priceAmount
    // and is ALSO included free for accessSubKeys holders (both optional axes).
    // (Same id scheme as seedLeadTenant's subIdOf — this runs in a separate fn.)
    const courseSubIds = (c.accessSubKeys ?? []).map((key) => `${teamId}-sub-${key}`)
    const accessRule = {
      type: c.access,
      ...(courseSubIds.length ? { subscriptionTypeIds: courseSubIds } : {}),
      ...(c.access === 'purchase' && c.priceAmount != null ? { priceAmount: c.priceAmount } : {}),
    }
    const courseOrder = profile.courses.indexOf(c)
    await courseRef.set({
      scope: 'team',
      teamId,
      title: c.title,
      slug: courseId,
      summary: c.summary,
      status: 'published',
      accessRule,
      coverImageUrl,
      moduleCount,
      lessonCount,
      order: courseOrder,
      created_at: ts(daysFromNow(-90)),
      updated_at: ts(daysFromNow(-90)),
      createdBy: uid,
      archived_at: null,
    })
    // Mirror what syncCoursePublicProfile writes so /space + shop list the course
    // even when the trigger isn't deployed on the sandbox.
    await courseRef.collection('public_profile').doc(courseId).set({
      type: 'course',
      teamId,
      slug: courseId,
      title: c.title,
      summary: c.summary,
      coverImageUrl,
      accessType: c.access,
      subscriptionTypeIds: courseSubIds,
      priceAmount: c.access === 'purchase' && c.priceAmount != null ? c.priceAmount : null,
      hideFromShop: false,
      moduleCount,
      lessonCount,
      order: courseOrder,
    })
  }

  // ── products (profile-authored; mirrors seedStoreProducts' shape) ──────────
  const productMirror: Record<string, unknown>[] = []
  for (let i = 0; i < profile.products.length; i++) {
    const p = profile.products[i]
    const id = `${teamId}-prod-${p.key}`
    await db
      .collection('teams')
      .doc(teamId)
      .collection('products')
      .doc(id)
      .set({
        teamId,
        name: p.name,
        description: p.description,
        priceAmount: p.priceAmount,
        ...(p.variantLabel ? { variantLabel: p.variantLabel } : {}),
        ...(p.variants ? { variants: p.variants.map((v) => ({ ...v, active: true })) } : {}),
        active: true,
        order: i,
        created_at: ts(daysFromNow(-60)),
        updated_at: ts(daysFromNow(-60)),
        createdBy: uid,
      })
    productMirror.push({
      id,
      name: p.name,
      description: p.description,
      priceAmount: p.priceAmount,
      ...(p.variantLabel ? { variantLabel: p.variantLabel } : {}),
      ...(p.variants ? { variants: p.variants.map((v) => ({ id: v.id, label: v.label })) } : {}),
    })
  }
  if (productMirror.length > 0) {
    await db
      .collection('teams')
      .doc(teamId)
      .collection('public_profile')
      .doc(teamId)
      .set({ products: productMirror }, { merge: true })
  }

  // ── documents ──────────────────────────────────────────────────────────────
  const docNow = ts(now())
  for (let i = 0; i < profile.documents.length; i++) {
    const doc = profile.documents[i]
    const docId = `${teamId}-doc-${doc.key}`
    const docRef = db.collection('documents').doc(docId)
    const isExternal = !!doc.externalUrl
    await docRef.set({
      id: docId,
      teamId,
      title: doc.title,
      slug: doc.slug,
      kind: doc.kind,
      source: isExternal ? 'external_link' : 'rich_text',
      ...(isExternal ? { externalUrl: doc.externalUrl } : { body: doc.body }),
      summary: doc.summary,
      status: 'published',
      isPublic: true,
      order: i,
      created_at: ts(daysFromNow(-180)),
      updated_at: docNow,
      createdBy: uid,
      archived_at: null,
    })
    await docRef.collection('public_profile').doc(docId).set({
      type: 'document',
      teamId,
      slug: doc.slug,
      title: doc.title,
      kind: doc.kind,
      source: isExternal ? 'external_link' : 'rich_text',
      ...(isExternal ? { externalUrl: doc.externalUrl } : {}),
      summary: doc.summary,
      ...(isExternal ? {} : { bodyHtml: doc.body }),
      updated_at: docNow,
    })
  }
}

// ── team weekly reports (1 year of history) ───────────────────────────────────

function scaleMap(map: Record<string, number>, factor: number): Record<string, number> {
  const out: Record<string, number> = {}
  for (const [k, v] of Object.entries(map)) out[k] = Math.max(0, Math.round(v * factor))
  return out
}

async function seedWeeklyReports(profile: LeadProfile, teamId: string) {
  const byStage: Record<string, number> = {}
  const byStatus: Record<string, number> = {}
  const byAffiliationType: Record<string, number> = {}
  const bySub: Record<string, number> = {}
  let withAffiliation = 0
  let withSubscription = 0
  for (const c of profile.contacts) {
    const stage = stageForPoolEntry(c.type, c.totalSessions)
    byStage[stage] = (byStage[stage] ?? 0) + 1
    byStatus[c.status] = (byStatus[c.status] ?? 0) + 1
    if (c.type !== 'external' && c.status !== 'guest') {
      byAffiliationType.club = (byAffiliationType.club ?? 0) + 1
      if (statusCountsAsActive(c.status)) withAffiliation++
    }
    if (c.subKey) {
      bySub[`${teamId}-sub-${c.subKey}`] = (bySub[`${teamId}-sub-${c.subKey}`] ?? 0) + 1
      withSubscription++
    }
  }
  const curActive = profile.contacts.length

  const WEEKS = 52
  for (let w = WEEKS - 1; w >= 0; w--) {
    const monday = mondayOfWeeksAgo(w)
    const label = isoWeekLabel(monday)
    const seed = `${teamId}-wr-${w}`
    const progress = (WEEKS - 1 - w) / (WEEKS - 1)
    const ramp = 0.62 + 0.38 * progress
    const factor = Math.min(1.05, Math.max(0.5, ramp + (seededRand(seed + 'n') - 0.5) * 0.08))

    const appointment = 1 + Math.floor(seededRand(seed + 'co') * 2)
    const group = profile.weeklyGrid.length + Math.floor(seededRand(seed + 'gp') * 2) - 1
    const bookings = 1 + Math.round(progress * 4) + Math.floor(seededRand(seed + 'bk') * 2)
    const bkAppointment = Math.min(bookings, Math.floor(seededRand(seed + 'bc') * 2))

    await db
      .collection('teams')
      .doc(teamId)
      .collection('team_weekly_reports')
      .doc(label)
      .set({
        iso_week: label,
        generated_at: ts(new Date(monday.getTime() + 6 * 86_400_000)),
        active_contacts_count: Math.max(0, Math.round(curActive * factor)),
        contacts_count_by_stage: scaleMap(byStage, factor),
        contacts_count_by_membership_status: scaleMap(byStatus, factor),
        contacts_with_active_affiliation: Math.round(withAffiliation * factor),
        contacts_count_by_affiliation_type: scaleMap(byAffiliationType, factor),
        contacts_with_active_subscription: Math.round(withSubscription * factor),
        contacts_count_by_subscription_type: scaleMap(bySub, factor),
        sessions_count: group + appointment,
        sessions_count_by_type: { class: group, appointment },
        bookings_count: bookings,
        bookings_count_by_type: { class: bookings - bkAppointment, appointment: bkAppointment },
        trial_conversions_count:
          seededRand(seed + 'cv') < 0.25 + progress * 0.4
            ? 1 + Math.floor(seededRand(seed + 'cv2') * 2)
            : 0,
        trial_dropouts_count: seededRand(seed + 'dp') < 0.3 ? 1 : 0,
      })
  }
}

// ── main ──────────────────────────────────────────────────────────────────────

async function main() {
  // Load the lead profile FIRST so its timezone applies before any Date math —
  // Node caches the TZ on first Date use, so this must precede everything else.
  const profilePath = path.join(__dirname, 'leads', LEAD!, 'profile')
  let profile: LeadProfile
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    profile = (require(profilePath) as { default: LeadProfile }).default
  } catch (e) {
    console.error(`❌ No profile for lead '${LEAD}' (expected scripts/leads/${LEAD}/profile.ts).`)
    console.error(`   ${(e as Error).message}`)
    process.exit(1)
  }
  process.env.TZ = profile.timezone
  assetsDir = path.join(__dirname, 'leads', LEAD!, 'assets')

  const teamId = `lead-${profile.id}`
  console.log(
    `\n🌱 Seeding lead tenant '${profile.teamName}' (${teamId}) → ${PROJECT_ID}${USE_EMULATOR ? ' (emulator)' : ''}`
  )
  console.log(`   Storage bucket: ${BUCKET}`)
  // TZ sanity check: this must print the profile's local time for a 19:30 slot.
  const probe = new Date()
  probe.setHours(19, 30, 0, 0)
  console.log(
    `   Timezone: ${profile.timezone} — sample slot renders as ${probe.toLocaleTimeString('en-CH', { timeZone: profile.timezone, hour: '2-digit', minute: '2-digit' })} local\n`
  )

  if (USE_EMULATOR && !HAS_STORAGE_EMULATOR) {
    uploadsDisabled = true
    uploadsDisabledReason =
      'FIREBASE_STORAGE_EMULATOR_HOST is not set (refusing to touch a real bucket from an emulator run)'
    console.log(`   ⚠ image uploads disabled — ${uploadsDisabledReason}\n`)
  }
  if (!USE_EMULATOR) {
    const [bucketExists] = await admin.storage().bucket().exists()
    if (!bucketExists) {
      console.error(
        `❌ Storage bucket '${BUCKET}' does not exist. If the sandbox project uses the legacy` +
          ` name, re-run with LEAD_STORAGE_BUCKET=${PROJECT_ID}.appspot.com`
      )
      process.exit(1)
    }
    await enableEmailPasswordSignIn()
  }

  if (cli.reset) await resetLeadTenant(teamId)

  const { studentEmail, sessionCount, demoContact } = await seedLeadTenant(profile)

  console.log(
    `\n✅ Lead tenant seeded — ${profile.contacts.length} contacts, ${sessionCount} sessions\n`
  )
  console.log('   Logins (password: ' + DEMO_PASSWORD + '):')
  if (!cli.password) {
    console.log('   ⚠ Randomly generated — SAVE IT NOW; every reseed rotates it (pin with --password).')
  }
  for (const s of profile.staff) {
    console.log(
      `     ${s.role.padEnd(8)} ${`${s.firstname} ${s.lastname}`.trim().padEnd(20)} ${s.email}`
    )
  }
  console.log(`     student  (member Space login)     ${studentEmail}`)
  if (demoContact) {
    console.log(
      `\n   👤 Contact POV — sign in AS "${demoContact.name}" (shop/Space) via the ` +
        `passwordless code, using any of: ${demoContact.emails.join(', ')}`
    )
    console.log(
      '      (the code is delivered per the messaging policy — allowlist/redirect the tester so it reaches their inbox)'
    )
  }
  console.log(
    `\n   Public surfaces: /public/${profile.slug} (bio-link · site · booking · shop · space · appointments)`
  )
  if (profile.notes?.length) {
    console.log('\n   ⚠ Notes:')
    for (const n of profile.notes) console.log(`     · ${n}`)
  }
  console.log('')
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('❌ Seed failed:', err)
    process.exit(1)
  })
