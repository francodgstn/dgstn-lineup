/**
 * Shared documents/waiver seeding — THE one writer of a seeded published document.
 *
 * ── WHY THIS FILE EXISTS ─────────────────────────────────────────────────────
 * Four seeders wrote this block four times, and the copies had already diverged
 * in a way that is invisible at a glance and produces a real alarm
 * (docs/seed-truth-2026-08.md → "Duplication register"): `seed-emulator.ts` wrote
 * the version snapshot and sanitized the mirror; the other three wrote
 * `status: 'published'` with NO `current_version` and NO `versions/v0001`, and
 * copied the RAW body into the public mirror. That is precisely the state
 * `scripts/backfill-document-versions.ts` exists to clear, reproduced on every
 * fresh seed run — which is how `scripts/verify-waiver-ledger.ts` gets learned
 * as noise.
 *
 * The implementation here is LIFTED from the emulator seeder, not re-derived.
 *
 * ── WHAT A CORRECT SEEDED DOCUMENT LOOKS LIKE ────────────────────────────────
 * `scripts/verify-waiver-ledger.ts` states the four invariants, and this file
 * exists to satisfy all four by construction:
 *
 *   1. `body_hash === sha256(bodyHtml)` on every version — so the SAME hasher
 *      and the SAME sanitizer the publish callable uses are imported below. A
 *      second implementation would make the verifier report a difference
 *      between two hashers rather than a difference in the text.
 *   2. Every signer row is backed by an acceptance event AT THE VERSION IT
 *      CLAIMS, and that event is `kind: 'accepted'` — including a REVOKED row,
 *      whose `acceptance_id` still points at the acceptance it revokes and
 *      which must additionally carry `revoked_at`.
 *   3. The team's waiver policy agrees with the documents IN BOTH DIRECTIONS —
 *      so the policy is derived here through `waiverPolicyEntryFor`, the same
 *      single derivation the publish callable and the verifier share.
 *   4. No document is `published` with a null `current_version`.
 *
 * ── THE MIRROR COPIES, IT DOES NOT RE-SANITIZE ───────────────────────────────
 * `DocumentPublicProfile.bodyHtml` is copied from the frozen version snapshot,
 * never re-derived from `body`. Two sanitize calls with a library upgrade
 * between them would silently break every acceptance hash.
 *
 * Path constants mirror @linyup/shared (same convention as lib/storefront.ts).
 * The sanitizer, the hasher and `documentVersionId` / `waiverPolicyEntryFor` are
 * IMPORTED rather than mirrored — a constant may be copied, an implementation
 * that a stored fingerprint depends on may not.
 */

import admin from 'firebase-admin'
import {
  contactIdentityKey,
  documentVersionId,
  waiverPolicyEntryFor,
  waiverValidUntilMs,
} from '@linyup/shared'
import type {
  DocumentKind,
  RequiredWaiverEntry,
  WaiverConfig,
  WaiverSignerRole,
} from '@linyup/shared'
import { sanitizeRichHtml } from '../../../packages/functions/src/utils/sanitizeHtml'
import { sha256Hex } from '../../../packages/functions/src/utils/crypto'

// ── Firestore path constants (mirror @linyup/shared/paths) ────────────────────
const TEAMS_COLLECTION = 'teams'
const DOCUMENTS_COLLECTION = 'documents'
const DOCUMENT_VERSIONS_SUBCOLLECTION = 'versions'
const DOCUMENT_ACCEPTANCES_SUBCOLLECTION = 'acceptances'
const DOCUMENT_SIGNERS_SUBCOLLECTION = 'signers'
const DOCUMENT_PUBLIC_PROFILE_SUBCOLLECTION = 'public_profile'
const WAIVER_POLICY_SUBCOLLECTION = 'waiver_policy'
const WAIVER_POLICY_DOC_ID = 'current'
const TEAM_SETTINGS_SUBCOLLECTION = 'settings'
const DOCUMENTS_SETTINGS_DOC_ID = 'documents'

const tsOf = (d: Date) => admin.firestore.Timestamp.fromDate(d)
function daysAgo(n: number): Date {
  const d = new Date()
  d.setDate(d.getDate() - n)
  return d
}

export type SeedDocumentKind = DocumentKind

export interface SeedDocumentSpec {
  /** Full document id — callers own the id convention (`${teamId}-doc-terms`). */
  id: string
  title: string
  slug: string
  kind: SeedDocumentKind
  summary?: string
  /** Rich-text body. Mutually exclusive with `externalUrl`. */
  body?: string
  /** External-link document. Mutually exclusive with `body`. */
  externalUrl?: string
  order: number
  /**
   * `kind: 'waiver'` only. When `required: true` the document earns an entry in
   * `teams/{teamId}/waiver_policy/current` — which is what makes the booking
   * gate actually gate. Absent on every other kind.
   */
  waiver?: WaiverConfig
}

