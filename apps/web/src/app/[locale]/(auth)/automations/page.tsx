'use client'

import { useState, useEffect } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import {
  collection, query, where, orderBy, getDocs,
  addDoc, updateDoc, deleteDoc, doc, serverTimestamp, Timestamp,
} from 'firebase/firestore'
import { httpsCallable } from 'firebase/functions'
import { db, functions } from '@/lib/firebase'
import { useAuth } from '@/contexts/AuthContext'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { PlanGate } from '@/components/plan/PlanGate'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Separator } from '@/components/ui/separator'
import {
  Workflow, Plus, Pencil, Play, Trash2, MoreVertical,
  Clock, UserPlus, CheckCircle, XCircle,
  CalendarCheck, ShieldCheck, CreditCard, Mail, Bell,
  FileText, Settings2, Zap, RefreshCw, Sparkles,
} from 'lucide-react'
import { TEAMS_COLLECTION } from '@lineup/shared'
import { SYSTEM_TEMPLATES, SYSTEM_RULES } from './systemDefaults'

// ─── types ────────────────────────────────────────────────────────────────────

interface AutomationTrigger {
  type: string
  delayMinutes?: number
}

interface AutomationCondition {
  type: string
  value?: string
  delay_days?: number
}

interface AutomationAction {
  type: string
  templateId?: string
  presetId?: string
  field?: string
  value?: unknown
  subject?: string
  body?: string
  message?: string
}

interface AutomationRule {
  id: string
  name: string
  active: boolean
  trigger: AutomationTrigger
  conditions: AutomationCondition[]
  actions: AutomationAction[]
  last_run_at?: { toDate(): Date } | null
  last_run_sent?: number
  system_key?: string   // present on starter-kit rules — used to prevent duplicate seeding
  // legacy fields — normalised on read
  template_id?: string
  alert_preset_id?: string
}

interface OutreachTemplate {
  id: string
  name: string
  subject: string
  body: string
  language: string
  active: boolean
  system_key?: string   // present on starter-kit templates — used to prevent duplicate seeding
}

// Form shapes
interface FormCondition { type: string; value: string }
interface FormAction {
  type: string
  templateId: string    // send_email
  field?: string        // update_field — which contact field
  fieldValue?: string   // update_field — the new value
  subject?: string      // notify_team — email subject
  body?: string         // notify_team — email body (markdown)
  message?: string      // log_activity — log message
}

// ─── constants ────────────────────────────────────────────────────────────────

const TRIGGER_OPTIONS = [
  { value: 'schedule_daily',            label: 'Daily scan (scheduled)',         icon: Clock,          supportsDelay: false },
  { value: 'contact_created',           label: 'Contact created',                icon: UserPlus,       supportsDelay: true },
  { value: 'booking_confirmed',         label: 'Booking confirmed',              icon: CheckCircle,    supportsDelay: true },
  { value: 'booking_no_show',           label: 'Booking marked no-show',         icon: XCircle,        supportsDelay: true },
  { value: 'membership_status_changed', label: 'Membership status changed',      icon: ShieldCheck,    supportsDelay: true },
  { value: 'subscription_changed',      label: 'Subscription changed',           icon: CreditCard,     supportsDelay: true },
  { value: 'session_ended',             label: 'Session ended',                  icon: CalendarCheck,  supportsDelay: true },
  { value: 'manual',                    label: 'Manual only',                    icon: Play,           supportsDelay: false },
]

const CONDITION_TYPE_OPTIONS = [
  { value: 'contact_type',              label: 'Contact type',            input: 'contact_type_select' },
  { value: 'membership_status',         label: 'Membership status',       input: 'membership_select' },
  { value: 'subscription',             label: 'Subscription',             input: 'subscription_select' },
  { value: 'sessions_attended_min',     label: 'Sessions attended ≥',     input: 'number' },
  { value: 'sessions_attended_max',     label: 'Sessions attended ≤',     input: 'number' },
  { value: 'sessions_attended_exactly', label: 'Sessions attended =',     input: 'number' },
  { value: 'inactivity_days',           label: 'Inactive for at least (days)', input: 'number' },
  { value: 'inactivity_days_max',       label: 'Inactive for at most (days)',  input: 'number' },
  { value: 'portal_booking_no_show',    label: 'Portal booking no-show',  input: 'none' },
]

const CONTACT_TYPE_VALUES = ['trial', 'student', 'external']
const MEMBERSHIP_STATUS_VALUES = ['guest', 'requested', 'being_checked', 'almost_ready', 'active', 'expired']
const SUBSCRIPTION_VALUES = [
  { value: 'any', label: 'Any subscription' },
  { value: 'none', label: 'No subscription' },
]

// ─── helpers ──────────────────────────────────────────────────────────────────

function triggerLabel(type: string): string {
  return TRIGGER_OPTIONS.find((t) => t.value === type)?.label ?? type
}

function conditionSummary(c: AutomationCondition): string {
  const opt = CONDITION_TYPE_OPTIONS.find((o) => o.value === c.type)
  if (!opt) return c.type
  if (opt.input === 'none') return opt.label
  if (opt.input === 'number') return `${opt.label} ${c.value ?? ''}`
  return `${opt.label}: ${c.value ?? ''}`
}

