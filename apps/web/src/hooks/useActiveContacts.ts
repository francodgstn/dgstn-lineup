'use client'

// Lightweight list of a team's ACTIVE contacts (non-archived, non-deleted) for
// pickers — e.g. assigning a payment to a contact. Mirrors the contacts page
// query (ordered by lastname, firstname — the index the project requires).

import { useQuery } from '@tanstack/react-query'
import { collection, getDocs, orderBy, query, where } from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { CONTACTS_COLLECTION, type Contact } from '@linyup/shared'

export function useActiveContacts(teamId: string | null) {
  return useQuery<Array<Contact & { id: string }>>({
    queryKey: ['contacts', 'active', teamId],
    enabled: !!teamId,
    queryFn: async () => {
      if (!teamId) return []
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