export interface SeedDocumentsOpts {
  teamId: string
  uid: string
  /** Shown as `published_by_name` on the frozen version snapshot. */
  publishedByName?: string
  /** How long ago (days) the documents were "created". Default 180. */
  createdDaysAgo?: number
}

export interface SeededDocument {
  id: string
  slug: string
  kind: SeedDocumentKind
  /** The frozen v1 hash — what an acceptance pins and the policy carries. */
  bodyHash: string
  version: number
}

/**
 * Write published documents with their immutable v1 snapshot and public mirror,
 * then patch the team's waiver policy to agree with them.
 *
 * The policy is written whole from the documents in THIS call, which is correct
 * for a seed (it authors the tenant's whole document set in one pass) and is
 * NOT the shape the callable uses — `publishDocumentVersion` patches the policy
 * inside the same transaction as the document write. A seeder that later adds a
 * waiver in a second call must pass every waiver again, or the first one's entry
 * is dropped.
 */
export async function seedPublishedDocuments(
  opts: SeedDocumentsOpts,
  docs: SeedDocumentSpec[]
): Promise<SeededDocument[]> {
  const db = admin.firestore()
  const { teamId, uid } = opts
  const publishedByName = opts.publishedByName ?? 'Seed'
  const createdAt = tsOf(daysAgo(opts.createdDaysAgo ?? 180))
  const now = tsOf(new Date())

  const out: SeededDocument[] = []
  const policyEntries: RequiredWaiverEntry[] = []

  for (const doc of docs) {
    const isExternal = !!doc.externalUrl
    const source = isExternal ? 'external_link' : 'rich_text'
    // Sanitized ONCE. The mirror copies this string; it never re-sanitizes.
    const bodyHtml = isExternal ? '' : sanitizeRichHtml(doc.body ?? '')
    const bodyHash = sha256Hex(bodyHtml)
    const docRef = db.collection(DOCUMENTS_COLLECTION).doc(doc.id)

    await docRef.set({
      id: doc.id,
      teamId,
      title: doc.title,
      slug: doc.slug,
      kind: doc.kind,
      source,
      ...(isExternal ? { externalUrl: doc.externalUrl } : { body: doc.body }),
      ...(doc.summary ? { summary: doc.summary } : {}),
      status: 'published',
      isPublic: true,
      order: doc.order,
      // A PUBLISHED document has a VERSION. Seeding one without would reproduce,
      // on every fresh run, exactly the state backfill-document-versions.ts
      // exists to clear — and verify-waiver-ledger.ts would fail on clean seed
      // data, which is how a real alarm gets learned as noise.
      current_version: 1,
      min_valid_version: null,
      ...(doc.waiver ? { waiver: doc.waiver } : {}),
      created_at: createdAt,
      updated_at: now,
      createdBy: uid,
      archived_at: null,
    })

    // The IMMUTABLE snapshot the mirror copies and an acceptance pins.
    await docRef
      .collection(DOCUMENT_VERSIONS_SUBCOLLECTION)
      .doc(documentVersionId(1))
      .set({
        teamId,
        documentId: doc.id,
        version: 1,
        kind: doc.kind,
        title: doc.title,
        bodyHtml,
        bodyHash,
        bodyChars: bodyHtml.length,
        externalUrl: doc.externalUrl ?? null,
        mayIncludeMinors: doc.waiver ? doc.waiver.mayIncludeMinors === true : null,
        publish_outcome: 'silent',
        supersedes: null,
        published_at: now,
        published_by: uid,
        published_by_name: publishedByName,
        backfilled_at: null,
      })

    // World-readable summary — what syncDocumentPublicProfile writes. Double-gated
    // on published && isPublic, both true here by construction.
    await docRef
      .collection(DOCUMENT_PUBLIC_PROFILE_SUBCOLLECTION)
      .doc(doc.id)
      .set({
        type: 'document',
        teamId,
        slug: doc.slug,
        title: doc.title,
        kind: doc.kind,
        source,
        ...(doc.summary ? { summary: doc.summary } : {}),
        ...(isExternal ? { externalUrl: doc.externalUrl } : { bodyHtml }),
        version: 1,
        bodyHash,
        updated_at: now,
      })

    // The policy is derived, never hand-written: waiverPolicyEntryFor is the
    // SAME derivation publishDocumentVersion and verify-waiver-ledger use, so a
    // seeded policy cannot disagree with a seeded document by construction.
    const entry = waiverPolicyEntryFor(
      {
        documentId: doc.id,
        slug: doc.slug,
        title: doc.title,
        kind: doc.kind,
        status: 'published',
        archived_at: null,
        current_version: 1,
        min_valid_version: null,
        waiver: doc.waiver ?? null,
      },
      bodyHash
    )
    if (entry) policyEntries.push(entry)

    out.push({ id: doc.id, slug: doc.slug, kind: doc.kind, bodyHash, version: 1 })
  }

  // teams/{teamId}/waiver_policy/current — THE authorization source for the
  // booking gate. It fails CLOSED, so a tenant with no waiver simply has no doc
  // and every rail behaves as "nothing to sign"; writing an empty policy would
  // say the same thing with an extra read.
  if (policyEntries.length > 0) {
    await db
      .collection(TEAMS_COLLECTION)
      .doc(teamId)
      .collection(WAIVER_POLICY_SUBCOLLECTION)
      .doc(WAIVER_POLICY_DOC_ID)
      .set({ teamId, required: policyEntries, updated_at: now })
  }

  return out
}

