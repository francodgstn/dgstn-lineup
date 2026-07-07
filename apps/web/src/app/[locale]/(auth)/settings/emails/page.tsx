'use client'

// Settings → Emails — the home of everything a studio's email sending:
//   1. Outreach templates (used by automations + campaigns): predefined ones
//      installed from the library are customisable (subject + text only — the
//      branded layout is applied at send time) and resettable to stock;
//      custom templates are fully owned by the studio.
//   2. System emails — the automatic transactional mail (bookings, reminders,
//      cancellations) with per-team toggles.
// The Automations page links here.
import { useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { collection, doc, getDocs, orderBy, query, updateDoc } from 'firebase/firestore'
import { Mail, Pencil, Plus, RotateCcw, Trash2 } from 'lucide-react'
import { db } from '@/lib/firebase'
import { TEAMS_COLLECTION } from '@linyup/shared'
import { useAuth } from '@/contexts/AuthContext'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { SystemEmailsCard } from './SystemEmailsCard'
import { TemplateEditor, type OutreachTemplate } from './TemplateEditor'
import { templateDefault } from './templateDefaults'

export default function SettingsEmailsPage() {
  const t = useTranslations('SettingsEmails')
  const ta = useTranslations('Automations')
  const { currentTeamId } = useAuth()
  const qc = useQueryClient()

  const { data: templates = [], isLoading } = useQuery<OutreachTemplate[]>({
    queryKey: ['outreach_templates_all', currentTeamId],
    enabled: !!currentTeamId,
    queryFn: async () => {
      const snap = await getDocs(
        query(
          collection(db, TEAMS_COLLECTION, currentTeamId!, 'outreach_templates'),
          orderBy('name', 'asc')
        )
      )
      return snap.docs.map((d) => ({ ...d.data(), id: d.id }) as OutreachTemplate)
    },
  })

  const [editorOpen, setEditorOpen] = useState(false)
  const [editing, setEditing] = useState<OutreachTemplate | null>(null)

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['outreach_templates_all', currentTeamId] })
    qc.invalidateQueries({ queryKey: ['outreach_templates', currentTeamId] })
  }

  const { system, custom } = useMemo(() => {
    const system = templates.filter((tm) => !!tm.system_key)
    const custom = templates.filter((tm) => !tm.system_key)
    return { system, custom }
  }, [templates])

  const openEditor = (tmpl: OutreachTemplate | null) => {
    setEditing(tmpl)
    setEditorOpen(true)
  }

  const onReset = async (tmpl: OutreachTemplate) => {
    if (!currentTeamId) return
    const def = templateDefault(tmpl.system_key, tmpl.language)
    if (!def) return
    if (!confirm(t('resetConfirm', { name: tmpl.name }))) return
    await updateDoc(doc(db, TEAMS_COLLECTION, currentTeamId, 'outreach_templates', tmpl.id), {
      name: def.name,
      subject: def.subject,
      body: def.body,
      active: true,
    })
    invalidate()
  }

  const onDeactivate = async (tmpl: OutreachTemplate) => {
    if (!currentTeamId) return
    if (!confirm(t('deactivateConfirm', { name: tmpl.name }))) return
    await updateDoc(doc(db, TEAMS_COLLECTION, currentTeamId, 'outreach_templates', tmpl.id), {
      active: false,
    })
    invalidate()
  }

  const renderRow = (tmpl: OutreachTemplate) => {
    const def = templateDefault(tmpl.system_key, tmpl.language)
    const modified = def && (def.subject !== tmpl.subject || def.body !== tmpl.body)
    return (
      <div key={tmpl.id} className="flex items-start justify-between gap-2 border rounded-lg p-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="font-medium text-sm truncate">{tmpl.name}</p>
            <Badge variant="outline" className="text-[10px] uppercase">
              {tmpl.language}
            </Badge>
            {modified && (
              <Badge variant="secondary" className="text-xs">
                {t('modified')}
              </Badge>
            )}
            {!tmpl.active && (
              <Badge variant="secondary" className="text-xs">
                {ta('common.inactive')}
              </Badge>
            )}
          </div>
          <p className="text-xs text-muted-foreground truncate mt-0.5">{tmpl.subject}</p>
        </div>
        <div className="flex gap-1 shrink-0">
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            title={ta('dialogs.templates.saveChanges')}
            onClick={() => openEditor(tmpl)}
          >
            <Pencil className="h-3.5 w-3.5" />
          </Button>
          {def && (
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              title={t('reset')}
              disabled={!modified}
              onClick={() => onReset(tmpl)}
            >
              <RotateCcw className="h-3.5 w-3.5 text-muted-foreground" />
            </Button>
          )}
          {!tmpl.system_key && (
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              title={t('deactivate')}
              onClick={() => onDeactivate(tmpl)}
            >
              <Trash2 className="h-3.5 w-3.5 text-muted-foreground" />
            </Button>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
          <Mail className="h-6 w-6" />
          {t('title')}
        </h1>
        <p className="text-muted-foreground text-sm mt-1">{t('subtitle')}</p>
      </div>

      {/* ── Templates ── */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-2">
          <CardTitle className="text-base">{t('templatesTitle')}</CardTitle>
          <Button size="sm" onClick={() => openEditor(null)}>
            <Plus className="h-4 w-4 mr-1.5" />
            {ta('dialogs.templates.newTemplate')}
          </Button>
        </CardHeader>
        <CardContent className="space-y-5">
          {isLoading && <Skeleton className="h-20 w-full" />}

          {!isLoading && templates.length === 0 && (
            <p className="text-sm text-muted-foreground py-4 text-center">
              {ta('dialogs.templates.empty')}
            </p>
          )}

          {system.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                {t('groupSystem')}
              </p>
              <p className="text-xs text-muted-foreground -mt-1">{t('groupSystemHint')}</p>
              {system.map(renderRow)}
            </div>
          )}

          {custom.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                {t('groupCustom')}
              </p>
              {custom.map(renderRow)}
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── System (transactional) emails ── */}
      <SystemEmailsCard />

      {currentTeamId && (
        <TemplateEditor
          open={editorOpen}
          onOpenChange={setEditorOpen}
          teamId={currentTeamId}
          editing={editing}
          onSaved={invalidate}
        />
      )}
    </div>
  )
}