function actionSummary(a: AutomationAction, templates: OutreachTemplate[]): string {
  if (a.type === 'send_email') {
    const tmpl = templates.find((t) => t.id === (a.templateId ?? ''))
    return `Email: ${tmpl?.name ?? a.templateId ?? '—'}`
  }
  if (a.type === 'create_alert') return 'Create alert'
  if (a.type === 'update_field') return `Set ${a.field ?? '—'} → ${String(a.value ?? '—')}`
  if (a.type === 'notify_team') return `Notify team: ${a.subject ?? ''}`
  if (a.type === 'log_activity') return `Log: ${a.message ?? ''}`
  return a.type
}

function timeAgo(ts: { toDate(): Date } | null | undefined): string {
  if (!ts) return ''
  const ms = Date.now() - ts.toDate().getTime()
  const mins = Math.floor(ms / 60000)
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  return `${Math.floor(hrs / 24)}d ago`
}

/** Normalise legacy rule docs (template_id / alert_preset_id → actions) */
function normaliseRule(data: Record<string, unknown>, id: string): AutomationRule {
  const actions: AutomationAction[] = []
  if (Array.isArray(data.actions) && (data.actions as unknown[]).length > 0) {
    actions.push(...(data.actions as AutomationAction[]))
  } else {
    if (data.template_id) actions.push({ type: 'send_email', templateId: data.template_id as string })
    if (data.alert_preset_id) actions.push({ type: 'create_alert', presetId: data.alert_preset_id as string })
  }
  const trigger = (data.trigger && typeof data.trigger === 'object')
    ? data.trigger as AutomationTrigger
    : { type: 'schedule_daily' }
  return {
    id,
    name: (data.name as string) || '',
    active: Boolean(data.active),
    trigger,
    conditions: (Array.isArray(data.conditions) ? data.conditions : []) as AutomationCondition[],
    actions,
    last_run_at: data.last_run_at as AutomationRule['last_run_at'],
    last_run_sent: data.last_run_sent as number | undefined,
    system_key: data.system_key as string | undefined,
    template_id: data.template_id as string | undefined,
  }
}

// ─── data hooks ───────────────────────────────────────────────────────────────

function useRules(teamId: string | null) {
  return useQuery<AutomationRule[]>({
    queryKey: ['automation_rules', teamId],
    enabled: !!teamId,
    queryFn: async () => {
      if (!teamId) return []
      const snap = await getDocs(
        query(
          collection(db, TEAMS_COLLECTION, teamId, 'automation_rules'),
          orderBy('name', 'asc'),
        ),
      )
      return snap.docs.map((d) => normaliseRule(d.data() as Record<string, unknown>, d.id))
    },
  })
}

function useTemplates(teamId: string | null) {
  return useQuery<OutreachTemplate[]>({
    queryKey: ['outreach_templates', teamId],
    enabled: !!teamId,
    queryFn: async () => {
      if (!teamId) return []
      const snap = await getDocs(
        query(
          collection(db, TEAMS_COLLECTION, teamId, 'outreach_templates'),
          where('active', '==', true),
          orderBy('name', 'asc'),
        ),
      )
      return snap.docs.map((d) => ({ id: d.id, ...d.data() }) as OutreachTemplate)
    },
  })
}

// ─── StarterKitBanner ─────────────────────────────────────────────────────────

/**
 * Shows a one-time banner prompting the manager to load the system starter kit.
 * Hides permanently once all system-key templates are present in the team's data.
 * The seeding writes directly to Firestore (no cloud function needed) and is
 * idempotent — existing docs with matching system_key are skipped.
 */
