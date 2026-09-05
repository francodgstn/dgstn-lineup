// Waivers (Wave 3 Phase 4) — document authoring, version publishing, and the
// team's waiver POLICY.
//
// ── WHY A WAIVER NEEDS FIVE CALLABLES AND NOT THREE ─────────────────────────
// A waiver document is CALLABLE-ONLY: firestore.rules denies client create,
// update AND delete where `kind == 'waiver'`, because its content is somebody's
// evidence and its required-ness is an authorization fact. The document editor's
// Save, meanwhile, is a direct client write. Naming only createWaiver /
// publishDocumentVersion / setWaiverRequirement would therefore have frozen
// every waiver at its empty creation state: a studio could mint "Liability
// release", type the text, hit Save, and be denied — with no callable behind the
// button and no way to author a v1, let alone a v2 after a lawyer sends
// corrected wording. Hence `updateWaiver` and `archiveWaiver` as well.
//
// ── PUBLISHING IS UNIVERSAL; THE GATE IS NOT ────────────────────────────────
// `publishDocumentVersion` replaces the client status flip for EVERY document
// kind, because signup consent has to be recorded against a real version of a
// real terms document too. The plan gate fires only for `kind === 'waiver'` —
// publishing a privacy policy is free.
//
// ── THE SANITIZE SEAM MOVED, AND THAT ORDERING IS LOAD-BEARING ──────────────
// The rich text is sanitized HERE, once, and frozen into the version snapshot;
// the public mirror then COPIES that frozen string instead of re-sanitizing the
// raw body. Two sanitize calls with a library upgrade between them would
// silently break every acceptance hash. `scripts/backfill-document-versions.ts`
// is the deploy precondition that gives every already-published document a
// version to copy from.
//
// ── ONE WRITE PATH TO THE POLICY, AND WHY IT IS PATCHED, NOT REBUILT ────────
// `teams/{t}/waiver_policy/current` is the booking gate's authorization source,
// and it fails CLOSED (the public mirror fails open, which is right for a
// display list and catastrophic for a gate).
//
// THE OWNER OF "what may write the policy" IS `writePolicyAndTouchTeam` BELOW —
// the single `tx.set` on the policy ref, and the only thing that may be called
// to change it. Do not restate its callers anywhere, and above all do not COUNT
// them: this header said "one writer-pair" while four callables called it
// (publish, setWaiverRequirement, updateWaiver's settings arm, archiveWaiver),
// and a fifth — a title edit — was added the round after. Pointing at the
// function survives the next one, because the next one has to call it.
//
// Every caller READS the policy inside its own transaction, patches or removes
// EXACTLY the one entry for the document it is writing (`patchedPolicy`), and
// writes the array back. A full rebuild would need a `teamId + kind` composite
// index that does not exist, and — executed outside the transaction — would let
// two managers publishing within the same second drop each other's entry,
// silently un-gating a required waiver with the policy left internally
// consistent so no invariant check would fire.
//
// Each policy writer also touches the team document in the SAME transaction, or
// `TeamPublicProfile.required_waivers` is stale by construction: that mirror is
// recomputed by a trigger on the TEAM document while the policy lives in a
// subcollection. A studio flipping Required on at 09:00 would otherwise have the
// consent step fail to appear, and the member would be refused by the server
// after their verification code was already spent.

import * as admin from 'firebase-admin'
import { FieldValue, Timestamp } from 'firebase-admin/firestore'
import { HttpsError, onCall, type CallableRequest } from 'firebase-functions/v2/https'
import {
  DOCUMENTS_COLLECTION,
  DOCUMENT_VERSIONS_SUBCOLLECTION,
  MAX_DOCUMENT_VERSIONS,
  MAX_REQUIRED_WAIVERS_PER_TEAM,
  MAX_WAIVER_BODY_CHARS,
  TEAMS_COLLECTION,
  WAIVER_MIN_PLAN,
  WAIVER_POLICY_DOC_ID,
  WAIVER_POLICY_SUBCOLLECTION,
  defaultWaiverConfig,
  documentVersionId,
  getWaiverLimits,
  waiverPolicyEntryFor,
  type DocumentKind,
  type DocumentSource,
  type DocumentStatus,
  type DocumentVersion,
  type PublishOutcome,
  type RequiredWaiverEntry,
  type SaasPlan,
  type WaiverApplies,
  type WaiverConfig,
  type WaiverPolicySourceDocument,
} from '@linyup/shared'
import { assertManager } from '../connect/access'
import { sha256Hex, generateSecureToken } from '../utils/crypto'
import { requirePlan } from '../utils/plan'
import { safeExternalUrl, sanitizeRichHtml } from '../utils/sanitizeHtml'

