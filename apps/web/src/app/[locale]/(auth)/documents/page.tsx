'use client'

import { useMemo, useState } from 'react'
import { useTranslations } from 'next-intl'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useRouter } from '@/i18n/navigation'
import type { Route } from 'next'
import { useAuth } from '@/contexts/AuthContext'
import { Button } from '@/components/ui/button'
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
import { FileText, Plus, Lock, ShieldCheck } from 'lucide-react'
import { WAIVER_MIN_PLAN } from '@linyup/shared'
import type { StudioDocument, DocumentKind, DocumentSource } from '@linyup/shared'
import {
  useDocuments, createDocument, createWaiver, duplicateDocument, countDocuments,
  waiverCallableError,
} from '@/plugins/documents/hooks'
import { getDocumentsLimits } from '@/plugins/documents/limits'
import { DocumentsList } from '@/plugins/documents/DocumentsList'
import { usePlan } from '@/hooks/usePlan'
import { UpgradeModal } from '@/components/plan/UpgradeModal'

// Documents is a DEFAULT FEATURE on every plan — there is no install wall here
// any more, and no marketplace card behind it. The de-gating was a prerequisite
// for waivers rather than a tidy-up: uninstalling (or lapsing to Free, which
// deactivates every install) used to batch-delete the team's document mirrors,
// so a booking gate pointing at a required waiver would have gone dark in the
// same beat as the plan change.

// `waiver` is offered here and is VISIBLE AND LOCKED below Studio rather than
// hidden — the reasoning the promo nav entry already records: hiding a lever
// teaches nobody it exists. Choosing it routes creation through `createWaiver`
// (a callable) instead of the client `addDoc`, which is what carries the plan
// gate, the per-plan cap and the callable-only rules.
const KIND_OPTIONS: DocumentKind[] = ['terms', 'privacy', 'regulation', 'waiver', 'other']

/** The `kind` filter's values. `all` is not a kind, so it is not in the union. */
type KindFilter = DocumentKind | 'all'