/** teams/{teamId}/settings/documents — the signup-consent selection, in its
 *  post-plugin home. Documents is a default feature, so there is no install. */
export async function seedDocumentsSettings(
  teamId: string,
  signupDocumentIds: string[],
  updatedDaysAgo = 30
): Promise<void> {
  await admin
    .firestore()
    .collection(TEAMS_COLLECTION)
    .doc(teamId)
    .collection(TEAM_SETTINGS_SUBCOLLECTION)
    .doc(DOCUMENTS_SETTINGS_DOC_ID)
    .set({ signupDocumentIds, updated_at: tsOf(daysAgo(updatedDaysAgo)) })
}

export interface SeedSignatureSpec {
  contactId: string
  contactName: string
  contactEmail: string
  /** Days ago the signature was given. */
  signedDaysAgo: number
  /**
   * Which state `waiverAcceptanceState` should return for this row:
   *
   *   'valid'   → active, unexpired, at or above the document's floor
   *   'expired' → active, but `valid_until` is in the past
   *   'revoked' → status revoked, carrying `revoked_at` — without which a later
   *               acceptance would silently undo the revocation (a check in
   *               verify-waiver-ledger.ts, not an opinion)
   *
   * `superseded` and `none` are deliberately NOT here, because neither is a
   * property of a row. `none` is the ABSENCE of a row — express it by not
   * calling this. `superseded` is DERIVED from the document's
   * `min_valid_version` being above what the row accepted, so it is produced by
   * publishing a second version and calling `raiseWaiverFloor` — never by
   * stamping a status onto a signer row, which is stored state the model
   * deliberately does not have.
   */
  state: 'valid' | 'expired' | 'revoked'
  signerRole?: WaiverSignerRole
  /** Only meaningful on a `guardian` row; a self-declaration either way. */
  signerName?: string
}

/**
 * Write ONE signature: the append-only acceptance EVENT plus the mutable
 * current-state signer row, exactly as `packages/functions/src/waivers/accept.ts`
 * writes them.
 *
 * A REVOKED row still points at the ACCEPTED event it revokes — the verifier
 * requires `acceptance_id` to name a `kind: 'accepted'` row — and additionally
 * carries `revoked_at`, without which a later acceptance would silently undo the
 * revocation. Both facts are checks in `verify-waiver-ledger.ts`, not opinions.
 */