// ─── Refusals ────────────────────────────────────────────────────────────────
// Studio-facing (the authoring surface), so the messages are English prose in
// the same shape every other manager callable uses. Each still carries a
// `details.reason` so the admin UI can map it rather than string-matching.

function refuse(reason: string, message: string): HttpsError {
  return new HttpsError('failed-precondition', message, { reason })
}

// ─── Refs ────────────────────────────────────────────────────────────────────

function documentRef(documentId: string): FirebaseFirestore.DocumentReference {
  return admin.firestore().collection(DOCUMENTS_COLLECTION).doc(documentId)
}

function versionRef(documentId: string, version: number): FirebaseFirestore.DocumentReference {
  return documentRef(documentId)
    .collection(DOCUMENT_VERSIONS_SUBCOLLECTION)
    .doc(documentVersionId(version))
}

export function waiverPolicyRef(teamId: string): FirebaseFirestore.DocumentReference {
  return admin
    .firestore()
    .collection(TEAMS_COLLECTION)
    .doc(teamId)
    .collection(WAIVER_POLICY_SUBCOLLECTION)
    .doc(WAIVER_POLICY_DOC_ID)
}

function teamRef(teamId: string): FirebaseFirestore.DocumentReference {
  return admin.firestore().collection(TEAMS_COLLECTION).doc(teamId)
}

// ─── Argument coercion ───────────────────────────────────────────────────────

function requireString(v: unknown, field: string): string {
  if (typeof v !== 'string' || !v.trim()) {
    throw new HttpsError('invalid-argument', `${field} is required`)
  }
  return v.trim()
}

/** For the one callable whose team comes from the PAYLOAD rather than from a
 *  document — `createWaiver`. Everything that names a documentId authorizes
 *  through `loadDocumentForManager`, which owns the ordering. */
function requireAuthedManager(request: CallableRequest<unknown>, teamId: string): Promise<void> {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Authentication required')
  return assertManager(request.auth.uid, teamId)
}

function coerceValidityMonths(v: unknown): number | null | undefined {
  if (v === null) return null
  if (typeof v !== 'number' || !Number.isInteger(v) || v <= 0 || v > 600) return undefined
  return v
}

function coerceScope(v: unknown): WaiverApplies | undefined {
  const raw = v as { appliesTo?: unknown; activityIds?: unknown } | undefined
  if (!raw || typeof raw !== 'object') return undefined
  if (raw.appliesTo === 'all_bookings') return { appliesTo: 'all_bookings' }
  if (raw.appliesTo === 'activities') {
    const ids = Array.isArray(raw.activityIds)
      ? (raw.activityIds as unknown[]).filter((i): i is string => typeof i === 'string')
      : []
    return { appliesTo: 'activities', activityIds: ids }
  }
  return undefined
}

function coerceSource(v: unknown): DocumentSource | undefined {
  return v === 'rich_text' || v === 'external_link' ? v : undefined
}

/**
 * Server-minted slug WITH a real collision check — unlike the client-side
 * `slugify`, whose uniqueness suffix comes from `Math.random()` and is checked
 * against nothing. A colliding slug makes two documents share a public URL,
 * which matters rather more once a waiver is linked from a booking form. The
 * check is free here because the caller has already listed the team's documents
 * to enforce the plan cap.
 */
function mintDocumentSlug(title: string, taken: Set<string>): string {
  const base =
    title
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)+/g, '')
      .slice(0, 48) || 'document'
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const candidate = `${base}-${generateSecureToken(2)}`
    if (!taken.has(candidate)) return candidate
  }
  return `${base}-${generateSecureToken(8)}`
}

