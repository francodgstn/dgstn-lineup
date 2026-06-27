'use client'

import { useQuery } from '@tanstack/react-query'
import { collection, getDocs } from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { TEAMS_COLLECTION, AUTOMATION_RULES_SUBCOLLECTION } from '@linyup/shared'

// Minimal rule shape for read-only listing (e.g. "automations for this subscription").
// The full builder/normalisation lives in the automations page.
export interface AutomationRuleLite {
  id: string
  name: string
  active: boolean
  trigger: { type: string; subscriptionTypeId?: string; affiliationTypeKey?: string }
  conditions: { type: string; value?: string }[]
}

export function useAutomationRules(teamId: string | null) {
  return useQuery<AutomationRuleLite[]>({
    queryKey: ['automation-rules', teamId],
    enabled: !!teamId,
    staleTime: 60_000,
    queryFn: async () => {
      if (!teamId) return []
      const snap = await getDocs(
        collection(db, TEAMS_COLLECTION, teamId, AUTOMATION_RULES_SUBCOLLECTION)
      )
      return snap.docs.map((d) => {
        const data = d.data() as Record<string, unknown>
        return {
          id: d.id,
          name: (data.name as string) ?? '',
          active: (data.active as boolean) ?? false,
          trigger: (data.trigger as AutomationRuleLite['trigger']) ?? { type: '' },
          conditions: Array.isArray(data.conditions)
            ? (data.conditions as AutomationRuleLite['conditions'])
            : [],
        }
      })
    },
  })
}

/** Rules that reference a specific subscription type — via a delta-trigger scope
 *  (trigger.subscriptionTypeId) or a `subscription` condition value. */
export function rulesForSubscriptionType(
  rules: AutomationRuleLite[],
  subscriptionTypeId: string
): AutomationRuleLite[] {
  return rules.filter(
    (r) =>
      r.trigger.subscriptionTypeId === subscriptionTypeId ||
      r.conditions.some((c) => c.type === 'subscription' && c.value === subscriptionTypeId)
  )
}
