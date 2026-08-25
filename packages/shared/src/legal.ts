/**
 * The Customer-facing agreement, and the record that one was accepted.
 *
 * WHY A VERSION AND NOT JUST A BOOLEAN. "They agreed" is not the question a
 * dispute asks; "which text did they agree to, and when" is. A boolean cannot
 * answer it after the terms are edited once, and by then the evidence is gone.
 * One string costs nothing now and is unreconstructable later.
 *
 * BUMP THIS WHENEVER THE BINDING TEXT CHANGES in a way a Customer would need to
 * agree to again — not for a typo. The stored value is compared to it, so a bump
 * is what makes an existing acceptance stale; nothing else does.
 *
 * The date form is deliberate: it matches the `lastUpdated` front-matter on the
 * published pages (`apps/landing/src/pages/terms.md`, `dpa.md`), so the stored
 * version names a document a reader can actually go and find. A semver here
 * would need a second lookup table mapping it to a document.
 */
export const CURRENT_TERMS_VERSION = '2026-08-25'

/**
 * What a Customer accepted, stamped on the team at provisioning.
 *
 * It lives on the TEAM, not on the user, because the contracting party is the
 * studio — the person clicking is binding a business. `accepted_by_uid` and
 * `accepted_by_email` record WHO did the binding, which is the thing a dispute
 * actually turns on; the team id alone would not say.
 *
 * ABSENT MEANS NEVER ASKED, not "refused". Every team created before this
 * shipped has no value at all, and reading absence as refusal would lock out
 * accounts that were never given the chance. There is deliberately no gate on
 * this field anywhere — it is a RECORD, not a permission. If a gate is ever
 * wanted, that is a product decision to take on purpose, with a way for an
 * existing Customer to accept.
 */
export interface TermsAcceptance {
  /** The `CURRENT_TERMS_VERSION` in force when it was accepted. */
  version: string
  /** Server timestamp. Firestore `Timestamp` at rest. */
  accepted_at: unknown
  accepted_by_uid: string
  accepted_by_email: string
}

/**
 * Has this team accepted the terms currently in force?
 *
 * Answers only what it is asked. It does NOT say whether the team may use the
 * product — see the note above about this being a record rather than a gate.
 */
export function termsAcceptanceIsCurrent(acceptance?: TermsAcceptance | null): boolean {
  return acceptance?.version === CURRENT_TERMS_VERSION
}