// ─── Shared reads ────────────────────────────────────────────────────────────

interface LoadedDocument {
  ref: FirebaseFirestore.DocumentReference
  data: FirebaseFirestore.DocumentData
  teamId: string
  kind: DocumentKind
}

/** Load + identify a document OUTSIDE the transaction, so the auth and plan
 *  checks (which read the team) happen before anything is locked. The
 *  transaction re-reads it; nothing here is trusted for a write decision.
 *
 *  NOT CALLED DIRECTLY BY ANY CALLABLE — see `loadDocumentForManager` below,
 *  which is the only caller and exists so the authorization cannot be ordered
 *  after the load's refusals. */
async function loadDocument(documentId: string): Promise<LoadedDocument> {
  const ref = documentRef(documentId)
  const snap = await ref.get()
  if (!snap.exists) {
    throw new HttpsError('not-found', 'We could not find that document.', {
      reason: 'document_not_found',
    })
  }
  const data = snap.data()!
  return { ref, data, teamId: data.teamId as string, kind: (data.kind as DocumentKind) ?? 'other' }
}

/**
 * THE ORDER: authenticated → loaded → authorized → identified. Every callable
 * that names a documentId enters through this, and none of them calls
 * `loadDocument` directly.
 *
 * It was the other order, and each step of it told an unauthorized caller
 * something. `loadDocument` throws `document_not_found` before any auth check
 * ran, so a stranger could probe the collection for which ids exist; then the
 * `kind !== 'waiver'` branch threw `not_a_waiver` — still before any auth check
 * — so the same stranger learned what kind each id was. A callable's refusal is
 * an answer, and these two answered questions about another tenant's data to
 * somebody with no claim on it.
 *
 * Authentication is asserted BEFORE the read, so an anonymous caller costs a
 * document read as well as learning nothing. Membership is asserted straight
 * after, so the kind is never spoken to a non-member. What remains — a signed-in
 * user of some other team distinguishing `not-found` from `permission-denied` —
 * is the same shape every manager callable in this codebase has, over ids that
 * are 20 random characters.
 */
async function loadDocumentForManager(
  request: CallableRequest<unknown>,
  documentId: string
): Promise<LoadedDocument> {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Authentication required')
  const doc = await loadDocument(documentId)
  await assertManager(request.auth.uid, doc.teamId)
  return doc
}

/**
 * The same, plus the kind assertion — which is a fact about the document and so
 * may only be spoken to somebody `loadDocumentForManager` has already
 * authorized. Taking the message as an argument is what keeps the three waiver
 * callables from re-implementing (and re-ordering) the check.
 */
async function loadWaiverForManager(
  request: CallableRequest<unknown>,
  documentId: string,
  notAWaiverMessage: string
): Promise<LoadedDocument> {
  const doc = await loadDocumentForManager(request, documentId)
  if (doc.kind !== 'waiver') {
    throw new HttpsError('invalid-argument', notAWaiverMessage, { reason: 'not_a_waiver' })
  }
  return doc
}

async function teamPlan(teamId: string): Promise<SaasPlan> {
  const snap = await teamRef(teamId).get()
  return ((snap.data()?.plan as SaasPlan) ?? 'free') as SaasPlan
}

function policySourceFrom(
  documentId: string,
  data: FirebaseFirestore.DocumentData
): WaiverPolicySourceDocument {
  return {
    documentId,
    slug: (data.slug as string) ?? '',
    title: (data.title as string) ?? '',
    kind: (data.kind as DocumentKind) ?? 'other',
    status: (data.status as string) ?? 'draft',
    archived_at: data.archived_at,
    current_version: (data.current_version as number | null) ?? null,
    min_valid_version: (data.min_valid_version as number | null) ?? null,
    waiver: (data.waiver as WaiverConfig | null) ?? null,
  }
}

/**
 * Replace-or-remove EXACTLY one entry. The caller has already read the policy
 * inside its transaction; this is the pure part, so the writers cannot disagree
 * about what "patch one entry" means.
 */
