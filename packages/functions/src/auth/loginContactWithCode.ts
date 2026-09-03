// Logs an existing contact in using a previously-issued email verification code —
// or, for the login-first shop checkout, REGISTERS a minimal new contact when the
// verified email matches none (optional `newContact`; see below). completeSignup
// remains the FULL signup flow (profile + consent).
import * as admin from 'firebase-admin'
import { FieldValue, Timestamp } from 'firebase-admin/firestore'
import { onCall, HttpsError } from 'firebase-functions/v2/https'
import { CONTACTS_COLLECTION, TEAMS_COLLECTION, planHasFeature, type SaasPlan } from '@linyup/shared'
import { buildContactSession } from '../utils/contactSession'
import { canCreateContact } from '../utils/contactCap'
import { bucketRateLimit } from '../utils/rateLimit'
import { planStatusIsInactive } from '../utils/plan'
import { APP_CHECK_ENFORCE_MOBILE, monitorAppCheck } from '../utils/appCheck'
import { assertVerifiableCodeById } from './verificationCode'

// Provisional shop registrations purge after this window unless a payment confirms
// them (see Contact.provisional + dailyTasks/purgeProvisionalContacts).
const PROVISIONAL_TTL_MS = 7 * 24 * 60 * 60 * 1000
// Anti-flooding: at most this many NEW shop registrations per team per day.
const REGISTRATIONS_PER_TEAM_PER_DAY = 20

// ─── The member-app plan gate (mobile client only) ─────────────────────────────
//
// `member_app` (packages/shared/src/types/plan.ts, renamed from `student_app`)
// is declared on Coach+ but was enforced nowhere — a contact on a Free-plan
// team could sign into the mobile app exactly as if the team had never been
// gated at all. The WEB Space has no equivalent gate (its whole point is to be
// the surface every plan gets), so this only ever runs for `client: 'mobile'`.
//
// Same "effective plan" rule `utils/plan.ts`'s `requirePlan` uses — shared
// through `planStatusIsInactive`, not copied: a trial (or any status other
// than `past_due`/`cancelled`) reads as active, so a trialing team is never
// refused here for a billing reason it hasn't actually reached yet — only a
// genuinely inactive subscription, or a tier below Coach, closes the door.
//
// Applied by BOTH callables that mint a contact session for a mobile caller:
// this one at sign-in, and `switchActiveContact` when a signed-in member
// switches to a sibling contact — the second door is what makes the first
// one worth having.
export function memberAppAccessForPlan(
  plan: SaasPlan | null | undefined,
  planStatus?: string | null
): boolean {
  if (planStatusIsInactive(planStatus)) return false
  return planHasFeature(plan ?? 'free', 'member_app')
}

/** The minimal shape `filterCandidatesForMemberApp` needs from a matched contact —
 *  deliberately narrower than the Firestore doc so it is trivial to fake in a test. */
export interface MemberAppCandidate {
  id: string
  teamId: string
  firstname?: string | null
  lastname?: string | null
}

/** What `filterCandidatesForMemberApp` needs from a candidate's team — the plan
 *  gate's inputs, plus the display fields the `appNotIncluded` result carries so
 *  the app can name the studio it was refused by. */
export interface MemberAppTeamInfo {
  plan?: SaasPlan | null
  plan_status?: string | null
  name?: string | null
  slug?: string | null
}

export interface MemberAppTeamRef {
  teamId: string
  teamName: string | null
  slug: string | null
}

export interface MemberAppFilterResult {
  /** The candidates whose team offers the member app — unmodified otherwise. */
  eligible: MemberAppCandidate[]
  /** Every DISTINCT team a candidate was dropped for, in first-seen order. */
  droppedTeams: MemberAppTeamRef[]
}

/**
 * Drops every candidate whose team's plan lacks `member_app` — the pure
 * decision, injected-loader shape (same DI pattern as `createTeamNotification`
 * in `utils/teamNotifications.ts`: the caller supplies a real Firestore read,
 * a test supplies a map) so it is unit-testable without an emulator.
 *
 * `loadTeam` is called at most once per DISTINCT teamId among the candidates.
 */
