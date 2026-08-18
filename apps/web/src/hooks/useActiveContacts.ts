'use client'

// THE list query for a team's ACTIVE contacts (non-archived, non-deleted) —
// ordered by (lastname, firstname), which is the composite index this project
// requires (a contacts query without that ordering works in the emulator and
// fails on a real project). Every surface that needs "the roster" reads it
// through here: the contacts page, the payment/contact pickers, and the sidebar
// search (UX-90). The contacts page owned a private copy until 2026-08-18; it
// was lifted here rather than duplicated a fourth time, so the cache is shared
// and there is one place where the ordering can be got right.
//
// `coachScopeUid` restricts the list to a coach's own book (uid in
// assigned_coach_ids). Own-scoped members may only read their ASSIGNED contacts
// per the Firestore rules, so the broad query above would be DENIED for them —
// that branch filters by assignee and does the active/archived filtering + sort
// client-side (a coach's book is small). Callers that never run as a coach may
// omit it.

import { useQuery } from '@tanstack/react-query'
import { collection, getDocs, orderBy, query, where } from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { CONTACTS_COLLECTION, type Contact } from '@linyup/shared'

export function useActiveContacts(teamId: string | null, coachScopeUid?: string | null) {
  return useQuery<Contact[]>({
    queryKey: ['contacts', 'active', teamId, coachScopeUid ?? 'all'],
    enabled: !!teamId,
    queryFn: async () => {
      if (!teamId) return []
      if (coachScopeUid) {
        const snap = await getDocs(
          query(
            collection(db, CONTACTS_COLLECTION),
            where('teamId', '==', teamId),
            where('assigned_coach_ids', 'array-contains', coachScopeUid)
          )
        )
        return snap.docs
          .map((d) => ({ ...(d.data() as Contact), id: d.id }))
          .filter((c) => !c.deleted_at && !c.archived_at)
          .sort(
            (a, b) =>
              (a.lastname ?? '').localeCompare(b.lastname ?? '') ||
              (a.firstname ?? '').localeCompare(b.firstname ?? '')
          )
      }
      const snap = await getDocs(
        query(
          collection(db, CONTACTS_COLLECTION),
          where('teamId', '==', teamId),
          where('deleted_at', '==', null),
          where('archived_at', '==', null),
          orderBy('lastname'),
          orderBy('firstname')
        )
      )
      return snap.docs.map((d) => ({ ...(d.data() as Contact), id: d.id }))
    },
  })
}