function patchedPolicy(
  existing: RequiredWaiverEntry[],
  documentId: string,
  entry: RequiredWaiverEntry | null
): RequiredWaiverEntry[] {
  const others = existing.filter((e) => e.documentId !== documentId)
  if (!entry) return others
  if (others.length >= MAX_REQUIRED_WAIVERS_PER_TEAM) {
    throw refuse(
      'waiver_required_limit_reached',
      `A team can require at most ${MAX_REQUIRED_WAIVERS_PER_TEAM} waivers at once. Turn one off first.`
    )
  }
  return [...others, entry]
}

function readPolicyEntries(snap: FirebaseFirestore.DocumentSnapshot): RequiredWaiverEntry[] {
  const raw = snap.data()?.required
  return Array.isArray(raw) ? (raw as RequiredWaiverEntry[]) : []
}

/** Both policy writes look identical, and the team touch RIDES ALONG so the
 *  public mirror is never stale by more than one sync. Kept in one function so
 *  neither half can be forgotten at a new call site. */
function writePolicyAndTouchTeam(
  tx: FirebaseFirestore.Transaction,
  teamId: string,
  entries: RequiredWaiverEntry[]
): void {
  tx.set(waiverPolicyRef(teamId), {
    teamId,
    required: entries,
    updated_at: FieldValue.serverTimestamp(),
  })
  // `set(..., {merge:true})` CREATES a missing document, which is a live bug in
  // `touchTeamForSurfaceRecompute` (see its header — it resurrected thirteen
  // deleted studios). It is safe HERE and stays as it is: this runs inside a
  // manager callable that has already authorized against a live team, not in a
  // trigger that fires on delete. Do not copy the shape into one that does — and
  // do not "fix" this into `tx.update`, which would fail the whole transaction
  // rather than the no-op the trigger path wants.
  tx.set(teamRef(teamId), { surfaces_updated_at: FieldValue.serverTimestamp() }, { merge: true })
}

// ─── createWaiver ────────────────────────────────────────────────────────────

export const createWaiver = onCall(async (request) => {
  const data = (request.data ?? {}) as Record<string, unknown>
  const teamId = requireString(data.teamId, 'teamId')
  await requireAuthedManager(request, teamId)
  // CREATION. `requirePlan`'s two refusals never reach a visitor, because no
  // public waiver path calls it — the gate controls creation and requiring, not
  // signing, so an in-flight requirement survives a downgrade.
  await requirePlan(teamId, WAIVER_MIN_PLAN)

  const title = requireString(data.title, 'title')
  const source = coerceSource(data.source) ?? 'rich_text'

  // One team-scoped list serves BOTH the plan cap and the slug collision check.
  // A `teamId + kind` composite index would be needed to count waivers directly
  // and none exists; a team's document count is small, so the filter is in
  // memory.
  const existing = await admin
    .firestore()
    .collection(DOCUMENTS_COLLECTION)
    .where('teamId', '==', teamId)
    .select('kind', 'slug', 'archived_at')
    .get()

  const limits = getWaiverLimits(await teamPlan(teamId))
  const liveWaivers = existing.docs.filter(
    (d) => d.data().kind === 'waiver' && d.data().archived_at == null
  ).length
  if (liveWaivers >= limits.maxWaivers) {
    throw refuse(
      'waiver_limit_reached',
      `Your plan includes ${limits.maxWaivers} waivers. Archive one to add another.`
    )
  }

  const taken = new Set(existing.docs.map((d) => d.data().slug as string).filter(Boolean))
  const now = Timestamp.now()
  const ref = admin.firestore().collection(DOCUMENTS_COLLECTION).doc()

  await ref.create({
    teamId,
    title,
    slug: mintDocumentSlug(title, taken),
    kind: 'waiver' as DocumentKind,
    source,
    summary: typeof data.summary === 'string' ? data.summary.slice(0, 500) : '',
    status: 'draft',
    isPublic: false,
    order: 0,
    current_version: null,
    min_valid_version: null,
    // Written EXPLICITLY even where it is the default, so a stored document is
    // self-describing rather than relying on a reader knowing what absent means.
    waiver: defaultWaiverConfig(),
    created_at: now,
    updated_at: now,
    createdBy: request.auth!.uid,
  })

  return { documentId: ref.id }
})

// ─── updateWaiver ────────────────────────────────────────────────────────────