export async function filterCandidatesForMemberApp(
  candidates: MemberAppCandidate[],
  loadTeam: (teamId: string) => Promise<MemberAppTeamInfo | null>
): Promise<MemberAppFilterResult> {
  // Every DISTINCT team in ONE parallel round trip — a member on several
  // studios is exactly the case where this list has more than one entry, and
  // this sits on the login path.
  const distinctTeamIds = [...new Set(candidates.map((c) => c.teamId))]
  const teamCache = new Map<string, MemberAppTeamInfo | null>(
    await Promise.all(
      distinctTeamIds.map(async (teamId) => [teamId, await loadTeam(teamId)] as const)
    )
  )

  const eligible: MemberAppCandidate[] = []
  const droppedTeams: MemberAppTeamRef[] = []
  const droppedTeamIds = new Set<string>()

  for (const candidate of candidates) {
    const info = teamCache.get(candidate.teamId) ?? null
    if (info && memberAppAccessForPlan(info.plan, info.plan_status)) {
      eligible.push(candidate)
      continue
    }
    if (!droppedTeamIds.has(candidate.teamId)) {
      droppedTeamIds.add(candidate.teamId)
      droppedTeams.push({
        teamId: candidate.teamId,
        teamName: info?.name ?? null,
        slug: info?.slug ?? null,
      })
    }
  }

  return { eligible, droppedTeams }
}

/** The real `loadTeam` the callable uses — reads `teams/{teamId}` once.
 *  Exported for `switchActiveContact`, the other session-minting door. */
export async function loadTeamForMemberAppGate(teamId: string): Promise<MemberAppTeamInfo | null> {
  const snap = await admin.firestore().collection(TEAMS_COLLECTION).doc(teamId).get()
  if (!snap.exists) return null
  const data = snap.data()!
  return {
    plan: (data.plan as SaasPlan | undefined) ?? null,
    plan_status: (data.plan_status as string | undefined) ?? null,
    name: (data.name as string | undefined) ?? null,
    slug: (data.slug as string | undefined) ?? null,
  }
}

