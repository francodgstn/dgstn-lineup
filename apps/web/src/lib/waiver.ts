// The CLIENT half of the waiver gate: the wire shapes, the refusal table, and
// the one place a surface turns "what the visitor did on the step" into the
// payload every booking callable accepts.
//
// It is deliberately free of React so the same coercion can be used from a form
// handler, a checkout catch block and a test.
//
// ── WHAT THE SERVER EXPECTS BACK, AND WHY EACH FIELD IS THERE ────────────────
// `parseWaiverSubmissions` (packages/functions/src/waivers/gate.ts) drops
// anything malformed rather than repairing it, so a payload that loses a field
// does not fail loudly — it reads as "did not sign" and the gate refuses in the
// ordinary way. Every field below therefore comes STRAIGHT BACK from
// `resolveWaiverRequirement`, unedited:
//
//   documentId, version, bodyHash  pin the signature to the exact text shown
//   intentId                       makes a double-submit ONE row, not two
//   accepted                       the checkbox; absent or false = not signed
//   signingAsGuardian, guardianName  the self-declaration, when the studio
//                                    flagged the waiver `mayIncludeMinors`
//
// Nothing here is a credential and nothing here is trusted: the server re-reads
// the version's own hash and refuses a disagreement, and it drops the
// declaration for any waiver the studio did not flag.

import type { useTranslations } from 'next-intl'

/** What the surface must do next for one waiver — mirrors `WaiverStepAction`
 *  in packages/functions/src/waivers/requirement.ts. Two answers, because the
 *  person in front of the step is always the person who can complete it. */
export type WaiverStepAction = 'none' | 'sign_self'

export type WaiverAcceptanceState = 'none' | 'valid' | 'superseded' | 'expired' | 'revoked'

/** One row of `resolveWaiverRequirement`'s answer. */
export interface WaiverRequirementItem {
  documentId: string
  slug: string
  title: string
  version: number
  /** The FROZEN text of that version, from the immutable snapshot — never the
   *  document's live body, which a manager may be mid-edit on. */
  bodyHtml: string
  bodyHash: string
  /** The studio flagged this waiver "participants may be minors", so the step
   *  shows a second required choice — "I am the participant" vs "I am signing as
   *  a parent or guardian" — with an optional name. A SELF-DECLARATION: it
   *  changes what is recorded and what the studio's roster shows, never whether
   *  this booking is allowed. */
  mayIncludeMinors: boolean
  state: WaiverAcceptanceState
  action: WaiverStepAction
  intentId: string
}

/**
 * NO `ambiguousCaller` FIELD, AND ITS ABSENCE IS A SECURITY PROPERTY.
 *
 * The server used to report "this email addresses several contacts and no name
 * narrowed it to one". Nothing here ever read it — the conservative answer is
 * already produced by the rows themselves, which come back `state: 'none'`,
 * `action: 'sign_self'` either way — while it answered, for any anonymous
 * caller, the one question a public surface must not answer: is this address
 * somebody's here. It is gone rather than rationed
 * (packages/functions/src/waivers/caller.ts, step 4), so a step built on this
 * type cannot start depending on the leak.
 */
export interface WaiverRequirementResponse {
  waivers: WaiverRequirementItem[]
}

/** The wire shape one tick takes back to a booking callable. */
export interface WaiverAcceptancePayload {
  documentId: string
  version: number
  bodyHash: string
  intentId: string
  accepted: true
  signingAsGuardian?: boolean
  guardianName?: string
}

/** What the visitor answered on the self-declaration, per document. `null` ⇒ not
 *  answered yet, which is what keeps the step from being submittable on a waiver
 *  that asks. */
export type WaiverSignerChoice = 'self' | 'guardian'

/** The identity proofs `resolveWaiverRequirement` accepts — the SAME set, in the
 *  same order, the booking rails accept. A bare `contactId` is deliberately not
 *  one of them on the server; it is carried here only so a signed-in surface can
 *  pass what it has and let the server decide whether the session agrees. */
export interface WaiverCallerIdentity {
  contactId?: string
  authenticatedContactId?: string
  verificationCodeId?: string
  email?: string
  firstname?: string
  lastname?: string
}

