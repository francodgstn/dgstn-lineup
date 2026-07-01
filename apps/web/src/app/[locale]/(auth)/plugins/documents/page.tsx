'use client'

import { useMemo, useState } from 'react'
import { useTranslations } from 'next-intl'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useRouter, Link } from '@/i18n/navigation'
import type { Route } from 'next'
import { useAuth } from '@/contexts/AuthContext'
import { useInstalledPlugins } from '@/hooks/useInstalledPlugins'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog'
import { toast } from 'sonner'
import { FileText, Plus, Link2, Globe, Settings2 } from 'lucide-react'
import type { StudioDocument, DocumentKind, DocumentSource, DocumentStatus } from '@linyup/shared'
import { useDocuments, createDocument, countDocuments } from '@/plugins/documents/hooks'
import { getDocumentsLimits } from '@/plugins/documents/limits'
import { ConfigPanel } from '@/plugins/documents/ConfigPanel'

const KIND_OPTIONS: DocumentKind[] = ['terms', 'privacy', 'regulation', 'other']

const STATUS_BADGE: Record<DocumentStatus, string> = {
  draft: 'bg-muted text-muted-foreground',
  published: 'bg-green-100 text-green-700',
  archived: 'bg-amber-100 text-amber-700',
}

function DocumentCard({ document, onOpen }: { document: StudioDocument; onOpen: () => void }) {
  const t = useTranslations('Documents')
  const SourceIcon = document.source === 'external_link' ? Link2 : FileText
  const isSharedPublic = document.isPublic && document.status === 'published'

  return (
    <button
      type="button"
      onClick={onOpen}
      className="text-left rounded-lg border bg-card p-4 hover:shadow-sm hover:border-primary/40 transition-all flex flex-col gap-2"
    >
      <div className="flex items-start justify-between gap-2">
        <span className="font-medium line-clamp-2 flex items-center gap-1.5">
          <SourceIcon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          {document.title}
        </span>
        <span
          className={`shrink-0 rounded px-2 py-0.5 text-xs font-medium ${STATUS_BADGE[document.status]}`}
        >
          {t(`status_${document.status}`)}
        </span>
      </div>
      <div className="flex items-center gap-2 text-xs">
        <Badge variant="secondary">{t(`kind_${document.kind}`)}</Badge>
        {isSharedPublic && (
          <Badge variant="outline" className="border-green-500/50 text-green-600 gap-1">
            <Globe className="h-3 w-3" />
            {t('publicBadge')}
          </Badge>
        )}
      </div>
    </button>
  )
}

