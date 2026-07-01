'use client'

import { useCallback, useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { ref as storageRef, uploadBytes, getDownloadURL } from 'firebase/storage'
import { storage } from '@/lib/firebase'
import { Link, useRouter } from '@/i18n/navigation'
import type { Route } from 'next'
import { useAuth } from '@/contexts/AuthContext'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Switch } from '@/components/ui/switch'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { RichTextEditor } from '@/components/RichTextEditor'
import { toast } from 'sonner'
import { ChevronLeft, Trash2, Archive, QrCode, FileText, Link2 } from 'lucide-react'
import type { StudioDocument, DocumentKind, DocumentSource, DocumentStatus } from '@linyup/shared'
import { useDocument, updateDocument, deleteDocument } from '@/plugins/documents/hooks'
import { getDocumentsLimits } from '@/plugins/documents/limits'
import { DocumentShareDialog } from '@/plugins/documents/DocumentShareDialog'

const KIND_OPTIONS: DocumentKind[] = ['terms', 'privacy', 'regulation', 'other']

async function uploadFile(file: File, path: string): Promise<string> {
  const ext = file.name.split('.').pop() ?? 'jpg'
  const sRef = storageRef(storage, `${path}.${ext}`)
  await uploadBytes(sRef, file)
  return getDownloadURL(sRef)
}

// Rejects javascript:/data: and other dangerous protocols — same guard as the
// bio-link editor's custom-link URL schema.
function isSafeHttpUrl(value: string): boolean {
  return /^https?:\/\/.+/.test(value.trim())
}

