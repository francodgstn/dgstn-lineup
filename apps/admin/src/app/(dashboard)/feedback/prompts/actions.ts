'use server'

import { revalidatePath } from 'next/cache'
import { FieldValue } from 'firebase-admin/firestore'
import { FEEDBACK_PROMPTS_COLLECTION, type FeedbackPromptStatus } from '@linyup/shared'
import { adminDb } from '@/lib/firebase-admin'
import { requireOperator } from '@/lib/require-operator'

export interface ActionResult {
  ok: boolean
  error?: string
}

const QUESTION_MAX_LENGTH = 300
const DESCRIPTION_MAX_LENGTH = 500

// Creates a prompt question as a draft — it only reaches app users once
// explicitly pushed (activated). Prompt docs are readable by ANY signed-in
// web-app user (drafts included), so never put sensitive content in one.
export async function createPrompt(formData: FormData): Promise<ActionResult> {
  const operator = await requireOperator()

  const question = String(formData.get('question') ?? '').trim()
  if (!question) return { ok: false, error: 'Question is required.' }
  if (question.length > QUESTION_MAX_LENGTH) {
    return { ok: false, error: `Question must be ${QUESTION_MAX_LENGTH} characters or fewer.` }
  }
  const rawDescription = String(formData.get('description') ?? '').trim()
  if (rawDescription.length > DESCRIPTION_MAX_LENGTH) {
    return { ok: false, error: `Description must be ${DESCRIPTION_MAX_LENGTH} characters or fewer.` }
  }
  const allowRating = formData.get('allow_rating') === 'on'
  const allowText = formData.get('allow_text') === 'on'
  if (!allowRating && !allowText) {
    return { ok: false, error: 'Enable at least one answer type (rating or text).' }
  }

  await adminDb.collection(FEEDBACK_PROMPTS_COLLECTION).add({
    question,
    description: rawDescription || null,
    allow_rating: allowRating,
    allow_text: allowText,
    status: 'draft' satisfies FeedbackPromptStatus,
    created_at: FieldValue.serverTimestamp(),
    created_by: operator.email,
    activated_at: null,
    closed_at: null,
    answer_count: 0,
  })

  revalidatePath('/feedback/prompts')
  return { ok: true }
}

async function transitionPrompt(
  id: string,
  status: FeedbackPromptStatus,
  stamp: Record<string, unknown>,
): Promise<ActionResult> {
  await requireOperator()
  const ref = adminDb.collection(FEEDBACK_PROMPTS_COLLECTION).doc(id)
  if (!(await ref.get()).exists) return { ok: false, error: 'Prompt not found.' }
  await ref.set({ status, ...stamp }, { merge: true })
  revalidatePath('/feedback/prompts')
  return { ok: true }
}

/** Push a draft (or a closed prompt again) to all app users. */
export async function activatePrompt(id: string): Promise<ActionResult> {
  return transitionPrompt(id, 'active', {
    activated_at: FieldValue.serverTimestamp(),
    closed_at: null,
  })
}

/** Stop showing the prompt (answers already given are kept). */
export async function closePrompt(id: string): Promise<ActionResult> {
  return transitionPrompt(id, 'closed', { closed_at: FieldValue.serverTimestamp() })
}
