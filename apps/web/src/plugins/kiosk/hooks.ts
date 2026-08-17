'use client'

import { useQuery } from '@tanstack/react-query'
import { doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore'
import { ref as storageRef, uploadBytes, getDownloadURL } from 'firebase/storage'
import { db, storage } from '@/lib/firebase'
import {
  TEAMS_COLLECTION,
  INSTALLED_PLUGINS_SUBCOLLECTION,
  normalizeKioskConfig,
} from '@linyup/shared'
import type { KioskConfig, KioskMediaItem } from '@linyup/shared'

// ─── queries ────────────────────────────────────────────────────────────────

/** Private config (installed_plugins/kiosk.config) — seeded from DEFAULT_KIOSK_CONFIG
 *  when absent, and defensively merged field-by-field so older saved configs still
 *  get any new default fields added later. */
export function useKioskConfig(teamId: string | null) {
  return useQuery<KioskConfig>({
    queryKey: ['kiosk-config', teamId],
    enabled: !!teamId,
    queryFn: async () => {
      const snap = await getDoc(
        doc(db, TEAMS_COLLECTION, teamId!, INSTALLED_PLUGINS_SUBCOLLECTION, 'kiosk')
      )
      const saved = snap.exists() ? (snap.data()?.config as Partial<KioskConfig> | undefined) : undefined
      return normalizeKioskConfig(saved)
    },
  })
}

// ─── mutations ────────────────────────────────────────────────────────────────

/** Persist the full config (overwrite — the config field IS the complete
 *  document, merged into installed_plugins/kiosk). */
export async function saveKioskConfig(teamId: string, userId: string, config: KioskConfig): Promise<void> {
  const ref = doc(db, TEAMS_COLLECTION, teamId, INSTALLED_PLUGINS_SUBCOLLECTION, 'kiosk')
  await setDoc(
    ref,
    { config, updated_at: serverTimestamp(), updatedBy: userId },
    { merge: true }
  )
}

/** Upload a standby-slideshow image/video to Storage and return its download URL. */
export async function uploadKioskMedia(teamId: string, file: File): Promise<KioskMediaItem> {
  const ext = file.name.split('.').pop() ?? 'jpg'
  const key = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
  const sRef = storageRef(storage, `teams/${teamId}/kiosk/${key}.${ext}`)
  await uploadBytes(sRef, file)
  const url = await getDownloadURL(sRef)
  return { url, type: file.type.startsWith('video') ? 'video' : 'image' }
}
