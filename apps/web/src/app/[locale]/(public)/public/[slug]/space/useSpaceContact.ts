'use client'

import { useQuery } from '@tanstack/react-query'
import { doc, getDoc } from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { CONTACTS_COLLECTION } from '@linyup/shared'
import type { Contact } from '@linyup/shared'
import { reportPublicLoadFailure } from '@/lib/publicQueryError'
import { useSpaceAuth } from './SpaceAuthProvider'

// The session `contact` is minimal (id/name/subscription_type_id). Modules that
// need the full record (membership, profile) read the own contact doc — permitted
// by the `isSelfContact` Firestore rule. Cached + shared across modules.
//
// EVERY consumer must read `isError`, not just `data`: this doc is where a
// member's subscriptions and credits live, so a failed read means "we don't know
// what you hold", which is NOT the same claim as "you hold nothing" — and it also
// silently shrinks the subscription-tier courses in "My courses". Both SpaceHome
// and AccountHome surface it; see `lib/publicQueryError.ts`.
export function useSpaceContact() {
  const { contact, isAuthenticated } = useSpaceAuth()
  const contactId = contact?.id ?? null

  return useQuery<Contact | null>({
    queryKey: ['space-contact', contactId],
    enabled: isAuthenticated && !!contactId,
    queryFn: async () => {
      try {
        const snap = await getDoc(doc(db, CONTACTS_COLLECTION, contactId!))
        return snap.exists() ? ({ ...snap.data(), id: snap.id } as Contact) : null
      } catch (err: unknown) {
        // Log and rethrow: the trace is for the developer, `isError` for the
        // visitor. Neither substitutes for the other.
        reportPublicLoadFailure('space/contact', err)
        throw err
      }
    },
  })
}