export const updateWaiver = onCall(async (request) => {
  const data = (request.data ?? {}) as Record<string, unknown>
  const documentId = requireString(data.documentId, 'documentId')
  const doc = await loadWaiverForManager(
    request,
    documentId,
    'This callable only edits waiver documents.'
  )

  const patch: Record<string, unknown> = {}
  let touchesContent = false
  // The one CONTENT field the policy entry also carries. Tracked separately from
  // `touchesContent` because a body edit changes nothing the gate reads, and a
  // title edit changes what the consent step calls the document.
  let nextTitle: string | null = null

  if (typeof data.title === 'string' && data.title.trim()) {
    patch.title = data.title.trim()
    nextTitle = data.title.trim()
    touchesContent = true
  }
  if (typeof data.summary === 'string') {
    patch.summary = data.summary.slice(0, 500)
    touchesContent = true
  }
  if (typeof data.body === 'string') {
    // The RAW body is stored; sanitizing happens once, at publish. Clamped here
    // as well so the stored draft can never exceed what a snapshot can freeze.
    patch.body = data.body.slice(0, MAX_WAIVER_BODY_CHARS)
    touchesContent = true
  }
  const source = coerceSource(data.source)
  if (source) {
    patch.source = source
    touchesContent = true
  }
  if (typeof data.externalUrl === 'string') {
    const url = safeExternalUrl(data.externalUrl)
    if (!url) {
      throw refuse('invalid_external_url', 'Enter a full http(s) address.')
    }
    patch.externalUrl = url
    touchesContent = true
  }

  const config = (doc.data.waiver as WaiverConfig | null) ?? defaultWaiverConfig()
  const nextConfig: WaiverConfig = { ...config }
  let touchesSettings = false

  if (typeof data.mayIncludeMinors === 'boolean') {
    nextConfig.mayIncludeMinors = data.mayIncludeMinors
    touchesSettings = true
  }
  const validityMonths = coerceValidityMonths(data.validityMonths)
  if (validityMonths !== undefined) {
    // FUTURE SIGNATURES ONLY. The validity in force at each tick is frozen onto
    // the acceptance, so this edit never re-dates a signature already taken.
    nextConfig.validityMonths = validityMonths
    touchesSettings = true
  }
  const scope = coerceScope(data.scope)
  if (scope) {
    nextConfig.scope = scope
    touchesSettings = true
  }
  // `required` is NOT writable here, in either direction. It decides whether the
  // document appears in the team's waiver policy, so the RULE is: it may only be
  // written where the policy entry is patched in the SAME transaction —
  // `setWaiverRequirement` (both directions) and `archiveWaiver` (which clears
  // the flag and the entry together). A path that could flip the flag without
  // that is precisely how the flag and the policy stop agreeing.
  if (data.required !== undefined) {
    throw new HttpsError(
      'invalid-argument',
      'Use setWaiverRequirement to turn a waiver requirement on or off.',
      { reason: 'required_not_writable_here' }
    )
  }

  if (!touchesContent && !touchesSettings) {
    throw new HttpsError('invalid-argument', 'Nothing to update')
  }
  // Content edits are the paid half; settings and retiring are not, so a
  // downgraded studio can still narrow a scope or flag a waiver for minors.
  if (touchesContent) await requirePlan(doc.teamId, WAIVER_MIN_PLAN)

  patch.updated_at = FieldValue.serverTimestamp()

  // WHAT DECIDES THE PATH IS "does the policy entry carry this field", not
  // "is this content or settings". `RequiredWaiverEntry` carries the minors
  // flag, the validity and the scope — the settings arm — AND the TITLE, which
  // is a content field. The first cut split on content-vs-settings and so let a
  // rename skip the policy patch entirely: the entry kept the old title, and
  // `resolveWaiverRequirement` reads its titles straight off the policy, so a
  // studio renaming "Liability release" to "Waiver and release of liability" got
  // the new name on every studio-side surface and the OLD one on the consent
  // step every member reads, until the next publish happened to rewrite the
  // entry. Silent, and visible only to the people being asked to sign.
  //
  // Everything else — the body, the summary, the source, the external URL — is
  // genuinely invisible to the policy, stays a plain update, and pays for no
  // policy read. That is the overwhelming majority of saves.
  const touchesPolicyEntry = touchesSettings || nextTitle !== null
  if (!touchesPolicyEntry) {
    await doc.ref.update(patch)
    return { ok: true }
  }

  await admin.firestore().runTransaction(async (tx) => {
    const docSnap = await tx.get(doc.ref)
    if (!docSnap.exists) {
      throw new HttpsError('not-found', 'We could not find that document.', {
        reason: 'document_not_found',
      })
    }
    const d = docSnap.data()!
    const teamId = d.teamId as string
    // The entry is built from the document AS IT WILL BE, not as it was read.
    // `policySourceFrom` reads the pre-patch snapshot, so the new title has to be
    // overlaid here or the transaction would faithfully rewrite the stale one.
    const source = {
      ...policySourceFrom(documentId, d),
      ...(nextTitle === null ? {} : { title: nextTitle }),
      waiver: nextConfig,
    }
    const policySnap = await tx.get(waiverPolicyRef(teamId))
    const entries = readPolicyEntries(policySnap)
    const isRequired = nextConfig.required === true

    // Fails CLOSED: an entry whose version cannot be read is never written, so
    // the gate can never point at text it cannot serve.
    const versionSnap =
      isRequired && source.current_version != null
        ? await tx.get(versionRef(documentId, source.current_version))
        : null
    const bodyHash = (versionSnap?.data()?.bodyHash as string) ?? ''
    const entry = bodyHash ? waiverPolicyEntryFor(source, bodyHash) : null

    tx.update(doc.ref, { ...patch, waiver: nextConfig })
    // Only touched when this document is, or was, in the policy — an ordinary
    // settings edit on a non-required waiver must not rewrite a team's policy.
    if (entry || entries.some((e) => e.documentId === documentId)) {
      writePolicyAndTouchTeam(tx, teamId, patchedPolicy(entries, documentId, entry))
    }
  })

  return { ok: true }
})