export const loginContactWithCode = onCall({ enforceAppCheck: APP_CHECK_ENFORCE_MOBILE }, async (request) => {
  monitorAppCheck(request, 'loginContactWithCode')
  const data = request.data as {
    codeId?: string
    code?: string
    selectedContactId?: string
    // Login-first shop registration: when the verified email matches NO contact,
    // create a minimal provisional one with these names and log it in. Ignored
    // whenever matches exist (a stolen code must not inject duplicates).
    newContact?: { firstname?: string; lastname?: string }
    // Set by the Expo app ONLY. The web flow never sends this field, so its
    // absence is what keeps the web login byte-for-byte unaffected by the gate
    // below — see memberAppAccessForPlan's header.
    client?: 'mobile'
  }

  if (!data?.codeId || !data?.code) {
    throw new HttpsError('invalid-argument', 'codeId and code are required')
  }

  if (!/^\d{6}$/.test(data.code)) {
    throw new HttpsError('invalid-argument', 'Code must be 6 digits')
  }

  // Validate and mark the code as verified
  const codeData = await assertVerifiableCodeById(data.codeId, data.code)

  const email: string = (codeData.email as string).toLowerCase().trim()
  const teamId: string | null =
    typeof codeData.team_id === 'string' && codeData.team_id.length > 0
      ? codeData.team_id
      : null

  // Match contacts whose PRIMARY email is this address, OR whose login-email
  // allow-list contains it (e.g. a parent signing in to a child's profile).
  // When teamId is known, scope the primary query to that team. When it's null
  // (mobile app flow — no team selected upfront), query by email across all
  // teams and optionally narrow to the teamIds stored on the code doc.
  const primaryQuery = teamId
    ? admin.firestore().collection('contacts').where('email', '==', email).where('teamId', '==', teamId).get()
    : admin.firestore().collection('contacts').where('email', '==', email).get()

  const [primarySnap, allowSnap] = await Promise.all([
    primaryQuery,
    admin
      .firestore()
      .collection('contacts')
      .where('login_emails', 'array-contains', email)
      .get(),
  ])

  // Dedupe by doc id; keep only active (non-archived, non-deleted) contacts.
  // When teamId is set, restrict to that team; otherwise accept all teams
  // (optionally narrowed by the code doc's teamIds list).
  const allowedTeamIds: string[] | null =
    !teamId && Array.isArray(codeData.teamIds) && codeData.teamIds.length > 0
      ? codeData.teamIds
      : null

  const byId = new Map<string, admin.firestore.QueryDocumentSnapshot>()
  for (const doc of [...primarySnap.docs, ...allowSnap.docs]) {
    const d = doc.data()
    if (teamId && d.teamId !== teamId) continue
    if (allowedTeamIds && !allowedTeamIds.includes(d.teamId)) continue
    if (d.archived_at != null || d.deleted_at != null) continue
    byId.set(doc.id, doc)
  }
  let activeContacts = [...byId.values()]

  // ── The member-app plan gate (mobile client only) ─────────────────────────
  // Drop every match whose team's plan lacks `member_app` BEFORE the
  // single-vs-multiple-contact branching below, so both the "which contact?"
  // list and the final chosen contact are already gated. Only when the ONLY
  // matches are dropped do we tell the app why, rather than falling through to
  // `requiresSignup` (which would be a confusing "no account" message for a
  // real account behind a plan wall).
  if (data.client === 'mobile' && activeContacts.length > 0) {
    const { eligible, droppedTeams } = await filterCandidatesForMemberApp(
      activeContacts.map((doc) => ({
        id: doc.id,
        teamId: doc.data().teamId as string,
        firstname: doc.data().firstname ?? null,
        lastname: doc.data().lastname ?? null,
      })),
      loadTeamForMemberAppGate
    )
    if (eligible.length === 0) {
      return { verified: true, appNotIncluded: true, teams: droppedTeams }
    }
    const eligibleIds = new Set(eligible.map((c) => c.id))
    activeContacts = activeContacts.filter((doc) => eligibleIds.has(doc.id))
  }

  if (activeContacts.length === 0) {
    const firstname = (data.newContact?.firstname ?? '').trim().slice(0, 100)
    const lastname = (data.newContact?.lastname ?? '').trim().slice(0, 100)
    if (!data.newContact || !firstname || !lastname || !teamId) {
      // No registration payload (or no team context) → the client shows the
      // register / signup step. Shop registration requires a known teamId.
      return { requiresSignup: true, email }
    }

    // ── Login-first shop registration ────────────────────────────────────────
    // The OTP proved ownership of `email`; create a minimal PROVISIONAL contact
    // (confirmed by the first successful payment, purged after 7 days otherwise)
    // and mint a session. Guards: per-team daily budget + the plan's hard cap
    // (measured against CONFIRMED actives — see utils/contactCap.ts).
    await bucketRateLimit({
      collection: 'shop_registration_attempts',
      key: teamId,
      limit: REGISTRATIONS_PER_TEAM_PER_DAY,
      windowMs: 24 * 60 * 60 * 1000,
      message: 'Registration is temporarily unavailable. Please contact the studio directly.',
    })

    const teamSnap = await admin.firestore().collection(TEAMS_COLLECTION).doc(teamId).get()
    if (!teamSnap.exists) throw new HttpsError('not-found', 'Team not found')
    const plan = (teamSnap.data()?.plan as SaasPlan | undefined) ?? 'free'
    if (!(await canCreateContact(teamId, plan))) {
      throw new HttpsError(
        'failed-precondition',
        'This studio cannot accept new registrations right now. Please contact the studio directly.',
        { reason: 'contact_cap' }
      )
    }

    const ref = admin.firestore().collection(CONTACTS_COLLECTION).doc()
    await ref.set({
      teamId,
      email,
      firstname,
      lastname,
      // Off-funnel entry: a shop registration is not a trial-funnel milestone —
      // no acquisition_stage (same birth facts as the webhook's shop creation).
      entry: 'shop',
      provisional: true,
      provisional_expires_at: Timestamp.fromMillis(Date.now() + PROVISIONAL_TTL_MS),
      archived_at: null,
      deleted_at: null,
      created_at: FieldValue.serverTimestamp(),
    })
    console.log(`[auth] shop registration: created provisional contact ${ref.id} (team=${teamId})`) // eslint-disable-line no-console

    const session = await buildContactSession(ref.id, teamId, email, { allowedEmail: email })
    return {
      customToken: session.customToken,
      sessionExpires: session.sessionExpires,
      contact: session.contact,
    }
  }

  if (activeContacts.length > 1 && !data.selectedContactId) {
    return {
      requiresContactSelection: true,
      email,
      matchedContacts: activeContacts.map((doc) => ({
        id: doc.id,
        firstname: doc.data().firstname ?? null,
        lastname: doc.data().lastname ?? null,
      })),
    }
  }

  // Determine which contact to log in as
  let chosen: admin.firestore.QueryDocumentSnapshot
  if (data.selectedContactId) {
    const found = activeContacts.find((doc) => doc.id === data.selectedContactId)
    if (!found) {
      throw new HttpsError(
        'permission-denied',
        'The selected contact does not match any active contact for this email and team'
      )
    }
    chosen = found
  } else {
    chosen = activeContacts[0]
  }

  const contactTeamId: string = chosen.data().teamId
  const session = await buildContactSession(chosen.id, contactTeamId, email, { allowedEmail: email })

  return {
    customToken: session.customToken,
    sessionExpires: session.sessionExpires,
    contact: session.contact,
  }
})
