'use client'

import { useQuery } from '@tanstack/react-query'
import { doc, getDoc } from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { useAuth } from '@/contexts/AuthContext'
import { useOrg, resolveOrgMembershipTerm } from '@/contexts/OrgContext'
import { useLocale } from 'next-intl'

/**
 * Returns the org-configured membership term (e.g. "Affiliation", "Lizenz") for the
 * current locale, falling back to "Membership" when not configured.
 *
 * Works in both org-admin pages (uses OrgContext) and team-admin pages (loads lazily
 * from the team's org_id via TanStack Query).
 */
export function useMembershipTerm(): string {
  const { org, membershipTerm: orgContextTerm } = useOrg()
  const { team } = useAuth()
  const locale = useLocale()

  // org_id to load when we're NOT inside an OrgProvider (org is null)
  const teamOrgId = !org && team?.org_id ? team.org_id : null

  const { data: termFromTeamOrg } = useQuery<string>({
    queryKey: ['org-membership-term', teamOrgId, locale],
    enabled: !!teamOrgId,
    staleTime: 10 * 60 * 1000,
    queryFn: async () => {
      if (!teamOrgId) return 'Membership'
      // Reuse cached ['org', orgId] data if available; otherwise fetch minimally
      const snap = await getDoc(doc(db, 'organizations', teamOrgId))
      if (!snap.exists()) return 'Membership'
      const data = snap.data() as { membership_term?: Partial<Record<string, string>> }
      return resolveOrgMembershipTerm(data.membership_term, locale)
    },
  })

  // Priority: org context (already resolved) > team's org > default
  if (org) return orgContextTerm
  if (termFromTeamOrg) return termFromTeamOrg
  return 'Membership'
}
