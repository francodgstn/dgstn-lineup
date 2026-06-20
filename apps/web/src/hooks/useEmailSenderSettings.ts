'use client'

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { doc, getDoc } from 'firebase/firestore'
import { httpsCallable } from 'firebase/functions'
import { db, functions } from '@/lib/firebase'
import type { EmailSenderConfig } from '@linyup/shared'

type EmailSenderScope = 'team' | 'org'

interface RegisterDomainPayload {
  scope: EmailSenderScope
  entityId: string
  domain: string
  fromLocalPart: string
}

interface RegisterDomainResult {
  domain: string
  fromLocalPart: string
  dnsRecords: EmailSenderConfig['dns_records']
  status: 'pending'
}

interface CheckDomainPayload {
  scope: EmailSenderScope
  entityId: string
}

interface CheckDomainResult {
  status: 'pending' | 'verified'
  dnsRecords: EmailSenderConfig['dns_records']
}

interface UseManagedSenderPayload {
  scope: EmailSenderScope
  entityId: string
}

interface UseManagedSenderResult {
  model: 'managed'
}

export interface UseEmailSenderSettingsResult {
  data: EmailSenderConfig | null
  isLoading: boolean
  registerDomain: (domain: string, fromLocalPart: string) => Promise<void>
  checkDomain: () => Promise<void>
  revertToManaged: () => Promise<void>
  isRegistering: boolean
  isChecking: boolean
  isReverting: boolean
}

function senderDocRef(scope: EmailSenderScope, entityId: string) {
  if (scope === 'team') {
    return doc(db, 'teams', entityId, 'integrations', 'email_sender')
  }
  return doc(db, 'organizations', entityId, 'integrations', 'email_sender')
}

export function useEmailSenderSettings(
  scope: EmailSenderScope,
  entityId: string | null
): UseEmailSenderSettingsResult {
  const qc = useQueryClient()
  const queryKey = ['email-sender-settings', scope, entityId]

  const { data = null, isLoading } = useQuery<EmailSenderConfig | null>({
    queryKey,
    enabled: !!entityId,
    queryFn: async () => {
      if (!entityId) return null
      const snap = await getDoc(senderDocRef(scope, entityId))
      return snap.exists() ? (snap.data() as EmailSenderConfig) : null
    },
  })

  const { mutateAsync: registerDomainMutation, isPending: isRegistering } = useMutation({
    mutationFn: async ({ domain, fromLocalPart }: { domain: string; fromLocalPart: string }) => {
      const fn = httpsCallable<RegisterDomainPayload, RegisterDomainResult>(
        functions,
        'registerSenderDomain'
      )
      await fn({ scope, entityId: entityId!, domain, fromLocalPart })
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey })
    },
  })

  const { mutateAsync: checkDomainMutation, isPending: isChecking } = useMutation({
    mutationFn: async () => {
      const fn = httpsCallable<CheckDomainPayload, CheckDomainResult>(
        functions,
        'checkSenderDomain'
      )
      await fn({ scope, entityId: entityId! })
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey })
    },
  })

  const { mutateAsync: revertToManagedMutation, isPending: isReverting } = useMutation({
    mutationFn: async () => {
      const fn = httpsCallable<UseManagedSenderPayload, UseManagedSenderResult>(
        functions,
        'useManagedSender'
      )
      await fn({ scope, entityId: entityId! })
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey })
    },
  })

  return {
    data,
    isLoading,
    registerDomain: (domain: string, fromLocalPart: string) =>
      registerDomainMutation({ domain, fromLocalPart }),
    checkDomain: () => checkDomainMutation(),
    revertToManaged: () => revertToManagedMutation(),
    isRegistering,
    isChecking,
    isReverting,
  }
}