function StarterKitBanner({
  teamId,
  templates,
  rules,
  onSeeded,
}: {
  teamId: string
  templates: OutreachTemplate[]
  rules: AutomationRule[]
  onSeeded: () => void
}) {
  const [open, setOpen] = useState(false)
  const [seeding, setSeeding] = useState(false)
  const [error, setError] = useState('')

  // Show the banner only when at least one system template is still missing
  const hasAllSystemTemplates = SYSTEM_TEMPLATES.every((t) =>
    templates.some((existing) => existing.system_key === t.system_key)
  )
  if (hasAllSystemTemplates) return null

  // Count how many items are genuinely new (not already seeded)
  const newTemplates = SYSTEM_TEMPLATES.filter(
    (t) => !templates.some((existing) => existing.system_key === t.system_key)
  )
  const newRules = SYSTEM_RULES.filter(
    (r) => !rules.some((existing) => existing.system_key === r.system_key)
  )

  async function handleSeed() {
    setSeeding(true)
    setError('')
    try {
      // 1. Create missing templates, build systemKey → docId map
      const createdIds: Record<string, string> = {}

      for (const tmpl of SYSTEM_TEMPLATES) {
        const existing = templates.find((t) => t.system_key === tmpl.system_key)
        if (existing) {
          createdIds[tmpl.system_key] = existing.id
          continue
        }
        const { system_key, ...tmplData } = tmpl
        const ref = await addDoc(
          collection(db, TEAMS_COLLECTION, teamId, 'outreach_templates'),
          { ...tmplData, system_key, created_at: serverTimestamp() }
        )
        createdIds[tmpl.system_key] = ref.id
      }

      // 2. Create missing rules, resolve template IDs from the map
      for (const rule of SYSTEM_RULES) {
        if (rules.some((existing) => existing.system_key === rule.system_key)) continue
        const templateId = createdIds[rule.template_system_key]
        if (!templateId) continue

        const { template_system_key, ...ruleData } = rule
        await addDoc(
          collection(db, TEAMS_COLLECTION, teamId, 'automation_rules'),
          {
            ...ruleData,
            trigger: { type: 'schedule_daily' },
            actions: [{ type: 'send_email', templateId }],
            created_at: serverTimestamp(),
            updated_at: serverTimestamp(),
          }
        )
      }

      setOpen(false)
      onSeeded()
    } catch (err) {
      setError((err as Error).message || 'Failed to load starter kit')
    } finally {
      setSeeding(false)
    }
  }

  return (
    <>
      {/* Banner */}
      <div className="rounded-xl border border-primary/20 bg-primary/5 p-4 flex items-start gap-3">
        <Sparkles className="h-4 w-4 text-primary shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-primary">Get started with a starter kit</p>
          <p className="text-xs text-muted-foreground mt-0.5">
            {SYSTEM_TEMPLATES.length} email templates and {SYSTEM_RULES.length} automation rules covering
            trial recovery, post-trial conversion, student win-back, and milestone emails.
            All rules are created inactive — review and activate when ready.
          </p>
        </div>
        <Button size="sm" variant="outline" className="shrink-0 text-xs h-7 border-primary/30 text-primary hover:bg-primary/10" onClick={() => setOpen(true)}>
          <Sparkles className="h-3 w-3 mr-1.5" />Load starter kit
        </Button>
      </div>

      {/* Confirmation dialog */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-primary" />
              Automation starter kit
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-1">
            <p className="text-xs text-muted-foreground">
              The following will be added to your account. Items already present are skipped automatically.
              All rules start as <strong>inactive</strong> — you control when they go live.
            </p>

            {newTemplates.length > 0 && (
              <div className="space-y-1.5">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-1.5">
                  <Mail className="h-3 w-3" />{newTemplates.length} email template{newTemplates.length !== 1 ? 's' : ''}
                </p>
                <ul className="space-y-1">
                  {newTemplates.map((t) => (
                    <li key={t.system_key} className="text-xs text-foreground flex items-center gap-1.5">
                      <span className="h-1 w-1 rounded-full bg-muted-foreground/50 shrink-0" />
                      {t.name}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {newRules.length > 0 && (
              <div className="space-y-1.5">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-1.5">
                  <Workflow className="h-3 w-3" />{newRules.length} automation rule{newRules.length !== 1 ? 's' : ''}
                </p>
                <ul className="space-y-1">
                  {newRules.map((r) => (
                    <li key={r.system_key} className="text-xs text-foreground flex items-center gap-1.5">
                      <span className="h-1 w-1 rounded-full bg-muted-foreground/50 shrink-0" />
                      {r.name}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {newTemplates.length === 0 && newRules.length === 0 && (
              <p className="text-xs text-muted-foreground text-center py-2">
                All starter-kit items are already loaded.
              </p>
            )}

            {error && <p className="text-xs text-destructive">{error}</p>}
          </div>

          <DialogFooter className="gap-2">
            <Button variant="ghost" size="sm" onClick={() => setOpen(false)} disabled={seeding}>
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={handleSeed}
              disabled={seeding || (newTemplates.length === 0 && newRules.length === 0)}
            >
              {seeding ? 'Applying…' : 'Apply'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

// ─── RuleCard ─────────────────────────────────────────────────────────────────

function TriggerIcon({ type, className }: { type: string; className?: string }) {
  const opt = TRIGGER_OPTIONS.find((t) => t.value === type)
  const Icon = opt?.icon ?? Zap
  return <Icon className={className ?? 'h-4 w-4'} />
}

function RuleCard({
  rule, templates, onEdit, onToggle, onRunNow, onDelete,
}: {
  rule: AutomationRule
  templates: OutreachTemplate[]
  onEdit: () => void
  onToggle: () => void
  onRunNow: () => void
  onDelete: () => void
}) {
  const [running, setRunning] = useState(false)

  async function handleRunNow() {
    setRunning(true)
    try { await onRunNow() } finally { setRunning(false) }
  }

  const trigger = rule.trigger ?? { type: 'schedule_daily' }

  return (
    <div className={`rounded-xl border bg-card p-4 space-y-3 transition-opacity ${rule.active ? '' : 'opacity-60'}`}>
      {/* Header */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <TriggerIcon type={trigger.type} className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
          <h3 className="font-semibold text-sm leading-tight truncate">{rule.name || '(unnamed)'}</h3>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Badge variant={rule.active ? 'default' : 'secondary'} className="text-xs">
            {rule.active ? 'Active' : 'Paused'}
          </Badge>
          <DropdownMenu>
            <DropdownMenuTrigger className="inline-flex items-center justify-center h-7 w-7 rounded-md hover:bg-accent transition-colors">
              <MoreVertical className="h-3.5 w-3.5" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={onEdit}>
                <Pencil className="h-3.5 w-3.5 mr-2" />Edit
              </DropdownMenuItem>
              <DropdownMenuItem onClick={onToggle}>
                {rule.active ? 'Pause' : 'Activate'}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={handleRunNow} disabled={running}>
                <Play className="h-3.5 w-3.5 mr-2" />{running ? 'Running…' : 'Run now'}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={onDelete} className="text-destructive focus:text-destructive">
                <Trash2 className="h-3.5 w-3.5 mr-2" />Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* Trigger line */}
      <div className="text-xs text-muted-foreground">
        <span className="font-medium text-foreground">{triggerLabel(trigger.type)}</span>
        {trigger.delayMinutes && trigger.delayMinutes > 0 && (
          <span className="ml-1">· {trigger.delayMinutes < 60
            ? `${trigger.delayMinutes}m delay`
            : `${trigger.delayMinutes / 60}h delay`}
          </span>
        )}
      </div>

      {/* Condition chips */}
      {rule.conditions.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {rule.conditions.map((c, i) => (
            <span key={i} className="inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium text-muted-foreground bg-muted">
              {conditionSummary(c)}
            </span>
          ))}
        </div>
      )}

      {/* Action line */}
      {rule.actions.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {rule.actions.map((a, i) => (
            <span key={i} className="inline-flex items-center gap-1.5 text-xs font-medium text-primary">
              {a.type === 'send_email' && <Mail className="h-3 w-3" />}
              {a.type === 'create_alert' && <Bell className="h-3 w-3" />}
              {a.type === 'update_field' && <Settings2 className="h-3 w-3" />}
              {a.type === 'notify_team' && <Bell className="h-3 w-3" />}
              {a.type === 'log_activity' && <FileText className="h-3 w-3" />}
              {actionSummary(a, templates)}
            </span>
          ))}
        </div>
      )}

      {/* Footer */}
      {rule.last_run_at && (
        <p className="text-xs text-muted-foreground border-t pt-2 mt-1">
          Last run {timeAgo(rule.last_run_at)}
          {rule.last_run_sent != null && ` · ${rule.last_run_sent} sent`}
        </p>
      )}
    </div>
  )
}

// ─── Condition editor ─────────────────────────────────────────────────────────

function ConditionEditor({
  conditions, onChange,
}: { conditions: FormCondition[]; onChange: (c: FormCondition[]) => void }) {
  function add() { onChange([...conditions, { type: 'contact_type', value: 'trial' }]) }
  function remove(i: number) { onChange(conditions.filter((_, idx) => idx !== i)) }
  function update(i: number, patch: Partial<FormCondition>) {
    onChange(conditions.map((c, idx) => idx === i ? { ...c, ...patch } : c))
  }

  return (
    <div className="space-y-2">
      {conditions.map((cond, i) => {
        const opt = CONDITION_TYPE_OPTIONS.find((o) => o.value === cond.type)
        return (
          <div key={i} className="flex gap-2 items-start">
            <div className="flex-1 grid grid-cols-2 gap-2">
              {/* Type select */}
              <Select value={cond.type} onValueChange={(v) => {
                // reset value when type changes
                const next = v ?? cond.type
                const defaultVal = next === 'contact_type' ? 'trial'
                  : next === 'membership_status' ? 'active'
                  : next === 'subscription' ? 'any'
                  : next === 'portal_booking_no_show' ? ''
                  : '7'
                update(i, { type: next, value: defaultVal })
              }}>
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CONDITION_TYPE_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value} className="text-xs">{o.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>

              {/* Value input */}
              {opt?.input === 'contact_type_select' && (
                <Select value={cond.value} onValueChange={(v) => update(i, { value: v ?? '' })}>
                  <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {CONTACT_TYPE_VALUES.map((v) => (
                      <SelectItem key={v} value={v} className="text-xs">{v}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
              {opt?.input === 'membership_select' && (
                <Select value={cond.value} onValueChange={(v) => update(i, { value: v ?? '' })}>
                  <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {MEMBERSHIP_STATUS_VALUES.map((v) => (
                      <SelectItem key={v} value={v} className="text-xs">{v}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
              {opt?.input === 'subscription_select' && (
                <Select value={cond.value} onValueChange={(v) => update(i, { value: v ?? '' })}>
                  <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {SUBSCRIPTION_VALUES.map((sv) => (
                      <SelectItem key={sv.value} value={sv.value} className="text-xs">{sv.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
              {opt?.input === 'number' && (
                <Input
                  type="number"
                  min={0}
                  className="h-8 text-xs"
                  value={cond.value}
                  onChange={(e) => update(i, { value: e.target.value })}
                />
              )}
              {opt?.input === 'none' && <div />}
            </div>
            <Button type="button" variant="ghost" size="icon" className="h-8 w-8 shrink-0" onClick={() => remove(i)}>
              <Trash2 className="h-3.5 w-3.5 text-muted-foreground" />
            </Button>
          </div>
        )
      })}
      <Button type="button" variant="outline" size="sm" className="h-7 text-xs" onClick={add}>
        <Plus className="h-3 w-3 mr-1" />Add condition
      </Button>
    </div>
  )
}

// ─── Action editor ────────────────────────────────────────────────────────────

const UPDATE_FIELD_OPTIONS = [
  { value: 'type', label: 'Contact type', values: ['trial', 'student', 'external'] },
  { value: 'membership_status', label: 'Membership status', values: ['guest', 'requested', 'being_checked', 'almost_ready', 'active', 'expired'] },
] as const

function ActionEditor({
  actions, templates, onChange,
}: { actions: FormAction[]; templates: OutreachTemplate[]; onChange: (a: FormAction[]) => void }) {
  function add() { onChange([...actions, { type: 'send_email', templateId: '' }]) }
  function remove(i: number) { onChange(actions.filter((_, idx) => idx !== i)) }
  function update(i: number, patch: Partial<FormAction>) {
    onChange(actions.map((a, idx) => idx === i ? { ...a, ...patch } : a))
  }

  const selectedFieldMeta = (action: FormAction) =>
    UPDATE_FIELD_OPTIONS.find((o) => o.value === action.field)

  return (
    <div className="space-y-3">
      {actions.map((action, i) => (
        <div key={i} className="flex gap-2 items-start">
          <div className="flex-1 space-y-2">
            {/* Row 1: action type + inline secondary for simple types */}
            <div className="grid grid-cols-2 gap-2">
              <Select
                value={action.type}
                onValueChange={(v) => update(i, {
                  type: v ?? 'send_email',
                  templateId: '',
                  field: undefined,
                  fieldValue: undefined,
                  subject: undefined,
                  body: undefined,
                  message: undefined,
                })}
              >
                <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="send_email"    className="text-xs">Send email</SelectItem>
                  <SelectItem value="update_field"  className="text-xs">Update contact field</SelectItem>
                  <SelectItem value="notify_team"   className="text-xs">Notify team (email)</SelectItem>
                  <SelectItem value="log_activity"  className="text-xs">Log activity entry</SelectItem>
                  <SelectItem value="create_alert"  className="text-xs">Create alert (coming soon)</SelectItem>
                </SelectContent>
              </Select>

              {/* Inline secondary for send_email */}
              {action.type === 'send_email' && (
                <Select value={action.templateId} onValueChange={(v) => update(i, { templateId: v ?? '' })}>
                  <SelectTrigger className="h-8 text-xs">
                    <SelectValue placeholder="Select template" />
                  </SelectTrigger>
                  <SelectContent>
                    {templates.length === 0
                      ? <SelectItem value="__none" disabled className="text-xs text-muted-foreground">No templates</SelectItem>
                      : templates.map((t) => (
                          <SelectItem key={t.id} value={t.id} className="text-xs">{t.name}</SelectItem>
                        ))
                    }
                  </SelectContent>
                </Select>
              )}

              {/* create_alert placeholder */}
              {action.type === 'create_alert' && (
                <p className="text-xs text-muted-foreground self-center">Alert presets coming soon</p>
              )}
            </div>

            {/* Row 2+: expanded controls for complex types */}

            {action.type === 'update_field' && (
              <div className="grid grid-cols-2 gap-2">
                <Select
                  value={action.field ?? ''}
                  onValueChange={(v) => update(i, {
                    field: v ?? '',
                    fieldValue: selectedFieldMeta({ ...action, field: v ?? '' })?.values[0] ?? '',
                  })}
                >
                  <SelectTrigger className="h-8 text-xs">
                    <SelectValue placeholder="Field" />
                  </SelectTrigger>
                  <SelectContent>
                    {UPDATE_FIELD_OPTIONS.map((o) => (
                      <SelectItem key={o.value} value={o.value} className="text-xs">{o.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                <Select
                  value={action.fieldValue ?? ''}
                  onValueChange={(v) => update(i, { fieldValue: v ?? '' })}
                >
                  <SelectTrigger className="h-8 text-xs">
                    <SelectValue placeholder="Value" />
                  </SelectTrigger>
                  <SelectContent>
                    {(selectedFieldMeta(action)?.values ?? []).map((v) => (
                      <SelectItem key={v} value={v} className="text-xs">{v}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {action.type === 'notify_team' && (
              <div className="space-y-2">
                <Input
                  className="h-8 text-xs"
                  placeholder="Subject — use {{firstname}}, {{teamName}}…"
                  value={action.subject ?? ''}
                  onChange={(e) => update(i, { subject: e.target.value })}
                />
                <Textarea
                  className="text-xs font-mono resize-none"
                  rows={3}
                  placeholder="Body (markdown) — {{firstname}} attended a session at {{teamName}}."
                  value={action.body ?? ''}
                  onChange={(e) => update(i, { body: e.target.value })}
                />
              </div>
            )}

            {action.type === 'log_activity' && (
              <Input
                className="h-8 text-xs"
                placeholder="Message — use {{firstname}}, {{teamName}}…"
                value={action.message ?? ''}
                onChange={(e) => update(i, { message: e.target.value })}
              />
            )}
          </div>

          <Button type="button" variant="ghost" size="icon" className="h-8 w-8 shrink-0" onClick={() => remove(i)}>
            <Trash2 className="h-3.5 w-3.5 text-muted-foreground" />
          </Button>
        </div>
      ))}
      <Button type="button" variant="outline" size="sm" className="h-7 text-xs" onClick={add}>
        <Plus className="h-3 w-3 mr-1" />Add action
      </Button>
    </div>
  )
}

// ─── RuleDialog ───────────────────────────────────────────────────────────────

const ruleSchema = z.object({
  name:          z.string().min(1, 'Name is required'),
  trigger_type:  z.string().min(1, 'Trigger is required'),
  delay_minutes: z.coerce.number().min(0).optional(),
  active:        z.boolean(),
})

type RuleFormValues = z.infer<typeof ruleSchema>

function RuleDialog({
  open, onOpenChange, teamId, editing, templates, onSaved,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  teamId: string
  editing: AutomationRule | null
  templates: OutreachTemplate[]
  onSaved: () => void
}) {
  const [conditions, setConditions] = useState<FormCondition[]>([])
  const [actions, setActions] = useState<FormAction[]>([])
  const [submitError, setSubmitError] = useState('')

  const { register, handleSubmit, watch, setValue, reset, formState: { errors, isSubmitting } } = useForm<RuleFormValues>({
    resolver: zodResolver(ruleSchema),
    defaultValues: { name: '', trigger_type: 'schedule_daily', delay_minutes: 0, active: true },
  })

  const triggerType = watch('trigger_type')
  const supportsDelay = TRIGGER_OPTIONS.find((t) => t.value === triggerType)?.supportsDelay ?? false

  // Populate form when editing
  useEffect(() => {
    if (!open) return
    if (editing) {
      reset({
        name: editing.name,
        trigger_type: editing.trigger.type,
        delay_minutes: editing.trigger.delayMinutes ?? 0,
        active: editing.active,
      })
      setConditions(editing.conditions.map((c) => ({
        type: c.type,
        value: c.value ?? (c.delay_days != null ? String(c.delay_days) : ''),
      })))
      setActions(editing.actions.map((a) => ({
        type: a.type,
        templateId: a.templateId ?? '',
        field: a.field,
        fieldValue: a.value != null ? String(a.value) : undefined,
        subject: a.subject,
        body: a.body,
        message: a.message,
      })))
    } else {
      reset({ name: '', trigger_type: 'schedule_daily', delay_minutes: 0, active: true })
      setConditions([])
      setActions([])
    }
    setSubmitError('')
  }, [open, editing, reset])

  const onSubmit = async (values: RuleFormValues) => {
    setSubmitError('')
    try {
      const ruleData = {
        name: values.name.trim(),
        active: values.active,
        trigger: {
          type: values.trigger_type,
          ...(supportsDelay && values.delay_minutes && values.delay_minutes > 0
            ? { delayMinutes: values.delay_minutes }
            : {}),
        },
        conditions: conditions.map((c) => {
          const opt = CONDITION_TYPE_OPTIONS.find((o) => o.value === c.type)
          if (opt?.input === 'number') return { type: c.type, value: Number(c.value) }
          if (opt?.input === 'none') return { type: c.type }
          return { type: c.type, value: c.value }
        }),
        actions: actions
          .filter((a) => a.type !== 'create_alert') // skip placeholder
          .map((a) => {
            if (a.type === 'send_email')   return { type: 'send_email',   templateId: a.templateId }
            if (a.type === 'update_field') return { type: 'update_field', field: a.field ?? '', value: a.fieldValue ?? '' }
            if (a.type === 'notify_team')  return { type: 'notify_team',  subject: a.subject ?? '', body: a.body ?? '' }
            if (a.type === 'log_activity') return { type: 'log_activity', message: a.message ?? '' }
            return { type: a.type }
          }),
        updated_at: serverTimestamp(),
      }

      const rulesRef = collection(db, TEAMS_COLLECTION, teamId, 'automation_rules')
      if (editing) {
        await updateDoc(doc(rulesRef, editing.id), ruleData)
      } else {
        await addDoc(rulesRef, { ...ruleData, created_at: serverTimestamp() })
      }

      onSaved()
      onOpenChange(false)
    } catch (err) {
      setSubmitError((err as Error).message || 'Failed to save')
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{editing ? 'Edit automation' : 'New automation'}</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
          {/* Name + active */}
          <div className="flex gap-3 items-end">
            <div className="flex-1">
              <Label htmlFor="rl-name" className="text-xs font-medium">Name</Label>
              <Input id="rl-name" {...register('name')} placeholder="e.g. No-show follow-up" className="mt-1" />
              {errors.name && <p className="text-xs text-destructive mt-1">{errors.name.message}</p>}
            </div>
            <div className="flex items-center gap-2 pb-0.5">
              <Switch
                id="rl-active"
                checked={watch('active')}
                onCheckedChange={(v) => setValue('active', v)}
              />
              <Label htmlFor="rl-active" className="text-xs">Active</Label>
            </div>
          </div>

          <Separator />

          {/* Trigger */}
          <div className="space-y-2">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Trigger</p>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label className="text-xs">When</Label>
                <Select value={triggerType} onValueChange={(v) => setValue('trigger_type', v ?? '')}>
                  <SelectTrigger className="mt-1 h-8 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {TRIGGER_OPTIONS.map((t) => (
                      <SelectItem key={t.value} value={t.value} className="text-xs">{t.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {supportsDelay && (
                <div>
                  <Label className="text-xs">Delay (minutes, optional)</Label>
                  <Input
                    type="number"
                    min={0}
                    className="mt-1 h-8 text-xs"
                    {...register('delay_minutes')}
                    placeholder="0"
                  />
                </div>
              )}
            </div>
          </div>

          <Separator />

          {/* Conditions */}
          <div className="space-y-2">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
              Conditions <span className="normal-case font-normal">(all must match)</span>
            </p>
            <ConditionEditor conditions={conditions} onChange={setConditions} />
          </div>

          <Separator />

          {/* Actions */}
          <div className="space-y-2">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Actions</p>
            <ActionEditor actions={actions} templates={templates} onChange={setActions} />
          </div>

          {submitError && <p className="text-xs text-destructive">{submitError}</p>}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? 'Saving…' : 'Save automation'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

// ─── TemplateDialog ───────────────────────────────────────────────────────────

const tmplSchema = z.object({
  name:     z.string().min(1, 'Required'),
  subject:  z.string().min(1, 'Required'),
  body:     z.string().min(1, 'Required'),
  language: z.string().min(1),
})
type TmplFormValues = z.infer<typeof tmplSchema>

function TemplateDialog({
  open, onOpenChange, teamId,
}: { open: boolean; onOpenChange: (v: boolean) => void; teamId: string }) {
  const qc = useQueryClient()
  const { data: allTemplates = [], isLoading } = useQuery<OutreachTemplate[]>({
    queryKey: ['outreach_templates_all', teamId],
    enabled: open && !!teamId,
    queryFn: async () => {
      const snap = await getDocs(
        query(
          collection(db, TEAMS_COLLECTION, teamId, 'outreach_templates'),
          orderBy('name', 'asc'),
        ),
      )
      return snap.docs.map((d) => ({ id: d.id, ...d.data() }) as OutreachTemplate)
    },
  })

  const [editingTmpl, setEditingTmpl] = useState<OutreachTemplate | null>(null)
  const [formOpen, setFormOpen] = useState(false)
  const [submitErr, setSubmitErr] = useState('')

  const { register, handleSubmit, reset, formState: { errors, isSubmitting } } = useForm<TmplFormValues>({
    resolver: zodResolver(tmplSchema),
    defaultValues: { name: '', subject: '', body: '', language: 'en' },
  })

  useEffect(() => {
    if (!formOpen) { reset({ name: '', subject: '', body: '', language: 'en' }); setEditingTmpl(null); setSubmitErr('') }
    else if (editingTmpl) reset({ name: editingTmpl.name, subject: editingTmpl.subject, body: editingTmpl.body, language: editingTmpl.language })
  }, [formOpen, editingTmpl, reset])

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['outreach_templates_all', teamId] })
    qc.invalidateQueries({ queryKey: ['outreach_templates', teamId] })
  }

  const onSaveTmpl = async (vals: TmplFormValues) => {
    setSubmitErr('')
    try {
      const tmplRef = collection(db, TEAMS_COLLECTION, teamId, 'outreach_templates')
      if (editingTmpl) {
        await updateDoc(doc(tmplRef, editingTmpl.id), { ...vals, active: true })
      } else {
        await addDoc(tmplRef, { ...vals, active: true, created_at: serverTimestamp() })
      }
      invalidate()
      setFormOpen(false)
    } catch (err) { setSubmitErr((err as Error).message) }
  }

  const onDelete = async (tmpl: OutreachTemplate) => {
    await updateDoc(doc(db, TEAMS_COLLECTION, teamId, 'outreach_templates', tmpl.id), { active: false })
    invalidate()
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Email templates</DialogTitle>
        </DialogHeader>

        {!formOpen ? (
          <div className="space-y-3">
            {isLoading && <Skeleton className="h-20 w-full" />}

            {!isLoading && allTemplates.length === 0 && (
              <p className="text-sm text-muted-foreground py-4 text-center">
                No templates yet. Create one to use in automation rules.
              </p>
            )}

            {allTemplates.map((tmpl) => (
              <div key={tmpl.id} className="flex items-start justify-between gap-2 border rounded-lg p-3">
                <div className="min-w-0">
                  <p className="font-medium text-sm truncate">{tmpl.name}</p>
                  <p className="text-xs text-muted-foreground truncate">{tmpl.subject}</p>
                  {!tmpl.active && <Badge variant="secondary" className="text-xs mt-1">Inactive</Badge>}
                </div>
                <div className="flex gap-1 shrink-0">
                  <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => { setEditingTmpl(tmpl); setFormOpen(true) }}>
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                  <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => onDelete(tmpl)}>
                    <Trash2 className="h-3.5 w-3.5 text-muted-foreground" />
                  </Button>
                </div>
              </div>
            ))}

            <Button variant="outline" className="w-full" onClick={() => setFormOpen(true)}>
              <Plus className="h-4 w-4 mr-2" />New template
            </Button>
          </div>
        ) : (
          <form onSubmit={handleSubmit(onSaveTmpl)} className="space-y-4">
            <div>
              <Label className="text-xs">Template name</Label>
              <Input {...register('name')} placeholder="e.g. No-show follow-up" className="mt-1" />
              {errors.name && <p className="text-xs text-destructive mt-1">{errors.name.message}</p>}
            </div>
            <div>
              <Label className="text-xs">Email subject</Label>
              <Input {...register('subject')} placeholder="We missed you!" className="mt-1" />
              {errors.subject && <p className="text-xs text-destructive mt-1">{errors.subject.message}</p>}
            </div>
            <div>
              <Label className="text-xs">
                Body <span className="font-normal text-muted-foreground">(markdown, use {'{{firstname}}'} etc.)</span>
              </Label>
              <Textarea {...register('body')} rows={6} placeholder="Hi {{firstname}},&#10;&#10;We noticed you missed our session…" className="mt-1 font-mono text-xs" />
              {errors.body && <p className="text-xs text-destructive mt-1">{errors.body.message}</p>}
            </div>
            <div className="w-32">
              <Label className="text-xs">Language</Label>
              <select {...register('language')} className="mt-1 w-full h-9 rounded-md border border-input bg-background px-3 py-1 text-sm">
                <option value="en">English</option>
                <option value="de">Deutsch</option>
                <option value="fr">Français</option>
                <option value="it">Italiano</option>
              </select>
            </div>
            {submitErr && <p className="text-xs text-destructive">{submitErr}</p>}
            <div className="flex justify-between pt-1">
              <Button type="button" variant="ghost" onClick={() => setFormOpen(false)}>← Back</Button>
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting ? 'Saving…' : editingTmpl ? 'Save changes' : 'Create template'}
              </Button>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  )
}

// ─── page ────────────────────────────────────────────────────────────────────

export default function AutomationsPage() {
  const { currentTeamId, user } = useAuth()
  const qc = useQueryClient()

  const { data: rules = [], isLoading: rulesLoading } = useRules(currentTeamId)
  const { data: templates = [] } = useTemplates(currentTeamId)

  const [ruleDialogOpen, setRuleDialogOpen] = useState(false)
  const [editingRule, setEditingRule] = useState<AutomationRule | null>(null)
  const [templateDialogOpen, setTemplateDialogOpen] = useState(false)

  const invalidateRules     = () => qc.invalidateQueries({ queryKey: ['automation_rules', currentTeamId] })
  const invalidateTemplates = () => qc.invalidateQueries({ queryKey: ['outreach_templates', currentTeamId] })
  const invalidateAll       = () => { invalidateRules(); invalidateTemplates() }

  async function handleToggle(rule: AutomationRule) {
    if (!currentTeamId) return
    await updateDoc(
      doc(db, TEAMS_COLLECTION, currentTeamId, 'automation_rules', rule.id),
      { active: !rule.active },
    )
    invalidateRules()
  }

  async function handleDelete(rule: AutomationRule) {
    if (!currentTeamId || !confirm(`Delete "${rule.name}"?`)) return
    await deleteDoc(doc(db, TEAMS_COLLECTION, currentTeamId, 'automation_rules', rule.id))
    invalidateRules()
  }

  async function handleRunNow(rule: AutomationRule) {
    if (!currentTeamId) return
    const fn = httpsCallable(functions, 'triggerAutomationRule')
    await fn({ teamId: currentTeamId as string, ruleId: rule.id })
    invalidateRules()
  }

  const activeRules  = rules.filter((r) => r.active)
  const pausedRules  = rules.filter((r) => !r.active)

  return (
    <PlanGate minPlan="club">
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
              <Workflow className="h-6 w-6" />
              Automations
            </h1>
            <p className="text-muted-foreground text-sm mt-1">
              Trigger emails and alerts automatically based on contact activity.
            </p>
          </div>
          <div className="flex gap-2 shrink-0">
            <Button variant="outline" size="sm" onClick={() => setTemplateDialogOpen(true)}>
              <FileText className="h-4 w-4 mr-1.5" />Templates
            </Button>
            <Button size="sm" onClick={() => { setEditingRule(null); setRuleDialogOpen(true) }}>
              <Plus className="h-4 w-4 mr-1.5" />New automation
            </Button>
          </div>
        </div>

        {/* Starter kit banner — shown until all system templates are loaded */}
        {!rulesLoading && currentTeamId && (
          <StarterKitBanner
            teamId={currentTeamId}
            templates={templates}
            rules={rules}
            onSeeded={invalidateAll}
          />
        )}

        {/* Loading */}
        {rulesLoading && (
          <div className="grid gap-4 sm:grid-cols-2">
            {[1, 2, 3].map((i) => <Skeleton key={i} className="h-36 rounded-xl" />)}
          </div>
        )}

        {/* Empty state */}
        {!rulesLoading && rules.length === 0 && (
          <div className="flex flex-col items-center gap-4 py-16 text-center">
            <div className="rounded-full bg-muted p-4">
              <Workflow className="h-8 w-8 text-muted-foreground" />
            </div>
            <div>
              <p className="font-semibold">No automations yet</p>
              <p className="text-muted-foreground text-sm mt-1">
                Create your first automation to automatically send emails or create alerts.
              </p>
            </div>
            <Button onClick={() => { setEditingRule(null); setRuleDialogOpen(true) }}>
              <Plus className="h-4 w-4 mr-2" />New automation
            </Button>
          </div>
        )}

        {/* Active rules */}
        {activeRules.length > 0 && (
          <div className="space-y-3">
            <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Active</h2>
            <div className="grid gap-4 sm:grid-cols-2">
              {activeRules.map((rule) => (
                <RuleCard
                  key={rule.id}
                  rule={rule}
                  templates={templates}
                  onEdit={() => { setEditingRule(rule); setRuleDialogOpen(true) }}
                  onToggle={() => handleToggle(rule)}
                  onRunNow={() => handleRunNow(rule)}
                  onDelete={() => handleDelete(rule)}
                />
              ))}
            </div>
          </div>
        )}

        {/* Paused rules */}
        {pausedRules.length > 0 && (
          <div className="space-y-3">
            <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Paused</h2>
            <div className="grid gap-4 sm:grid-cols-2">
              {pausedRules.map((rule) => (
                <RuleCard
                  key={rule.id}
                  rule={rule}
                  templates={templates}
                  onEdit={() => { setEditingRule(rule); setRuleDialogOpen(true) }}
                  onToggle={() => handleToggle(rule)}
                  onRunNow={() => handleRunNow(rule)}
                  onDelete={() => handleDelete(rule)}
                />
              ))}
            </div>
          </div>
        )}

        {/* Mobile FAB */}
        <button
          className="md:hidden fixed bottom-6 right-6 z-40 flex items-center justify-center w-14 h-14 rounded-full bg-primary text-primary-foreground shadow-lg hover:bg-primary/90 transition-colors"
          onClick={() => { setEditingRule(null); setRuleDialogOpen(true) }}
        >
          <Plus className="h-6 w-6" />
        </button>
      </div>

      {currentTeamId && (
        <>
          <RuleDialog
            open={ruleDialogOpen}
            onOpenChange={setRuleDialogOpen}
            teamId={currentTeamId}
            editing={editingRule}
            templates={templates}
            onSaved={invalidateRules}
          />
          <TemplateDialog
            open={templateDialogOpen}
            onOpenChange={setTemplateDialogOpen}
            teamId={currentTeamId}
          />
        </>
      )}
    </PlanGate>
  )
}
