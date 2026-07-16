// In-app AI assistant (v1) — a navigation & help copilot for studio staff. It
// answers "how do I / where is X" and points to the right page. Read-only: it has
// NO access to the team's data and takes no actions (those are later phases).
//
// Gated: the caller must be a member of a team that has the (locked) ai-assistant
// plugin installed — so it only runs for teams the operator has unlocked.
import * as admin from 'firebase-admin'
import { FieldValue } from 'firebase-admin/firestore'
import { onCall, HttpsError } from 'firebase-functions/v2/https'
import { to } from '../utils/async'
import { isTeamMember } from '../utils/teams'
import { getAssistantModel } from '../utils/vertexClient'

const MAX_MESSAGES = 20
const MAX_CHARS_PER_MESSAGE = 4000
const UNLOCK_PLUGIN_ID = 'ai-assistant'
const RATE_LIMIT_MAX = 40 // messages per user + team per hour
const RATE_WINDOW_MS = 60 * 60 * 1000

// Static app-capability index the model is grounded on. Keep concise; a richer,
// generated index (from NAV_SECTIONS/settings-nav/PLUGIN_REGISTRY) is a Phase-B
// improvement. Menu paths mirror the sidebar.
const APP_MAP = `Linyup dashboard map (menu path → what it's for):
- Dashboard — overview.
- Run › Schedule — calendar of sessions. Run › Bookings — booking requests.
  Run › Contacts — your people (profiles, notes, follow-ups, appointments).
  Run › Payments — money in (needs Stripe Connect). Run › Automations — rules that act on contacts/bookings.
- Offer › Activities — class/service types. Offer › Plans & affiliations — subscriptions + affiliations.
  Offer › Online courses — course library (Space). Offer › Products — sellable products. Offer › Documents — public docs.
- Grow › All public pages — hub of every public surface (bio-link, website, shop, space, booking, signup, forms, documents) with a default-landing picker; Shop settings and Space settings live under it. Grow › Bio link — the link-in-bio editor. Grow › Website, Forms, Gamification — plugin surfaces.
- Settings › Team (general, payments/currency, branding), Booking, Event types, Places, Members, Roles (capabilities per role), Plugins (marketplace), Billing (plan & invoices).
Contact detail tabs: Profile, Appointments, Stats, Bookings, Plans & Affiliation, Payments, Activity, Follow-ups (alerts + outreach), Gamification.`

const SYSTEM_PROMPT = `You are Linyup's in-app assistant for studio staff (coaches, managers, owners).
Help them find features and learn how to do things in Linyup. Be concise and practical.
When relevant, tell them exactly where to go using the menu path (e.g. "Settings › Roles").
Only discuss the Linyup app. If asked about their private data (specific contacts, numbers)
or to perform an action, explain that you can't do that yet — you currently help with
navigation and how-to. Do not invent features that aren't in the app map.

${APP_MAP}`

type ChatMessage = { role: 'user' | 'assistant'; content: string }

export const assistantChat = onCall(async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'You must be signed in.')
  const uid = request.auth.uid
  const { teamId, messages } = (request.data ?? {}) as { teamId?: string; messages?: ChatMessage[] }

  if (!teamId) throw new HttpsError('invalid-argument', 'teamId is required.')
  if (!Array.isArray(messages) || messages.length === 0) {
    throw new HttpsError('invalid-argument', 'messages must be a non-empty array.')
  }

  const db = admin.firestore()

  // Caller must be a team member…
  const [memberErr, isMember] = await to(isTeamMember(uid, teamId))
  if (memberErr || !isMember) throw new HttpsError('permission-denied', 'You are not a member of this team.')

  // …and the (unlocked) assistant plugin must be installed for this team.
  const installSnap = await db
    .collection('teams').doc(teamId)
    .collection('installed_plugins').doc(UNLOCK_PLUGIN_ID)
    .get()
  if (!installSnap.exists || installSnap.data()?.status !== 'active') {
    throw new HttpsError('failed-precondition', 'The AI assistant is not enabled for this team.')
  }

  // Rate-limit per user + team per hour.
  const windowKey = Math.floor(Date.now() / RATE_WINDOW_MS).toString()
  const rlRef = db.collection('rate_limits').doc(uid).collection('assistant_chat').doc(`${teamId}_${windowKey}`)
  const allowed = await db.runTransaction(async (tx) => {
    const snap = await tx.get(rlRef)
    const count = snap.exists ? (snap.data()!.count as number) : 0
    if (count >= RATE_LIMIT_MAX) return false
    tx.set(rlRef, { count: count + 1, updated_at: FieldValue.serverTimestamp() }, { merge: true })
    return true
  })
  if (!allowed) throw new HttpsError('resource-exhausted', 'You have reached the hourly limit. Try again later.')

  // Normalise + bound the conversation, then map to Vertex content format.
  const trimmed = messages
    .slice(-MAX_MESSAGES)
    .filter((m) => m && typeof m.content === 'string' && m.content.trim())
    .map((m) => ({
      role: m.role === 'assistant' ? ('model' as const) : ('user' as const),
      parts: [{ text: String(m.content).slice(0, MAX_CHARS_PER_MESSAGE) }],
    }))
  if (trimmed.length === 0 || trimmed[trimmed.length - 1].role !== 'user') {
    throw new HttpsError('invalid-argument', 'The last message must be from the user.')
  }

  try {
    const model = getAssistantModel()
    const result = await model.generateContent({
      contents: trimmed,
      systemInstruction: { role: 'system', parts: [{ text: SYSTEM_PROMPT }] },
      generationConfig: { maxOutputTokens: 1024, temperature: 0.3 },
    })
    const reply =
      result.response?.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('').trim() || ''
    if (!reply) throw new HttpsError('internal', 'The assistant returned an empty response.')
    return { reply }
  } catch (err) {
    if (err instanceof HttpsError) throw err
    console.error('[assistantChat] Vertex error:', (err as Error).message)
    throw new HttpsError('internal', 'The assistant is unavailable right now.')
  }
})
