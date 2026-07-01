'use client'

import { useQuery } from '@tanstack/react-query'
import { doc, getDoc } from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { useAuth } from '@/contexts/AuthContext'
import { useOrg, resolveAffiliationTerm } from '@/contexts/OrgContext'
import { useLocale } from 'next-intl'

/**
 * Returns the org-configured affiliation term (e.g. "Affiliation", "Lizenz") for the
 * current locale, falling back to "Affiliation" when not configured.
 *
 * Works in both org-admin pages (uses OrgContext) and team-admin pages (loads lazily
 * from the team's org_id via TanStack Query).
 *
 * Renamed from useMembershipTerm — reads the same Organization.affiliation_term field.
 */
export function useAffiliationTerm(): string {
  const { org, affiliationTerm: orgContextTerm } = useOrg()
  const { team } = useAuth()
  const locale = useLocale()

  // org_id to load when we're NOT inside an OrgProvider (org is null)
  const teamOrgId = !org && team?.org_id ? team.org_id : null

  const { data: termFromTeamOrg } = useQuery<string>({
    queryKey: ['org-membership-term', teamOrgId, locale],
    enabled: !!teamOrgId,
    staleTime: 10 * 60 * 1000,
    queryFn: async () => {
      if (!teamOrgId) return 'Affiliation'
      const snap = await getDoc(doc(db, 'organizations', teamOrgId))
      if (!snap.exists()) return 'Affiliation'
      const data = snap.data() as { affiliation_term?: Partial<Record<string, string>> }
      return resolveAffiliationTerm(data.affiliation_term, locale)
    },
  })

  // Priority: org context (already resolved) > team's org > default
  if (org) return orgContextTerm
  if (termFromTeamOrg) return termFromTeamOrg
  return 'Affiliation'
}
