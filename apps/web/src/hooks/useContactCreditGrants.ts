'use client'

// A contact's lesson-credit GRANTS — the individual packs, not the rolled-up
// balance.
//
// WHY NOT `Contact.credit_summary`: that mirror answers "how many are left right
// now", which is the right answer for a booking gate and the wrong one for a
// coach asking what happened in March. A grant carries its own dates
// (`created_at`, `expires_at`) and its own size, so it can be placed on a
// timeline; the summary carries neither.
//
// THE ONE EXACT PAYMENT JOIN IN THE MODEL lives here: a grant's DOC ID is the id
// of the payment that produced it (`CreditGrant.payment_ref` carries the same
// value). Everything else linking money to what it bought is a plan *type* at
// best — see `UnifiedPaymentRow.planTypeId`.
//
// Historical BALANCE is deliberately not reconstructed anywhere: a spend is a
// bare `credits_used` counter with no date of its own, so "how many were left on
// 14 March" is not answerable from this data and must not be implied.

import { useQuery } from '@tanstack/react-query'
import { collection, getDocs, orderBy, query } from 'firebase/firestore'
import { db } from '@/lib/firebase'
import {
  CONTACTS_COLLECTION,
  CONTACT_CREDIT_GRANTS_SUBCOLLECTION,
  type CreditGrant,
} from '@linyup/shared'

export function useContactCreditGrants(contactId: string | null) {
  return useQuery<CreditGrant[]>({
    queryKey: ['contact-credit-grants', contactId],
    enabled: !!contactId,
    queryFn: async () => {
      if (!contactId) return []
      const snap = await getDocs(
        query(
          collection(db, CONTACTS_COLLECTION, contactId, CONTACT_CREDIT_GRANTS_SUBCOLLECTION),
          orderBy('created_at', 'desc')
        )
      )
      return snap.docs.map((d) => ({ ...d.data(), id: d.id }) as CreditGrant)
    },
  })
}
