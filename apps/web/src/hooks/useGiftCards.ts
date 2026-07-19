'use client'

// Admin-side client hooks for gift cards (E3). The public purchase/redeem flow
// (createGiftCardCheckout / checkGiftCard) is called inline from the public
// surfaces themselves (ShopHome, BookingForm, GiftCardRedeemField) — same
// convention those files already use for the other public checkouts. This file
// only covers what the Payments dashboard needs: listing + voiding.

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { httpsCallable } from 'firebase/functions'
import { collection, getDocs, limit, orderBy, query } from 'firebase/firestore'
import { db, functions } from '@/lib/firebase'
import { GIFT_CARDS_SUBCOLLECTION, TEAMS_COLLECTION, type GiftCard } from '@linyup/shared'

/** Recent gift cards for the team (manager read, function-only write — see
 *  firestore.rules). Single-field orderBy, no composite index needed. */
export function useTeamGiftCards(teamId: string | null) {
  return useQuery({
    queryKey: ['gift-cards', teamId],
    enabled: !!teamId,
    queryFn: async (): Promise<GiftCard[]> => {
      const snap = await getDocs(
        query(
          collection(db, TEAMS_COLLECTION, teamId!, GIFT_CARDS_SUBCOLLECTION),
          orderBy('created_at', 'desc'),
          limit(50)
        )
      )
      return snap.docs.map((d) => d.data() as GiftCard)
    },
  })
}

export function useVoidGiftCard() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (vars: { teamId: string; code: string }) => {
      const fn = httpsCallable<typeof vars, { ok: boolean }>(functions, 'voidGiftCard')
      return (await fn(vars)).data
    },
    onSuccess: (_data, vars) => qc.invalidateQueries({ queryKey: ['gift-cards', vars.teamId] }),
  })
}
