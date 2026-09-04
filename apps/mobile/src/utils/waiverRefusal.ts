/**
 * Waiver refusals, made legible in the app.
 *
 * The mobile app has NO waiver step and deliberately does not get one in this
 * phase: it mirrors shared shapes locally rather than depending on
 * `@linyup/shared`, so a step here is a port rather than a call-site edit. What
 * it does get is the minimum that stops a compliance refusal reading as a
 * crash — a sentence that names the document, and a way to go and sign it.
 *
 * ── WHY THE URL COMES FROM THE SERVER ───────────────────────────────────────
 * The app has no notion of the web origin (that lives in a server-side env
 * param, `HOSTING_URL`), so it cannot build a link into the member's Space. A
 * guessed hostname would send somebody standing at a door to a page that may not
 * exist. `selfCheckIn` therefore attaches `signUrl` to the refusal it throws, and
 * this maps it. When it is absent — every other rail, today — the message still
 * names the document and says where to sign, which is legible without being a
 * promise the app cannot keep.
 *
 * ── TRANSLATED VIA THE `Waiver` NAMESPACE ───────────────────────────────────
 * A pure module-level function can't call `useTranslations` itself, so the
 * caller passes one bound to the `Waiver` namespace (`useTranslations('Waiver')`)
 * — see the three call sites for the pattern. `title`, when the server sent
 * one, is the studio's own document name (Firestore-authored) and is never
 * translated; only the surrounding sentence is.
 *
 * ── TWO RAILS, TWO VERBS ────────────────────────────────────────────────────
 * The app refuses on two paths and they are not the same act: the QR scanner
 * checks somebody in at a door, the agenda card BOOKS a class days ahead.
 * "before you can check in" printed on a Book button is the wrong-context copy
 * this phase keeps finding, so the verb is a parameter and the caller says
 * which rail it is.
 */

/** Which act the member was refused — it decides the verb, nothing else. */
export type WaiverRefusalContext = 'checkin' | 'booking'

export interface WaiverRefusal {
  /** The sentence to show. */
  message: string
  /** Where the member can sign, when the server told us. */
  signUrl: string | null
}

interface CallableError {
  code?: string
  message?: string
  details?: {
    reason?: string
    title?: string
    signUrl?: string
  }
}

/** What `waiverRefusal` needs from `useTranslations('Waiver')`. */
export type WaiverTranslate = (key: string, values?: Record<string, string | number>) => string;

/**
 * Returns null when this is not a waiver refusal, so a call site reads
 * `waiverRefusal(t, err) ?? …its own handling…` and nothing about waivers leaks
 * into an unrelated branch.
 */
export function waiverRefusal(
  t: WaiverTranslate,
  err: unknown,
  context: WaiverRefusalContext = 'checkin'
): WaiverRefusal | null {
  const e = err as CallableError | null
  const reason = e?.details?.reason
  if (typeof reason !== 'string' || !reason.startsWith('waiver_')) return null

  // The studio's own document name (Firestore-authored) — never translated.
  const title = e?.details?.title?.trim() || t('documentFallback');
  const signUrl = typeof e?.details?.signUrl === 'string' ? e.details.signUrl : null;
  const verb = context === 'booking' ? t('verbBooking') : t('verbCheckin');
  const noun = context === 'booking' ? t('nounBooking') : t('nounCheckin');

  // Each sentence says what is true and what to do. `waiver_unavailable` is the
  // one that is NOT the member's to fix — telling somebody to sign a document
  // the server cannot serve is an instruction they cannot follow — so it keeps
  // its own arm and everything else falls through to "sign it, here is where".
  const message =
    reason === 'waiver_unavailable'
      ? t('temporarilyUnavailable', { noun })
      : signUrl
        ? t('needsSignatureOpenNow', { title, verb })
        : t('needsSignatureOpenStudioPage', { title, verb });

  return { message, signUrl }
}
