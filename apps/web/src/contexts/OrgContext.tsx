'use client'

import { createContext, useContext, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { doc, getDoc } from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { useAuth } from '@/contexts/AuthContext'
import type { Organization, SaasSubscription, OrgRole } from '@lineup/shared'

interface OrgContextValue {
  org: Organization | null
  subscription: SaasSubscription | null
  userRole: OrgRole | null
  loading: boolean
  isAdmin: boolean
}

const OrgContext = createContext<OrgContextValue>({
  org: null,
  subscription: null,
  userRole: null,
  loading: true,
  isAdmin: false,
})

export function OrgProvider({ orgId, children }: { orgId: string; children: ReactNode }) {
  const { user } = useAuth()

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

  return (
    <OrgContext.Provider value={{
      org: org ?? null,
      subscription: subscription ?? null,
      userRole: userRole ?? null,
      loading,
      isAdmin: userRole === 'org_admin',
    }}>
      {children}
    </OrgContext.Provider>
  )
}

export function useOrg() {
  return useContext(OrgContext)
}