export default function DocumentsPage() {
  const t = useTranslations('Documents')
  const { currentTeamId, user } = useAuth()
  const { isInstalled, isLoading: pluginsLoading } = useInstalledPlugins()
  const router = useRouter()
  const queryClient = useQueryClient()

  const { data: documents = [], isLoading } = useDocuments(currentTeamId)
  const [search, setSearch] = useState('')
  const [createOpen, setCreateOpen] = useState(false)
  const [configOpen, setConfigOpen] = useState(false)
  const [title, setTitle] = useState('')
  const [kind, setKind] = useState<DocumentKind>('terms')
  const [source, setSource] = useState<DocumentSource>('rich_text')

  const limits = getDocumentsLimits()
  const atDocumentCap = documents.length >= limits.maxDocumentsPerTeam

  const createMutation = useMutation({
    mutationFn: async () => {
      if (!currentTeamId || !user) throw new Error('No team')
      const count = await countDocuments(currentTeamId)
      if (count >= limits.maxDocumentsPerTeam) {
        throw new Error('LIMIT')
      }
      return createDocument({ teamId: currentTeamId, userId: user.uid, title: title.trim(), kind, source })
    },
    onSuccess: (documentId) => {
      setCreateOpen(false)
      setTitle('')
      setKind('terms')
      setSource('rich_text')
      queryClient.invalidateQueries({ queryKey: ['documents', currentTeamId] })
      router.push(`/plugins/documents/${documentId}` as Route)
    },
    onError: (err: Error) => {
      toast.error(
        err.message === 'LIMIT'
          ? t('limitReached', { max: limits.maxDocumentsPerTeam })
          : t('createError'),
      )
    },
  })

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return q ? documents.filter((d) => d.title.toLowerCase().includes(q)) : documents
  }, [documents, search])

  if (!pluginsLoading && !isInstalled('documents')) {
    return (
      <div className="mx-auto max-w-md rounded-xl border bg-muted/30 p-10 text-center">
        <FileText className="mx-auto mb-3 h-8 w-8 text-muted-foreground" />
        <p className="font-medium">{t('notInstalledTitle')}</p>
        <p className="mt-1 text-sm text-muted-foreground">{t('notInstalledBody')}</p>
        <Link
          href={'/settings/plugins' as Route}
          className="mt-4 inline-block text-sm text-primary hover:underline"
        >
          {t('goToPlugins')} →
        </Link>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">{t('title')}</h1>
          <p className="text-sm text-muted-foreground">{t('subtitle')}</p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Button variant="outline" onClick={() => setConfigOpen(true)}>
            <Settings2 className="mr-1.5 h-4 w-4" />
            {t('signupConsent')}
          </Button>
          <Button onClick={() => setCreateOpen(true)} disabled={atDocumentCap}>
            <Plus className="mr-1.5 h-4 w-4" />
            {t('newDocument')}
          </Button>
        </div>
      </div>

      <div className="flex items-center justify-between gap-3">
        <Input
          placeholder={t('searchPlaceholder')}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-sm"
        />
        <span className="text-xs text-muted-foreground shrink-0">
          {t('quotaDocuments', { count: documents.length, max: limits.maxDocumentsPerTeam })}
        </span>
      </div>

      {isLoading ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-24 rounded-lg" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-xl border bg-muted/30 p-10 text-center">
          <FileText className="mx-auto mb-3 h-8 w-8 text-muted-foreground" />
          <p className="font-medium">{t('emptyTitle')}</p>
          <p className="mt-1 text-sm text-muted-foreground">{t('emptyBody')}</p>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((document) => (
            <DocumentCard
              key={document.id}
              document={document}
              onOpen={() => router.push(`/plugins/documents/${document.id}` as Route)}
            />
          ))}
        </div>
      )}

      {/* Create dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('newDocument')}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="document-title">{t('fieldTitle')}</Label>
              <Input
                id="document-title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder={t('titlePlaceholder')}
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && title.trim()) createMutation.mutate()
                }}
              />
            </div>

            <div className="space-y-2">
              <Label>{t('fieldKind')}</Label>
              <Select value={kind} onValueChange={(v) => setKind(v as DocumentKind)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {KIND_OPTIONS.map((k) => (
                    <SelectItem key={k} value={k}>{t(`kind_${k}`)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>{t('fieldSource')}</Label>
              <RadioGroup value={source} onValueChange={(v) => setSource(v as DocumentSource)}>
                <div className="flex items-center gap-2">
                  <RadioGroupItem value="rich_text" id="source-rich-text" />
                  <Label htmlFor="source-rich-text" className="font-normal">{t('sourceRichText')}</Label>
                </div>
                <div className="flex items-center gap-2">
                  <RadioGroupItem value="external_link" id="source-external" />
                  <Label htmlFor="source-external" className="font-normal">{t('sourceExternalLink')}</Label>
                </div>
              </RadioGroup>
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setCreateOpen(false)}>
              {t('cancel')}
            </Button>
            <Button
              onClick={() => createMutation.mutate()}
              disabled={!title.trim() || createMutation.isPending}
            >
              {createMutation.isPending ? t('creating') : t('create')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Signup consent config */}
      <Dialog open={configOpen} onOpenChange={setConfigOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('signupConsent')}</DialogTitle>
          </DialogHeader>
          <ConfigPanel />
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfigOpen(false)}>{t('close')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
