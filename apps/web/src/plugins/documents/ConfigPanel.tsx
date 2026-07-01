'use client'

import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { doc, setDoc } from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { TEAMS_COLLECTION, INSTALLED_PLUGINS_SUBCOLLECTION } from '@linyup/shared'
import { useAuth } from '@/contexts/AuthContext'
import { useInstalledPlugins } from '@/hooks/useInstalledPlugins'
import { useDocuments } from '@/plugins/documents/hooks'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { FileText } from 'lucide-react'
import { toast } from 'sonner'

// Owner config: which of the team's PUBLISHED documents are attached to the
// public signup consent checkbox. Suggests terms/privacy but allows any kind.
// Writes teams/{teamId}/installed_plugins/documents.config.signupDocumentIds
// (setDoc merge — never touches the rest of the installed-plugin doc).
export function ConfigPanel() {
  const t = useTranslations('Documents')
  const { currentTeamId, user } = useAuth()
  const { getConfig } = useInstalledPlugins()
  const { data: documents = [], isLoading } = useDocuments(currentTeamId)
  const queryClient = useQueryClient()

  const published = documents.filter((d) => d.status === 'published')
  const savedIds = (getConfig('documents')?.signupDocumentIds as string[] | undefined) ?? []

  const [selected, setSelected] = useState<string[]>(savedIds)
  // Re-sync local selection when the persisted config changes underneath us
  // (e.g. after a successful save invalidates the installed-plugins snapshot).
  useEffect(() => {
    setSelected(savedIds)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(savedIds)])

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!currentTeamId || !user) throw new Error('Not authenticated')
      const ref = doc(db, TEAMS_COLLECTION, currentTeamId, INSTALLED_PLUGINS_SUBCOLLECTION, 'documents')
      await setDoc(ref, { config: { signupDocumentIds: selected } }, { merge: true })
    },
    onSuccess: () => {
      toast.success(t('configSaved'))
      queryClient.invalidateQueries({ queryKey: ['documents', currentTeamId] })
    },
    onError: () => toast.error(t('configSaveError')),
  })

  function toggle(id: string) {
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))
  }

  if (isLoading) {
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