export async function seedWaiverSignature(
  params: {
    teamId: string
    documentId: string
    version: number
    bodyHash: string
    validityMonths: number | null
  },
  sig: SeedSignatureSpec
): Promise<void> {
  const db = admin.firestore()
  const docRef = db.collection(DOCUMENTS_COLLECTION).doc(params.documentId)
  const acceptedAt = daysAgo(sig.signedDaysAgo)
  const intentId = `seed-${sig.contactId}-${params.documentId}`
  // waiverAcceptanceId's material is (documentId, version, contactId, intentId);
  // reproduced through the same hasher so a re-run overwrites in place.
  const acceptanceId = `a_${sha256Hex(
    [params.documentId, String(params.version), sig.contactId, intentId].join(':')
  ).slice(0, 32)}`

  // The validity rule IN FORCE AT THE TICK, frozen — and DERIVED from
  // `accepted_at`, never pinned.
  //
  // An 'expired' row is produced by back-dating the SIGNATURE past its own
  // window, so `valid_until` still equals `accepted_at + validity_months`. An
  // earlier draft pinned `valid_until` to yesterday instead, which rendered
  // correctly and stored a contradiction: a 392-day-old signature under a
  // 12-month rule claiming it lapsed yesterday. Nothing checks that today, which
  // is exactly why a seed must not write it — the shapes here are the shapes
  // waivers/accept.ts writes, or they are a trap for whoever reads them next.
  // `waiverValidUntilMs` is THE arithmetic — imported, never reproduced. Its
  // docblock notes it had exactly one non-test call site (waivers/accept.ts);
  // this is the second, and it is here precisely so a seeded row cannot drift
  // from what the callable would have stored.
  const validUntilMs = waiverValidUntilMs(acceptedAt.getTime(), params.validityMonths)
  const validUntil = validUntilMs == null ? null : tsOf(new Date(validUntilMs))

  await docRef
    .collection(DOCUMENT_ACCEPTANCES_SUBCOLLECTION)
    .doc(acceptanceId)
    .set({
      teamId: params.teamId,
      documentId: params.documentId,
      version: params.version,
      body_hash: params.bodyHash,
      kind: 'accepted',
      contactId: sig.contactId,
      identity_key: contactIdentityKey(
        { email: sig.contactEmail, contactId: sig.contactId },
        sha256Hex
      ),
      signer_role: sig.signerRole ?? 'self',
      signer_name: sig.signerName ?? sig.contactName,
      signer_email: sig.contactEmail,
      signer_email_verified_by: 'session',
      subject_name: sig.contactName,
      subject_email: sig.contactEmail,
      validity_months_at_signing: params.validityMonths,
      valid_until: validUntil,
      method: 'click_wrap',
      accepted_at: tsOf(acceptedAt),
      ip: null,
      user_agent: null,
      locale: 'en',
      source: 'signup',
      booking_ref: null,
      intent_id: intentId,
      created_at: tsOf(acceptedAt),
    })

  const revoked = sig.state === 'revoked'
  await docRef
    .collection(DOCUMENT_SIGNERS_SUBCOLLECTION)
    .doc(sig.contactId)
    .set({
      teamId: params.teamId,
      documentId: params.documentId,
      contactId: sig.contactId,
      accepted_version: params.version,
      accepted_at: tsOf(acceptedAt),
      valid_until: validUntil,
      acceptance_id: acceptanceId,
      // Absolute, never FieldValue.increment — the same rule bookings_count and
      // usage_count carry.
      rounds: 1,
      signer_role: sig.signerRole ?? 'self',
      signer_name: sig.signerName ?? sig.contactName,
      signer_email: sig.contactEmail,
      signer_email_verified_by: 'session',
      status: revoked ? 'revoked' : 'active',
      revoked_at: revoked ? tsOf(daysAgo(Math.max(0, sig.signedDaysAgo - 5))) : null,
      revoked_by: revoked ? 'seed' : null,
      latest_notice_id: null,
      contact_name: sig.contactName,
      contact_email: sig.contactEmail,
      updated_at: tsOf(acceptedAt),
    })
}

/**
 * Move a document's `min_valid_version` floor without writing a new version.
 *
 * This is how a `require_resign` publish expresses supersession: ONE number
 * moves and ZERO signer rows are written, because `waiverAcceptanceState`
 * derives supersession lazily. A seed that instead stamped `superseded` onto a
 * signer row would be inventing stored state the model deliberately does not
 * have.
 *
 * The caller must publish the matching version first; seeding a floor above
 * `current_version` would make the policy disagree with the document.
 */
export async function raiseWaiverFloor(documentId: string, minValidVersion: number): Promise<void> {
  await admin
    .firestore()
    .collection(DOCUMENTS_COLLECTION)
    .doc(documentId)
    .set({ min_valid_version: minValidVersion }, { merge: true })
}

/**
 * Seed a studio's liability waiver: the document, its policy entry, and a spread
 * of signature states over the team's own contacts.
 *
 * WHY IT READS THE CONTACTS BACK rather than taking them as a parameter: the
 * four seeders build their contact pools in four different shapes, and a signer
 * needs a real contactId, name and email (the email is what `identity_key` is
 * derived from). One query keeps the call site identical everywhere, and a seed
 * script reading its own writes costs nothing.
 *
 * The spread is deliberate. A waiver whose every signature is valid demonstrates
 * nothing about `waiverAcceptanceState`, whose whole design is a fixed
 * precedence order — so the roster shows a signed member, a lapsed one, a
 * revoked one, and members who never signed at all.
 */