// ─── publishDocumentVersion ──────────────────────────────────────────────────

function coerceOutcome(v: unknown): PublishOutcome {
  // Two outcomes, not three: `notify` is deferred to v2 (see PublishOutcome in
  // @linyup/shared). An old client that still sends it is refused loudly rather
  // than silently downgraded to `silent`, which would tell a studio their
  // members were notified when nobody was.
  if (v === 'silent' || v === 'require_resign') return v
  if (v === 'notify') {
    throw refuse(
      'publish_outcome_unavailable',
      'Notifying signers is not available yet. Choose "Silent update" or "Require re-signing".'
    )
  }
  throw new HttpsError('invalid-argument', 'outcome must be "silent" or "require_resign"')
}

export const publishDocumentVersion = onCall(async (request) => {
  const data = (request.data ?? {}) as Record<string, unknown>
  const documentId = requireString(data.documentId, 'documentId')
  const outcome = coerceOutcome(data.outcome)

  const doc = await loadDocumentForManager(request, documentId)
  // Waiver kind ONLY. Publishing a privacy policy is free on every plan,
  // because signup consent has to be recorded against a real version.
  const isWaiver = doc.kind === 'waiver'
  if (isWaiver) await requirePlan(doc.teamId, WAIVER_MIN_PLAN)

  const result = await admin.firestore().runTransaction(async (tx) => {
    // ── READ PHASE ────────────────────────────────────────────────────────────
    const docSnap = await tx.get(doc.ref)
    if (!docSnap.exists) {
      throw new HttpsError('not-found', 'We could not find that document.', {
        reason: 'document_not_found',
      })
    }
    const d = docSnap.data()!
    const teamId = d.teamId as string
    const kind = (d.kind as DocumentKind) ?? 'other'
    const source = (d.source as DocumentSource) ?? 'rich_text'

    if (d.archived_at != null) {
      throw refuse('document_archived', 'Restore this document before publishing it.')
    }

    const currentVersion = (d.current_version as number | null) ?? null
    const version = (currentVersion ?? 0) + 1
    if (version > MAX_DOCUMENT_VERSIONS) {
      throw refuse(
        'version_limit_reached',
        `This document has reached ${MAX_DOCUMENT_VERSIONS} versions.`
      )
    }

    let bodyHtml = ''
    let externalUrl: string | null = null
    if (source === 'rich_text') {
      const raw = typeof d.body === 'string' ? d.body.slice(0, MAX_WAIVER_BODY_CHARS) : ''
      // THE sanitize call for a VERSION — the only text an acceptance can ever
      // pin, hashed one line below. The public mirror copies this frozen string
      // rather than re-sanitizing the body; its own `sanitizeRichHtml` is a
      // pre-backfill fallback for documents published before versioning existed
      // (see syncDocumentPublicProfile's header), which by construction no
      // acceptance can name.
      bodyHtml = sanitizeRichHtml(raw)
      if (!bodyHtml.trim()) {
        throw refuse('document_body_empty', 'Add some text before publishing this document.')
      }
    } else {
      externalUrl = safeExternalUrl(d.externalUrl) ?? null
      if (!externalUrl) {
        throw refuse('invalid_external_url', 'Add a full http(s) address before publishing.')
      }
    }

    const vRef = versionRef(documentId, version)
    const existingVersion = await tx.get(vRef)
    if (existingVersion.exists) {
      // A version document is immutable, so this is a concurrent publish rather
      // than a retry. Refused with a name, instead of letting `tx.create` fail
      // the whole commit with an opaque precondition error.
      throw refuse('version_exists', 'Someone else just published this document. Reload and retry.')
    }

    const policySnap = isWaiver ? await tx.get(waiverPolicyRef(teamId)) : null

    // ── WRITE PHASE ───────────────────────────────────────────────────────────
    const now = Timestamp.now()
    const bodyHash = sha256Hex(bodyHtml)
    const snapshot: DocumentVersion = {
      teamId,
      documentId,
      version,
      kind,
      title: (d.title as string) ?? '',
      bodyHtml,
      bodyHash,
      bodyChars: bodyHtml.length,
      externalUrl,
      // The minors flag IN FORCE AT PUBLISH. A later config change must not
      // rewrite what a past signature was taken under.
      mayIncludeMinors: isWaiver
        ? ((d.waiver as WaiverConfig | null)?.mayIncludeMinors === true)
        : null,
      publish_outcome: outcome,
      supersedes: currentVersion,
      published_at: now,
      published_by: request.auth!.uid,
      published_by_name: (request.auth?.token?.name as string | undefined) || '—',
      backfilled_at: null,
    }
    tx.create(vRef, snapshot)

    // `require_resign` moves the floor and writes ZERO signer rows: supersession
    // is DERIVED from this one number by `waiverAcceptanceState`, so the publish
    // is O(1), is correct at every instant, and "un-require" is a single field
    // write rather than an unwind.
    const minValidVersion =
      outcome === 'require_resign' ? version : ((d.min_valid_version as number | null) ?? null)

    tx.update(doc.ref, {
      status: 'published',
      current_version: version,
      min_valid_version: minValidVersion,
      updated_at: FieldValue.serverTimestamp(),
    })

    if (isWaiver && policySnap) {
      const entries = readPolicyEntries(policySnap)
      const entry = waiverPolicyEntryFor(
        {
          ...policySourceFrom(documentId, d),
          status: 'published',
          current_version: version,
          min_valid_version: minValidVersion,
        },
        bodyHash
      )
      writePolicyAndTouchTeam(tx, teamId, patchedPolicy(entries, documentId, entry))
    }

    return { version, bodyHash }
  })

  return result
})

