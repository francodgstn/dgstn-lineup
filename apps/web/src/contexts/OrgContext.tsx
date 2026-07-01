'use client'

import { createContext, useContext, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { doc, getDoc } from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { useAuth } from '@/contexts/AuthContext'
import { useLocale } from 'next-intl'
import type { Organization, SaasSubscription, OrgRole } from '@linyup/shared'

export function resolveAffiliationTerm(
  termObj: Partial<Record<string, string>> | undefined,
  locale: string,
): string {
  if (!termObj) return 'Affiliation'
  // Viewer locale → English → any filled language → default. The last fallback
  // lets a studio that entered only one translation have it apply everywhere.
  const firstFilled = Object.values(termObj).find((v) => v && v.trim())
  return termObj[locale] ?? termObj['en'] ?? firstFilled ?? 'Affiliation'
}

interface OrgContextValue {
  org: Organization | null
  subscription: SaasSubscription | null
  userRole: OrgRole | null
  loading: boolean
  isAdmin: boolean
  affiliationTerm: string
}

const OrgContext = createContext<OrgContextValue>({
  org: null,
  subscription: null,
  userRole: null,
  loading: true,
  isAdmin: false,
  affiliationTerm: 'Affiliation',
})

export function OrgProvider({ orgId, children }: { orgId: string; children: ReactNode }) {
  const { user } = useAuth()
  const locale = useLocale()

  const { data: org, isLoading: orgLoading } = useQuery<Organization | null>({
    queryKey: ['org', orgId],
    queryFn: async () => {
      const snap = await getDoc(doc(db, 'organizations', orgId))
      return snap.exists() ? ({ id: snap.id, ...snap.data() } as Organization) : null
    },
  })

  const { data: subscription, isLoading: subLoading } = useQuery<SaasSubscription | null>({
    queryKey: ['org-subscription', orgId],
    queryFn: async () => {
      const snap = await getDoc(doc(db, 'saas_subscriptions', orgId))
      return snap.exists() ? (snap.data() as SaasSubscription) : null
    },
  })

  const { data: userRole, isLoading: roleLoading } = useQuery<OrgRole | null>({
    queryKey: ['org-role', orgId, user?.uid],
    enabled: !!user,
    queryFn: async () => {
      if (!user) return null
      const snap = await getDoc(doc(db, 'organizations', orgId, 'org_members', user.uid))
      return snap.exists() ? (snap.data().role as OrgRole) : null
    },
  })

  const loading = orgLoading || subLoading || roleLoading
  const affiliationTerm = resolveAffiliationTerm(org?.affiliation_term, locale)

  return (
    <OrgContext.Provider value={{
      org: org ?? null,
      subscription: subscription ?? null,
      userRole: userRole ?? null,
      loading,
      isAdmin: userRole === 'org_admin',
      affiliationTerm,
    }}>
      {children}
    </OrgContext.Provider>
  )
}

export function useOrg() {
  return useContext(OrgContext)
}
