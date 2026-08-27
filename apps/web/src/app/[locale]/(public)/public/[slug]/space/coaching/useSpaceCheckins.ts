'use client'

// The member's own performance check-ins — `contacts/{contactId}/performance_checkins`,
// same `isSelfContact` grant as goals (see useSpaceGoals.ts). The profile
// heuristic (`detectPerformanceProfile`) is computed HERE, client-side, at
// submit time: there is no Cloud Function trigger for it yet (see the
// `onGoalWrite` note in useSpaceGoals.ts), so a check-in that skipped this step
// would store raw scores and no profile at all. Mirrors the mobile app's
// `addPerformanceCheckin`.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Timestamp, addDoc, collection, doc, getDocs, limit, orderBy, query, updateDoc } from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { CONTACTS_COLLECTION, CONTACT_PERFORMANCE_CHECKINS_SUBCOLLECTION, detectPerformanceProfile } from '@linyup/shared'
import type { PerformanceCheckin } from '@linyup/shared'
import { reportPublicActionFailure, reportPublicLoadFailure } from '@/lib/publicQueryError'
import { useSpaceAuth } from '../SpaceAuthProvider'

const HISTORY_LIMIT = 10

export function useSpaceCheckins() {
  const { isAuthenticated, contact } = useSpaceAuth()
  const contactId = contact?.id ?? null
  const qc = useQueryClient()

  const checkinsQuery = useQuery<PerformanceCheckin[]>({
    queryKey: ['space-checkins', contactId],
    enabled: isAuthenticated && !!contactId,
    queryFn: async () => {
      try {
        const col = collection(db, CONTACTS_COLLECTION, contactId!, CONTACT_PERFORMANCE_CHECKINS_SUBCOLLECTION)
        // Single orderBy, no equality filter — the automatic single-field
        // index covers this. Deliberately: see the dedup note below for why a
        // second, filtered query is avoided rather than added.
        const snap = await getDocs(query(col, orderBy('taken_at', 'desc'), limit(HISTORY_LIMIT)))
        return snap.docs.map((d) => ({ id: d.id, ...d.data() }) as PerformanceCheckin)
      } catch (err: unknown) {
        reportPublicLoadFailure('space/checkins', err)
        throw err
      }
    },
  })

  const submitCheckin = useMutation({
    mutationFn: async ({ scores, notes }: { scores: Record<string, number>; notes: string | null }) => {
      if (!contactId) throw new Error('Not signed in')
      const col = collection(db, CONTACTS_COLLECTION, contactId, CONTACT_PERFORMANCE_CHECKINS_SUBCOLLECTION)
      const profile = detectPerformanceProfile(scores)
      const payload = {
        taken_at: Timestamp.now(),
        filled_by: 'student' as const,
        context: 'self' as const,
        scores,
        notes: notes || null,
        ...profile,
      }
      // One self check-in per day — overwrite rather than accumulate, the same
      // rule the mobile app already applies (a correction five minutes later
      // should not leave two rows for the same day). Found from the page
      // already in hand rather than a second query: a `where('filled_by', …)
      // .where('taken_at', '>=', …)` query needs a composite index this
      // surface does not (yet) ship, and today's entry — if it exists — is
      // necessarily the single most recent one, so it is always on this page.
      const todayStart = new Date()
      todayStart.setHours(0, 0, 0, 0)
      const todayMs = todayStart.getTime()
      const existing = (checkinsQuery.data ?? []).find(
        (c) => c.filled_by === 'student' && c.taken_at.toMillis() >= todayMs
      )
      if (existing) {
        await updateDoc(doc(col, existing.id), payload)
      } else {
        await addDoc(col, payload)
      }
    },
    onError: (err) => reportPublicActionFailure('space/submit-checkin', err),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['space-checkins', contactId] }),
  })

  return {
    ...checkinsQuery,
    checkins: checkinsQuery.data ?? [],
    submitCheckin,
  }
}

export type SpaceCheckinsState = ReturnType<typeof useSpaceCheckins>