// ─── setWaiverRequirement ────────────────────────────────────────────────────

export const setWaiverRequirement = onCall(async (request) => {
  const data = (request.data ?? {}) as Record<string, unknown>
  const documentId = requireString(data.documentId, 'documentId')
  if (typeof data.required !== 'boolean') {
    throw new HttpsError('invalid-argument', 'required must be a boolean')
  }
  const required = data.required

  const doc = await loadWaiverForManager(request, documentId, 'Only a waiver can be required.')
  // ASYMMETRIC BY DESIGN. Turning a requirement ON is a creation-shaped act and
  // is gated; turning it OFF never is, so a downgraded studio is never left with
  // a gate it cannot lift.
  if (required) await requirePlan(doc.teamId, WAIVER_MIN_PLAN)

  await admin.firestore().runTransaction(async (tx) => {
    const docSnap = await tx.get(doc.ref)
    if (!docSnap.exists) {
      throw new HttpsError('not-found', 'We could not find that document.', {
        reason: 'document_not_found',
      })
    }
    const d = docSnap.data()!
    const teamId = d.teamId as string
    const currentVersion = (d.current_version as number | null) ?? null

    if (required && currentVersion == null) {
      throw refuse(
        'waiver_not_published',
        'Publish a version of this waiver before requiring it — a visitor has to have something to read.'
      )
    }
    if (required && d.archived_at != null) {
      throw refuse('document_archived', 'Restore this waiver before requiring it.')
    }

    const policySnap = await tx.get(waiverPolicyRef(teamId))
    // Fails CLOSED: no readable version, no policy entry, no gate pointing at
    // text nobody can serve.
    const versionSnap = required && currentVersion != null
      ? await tx.get(versionRef(documentId, currentVersion))
      : null
    if (required && !versionSnap?.exists) {
      throw refuse(
        'waiver_unavailable',
        'This waiver has no readable published version. Publish it again.'
      )
    }

    const config = (d.waiver as WaiverConfig | null) ?? defaultWaiverConfig()
    const nextConfig: WaiverConfig = { ...config, required }
    const entry = required
      ? waiverPolicyEntryFor(
          { ...policySourceFrom(documentId, d), waiver: nextConfig },
          (versionSnap!.data()!.bodyHash as string) ?? ''
        )
      : null

    tx.update(doc.ref, { waiver: nextConfig, updated_at: FieldValue.serverTimestamp() })
    writePolicyAndTouchTeam(
      tx,
      teamId,
      patchedPolicy(readPolicyEntries(policySnap), documentId, entry)
    )
  })

  return { ok: true }
})

