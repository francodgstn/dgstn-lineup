'use client'

import { useQuery } from '@tanstack/react-query'
import { doc, getDoc } from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { CONTACTS_COLLECTION } from '@linyup/shared'
import type { Contact } from '@linyup/shared'
import { useSpaceAuth } from './SpaceAuthProvider'

// The session `contact` is minimal (id/name/subscription_type_id). Modules that
// need the full record (membership, profile) read the own contact doc — permitted
// by the `isSelfContact` Firestore rule. Cached + shared across modules.
export function useSpaceContact() {
  const { contact, isAuthenticated } = useSpaceAuth()
  const contactId = contact?.id ?? null

  return useQuery<Contact | null>({
    queryKey: ['space-contact', contactId],
    enabled: isAuthenticated && !!contactId,
    queryFn: async () => {
      const snap = await getDoc(doc(db, CONTACTS_COLLECTION, contactId!))
      return snap.exists() ? ({ ...snap.data(), id: snap.id } as Contact) : null
    },
  })
}
