'use server'

import { revalidatePath } from 'next/cache'
import { FieldValue } from 'firebase-admin/firestore'
import { FEEDBACK_COLLECTION, type FeedbackStatus } from '@linyup/shared'
import { adminDb } from '@/lib/firebase-admin'
import { requireOperator } from '@/lib/require-operator'

export interface ActionResult {
  ok: boolean
  error?: string
}

const STATUSES: readonly FeedbackStatus[] = ['new', 'reviewed', 'archived']

export async function setFeedbackStatus(id: string, status: FeedbackStatus): Promise<ActionResult> {
  const operator = await requireOperator()
  if (!STATUSES.includes(status)) return { ok: false, error: 'Invalid status.' }

  const ref = adminDb.collection(FEEDBACK_COLLECTION).doc(id)
  if (!(await ref.get()).exists) return { ok: false, error: 'Feedback not found.' }

  await ref.set(
    {
      status,
      // 'new' resets the review stamp; any other status records who/when.
      reviewed_at: status === 'new' ? null : FieldValue.serverTimestamp(),
      reviewed_by: status === 'new' ? null : operator.email,
    },
    { merge: true },
  )

  revalidatePath('/feedback')
  revalidatePath(`/feedback/${id}`)
  return { ok: true }
}
