'use client'

import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '@/contexts/AuthContext'
import {
  useDocuments,
  useSignupDocumentIds,
  saveSignupDocumentIds,
} from '@/plugins/documents/hooks'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { FileText } from 'lucide-react'
import { toast } from 'sonner'

// Owner config: which of the team's PUBLISHED documents are attached to the
// public signup consent checkbox. Suggests terms/privacy but allows any kind.
//
// Writes teams/{teamId}/settings/documents.signupDocumentIds. That location is
// new: it used to be installed_plugins/documents.config, which the de-gating
// retires. The read is dual (new ?? old) and lives in one shared helper, and the
// read, the write and the security rule for the new path all landed together —
// split, a studio's save silently does nothing, or fails with a permission error.
export function ConfigPanel() {
  const t = useTranslations('Documents')
  const { currentTeamId } = useAuth()
  const { data: documents = [], isLoading } = useDocuments(currentTeamId)
  const { data: savedIds, isLoading: idsLoading } = useSignupDocumentIds(currentTeamId)
  const queryClient = useQueryClient()

  const published = documents.filter((d) => d.status === 'published')

  const [selected, setSelected] = useState<string[]>([])
  // Re-sync local selection when the persisted config changes underneath us
  // (e.g. after a successful save invalidates the settings query).
  useEffect(() => {
    if (savedIds) setSelected(savedIds)
  }, [savedIds])

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!currentTeamId) throw new Error('Not authenticated')
      await saveSignupDocumentIds(currentTeamId, selected)
    },
    onSuccess: () => {
      toast.success(t('configSaved'))
      queryClient.invalidateQueries({ queryKey: ['documents-settings', currentTeamId] })
    },
    onError: () => toast.error(t('configSaveError')),
  })

  function toggle(id: string) {
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))
  }

  if (isLoading || idsLoading) {
    return <Skeleton className="h-32 w-full" />
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">{t('configSignupBody')}</p>

      {published.length === 0 ? (
        <div className="rounded-md border border-dashed p-4 text-center">
          <FileText className="mx-auto mb-2 h-6 w-6 text-muted-foreground/50" />
          <p className="text-xs text-muted-foreground">{t('configNoPublished')}</p>
        </div>
      ) : (
        <div className="space-y-1.5 rounded-md border p-3">
          {published.map((d) => (
            <label key={d.id} className="flex items-center gap-2 cursor-pointer text-sm">
              <input
                type="checkbox"
                checked={selected.includes(d.id)}
                onChange={() => toggle(d.id)}
                className="h-4 w-4 rounded border-gray-300 accent-primary"
              />
              <span className="flex-1">{d.title}</span>
              <span className="text-xs text-muted-foreground">{t(`kind_${d.kind}`)}</span>
            </label>
          ))}
        </div>
      )}

      <Button
        size="sm"
        onClick={() => saveMutation.mutate()}
        disabled={saveMutation.isPending}
      >
        {saveMutation.isPending ? t('saving') : t('saveConfig')}
      </Button>
    </div>
  )
}