// ─── archiveWaiver ───────────────────────────────────────────────────────────

export const archiveWaiver = onCall(async (request) => {
  const data = (request.data ?? {}) as Record<string, unknown>
  const documentId = requireString(data.documentId, 'documentId')

  // NO PLAN GATE. Retiring is not creating: a downgraded studio must always be
  // able to stop asking for a signature. Authorization is not optional for the
  // same reason it is not optional anywhere: `loadWaiverForManager` does it.
  const doc = await loadWaiverForManager(
    request,
    documentId,
    'This callable only archives waiver documents.'
  )

  await admin.firestore().runTransaction(async (tx) => {
    const docSnap = await tx.get(doc.ref)
    if (!docSnap.exists) {
      throw new HttpsError('not-found', 'We could not find that document.', {
        reason: 'document_not_found',
      })
    }
    const d = docSnap.data()!
    const teamId = d.teamId as string
    const policySnap = await tx.get(waiverPolicyRef(teamId))

    const config = (d.waiver as WaiverConfig | null) ?? defaultWaiverConfig()
    // `required` is cleared TOGETHER with the policy entry, so the converse
    // invariant the Documents page checks — every required waiver has an entry —
    // stays a plain statement rather than one carrying an archived-document
    // exception nobody would remember.
    //
    // AND `status`, WHICH THIS USED TO OMIT. Every surface in the product reads
    // archived-ness off `status` — the badge, the list filter, `setDocumentStatus`
    // for every other kind — so writing only `archived_at` left an archived
    // waiver rendering as **Published**, with a live Publish button behind it
    // that `publishDocumentVersion` then refused by name (`document_archived`).
    // A control that is always an error is worse than no control, and the state
    // it was reporting was simply false. `isPublic` goes off for the same reason
    // `setDocumentStatus` turns it off: it can only be true while published.
    tx.update(doc.ref, {
      status: 'archived' as DocumentStatus,
      isPublic: false,
      archived_at: FieldValue.serverTimestamp(),
      waiver: { ...config, required: false },
      updated_at: FieldValue.serverTimestamp(),
    })
    writePolicyAndTouchTeam(tx, teamId, patchedPolicy(readPolicyEntries(policySnap), documentId, null))
  })

  return { ok: true }
})
