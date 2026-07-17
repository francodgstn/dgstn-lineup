import 'server-only'
import {
  APP_SETTINGS_COLLECTION,
  GLOBAL_SETTINGS_DOC,
  PUBLIC_SETTINGS_DOC,
  FEEDBACK_COLLECTION,
  FEEDBACK_PROMPTS_COLLECTION,
  type FeedbackDoc,
  type FeedbackPrompt,
  type FeedbackStatus,
} from '@linyup/shared'
import { adminDb } from '@/lib/firebase-admin'

// Admin-SDK reads for the in-app feedback console (submissions inbox, prompt
// questions, global settings). Timestamps are serialized to millis so the
// results can cross into client components.

export interface FeedbackRow {
  id: string
  type: FeedbackDoc['type']
  rating: number | null
  message: string | null
  scopes: string[]
  promptId: string | null
  context: FeedbackDoc['context'] | null
  teamId: string
  teamName: string
  plan: string
  createdByEmail: string
  createdMs: number | null
  screenshotPath: string | null
  status: FeedbackStatus
  reviewedMs: number | null
  reviewedBy: string | null
}

function toRow(id: string, d: FeedbackDoc): FeedbackRow {
  return {
    id,
    type: d.type ?? 'general',
    rating: typeof d.rating === 'number' ? d.rating : null,
    message: d.message ?? null,
    scopes: Array.isArray(d.scopes) ? d.scopes : [],
    promptId: d.prompt_id ?? null,
    context: d.context ?? null,
    teamId: d.team_id ?? '',
    teamName: d.team_name ?? '',
    plan: d.plan ?? '',
    createdByEmail: d.created_by_email ?? '',
    createdMs: d.created_at?.toMillis?.() ?? null,
    screenshotPath: d.screenshot_path ?? null,
    status: d.status ?? 'new',
    reviewedMs: d.reviewed_at?.toMillis?.() ?? null,
    reviewedBy: d.reviewed_by ?? null,
  }
}

export async function listFeedback(options?: {
  status?: FeedbackStatus
  limit?: number
}): Promise<FeedbackRow[]> {
  let query = adminDb
    .collection(FEEDBACK_COLLECTION)
    .orderBy('created_at', 'desc')
    .limit(options?.limit ?? 100)
  if (options?.status) {
    // Composite index (status ASC, created_at DESC) in firestore.index.json.
    query = adminDb
      .collection(FEEDBACK_COLLECTION)
      .where('status', '==', options.status)
      .orderBy('created_at', 'desc')
      .limit(options?.limit ?? 100)
  }
  const snap = await query.get()
  return snap.docs.map((doc) => toRow(doc.id, doc.data() as FeedbackDoc))
}

export async function getFeedback(id: string): Promise<FeedbackRow | null> {
  const snap = await adminDb.collection(FEEDBACK_COLLECTION).doc(id).get()
  if (!snap.exists) return null
  return toRow(snap.id, snap.data() as FeedbackDoc)
}

export interface PromptRow {
  id: string
  question: string
  description: string | null
  allowRating: boolean
  allowText: boolean
  status: FeedbackPrompt['status']
  createdMs: number | null
  createdBy: string
  activatedMs: number | null
  closedMs: number | null
  answerCount: number
}

export async function listPrompts(): Promise<PromptRow[]> {
  const snap = await adminDb
    .collection(FEEDBACK_PROMPTS_COLLECTION)
    .orderBy('created_at', 'desc')
    .get()
  return snap.docs.map((doc) => {
    const d = doc.data() as FeedbackPrompt
    return {
      id: doc.id,
      question: d.question ?? '',
      description: d.description ?? null,
      allowRating: d.allow_rating === true,
      allowText: d.allow_text === true,
      status: d.status ?? 'draft',
      createdMs: d.created_at?.toMillis?.() ?? null,
      createdBy: d.created_by ?? '',
      activatedMs: d.activated_at?.toMillis?.() ?? null,
      closedMs: d.closed_at?.toMillis?.() ?? null,
      answerCount: d.answer_count ?? 0,
    }
  })
}

/** Looks up prompt questions for a set of ids (inbox rows / detail page). */
export async function getPromptQuestions(ids: string[]): Promise<Record<string, string>> {
  const unique = [...new Set(ids)].filter(Boolean)
  const out: Record<string, string> = {}
  await Promise.all(
    unique.map(async (id) => {
      const snap = await adminDb.collection(FEEDBACK_PROMPTS_COLLECTION).doc(id).get()
      const q = snap.data()?.question
      if (typeof q === 'string') out[id] = q
    })
  )
  return out
}

export interface FeedbackSettings {
  enabled: boolean
  enabledUpdatedMs: number | null
  enabledUpdatedBy: string | null
  notifyEnabled: boolean
  notifyEmails: string[]
}

// Reads both halves of the feedback config: the world-readable widget switch
// (app_settings/public) and the private notification config
// (app_settings/global_settings). Missing docs/fields = everything off.
export async function getFeedbackSettings(): Promise<FeedbackSettings> {
  const settingsCol = adminDb.collection(APP_SETTINGS_COLLECTION)
  const [publicSnap, globalSnap] = await Promise.all([
    settingsCol.doc(PUBLIC_SETTINGS_DOC).get(),
    settingsCol.doc(GLOBAL_SETTINGS_DOC).get(),
  ])
  const pub = publicSnap.exists ? (publicSnap.data() ?? {}) : {}
  const glob = globalSnap.exists ? (globalSnap.data() ?? {}) : {}
  return {
    enabled: pub.feedback_enabled === true,
    enabledUpdatedMs: pub.feedback_updated_at?.toMillis?.() ?? null,
    enabledUpdatedBy: pub.feedback_updated_by ?? null,
    notifyEnabled: glob.feedback_notify_enabled === true,
    notifyEmails: Array.isArray(glob.feedback_notify_emails)
      ? glob.feedback_notify_emails.filter((e: unknown) => typeof e === 'string')
      : [],
  }
}
