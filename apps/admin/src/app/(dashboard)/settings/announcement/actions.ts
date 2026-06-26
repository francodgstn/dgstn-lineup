'use server'

import { revalidatePath } from 'next/cache'
import { FieldValue } from 'firebase-admin/firestore'
import {
  ANNOUNCEMENT_MAX_LENGTH,
  APP_SETTINGS_COLLECTION,
  PUBLIC_SETTINGS_DOC,
  type AnnouncementStyle,
} from '@linyup/shared'
import { adminDb } from '@/lib/firebase-admin'
import { requireOperator } from '@/lib/require-operator'

export interface ActionResult {
  ok: boolean
  error?: string
}

const STYLES: readonly AnnouncementStyle[] = ['info', 'warning', 'success']

function isStyle(value: string): value is AnnouncementStyle {
  return (STYLES as readonly string[]).includes(value)
}

// Writes the platform announcement banner config to the world-readable
// app_settings/public doc (fields live flat alongside the signup flag). The web
// app reads this without auth to render the top strip.
export async function setAnnouncement(formData: FormData): Promise<ActionResult> {
  const operator = await requireOperator()

  // Checkbox is absent when unchecked.
  const enabled = formData.get('enabled') === 'on'

  const style = String(formData.get('style') ?? 'info')
  if (!isStyle(style)) return { ok: false, error: 'Invalid style.' }

  const rawText = String(formData.get('text') ?? '').trim()
  if (rawText.length > ANNOUNCEMENT_MAX_LENGTH) {
    return { ok: false, error: `Text must be ${ANNOUNCEMENT_MAX_LENGTH} characters or fewer.` }
  }
  const text = rawText.length > 0 ? rawText : null

  await adminDb
    .collection(APP_SETTINGS_COLLECTION)
    .doc(PUBLIC_SETTINGS_DOC)
    .set(
      {
        announcement_enabled: enabled,
        announcement_text: text,
        announcement_style: style,
        announcement_updated_at: FieldValue.serverTimestamp(),
        announcement_updated_by: operator.email,
      },
      { merge: true },
    )

  revalidatePath('/settings/announcement')
  return { ok: true }
}
