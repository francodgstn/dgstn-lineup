'use server'

import { revalidatePath } from 'next/cache'
import { FieldValue } from 'firebase-admin/firestore'
import { TEAMS_COLLECTION } from '@linyup/shared'
import { adminDb } from '@/lib/firebase-admin'
import { requireOperator } from '@/lib/require-operator'

export interface ActionResult {
  ok: boolean
  error?: string
}

/**
 * Operator kill-switch for a team's Stripe Connect (member → studio) payments.
 * Connect is self-serve, so `enabled=false` blocks onboarding + charging, while
 * `true` (or absent) allows the studio to set it up. Writes only the nested
 * `payments.connectEnabled` field so the function-managed account mirror is left
 * untouched.
 */
export async function setConnectEnabled(teamId: string, enabled: boolean): Promise<ActionResult> {
  await requireOperator()
  await adminDb
    .collection(TEAMS_COLLECTION)
    .doc(teamId)
    .update({
      'payments.connectEnabled': enabled,
      updated_at: FieldValue.serverTimestamp(),
    })
  revalidatePath(`/accounts/team/${teamId}`)
  return { ok: true }
}