export default function DocumentsPage() {
  const t = useTranslations('Documents')
  const tWaivers = useTranslations('Waivers')
  const tCommon = useTranslations('Common')
  const { currentTeamId, user } = useAuth()
  const router = useRouter()
  const queryClient = useQueryClient()

  const { isAtLeast } = usePlan()
  const canAuthorWaivers = isAtLeast(WAIVER_MIN_PLAN)

  const { data: documents = [], isLoading } = useDocuments(currentTeamId)
  const [search, setSearch] = useState('')
  const [kindFilter, setKindFilter] = useState<KindFilter>('all')
  const [upgradeOpen, setUpgradeOpen] = useState(false)
  const [createOpen, setCreateOpen] = useState(false)
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
      // A waiver is callable-only in every direction — the rules deny a client
      // create, update AND delete on the kind — so it cannot share the plain
      // `addDoc` path even for its first write.
      if (kind === 'waiver') {
        return createWaiver({ teamId: currentTeamId, title: title.trim(), source })
      }
      return createDocument({ teamId: currentTeamId, userId: user.uid, title: title.trim(), kind, source })
    },
    onSuccess: (documentId) => {
      setCreateOpen(false)
      setTitle('')
      setKind('terms')
      setSource('rich_text')
      queryClient.invalidateQueries({ queryKey: ['documents', currentTeamId] })
      router.push(`/documents/${documentId}` as Route)
    },
    onError: (err: Error) => {
      if (err.message === 'LIMIT') {
        toast.error(t('limitReached', { max: limits.maxDocumentsPerTeam }))
        return
      }
      // The waiver callable's own refusals (the plan gate, the per-plan waiver
      // cap) are named rather than folded into "could not create" — a studio
      // told only that will not find which of the two it hit.
      const named = waiverCallableError(err, tWaivers)
      toast.error(named === tWaivers('errorGeneric') ? t('createError') : named)
    },
  })

  // Copying reuses the create mutation's guards (the per-team cap) and its
  // landing (open the copy in the editor); it adds nothing of its own.
  const duplicateMutation = useMutation({
    mutationFn: async (source: StudioDocument) => {
      if (!currentTeamId || !user) throw new Error('No team')
      const count = await countDocuments(currentTeamId)
      if (count >= limits.maxDocumentsPerTeam) throw new Error('LIMIT')
      return duplicateDocument({
        source,
        userId: user.uid,
        title: tCommon('copyName', { name: source.title }),
      })
    },
    onSuccess: (documentId) => {
      queryClient.invalidateQueries({ queryKey: ['documents', currentTeamId] })
      router.push(`/documents/${documentId}` as Route)
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
    return documents
      .filter((d) => (kindFilter === 'all' ? true : d.kind === kindFilter))
      .filter((d) => (q ? d.title.toLowerCase().includes(q) : true))
  }, [documents, search, kindFilter])

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">{t('title')}</h1>
          <p className="text-sm text-muted-foreground">{t('subtitle')}</p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Button onClick={() => setCreateOpen(true)} disabled={atDocumentCap}>
            <Plus className="mr-1.5 h-4 w-4" />
            {t('newDocument')}
          </Button>
        </div>
      </div>

      <div className="flex items-center justify-between gap-3">
        <div className="flex flex-1 items-center gap-2">
          <Input
            placeholder={t('searchPlaceholder')}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="max-w-sm"
          />
          <Select value={kindFilter} onValueChange={(v) => setKindFilter(v as KindFilter)}>
            <SelectTrigger className="w-[10rem]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t('kindFilterAll')}</SelectItem>
              {KIND_OPTIONS.map((k) => (
                <SelectItem key={k} value={k}>{t(`kind_${k}`)}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <span className="text-xs text-muted-foreground shrink-0">
          {t('quotaDocuments', { count: documents.length, max: limits.maxDocumentsPerTeam })}
        </span>
      </div>

      {/* ONE list. A document's consent memberships are switches ON ITS ROW —
          see DocumentsList for why the second list was removed rather than
          restyled. */}
      {isLoading ? (
        <Skeleton className="h-64 w-full rounded-xl" />
      ) : filtered.length === 0 ? (
        <div className="rounded-xl border bg-muted/30 p-10 text-center">
          <FileText className="mx-auto mb-3 h-8 w-8 text-muted-foreground" />
          <p className="font-medium">{t('emptyTitle')}</p>
          <p className="mt-1 text-sm text-muted-foreground">{t('emptyBody')}</p>
        </div>
      ) : (
        <DocumentsList
          documents={filtered}
          onOpen={(documentId) => router.push(`/documents/${documentId}` as Route)}
          onDuplicate={(document) => duplicateMutation.mutate(document)}
          duplicating={duplicateMutation.isPending}
        />
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
                    <SelectItem key={k} value={k}>
                      <span className="flex items-center gap-1.5">
                        {k === 'waiver' && <ShieldCheck className="h-3.5 w-3.5" />}
                        {t(`kind_${k}`)}
                        {k === 'waiver' && !canAuthorWaivers && (
                          <Lock className="h-3 w-3 text-muted-foreground" />
                        )}
                      </span>
                    </SelectItem>
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
              onClick={() =>
                // VISIBLE AND LOCKED, not hidden: the option is there, and
                // choosing it below the tier opens the upgrade modal instead of
                // failing with a permission error the studio cannot read.
                kind === 'waiver' && !canAuthorWaivers
                  ? setUpgradeOpen(true)
                  : createMutation.mutate()
              }
              disabled={!title.trim() || createMutation.isPending}
            >
              {kind === 'waiver' && !canAuthorWaivers
                ? tWaivers('unlockCta')
                : createMutation.isPending
                  ? t('creating')
                  : t('create')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <UpgradeModal
        open={upgradeOpen}
        onClose={() => setUpgradeOpen(false)}
        minPlan={WAIVER_MIN_PLAN}
      />
    </div>
  )
}