export default function DocumentDetailPage() {
  const t = useTranslations('Documents')
  const params = useParams()
  const documentId = String(params.documentId)
  const router = useRouter()
  const queryClient = useQueryClient()
  const { team, currentTeamId } = useAuth()
  const { data: document, isLoading } = useDocument(documentId)
  const limits = getDocumentsLimits()

  const [draft, setDraft] = useState<StudioDocument | null>(null)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [archiveOpen, setArchiveOpen] = useState(false)
  const [shareOpen, setShareOpen] = useState(false)

  useEffect(() => {
    if (document) setDraft(document)
  }, [document])

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['document', documentId] })
    queryClient.invalidateQueries({ queryKey: ['documents', document?.teamId] })
  }

  const saveMutation = useMutation({
    mutationFn: async (patch: Parameters<typeof updateDocument>[1]) => updateDocument(documentId, patch),
    onSuccess: () => {
      invalidate()
      toast.success(t('saved'))
    },
    onError: () => toast.error(t('saveError')),
  })

  const deleteMutation = useMutation({
    mutationFn: () => deleteDocument(documentId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['documents', document?.teamId] })
      router.push('/plugins/documents' as Route)
    },
    onError: () => toast.error(t('deleteError')),
  })

  // Image uploads for the rich-text body. Stable identity so the memoized
  // RichTextEditor doesn't re-render (and steal focus) on other state changes.
  const uploadBodyImage = useCallback(
    async (file: File) => {
      if (file.size > limits.maxImageSizeMB * 1024 * 1024) {
        toast.error(t('limitImageSize', { max: limits.maxImageSizeMB }))
        throw new Error('IMAGE_TOO_LARGE')
      }
      return uploadFile(file, `teams/${currentTeamId}/documents/${documentId}/images/${Date.now()}`)
    },
    [currentTeamId, documentId, limits.maxImageSizeMB, t],
  )

  if (isLoading || !draft) {
    return (
      <div className="max-w-3xl space-y-6">
        <Skeleton className="h-7 w-48" />
        <Skeleton className="h-40 rounded-lg" />
      </div>
    )
  }

  if (!document) {
    return (
      <div className="max-w-3xl space-y-4">
        <Link href={'/plugins/documents' as Route} className="text-sm text-muted-foreground hover:text-foreground inline-flex items-center gap-1">
          <ChevronLeft className="h-4 w-4" />{t('backToDocuments')}
        </Link>
        <p className="text-sm text-muted-foreground">{t('notFound')}</p>
      </div>
    )
  }

  const teamSlug = team?.slug ?? ''
  const publicHref = `/public/${teamSlug}/documents/${draft.slug}`
  const publicUrl =
    typeof window !== 'undefined' && teamSlug ? `${window.location.origin}${publicHref}` : ''
  const canShare = draft.status === 'published' && draft.isPublic && !!teamSlug

  const urlInvalid = draft.source === 'external_link' && !!draft.externalUrl && !isSafeHttpUrl(draft.externalUrl)

  function handleSave() {
    if (!draft) return
    saveMutation.mutate({
      title: draft.title.trim(),
      kind: draft.kind,
      source: draft.source,
      body: draft.source === 'rich_text' ? (draft.body ?? '') : undefined,
      externalUrl: draft.source === 'external_link' ? (draft.externalUrl ?? '').trim() : undefined,
      summary: draft.summary ?? '',
    })
  }

  function setStatus(status: DocumentStatus) {
    if (!draft) return
    const patch: Parameters<typeof updateDocument>[1] = { status }
    // isPublic can only be true when published — turning off published forces it off.
    if (status !== 'published' && draft.isPublic) patch.isPublic = false
    setDraft({ ...draft, status, isPublic: status !== 'published' ? false : draft.isPublic })
    saveMutation.mutate(patch)
  }

  function toggleIsPublic(value: boolean) {
    if (!draft) return
    setDraft({ ...draft, isPublic: value })
    saveMutation.mutate({ isPublic: value })
  }

  return (
    <div className="max-w-3xl space-y-5">
      <Link href={'/plugins/documents' as Route} className="text-sm text-muted-foreground hover:text-foreground inline-flex items-center gap-1">
        <ChevronLeft className="h-4 w-4" />{t('backToDocuments')}
      </Link>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          {draft.source === 'external_link' ? (
            <Link2 className="h-5 w-5 text-muted-foreground shrink-0" />
          ) : (
            <FileText className="h-5 w-5 text-muted-foreground shrink-0" />
          )}
          <h1 className="text-xl font-semibold truncate">{draft.title}</h1>
          <Badge variant="secondary">{t(`status_${draft.status}`)}</Badge>
        </div>
        <div className="flex items-center gap-2">
          {canShare && (
            <Button variant="outline" size="sm" onClick={() => setShareOpen(true)}>
              <QrCode className="mr-1.5 h-4 w-4" />
              {t('shareQr')}
            </Button>
          )}
        </div>
      </div>

      <div className="space-y-5">
        {/* Title / kind / summary */}
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="doc-title">{t('fieldTitle')}</Label>
            <Input
              id="doc-title"
              value={draft.title}
              onChange={(e) => setDraft({ ...draft, title: e.target.value })}
            />
          </div>
          <div className="space-y-1.5">
            <Label>{t('fieldKind')}</Label>
            <Select value={draft.kind} onValueChange={(v) => setDraft({ ...draft, kind: v as DocumentKind })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {KIND_OPTIONS.map((k) => (
                  <SelectItem key={k} value={k}>{t(`kind_${k}`)}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="doc-summary">{t('fieldSummary')}</Label>
          <Textarea
            id="doc-summary"
            rows={2}
            value={draft.summary ?? ''}
            onChange={(e) => setDraft({ ...draft, summary: e.target.value })}
            placeholder={t('summaryPlaceholder')}
          />
        </div>

        {/* Source segmented control */}
        <div className="space-y-2">
          <Label>{t('fieldSource')}</Label>
          <div className="flex rounded-lg border overflow-hidden w-fit">
            {(['rich_text', 'external_link'] as DocumentSource[]).map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setDraft({ ...draft, source: s })}
                className={`px-4 py-1.5 text-sm transition-colors ${
                  draft.source === s
                    ? 'bg-primary text-primary-foreground'
                    : 'hover:bg-muted text-muted-foreground'
                }`}
              >
                {t(s === 'rich_text' ? 'sourceRichText' : 'sourceExternalLink')}
              </button>
            ))}
          </div>
        </div>

        {draft.source === 'rich_text' ? (
          <div className="space-y-1.5">
            <Label>{t('fieldContent')}</Label>
            <RichTextEditor
              key={documentId}
              value={document.body ?? ''}
              onChange={(html) => setDraft((prev) => (prev ? { ...prev, body: html } : prev))}
              minHeight={320}
              placeholder={t('contentPlaceholder')}
              onUploadImage={uploadBodyImage}
            />
          </div>
        ) : (
          <div className="space-y-1.5">
            <Label htmlFor="doc-url">{t('fieldExternalUrl')}</Label>
            <Input
              id="doc-url"
              value={draft.externalUrl ?? ''}
              onChange={(e) => setDraft({ ...draft, externalUrl: e.target.value })}
              placeholder="https://…"
            />
            {urlInvalid && <p className="text-xs text-destructive">{t('externalUrlInvalid')}</p>}
          </div>
        )}

        <Button
          onClick={handleSave}
          disabled={saveMutation.isPending || !draft.title.trim() || urlInvalid}
        >
          {saveMutation.isPending ? t('saving') : t('save')}
        </Button>

        {/* Status + public toggle */}
        <div className="rounded-lg border p-4 space-y-4">
          <div className="space-y-2">
            <Label>{t('fieldStatus')}</Label>
            <div className="flex rounded-lg border overflow-hidden w-fit">
              {(['draft', 'published', 'archived'] as DocumentStatus[]).map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setStatus(s)}
                  className={`px-4 py-1.5 text-sm transition-colors ${
                    draft.status === s
                      ? 'bg-primary text-primary-foreground'
                      : 'hover:bg-muted text-muted-foreground'
                  }`}
                >
                  {t(`status_${s}`)}
                </button>
              ))}
            </div>
          </div>

          <div className="flex items-center justify-between gap-4">
            <div>
              <Label htmlFor="doc-public">{t('fieldIsPublic')}</Label>
              <p className="text-xs text-muted-foreground">
                {draft.status === 'published' ? t('isPublicHint') : t('publishFirstHint')}
              </p>
            </div>
            <Switch
              id="doc-public"
              checked={draft.isPublic}
              disabled={draft.status !== 'published'}
              onCheckedChange={toggleIsPublic}
            />
          </div>

          {publicUrl && draft.isPublic && draft.status === 'published' && (
            <p className="text-xs text-muted-foreground break-all">{t('publicUrl')}: {publicUrl}</p>
          )}
        </div>

        {/* Danger zone */}
        <div className="border-t pt-4 flex gap-2">
          <Button variant="ghost" className="text-destructive hover:text-destructive" onClick={() => setArchiveOpen(true)}>
            <Archive className="mr-1.5 h-4 w-4" />
            {t('archive')}
          </Button>
          <Button variant="ghost" className="text-destructive hover:text-destructive" onClick={() => setDeleteOpen(true)}>
            <Trash2 className="mr-1.5 h-4 w-4" />
            {t('delete')}
          </Button>
        </div>
      </div>

      {/* Archive confirm */}
      <AlertDialog open={archiveOpen} onOpenChange={setArchiveOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('archiveConfirmTitle')}</AlertDialogTitle>
            <AlertDialogDescription>{t('archiveConfirmBody')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('cancel')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setStatus('archived')
                setArchiveOpen(false)
              }}
            >
              {t('archive')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Delete confirm */}
      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('deleteConfirmTitle')}</AlertDialogTitle>
            <AlertDialogDescription>{t('deleteConfirmBody')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('cancel')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteMutation.mutate()}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {t('delete')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Share / QR */}
      <DocumentShareDialog
        open={shareOpen}
        onClose={() => setShareOpen(false)}
        url={publicUrl}
        title={draft.title}
        teamName={team?.name}
      />
    </div>
  )
}