/** Is this item still waiting on the visitor for something? */
export function waiverNeedsVisitor(item: WaiverRequirementItem): boolean {
  return item.action !== 'none'
}

/**
 * Has this item been satisfied by what the visitor has done ON THIS STEP?
 *
 * The tick is required. On a `mayIncludeMinors` waiver the self-declaration is
 * required TOO — a second radio with no default, because a default would answer
 * on the visitor's behalf a question the record then attributes to them. It
 * gates the Confirm and nothing else: whichever answer they give, the booking
 * goes through.
 */
export function waiverSatisfiedLocally(
  item: WaiverRequirementItem,
  ticked: boolean,
  choice: WaiverSignerChoice | null
): boolean {
  if (item.action === 'none') return true
  if (!ticked) return false
  return item.mayIncludeMinors ? choice !== null : true
}

/** Turn the step's state into the payload. Only a ticked `sign_self` produces a
 *  row: an already-valid waiver needs no submission, and the server treats one
 *  as a no-op anyway. */
export function waiverAcceptancePayload(
  items: WaiverRequirementItem[],
  ticks: Record<string, boolean>,
  choices: Record<string, WaiverSignerChoice | undefined>,
  guardianNames: Record<string, string | undefined>
): WaiverAcceptancePayload[] {
  return items
    .filter((i) => i.action === 'sign_self' && ticks[i.documentId] === true)
    .map((i) => {
      const asGuardian = i.mayIncludeMinors && choices[i.documentId] === 'guardian'
      const name = (guardianNames[i.documentId] ?? '').trim()
      return {
        documentId: i.documentId,
        version: i.version,
        bodyHash: i.bodyHash,
        intentId: i.intentId,
        accepted: true as const,
        ...(asGuardian ? { signingAsGuardian: true } : {}),
        ...(asGuardian && name ? { guardianName: name } : {}),
      }
    })
}

// ─── Refusals ────────────────────────────────────────────────────────────────

/**
 * Every `details.reason` the waiver paths raise, and NOTHING else.
 *
 * The list is exhaustive on purpose. The previous phase shipped a public surface
 * that rendered internal English billing prose to a French visitor because one
 * refusal had no reason code and fell through to `err.message`; a waiver refusal
 * arrives on the acquisition path, in four languages, and every one of these has
 * a `reason_*` key in the `Waiver` namespace.
 *
 * The census owner for the server side is `WaiverRefusalReason` in
 * packages/functions/src/waivers/gate.ts; this table is checked against it by
 * `waiverReasons.test.ts`.
 */
export const WAIVER_REFUSAL_REASONS = [
  'waiver_required',
  'waiver_version_changed',
  'waiver_unavailable',
] as const

export type WaiverRefusalReason = (typeof WAIVER_REFUSAL_REASONS)[number]

function reasonOf(err: unknown): string | null {
  const e = err as { details?: { reason?: string } } | null
  return e?.details?.reason ?? null
}

export function waiverRefusalReason(err: unknown): WaiverRefusalReason | null {
  const reason = reasonOf(err)
  return reason && (WAIVER_REFUSAL_REASONS as readonly string[]).includes(reason)
    ? (reason as WaiverRefusalReason)
    : null
}

/**
 * The translated sentence for a waiver refusal, or null when this error is not
 * one — so a call site reads `waiverErrorMessage(err, tWaiver) ?? …its own
 * table…` and nothing about waivers leaks into an unrelated branch.
 *
 * `t` is the `Waiver` namespace. The keys are `reason_{code}`, in lockstep
 * across all four locales.
 */
export function waiverErrorMessage(
  err: unknown,
  t: ReturnType<typeof useTranslations>
): string | null {
  const reason = waiverRefusalReason(err)
  if (!reason) return null
  return t(`reason_${reason}` as Parameters<typeof t>[0])
}

/**
 * Did this refusal come from the waiver gate, i.e. is there a STEP the surface
 * should present rather than an error to print?
 *
 * `waiver_required` and `waiver_version_changed` both mean "fetch the
 * requirement and render the step". `waiver_unavailable` is the one the visitor
 * cannot act on by re-rendering.
 */
export function waiverRefusalIsActionable(err: unknown): boolean {
  const reason = waiverRefusalReason(err)
  return reason === 'waiver_required' || reason === 'waiver_version_changed'
}
