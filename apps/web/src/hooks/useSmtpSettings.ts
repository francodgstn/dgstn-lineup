'use client'

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { doc, getDoc } from 'firebase/firestore'
import { httpsCallable } from 'firebase/functions'
import { db, functions } from '@/lib/firebase'
import type { SmtpIntegration } from '@linyup/shared'

type SmtpScope = 'team' | 'org'

interface SmtpSavePayload {
  host: string
  port: number
  secure: boolean
  user: string
  password?: string
  from_name: string
  from_email: string
  use_org_smtp?: boolean
}

interface UseSmtpSettingsResult {
  data: SmtpIntegration | null
  isLoading: boolean
  save: (config: SmtpSavePayload) => Promise<void>
  test: () => Promise<{ success: boolean; message?: string }>
  isSaving: boolean
  isTesting: boolean
}

function smtpDocRef(scope: SmtpScope, entityId: string) {
  if (scope === 'team') {
    return doc(db, 'teams', entityId, 'integrations', 'email_smtp')
  }
  return doc(db, 'organizations', entityId, 'integrations', 'email_smtp')
}

export function useSmtpSettings(scope: SmtpScope, entityId: string | null): UseSmtpSettingsResult {
  const qc = useQueryClient()
  const queryKey = ['smtp-settings', scope, entityId]

  const { data = null, isLoading } = useQuery<SmtpIntegration | null>({
    queryKey,
    enabled: !!entityId,
    queryFn: async () => {
      if (!entityId) return null
      const snap = await getDoc(smtpDocRef(scope, entityId))
      return snap.exists() ? (snap.data() as SmtpIntegration) : null
    },
  })

  const { mutateAsync: save, isPending: isSaving } = useMutation({
    mutationFn: async (config: SmtpSavePayload) => {
      const fn = httpsCallable<
        { scope: SmtpScope; entityId: string; config: SmtpSavePayload },
        { success: boolean }
      >(functions, 'saveSmtpConfig')
      await fn({ scope, entityId: entityId!, config })
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey })
    },
  })

  const { mutateAsync: test, isPending: isTesting } = useMutation({
    mutationFn: async () => {
      const fn = httpsCallable<
        { scope: SmtpScope; entityId: string },
        { success: boolean; message?: string }
      >(functions, 'testSmtpConfig')
      const result = await fn({ scope, entityId: entityId! })
      return result.data
    },
  })

  return { data, isLoading, save, test, isSaving, isTesting }
}