export async function seedTeamWaiver(opts: {
  teamId: string
  uid: string
  teamName: string
  teamSlug: string
  /** Also seeded here so the policy is written from the COMPLETE document set —
   *  seedPublishedDocuments writes the policy whole. */
  otherDocuments: SeedDocumentSpec[]
  publishedByName?: string
  /** Studios that teach children want the minors prompt on. Default true. */
  mayIncludeMinors?: boolean
  /** Default 12. null = a signature never lapses. */
  validityMonths?: number | null
  /** Default true — an unrequired waiver earns no policy entry and gates nothing. */
  required?: boolean
  /** How long ago (days) every document in the set was created. Default 180. */
  createdDaysAgo?: number
}): Promise<SeededDocument[]> {
  const { teamId, uid, teamName, teamSlug } = opts
  const validityMonths = opts.validityMonths === undefined ? 12 : opts.validityMonths
  const waiverId = `${teamId}-doc-waiver`
  const waiverSpec: SeedDocumentSpec = {
    id: waiverId,
    title: 'Liability Release & Assumption of Risk',
    slug: `waiver-${teamSlug.slice(0, 4)}`,
    kind: 'waiver',
    summary: `The liability release every participant at ${teamName} signs before training.`,
    order: 3,
    waiver: {
      mayIncludeMinors: opts.mayIncludeMinors !== false,
      validityMonths,
      scope: { appliesTo: 'all_bookings' },
      required: opts.required !== false,
    },
    body: `<h2>Liability Release &amp; Assumption of Risk</h2>
<p>Please read this release carefully before participating in any activity at ${teamName}. By signing, you confirm that you understand and accept the following.</p>
<h3>1. Assumption of risk</h3>
<p>Physical training carries an inherent risk of injury. I understand that risk, I accept it, and I participate voluntarily.</p>
<h3>2. Fitness to participate</h3>
<p>I confirm that I am in good health and know of no medical condition that would make participation unsafe. I will tell a coach about any condition, injury or medication that could affect my training, and I will update them if that changes.</p>
<h3>3. Release</h3>
<p>To the extent permitted by law, I release ${teamName}, its coaches and its staff from liability for injury or loss sustained during participation, except where caused by gross negligence or wilful misconduct.</p>
<h3>4. Instructions and safety</h3>
<p>I will follow the coaches' instructions, train within my own limits, and stop when asked to stop.</p>
<h3>5. Emergency care</h3>
<p>If I am injured and cannot consent, I authorise ${teamName} to arrange emergency medical care on my behalf.</p>`,
  }

  const seeded = await seedPublishedDocuments(
    {
      teamId,
      uid,
      publishedByName: opts.publishedByName,
      createdDaysAgo: opts.createdDaysAgo ?? 180,
    },
    [...opts.otherDocuments, waiverSpec]
  )
  const waiver = seeded.find((d) => d.id === waiverId)
  if (!waiver) return seeded

  const contacts = await admin
    .firestore()
    .collection('contacts')
    .where('teamId', '==', teamId)
    .limit(6)
    .get()

  // valid, valid, expired, revoked — and everyone after that has NO row, which
  // is the state the booking gate actually refuses on.
  const states: SeedSignatureSpec['state'][] = ['valid', 'valid', 'expired', 'revoked']
  for (let i = 0; i < Math.min(states.length, contacts.docs.length); i++) {
    const c = contacts.docs[i]
    const d = c.data() as { firstname?: string; lastname?: string; email?: string }
    const name = [d.firstname, d.lastname].filter(Boolean).join(' ') || 'Member'
    const state = states[i]
    await seedWaiverSignature(
      {
        teamId,
        documentId: waiverId,
        version: waiver.version,
        bodyHash: waiver.bodyHash,
        validityMonths,
      },
      {
        contactId: c.id,
        contactName: name,
        contactEmail: d.email ?? `${c.id}@example.com`,
        // An 'expired' row is back-dated PAST its own validity window, so
        // `valid_until` (derived) genuinely falls in the past. With no validity
        // rule a signature never lapses, so there is no expired row to seed.
        signedDaysAgo: state === 'expired' ? (validityMonths ?? 0) * 31 + 30 : 40 + i * 10,
        state,
        // One guardian row, because the minors prompt is a self-declaration the
        // studio checks at the door — and a roster with no chip on it never
        // shows that the chip exists.
        ...(i === 1 && opts.mayIncludeMinors !== false
          ? { signerRole: 'guardian' as const, signerName: `Parent of ${name}` }
          : {}),
      }
    )
  }

  return seeded
}
