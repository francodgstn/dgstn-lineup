/**
 * scripts/lib/mobile.ts — what every seeded environment needs so the MEMBER APP
 * can be signed into and tested there.
 *
 * ── THE REVIEW TENANT IS THE SAME EVERYWHERE ─────────────────────────────────
 * Production provisions its demo studio through the operator console
 * (`manageDemoTenant` → `provisionDemoTenant`, packages/functions/src/ops/
 * demoTenant.ts). Rather than describe a second, slightly different studio for
 * the emulator, staging and the sandbox, the seeders call THE SAME provisioner:
 * the dependency runs scripts→functions, which is the allowed direction
 * (`lib/fixtures/finance.ts` already imports from packages/functions/src), and
 * it means the studio a store reviewer meets in production is the one every
 * developer and every Maestro run has been signing into all along.
 *
 * `linyup-demo` is `flags.internal` (off the metrics), `silent` (sends
 * nothing), has no Connect account (every priced door shut) and every contact
 * is `@example.com`. See demoTenant.ts for why each of those holds.
 *
 * ── THE FIXED CODE ───────────────────────────────────────────────────────────
 * `app_settings/review_access` gives ONE address a known six-digit code that is
 * never mailed (ops/reviewAccess.ts owns the bounds). Seeding it is what makes
 * the app testable without a mailbox: on the emulator no mail is sent, on the
 * sandbox the system stream is dropped, and a device test cannot open an inbox.
 *
 * The default code is COMMITTED and therefore public. That is acceptable here
 * and only here: it opens a synthetic reviewer contact on an internal demo
 * studio, in non-production environments whose owner logins are already
 * committed (`linyup123`). PRODUCTION IS NEVER SEEDED BY THIS FILE — its code
 * is set from the console, by hand, for a review window, and switched off
 * after. Override with `REVIEW_ACCESS_CODE=nnnnnn` when a private one is wanted.
 *
 * The window is the maximum the callable allows. Staging is seeded by hand and
 * its window WILL lapse — re-run `pnpm staging:seed`, or re-enable from the
 * console; the sandbox reseeds nightly, so its window never does.
 */
import type { Firestore } from 'firebase-admin/firestore'
import { FieldValue, Timestamp } from 'firebase-admin/firestore'
import {
  APP_SETTINGS_COLLECTION,
  MOBILE_SETTINGS_DOC,
  type MobileAppSettings,
} from '@linyup/shared'
import {
  provisionDemoTenant,
  DEMO_REVIEW_EMAIL,
  DEMO_TESTERS,
  type ProvisionResult,
} from '../../packages/functions/src/ops/demoTenant'
import {
  REVIEW_ACCESS_DOC,
  REVIEW_ACCESS_MAX_DAYS,
} from '../../packages/functions/src/ops/reviewAccess'

export const REVIEW_ACCESS_DEFAULT_CODE = '123456'
const DAY_MS = 24 * 60 * 60 * 1000

export interface ReviewTenantSeed extends ProvisionResult {
  code: string
  expiresAt: Date
}

/** Provision `linyup-demo` and open the fixed-code login for its reviewer contact
 *  AND the closed-test testers — one address each, so nobody shares the login the
 *  store reviewer depends on. See `ops/reviewAccess.ts` for the guards. */
export async function seedReviewTenant(opts: {
  db: Firestore
  seededBy: string
  code?: string
}): Promise<ReviewTenantSeed> {
  const code = opts.code ?? process.env.REVIEW_ACCESS_CODE ?? REVIEW_ACCESS_DEFAULT_CODE
  if (!/^\d{6}$/.test(code)) {
    throw new Error(`REVIEW_ACCESS_CODE must be exactly six digits (got '${code}')`)
  }

  const result = await provisionDemoTenant()

  const expiresAt = new Date(Date.now() + REVIEW_ACCESS_MAX_DAYS * DAY_MS)
  await opts.db
    .collection(APP_SETTINGS_COLLECTION)
    .doc(REVIEW_ACCESS_DOC)
    .set(
      {
        enabled: true,
        // The reviewer stays in the legacy `email` field so an older deployment
        // reading only that keeps working; `emails` is the full set and is what
        // current code unions over.
        email: DEMO_REVIEW_EMAIL,
        emails: [DEMO_REVIEW_EMAIL, ...DEMO_TESTERS.map((t) => t.email)],
        code,
        expires_at: Timestamp.fromDate(expiresAt),
        note: `Seeded by ${opts.seededBy} — the member app's test login + ${DEMO_TESTERS.length} closed-test testers (docs/test-accounts.md).`,
        updated_at: FieldValue.serverTimestamp(),
        updated_by: opts.seededBy,
      },
      { merge: true }
    )

  return { ...result, code, expiresAt }
}

/** `app_settings/mobile` — the member app's minimum-version policy. Seeded
 *  permissive (1.0.0, the first store version) so no seeded environment ever
 *  gates a dev build; the console raises it when a build must be retired. */
export async function seedMobileSettings(opts: {
  db: Firestore
  seededBy: string
  minSupportedVersion?: string
}): Promise<void> {
  const settings: MobileAppSettings = {
    min_supported_version: opts.minSupportedVersion ?? '1.0.0',
    update_message: null,
    store_url_ios: null,
    store_url_android: null,
    updated_by: opts.seededBy,
  }
  await opts.db
    .collection(APP_SETTINGS_COLLECTION)
    .doc(MOBILE_SETTINGS_DOC)
    .set({ ...settings, updated_at: FieldValue.serverTimestamp() }, { merge: true })
}

/** The line every seeder prints, so the login is never re-derived from memory. */
export function printMemberAppLogin(seed: ReviewTenantSeed): void {
  console.log('   📱 Member app (Linyup) test login — docs/test-accounts.md')
  console.log(`      studio   ${seed.teamId}  (/public/${seed.slug})`)
  console.log(`      email    ${seed.reviewEmail}`)
  console.log(
    `      code     ${seed.code}   (fixed, never mailed; valid until ${seed.expiresAt.toISOString().slice(0, 10)})`
  )
}
