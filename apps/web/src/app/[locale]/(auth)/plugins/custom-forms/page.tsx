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
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog'
import { toast } from 'sonner'
import { ClipboardList, Plus, MessageSquare } from 'lucide-react'
import type { Form, FormStatus } from '@linyup/shared'
import { useForms, createForm, countForms } from '@/plugins/custom-forms/hooks'
import { MAX_FORMS_PER_TEAM } from '@/plugins/custom-forms/limits'

const STATUS_BADGE: Record<FormStatus, string> = {
  draft: 'bg-muted text-muted-foreground',
  published: 'bg-green-100 text-green-700',
  archived: 'bg-amber-100 text-amber-700',
}

function FormCard({ form, onOpen }: { form: Form; onOpen: () => void }) {
  const t = useTranslations('CustomForms')
  return (
    <button
      type="button"
      onClick={onOpen}
      className="text-left rounded-lg border bg-card p-4 hover:shadow-sm hover:border-primary/40 transition-all flex flex-col gap-2"
    >
      <div className="flex items-start justify-between gap-2">
        <span className="font-medium line-clamp-2">{form.title}</span>
        <span className={`shrink-0 rounded px-2 py-0.5 text-xs font-medium ${STATUS_BADGE[form.status]}`}>
          {t(`status_${form.status}`)}
        </span>
      </div>
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Badge variant="secondary">
          {form.access === 'contacts' ? t('accessContacts') : t('accessPublic')}
        </Badge>
        <span className="inline-flex items-center gap-1">
          <MessageSquare className="h-3.5 w-3.5" />
          {form.submissionCount ?? 0}
        </span>
      </div>
    </button>
  )
}

export default function CustomFormsPage() {
  const t = useTranslations('CustomForms')
  const { currentTeamId, user } = useAuth()
  const { isInstalled, isLoading: pluginsLoading } = useInstalledPlugins()
  const router = useRouter()
  const queryClient = useQueryClient()

  const { data: forms, isLoading } = useForms(currentTeamId)
  const [search, setSearch] = useState('')
  const [createOpen, setCreateOpen] = useState(false)
  const [title, setTitle] = useState('')

  const createMutation = useMutation({
    mutationFn: async () => {
      if (!currentTeamId || !user) throw new Error('No team')
      const count = await countForms(currentTeamId)
      if (count >= MAX_FORMS_PER_TEAM) {
        throw new Error('LIMIT')
      }
      return createForm({ teamId: currentTeamId, userId: user.uid, title: title.trim() })
    },
    onSuccess: (formId) => {
      setCreateOpen(false)
      setTitle('')
      queryClient.invalidateQueries({ queryKey: ['forms', currentTeamId] })
      router.push(`/plugins/custom-forms/${formId}` as Route)
    },
    onError: (err: Error) => {
      toast.error(err.message === 'LIMIT' ? t('limitReached', { max: MAX_FORMS_PER_TEAM }) : t('createError'))
    },
  })

  const filtered = useMemo(() => {
    if (!forms) return []
    const q = search.trim().toLowerCase()
    return q ? forms.filter((f) => f.title.toLowerCase().includes(q)) : forms
  }, [forms, search])

  if (!pluginsLoading && !isInstalled('custom-forms')) {
    return (
      <div className="mx-auto max-w-md rounded-xl border bg-muted/30 p-10 text-center">
        <ClipboardList className="mx-auto mb-3 h-8 w-8 text-muted-foreground" />
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
        <Button onClick={() => setCreateOpen(true)} className="shrink-0">
          <Plus className="mr-1.5 h-4 w-4" />
          {t('newForm')}
        </Button>
      </div>

      <Input
        placeholder={t('searchPlaceholder')}
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="max-w-sm"
      />

      {isLoading ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-24 rounded-lg" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-xl border bg-muted/30 p-10 text-center">
          <ClipboardList className="mx-auto mb-3 h-8 w-8 text-muted-foreground" />
          <p className="font-medium">{t('emptyTitle')}</p>
          <p className="mt-1 text-sm text-muted-foreground">{t('emptyBody')}</p>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((form) => (
            <FormCard
              key={form.id}
              form={form}
              onOpen={() => router.push(`/plugins/custom-forms/${form.id}` as Route)}
            />
          ))}
        </div>
      )}

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('newForm')}</DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="form-title">{t('formTitle')}</Label>
            <Input
              id="form-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={t('formTitlePlaceholder')}
              autoFocus
              onKeyDown={(e) => {
                if (e.key === 'Enter' && title.trim()) createMutation.mutate()
              }}
            />
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setCreateOpen(false)}>
              {t('cancel')}
            </Button>
            <Button
              onClick={() => createMutation.mutate()}
              disabled={!title.trim() || createMutation.isPending}
            >
              {t('create')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
