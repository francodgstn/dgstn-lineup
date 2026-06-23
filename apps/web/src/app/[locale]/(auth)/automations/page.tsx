'use client'

import React, { useState, useEffect } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import {
  collection,
  query,
  where,
  orderBy,
  getDocs,
  getDoc,
  addDoc,
  updateDoc,
  deleteDoc,
  doc,
  serverTimestamp,
  Timestamp,
} from 'firebase/firestore'
import { httpsCallable } from 'firebase/functions'
import { db, functions } from '@/lib/firebase'
import { useAuth } from '@/contexts/AuthContext'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { usePlan } from '@/hooks/usePlan'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Separator } from '@/components/ui/separator'
import {
  Workflow,
  Plus,
  Pencil,
  Play,
  Trash2,
  MoreVertical,
  CirclePause,
  CirclePlay,
  Clock,
  UserPlus,
  CheckCircle,
  XCircle,
  CalendarCheck,
  ShieldCheck,
  CreditCard,
  Mail,
  Bell,
  FileText,
  Settings2,
  Zap,
  RefreshCw,
  Sparkles,
  BookOpen,
  Tag,
  Webhook,
} from 'lucide-react'
import { TEAMS_COLLECTION, SUBSCRIPTION_ROLLUP_STATUSES } from '@linyup/shared'
import { Link } from '@/i18n/navigation'
import { LibraryDialog, installStarterBundle } from './LibraryDialog'
import { WebhookEndpointsDialog, type WebhookEndpoint } from './WebhookEndpointsDialog'
import { useInstalledPlugins } from '@/hooks/useInstalledPlugins'

// ─── types ────────────────────────────────────────────────────────────────────

interface AutomationTrigger {
  type: string
  delayMinutes?: number
  webhook_endpoint_id?: string // inbound_webhook only
}

interface AutomationCondition {
  type: string
  value?: string
  field?: string // field_equals condition
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
  tag?: string // assign_tag / remove_tag
  url?: string // webhook
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
  system_key?: string // present on starter-kit rules — used to prevent duplicate seeding
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
  system_key?: string // present on starter-kit templates — used to prevent duplicate seeding
}

// Form shapes
interface FormCondition {
  type: string
  value: string
  condField?: string // field_equals — the field name
}
interface FormAction {
  type: string
  templateId: string // send_email
  field?: string // update_field — which contact field
  fieldValue?: string // update_field — the new value
  subject?: string // notify_team — email subject
  body?: string // notify_team — email body (markdown)
  message?: string // log_activity — log message
  tag?: string // assign_tag / remove_tag
  url?: string // webhook
}

// ─── constants ────────────────────────────────────────────────────────────────

const TRIGGER_OPTIONS = [
  { value: 'schedule_daily', label: 'Daily scan (scheduled)', icon: Clock, supportsDelay: false },
  { value: 'contact_created', label: 'Contact created', icon: UserPlus, supportsDelay: true },
  {
    value: 'booking_confirmed',
    label: 'Booking confirmed',
    icon: CheckCircle,
    supportsDelay: true,
  },
  { value: 'booking_no_show', label: 'Booking marked no-show', icon: XCircle, supportsDelay: true },
  { value: 'booking_cancelled', label: 'Booking cancelled', icon: XCircle, supportsDelay: true },
  {
    value: 'affiliation_changed',
    label: 'Affiliation changed',
    icon: ShieldCheck,
    supportsDelay: true,
  },
  {
    value: 'subscription_changed',
    label: 'Subscription changed',
    icon: CreditCard,
    supportsDelay: true,
  },
  { value: 'session_ended', label: 'Session ended', icon: CalendarCheck, supportsDelay: true },
  { value: 'inbound_webhook', label: 'Inbound webhook', icon: Webhook, supportsDelay: false },
  { value: 'manual', label: 'Manual only', icon: Play, supportsDelay: false },
]

const CONDITION_TYPE_OPTIONS = [
  { value: 'acquisition_stage', label: 'Acquisition stage', input: 'acquisition_stage_select' },
  { value: 'has_affiliation', label: 'Has an active affiliation', input: 'none' },
  { value: 'affiliation_type', label: 'Affiliation type', input: 'affiliation_type_select' },
  { value: 'subscription', label: 'Subscription', input: 'subscription_select' },
  { value: 'sessions_attended_min', label: 'Sessions attended ≥', input: 'number' },
  { value: 'sessions_attended_max', label: 'Sessions attended ≤', input: 'number' },
  { value: 'sessions_attended_exactly', label: 'Sessions attended =', input: 'number' },
  { value: 'inactivity_days', label: 'Inactive for at least (days)', input: 'number' },
  { value: 'inactivity_days_max', label: 'Inactive for at most (days)', input: 'number' },
  { value: 'subscription_expires_in', label: 'Subscription expires in ≤ (days)', input: 'number' },
  { value: 'days_since_created', label: 'Days since created ≥', input: 'number' },
  { value: 'tag', label: 'Has tag', input: 'text' },
  { value: 'field_equals', label: 'Field equals', input: 'field_equals' },
  { value: 'birthday_today', label: 'Birthday today', input: 'none' },
  { value: 'bio_link_booking_no_show', label: 'Bio-link booking no-show', input: 'none' },
  {
    value: 'subscription_status',
    label: 'Subscription billing status',
    input: 'subscription_status_select',
  },
]

const SUBSCRIPTION_STATUS_VALUES = SUBSCRIPTION_ROLLUP_STATUSES.map((v) => ({
  value: v,
  label:
    v === 'active'
      ? 'Active'
      : v === 'trialing'
        ? 'Trialing'
        : v === 'past_due'
          ? 'Past due'
          : v === 'paused'
            ? 'Paused (frozen)'
            : v === 'cancelled'
              ? 'Cancelled'
              : 'No subscription',
}))

const ACQUISITION_STAGE_VALUES = [
  { value: 'trial_booked', label: 'Trial booked' },
  { value: 'trial_attended', label: 'Trial attended' },
  { value: 'joined', label: 'Joined' },
]
const SUBSCRIPTION_VALUES = [
  { value: 'any', label: 'Any subscription' },
  { value: 'none', label: 'No subscription' },
]

const ACTION_TYPE_LABELS: Record<string, string> = {
  send_email: 'Send email',
  update_field: 'Update contact field',
  assign_tag: 'Add tag to contact',
  remove_tag: 'Remove tag from contact',
  notify_team: 'Notify team (email)',
  log_activity: 'Log activity entry',
  webhook: 'Webhook (POST)',
  create_alert: 'Create alert (coming soon)',
}

// ─── helpers ──────────────────────────────────────────────────────────────────

function triggerLabel(type: string): string {
  return TRIGGER_OPTIONS.find((t) => t.value === type)?.label ?? type
}

function conditionSummary(c: AutomationCondition): string {
  const opt = CONDITION_TYPE_OPTIONS.find((o) => o.value === c.type)
  if (!opt) return c.type
  if (opt.input === 'none') return opt.label
  if (opt.input === 'number') return `${opt.label} ${c.value ?? ''}`
  if (c.type === 'field_equals') return `${c.field ?? '?'} = ${c.value ?? ''}`
  return `${opt.label}: ${c.value ?? ''}`
}

function actionSummary(
  a: AutomationAction,
  templates: OutreachTemplate[],
  pluginActionLabels?: Record<string, string>
): string {
  if (a.type === 'send_email') {
    const tmpl = templates.find((t) => t.id === (a.templateId ?? ''))
    return `Email: ${tmpl?.name ?? a.templateId ?? '—'}`
  }
  if (a.type === 'create_alert') return 'Create alert'
  if (a.type === 'update_field') return `Set ${a.field ?? '—'} → ${String(a.value ?? '—')}`
  if (a.type === 'notify_team') return `Notify team: ${a.subject ?? ''}`
  if (a.type === 'log_activity') return `Log: ${a.message ?? ''}`
  if (a.type === 'assign_tag') return `Add tag: ${a.tag ?? '—'}`
  if (a.type === 'remove_tag') return `Remove tag: ${a.tag ?? '—'}`
  if (a.type === 'webhook') return `Webhook: ${a.url ?? '—'}`
  // Plugin-contributed actions — use the label from the manifest if available
  if (a.type.startsWith('plugin:')) {
    return pluginActionLabels?.[a.type] ?? a.type
  }
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
    if (data.template_id)
      actions.push({ type: 'send_email', templateId: data.template_id as string })
    if (data.alert_preset_id)
      actions.push({ type: 'create_alert', presetId: data.alert_preset_id as string })
  }
  const trigger =
    data.trigger && typeof data.trigger === 'object'
      ? (data.trigger as AutomationTrigger)
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
        query(collection(db, TEAMS_COLLECTION, teamId, 'automation_rules'), orderBy('name', 'asc'))
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
          orderBy('name', 'asc')
        )
      )
      return snap.docs.map((d) => ({ ...d.data(), id: d.id }) as OutreachTemplate)
    },
  })
}

// ─── RuleCard ─────────────────────────────────────────────────────────────────

function TriggerIcon({ type, className }: { type: string; className?: string }) {
  const opt = TRIGGER_OPTIONS.find((t) => t.value === type)
  const Icon = opt?.icon ?? Zap
  return <Icon className={className ?? 'h-4 w-4'} />
}

function RuleCard({
  rule,
  templates,
  onEdit,
  onToggle,
  onRunNow,
  onDelete,
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
    try {
      await onRunNow()
    } finally {
      setRunning(false)
    }
  }

  const trigger = rule.trigger ?? { type: 'schedule_daily' }

  return (
    <div
      className={`rounded-xl border bg-card p-4 space-y-3 transition-opacity ${rule.active ? '' : 'opacity-60'}`}
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <TriggerIcon
            type={trigger.type}
            className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5"
          />
          <h3 className="font-semibold text-sm leading-tight truncate">
            {rule.name || '(unnamed)'}
          </h3>
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
                <Pencil className="h-3.5 w-3.5 mr-2" />
                Edit
              </DropdownMenuItem>
              <DropdownMenuItem onClick={onToggle}>
                {rule.active ? (
                  <>
                    <CirclePause className="h-3.5 w-3.5 mr-2" />
                    Pause
                  </>
                ) : (
                  <>
                    <CirclePlay className="h-3.5 w-3.5 mr-2" />
                    Activate
                  </>
                )}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={handleRunNow} disabled={running}>
                <Play className="h-3.5 w-3.5 mr-2" />
                {running ? 'Running…' : 'Run now'}
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={onDelete}
                className="text-destructive focus:text-destructive"
              >
                <Trash2 className="h-3.5 w-3.5 mr-2" />
                Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* Trigger line */}
      <div className="text-xs text-muted-foreground">
        <span className="font-medium text-foreground">{triggerLabel(trigger.type)}</span>
        {trigger.delayMinutes && trigger.delayMinutes > 0 && (
          <span className="ml-1">
            ·{' '}
            {trigger.delayMinutes < 60
              ? `${trigger.delayMinutes}m delay`
              : `${trigger.delayMinutes / 60}h delay`}
          </span>
        )}
      </div>

      {/* Condition chips */}
      {rule.conditions.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {rule.conditions.map((c, i) => (
            <span
              key={i}
              className="inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium text-muted-foreground bg-muted"
            >
              {conditionSummary(c)}
            </span>
          ))}
        </div>
      )}

      {/* Action line */}
      {rule.actions.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {rule.actions.map((a, i) => (
            <span
              key={i}
              className="inline-flex items-center gap-1.5 text-xs font-medium text-primary"
            >
              {a.type === 'send_email' && <Mail className="h-3 w-3" />}
              {a.type === 'create_alert' && <Bell className="h-3 w-3" />}
              {a.type === 'update_field' && <Settings2 className="h-3 w-3" />}
              {a.type === 'notify_team' && <Bell className="h-3 w-3" />}
              {a.type === 'log_activity' && <FileText className="h-3 w-3" />}
              {a.type === 'assign_tag' && <Tag className="h-3 w-3" />}
              {a.type === 'remove_tag' && <Tag className="h-3 w-3" />}
              {a.type === 'webhook' && <Webhook className="h-3 w-3" />}
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
  conditions,
  onChange,
}: {
  conditions: FormCondition[]
  onChange: (c: FormCondition[]) => void
}) {
  function add() {
    onChange([...conditions, { type: 'acquisition_stage', value: 'trial_booked' }])
  }
  function remove(i: number) {
    onChange(conditions.filter((_, idx) => idx !== i))
  }
  function update(i: number, patch: Partial<FormCondition>) {
    onChange(conditions.map((c, idx) => (idx === i ? { ...c, ...patch } : c)))
  }

  return (
    <div className="space-y-2">
      {conditions.map((cond, i) => {
        const opt = CONDITION_TYPE_OPTIONS.find((o) => o.value === cond.type)
        const isFieldEquals = cond.type === 'field_equals'
        return (
          <div key={i} className="flex gap-2 items-start">
            <div className="flex-1 space-y-1">
              {/* Row 1: type selector + inline value (all types except field_equals) */}
              <div className={`grid gap-2 ${isFieldEquals ? 'grid-cols-1' : 'grid-cols-2'}`}>
                {/* Type select */}
                <Select
                  value={cond.type}
                  onValueChange={(v: string | null) => {
                    const next = v ?? cond.type
                    const defaultVal =
                      next === 'acquisition_stage'
                        ? 'trial_booked'
                        : next === 'subscription'
                          ? 'any'
                          : next === 'subscription_status'
                            ? 'active'
                            : next === 'bio_link_booking_no_show' || next === 'birthday_today'
                              ? ''
                              : next === 'has_affiliation'
                                ? ''
                                : next === 'tag' || next === 'field_equals' || next === 'affiliation_type'
                                  ? ''
                                  : '7'
                    update(i, { type: next, value: defaultVal, condField: undefined })
                  }}
                >
                  <SelectTrigger className="h-8 text-xs">
                    <span className="flex flex-1 text-left text-xs truncate">
                      {CONDITION_TYPE_OPTIONS.find((o) => o.value === cond.type)?.label ??
                        cond.type}
                    </span>
                  </SelectTrigger>
                  <SelectContent>
                    {CONDITION_TYPE_OPTIONS.map((o) => (
                      <SelectItem key={o.value} value={o.value} className="text-xs">
                        {o.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                {/* Inline value input (all types except field_equals which gets its own row) */}
                {!isFieldEquals && (
                  <>
                    {opt?.input === 'acquisition_stage_select' && (
                      <Select
                        value={cond.value}
                        onValueChange={(v) => update(i, { value: v ?? '' })}
                      >
                        <SelectTrigger className="h-8 text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {ACQUISITION_STAGE_VALUES.map((s) => (
                            <SelectItem key={s.value} value={s.value} className="text-xs">
                              {s.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                    {opt?.input === 'affiliation_type_select' && (
                      <Input
                        className="h-8 text-xs"
                        placeholder="type key (e.g. club_membership)"
                        value={cond.value}
                        onChange={(e) => update(i, { value: e.target.value })}
                      />
                    )}
                    {opt?.input === 'subscription_select' && (
                      <Select
                        value={cond.value}
                        onValueChange={(v) => update(i, { value: v ?? '' })}
                      >
                        <SelectTrigger className="h-8 text-xs">
                          <span className="flex flex-1 text-left text-xs truncate">
                            {SUBSCRIPTION_VALUES.find((sv) => sv.value === cond.value)?.label ??
                              cond.value}
                          </span>
                        </SelectTrigger>
                        <SelectContent>
                          {SUBSCRIPTION_VALUES.map((sv) => (
                            <SelectItem key={sv.value} value={sv.value} className="text-xs">
                              {sv.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                    {opt?.input === 'subscription_status_select' && (
                      <Select
                        value={cond.value}
                        onValueChange={(v) => update(i, { value: v ?? 'active' })}
                      >
                        <SelectTrigger className="h-8 text-xs">
                          <span className="flex flex-1 text-left text-xs truncate">
                            {SUBSCRIPTION_STATUS_VALUES.find((sv) => sv.value === cond.value)?.label ??
                              cond.value}
                          </span>
                        </SelectTrigger>
                        <SelectContent>
                          {SUBSCRIPTION_STATUS_VALUES.map((sv) => (
                            <SelectItem key={sv.value} value={sv.value} className="text-xs">
                              {sv.label}
                            </SelectItem>
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
                    {opt?.input === 'text' && (
                      <Input
                        className="h-8 text-xs"
                        placeholder="tag name"
                        value={cond.value}
                        onChange={(e) => update(i, { value: e.target.value })}
                      />
                    )}
                    {opt?.input === 'none' && <div />}
                  </>
                )}
              </div>

              {/* Row 2: field_equals — field name + value on separate row */}
              {isFieldEquals && (
                <div className="grid grid-cols-2 gap-2">
                  <Input
                    className="h-8 text-xs"
                    placeholder="Field (e.g. type)"
                    value={cond.condField ?? ''}
                    onChange={(e) => update(i, { condField: e.target.value })}
                  />
                  <Input
                    className="h-8 text-xs"
                    placeholder="Value"
                    value={cond.value}
                    onChange={(e) => update(i, { value: e.target.value })}
                  />
                </div>
              )}
            </div>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-8 w-8 shrink-0"
              onClick={() => remove(i)}
            >
              <Trash2 className="h-3.5 w-3.5 text-muted-foreground" />
            </Button>
          </div>
        )
      })}
      <Button type="button" variant="outline" size="sm" className="h-7 text-xs" onClick={add}>
        <Plus className="h-3 w-3 mr-1" />
        Add condition
      </Button>
    </div>
  )
}

// ─── Action editor ────────────────────────────────────────────────────────────

const UPDATE_FIELD_OPTIONS = [
  {
    value: 'acquisition_stage',
    label: 'Acquisition stage',
    values: ['trial_booked', 'trial_attended', 'joined'],
  },
] as const

function ActionEditor({
  actions,
  templates,
  onChange,
  actionTypeLabels: labelOverrides,
}: {
  actions: FormAction[]
  templates: OutreachTemplate[]
  onChange: (a: FormAction[]) => void
  actionTypeLabels?: Record<string, string>
}) {
  const resolvedActionLabels = labelOverrides ?? ACTION_TYPE_LABELS
  function add() {
    onChange([...actions, { type: 'send_email', templateId: '' }])
  }
  function remove(i: number) {
    onChange(actions.filter((_, idx) => idx !== i))
  }
  function update(i: number, patch: Partial<FormAction>) {
    onChange(actions.map((a, idx) => (idx === i ? { ...a, ...patch } : a)))
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
                onValueChange={(v) =>
                  update(i, {
                    type: v ?? 'send_email',
                    templateId: '',
                    field: undefined,
                    fieldValue: undefined,
                    subject: undefined,
                    body: undefined,
                    message: undefined,
                    tag: undefined,
                    url: undefined,
                  })
                }
              >
                <SelectTrigger className="h-8 text-xs">
                  <span className="flex flex-1 text-left text-xs truncate">
                    {resolvedActionLabels[action.type] ?? action.type}
                  </span>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="send_email" className="text-xs">
                    Send email
                  </SelectItem>
                  <SelectItem value="update_field" className="text-xs">
                    Update contact field
                  </SelectItem>
                  <SelectItem value="assign_tag" className="text-xs">
                    Add tag to contact
                  </SelectItem>
                  <SelectItem value="remove_tag" className="text-xs">
                    Remove tag from contact
                  </SelectItem>
                  <SelectItem value="notify_team" className="text-xs">
                    Notify team (email)
                  </SelectItem>
                  <SelectItem value="log_activity" className="text-xs">
                    Log activity entry
                  </SelectItem>
                  <SelectItem value="webhook" className="text-xs">
                    Webhook (POST)
                  </SelectItem>
                  <SelectItem value="create_alert" className="text-xs">
                    Create alert (coming soon)
                  </SelectItem>
                </SelectContent>
              </Select>

              {/* Inline secondary for send_email */}
              {action.type === 'send_email' && (
                <Select
                  value={action.templateId}
                  onValueChange={(v) => update(i, { templateId: v ?? '' })}
                >
                  <SelectTrigger className="h-8 text-xs">
                    <span className="flex flex-1 text-left text-xs truncate">
                      {templates.find((t) => t.id === action.templateId)?.name ?? (
                        <span className="text-muted-foreground">Select template</span>
                      )}
                    </span>
                  </SelectTrigger>
                  <SelectContent>
                    {templates.length === 0 ? (
                      <SelectItem value="__none" disabled className="text-xs text-muted-foreground">
                        No templates
                      </SelectItem>
                    ) : (
                      templates.map((t) => (
                        <SelectItem key={t.id} value={t.id} className="text-xs">
                          {t.name}
                        </SelectItem>
                      ))
                    )}
                  </SelectContent>
                </Select>
              )}

              {/* create_alert placeholder */}
              {action.type === 'create_alert' && (
                <p className="text-xs text-muted-foreground self-center">
                  Alert presets coming soon
                </p>
              )}
            </div>

            {/* Row 2+: expanded controls for complex types */}

            {action.type === 'update_field' && (
              <div className="grid grid-cols-2 gap-2">
                <Select
                  value={action.field ?? ''}
                  onValueChange={(v) =>
                    update(i, {
                      field: v ?? '',
                      fieldValue: selectedFieldMeta({ ...action, field: v ?? '' })?.values[0] ?? '',
                    })
                  }
                >
                  <SelectTrigger className="h-8 text-xs">
                    <span className="flex flex-1 text-left text-xs truncate">
                      {UPDATE_FIELD_OPTIONS.find((o) => o.value === action.field)?.label ?? (
                        <span className="text-muted-foreground">Field</span>
                      )}
                    </span>
                  </SelectTrigger>
                  <SelectContent>
                    {UPDATE_FIELD_OPTIONS.map((o) => (
                      <SelectItem key={o.value} value={o.value} className="text-xs">
                        {o.label}
                      </SelectItem>
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
                      <SelectItem key={v} value={v} className="text-xs">
                        {v}
                      </SelectItem>
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

            {(action.type === 'assign_tag' || action.type === 'remove_tag') && (
              <Input
                className="h-8 text-xs"
                placeholder="Tag name (e.g. vip, at-risk, converted)"
                value={action.tag ?? ''}
                onChange={(e) => update(i, { tag: e.target.value })}
              />
            )}

            {action.type === 'webhook' && (
              <Input
                className="h-8 text-xs"
                placeholder="https://hooks.zapier.com/…"
                value={action.url ?? ''}
                onChange={(e) => update(i, { url: e.target.value })}
              />
            )}
          </div>

          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-8 w-8 shrink-0"
            onClick={() => remove(i)}
          >
            <Trash2 className="h-3.5 w-3.5 text-muted-foreground" />
          </Button>
        </div>
      ))}
      <Button type="button" variant="outline" size="sm" className="h-7 text-xs" onClick={add}>
        <Plus className="h-3 w-3 mr-1" />
        Add action
      </Button>
    </div>
  )
}

// ─── RuleDialog ───────────────────────────────────────────────────────────────

const ruleSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  trigger_type: z.string().min(1, 'Trigger is required'),
  delay_minutes: z.coerce.number().min(0).optional(),
  active: z.boolean(),
})

type RuleFormValues = z.infer<typeof ruleSchema>

function RuleDialog({
  open,
  onOpenChange,
  teamId,
  editing,
  templates,
  webhookEndpoints,
  onSaved,
  triggerOptions: triggerOptionsProp,
  actionTypeLabels: actionTypeLabelsProp,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  teamId: string
  editing: AutomationRule | null
  templates: OutreachTemplate[]
  webhookEndpoints: WebhookEndpoint[]
  onSaved: () => void
  triggerOptions?: Array<{
    value: string
    label: string
    icon: React.ElementType
    supportsDelay: boolean
  }>
  actionTypeLabels?: Record<string, string>
}) {
  const resolvedTriggerOptions = triggerOptionsProp ?? TRIGGER_OPTIONS
  const [conditions, setConditions] = useState<FormCondition[]>([])
  const [actions, setActions] = useState<FormAction[]>([])
  const [webhookEndpointId, setWebhookEndpointId] = useState('')
  const [submitError, setSubmitError] = useState('')

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<RuleFormValues>({
    resolver: zodResolver(ruleSchema),
    defaultValues: { name: '', trigger_type: 'schedule_daily', delay_minutes: 0, active: true },
  })

  const triggerType = watch('trigger_type')
  const supportsDelay =
    resolvedTriggerOptions.find((t) => t.value === triggerType)?.supportsDelay ?? false

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
      setConditions(
        editing.conditions.map((c) => ({
          type: c.type,
          value: c.value ?? (c.delay_days != null ? String(c.delay_days) : ''),
          condField: (c as { field?: string }).field,
        }))
      )
      setActions(
        editing.actions.map((a) => ({
          type: a.type,
          templateId: a.templateId ?? '',
          field: a.field,
          fieldValue: a.value != null ? String(a.value) : undefined,
          subject: a.subject,
          body: a.body,
          message: a.message,
          tag: (a as { tag?: string }).tag,
          url: (a as { url?: string }).url,
        }))
      )
      setWebhookEndpointId(editing.trigger.webhook_endpoint_id ?? '')
    } else {
      reset({ name: '', trigger_type: 'schedule_daily', delay_minutes: 0, active: true })
      setConditions([])
      setActions([])
      setWebhookEndpointId('')
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
          ...(values.trigger_type === 'inbound_webhook' && webhookEndpointId
            ? { webhook_endpoint_id: webhookEndpointId }
            : {}),
        },
        conditions: conditions.map((c) => {
          const opt = CONDITION_TYPE_OPTIONS.find((o) => o.value === c.type)
          if (opt?.input === 'number') return { type: c.type, value: Number(c.value) }
          if (opt?.input === 'none') return { type: c.type }
          if (c.type === 'field_equals')
            return { type: 'field_equals', field: c.condField ?? '', value: c.value }
          return { type: c.type, value: c.value }
        }),
        actions: actions
          .filter((a) => a.type !== 'create_alert') // skip placeholder
          .map((a) => {
            if (a.type === 'send_email') return { type: 'send_email', templateId: a.templateId }
            if (a.type === 'update_field')
              return { type: 'update_field', field: a.field ?? '', value: a.fieldValue ?? '' }
            if (a.type === 'notify_team')
              return { type: 'notify_team', subject: a.subject ?? '', body: a.body ?? '' }
            if (a.type === 'log_activity') return { type: 'log_activity', message: a.message ?? '' }
            if (a.type === 'assign_tag') return { type: 'assign_tag', tag: a.tag ?? '' }
            if (a.type === 'remove_tag') return { type: 'remove_tag', tag: a.tag ?? '' }
            if (a.type === 'webhook') return { type: 'webhook', url: a.url ?? '' }
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
      <DialogContent className="sm:max-w-[680px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{editing ? 'Edit automation' : 'New automation'}</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
          {/* Name + active */}
          <div className="flex gap-3 items-end">
            <div className="flex-1">
              <Label htmlFor="rl-name" className="text-xs font-medium">
                Name
              </Label>
              <Input
                id="rl-name"
                {...register('name')}
                placeholder="e.g. No-show follow-up"
                className="mt-1"
              />
              {errors.name && (
                <p className="text-xs text-destructive mt-1">{errors.name.message}</p>
              )}
            </div>
            <div className="flex items-center gap-2 pb-0.5">
              <Switch
                id="rl-active"
                checked={watch('active')}
                onCheckedChange={(v) => setValue('active', v)}
              />
              <Label htmlFor="rl-active" className="text-xs">
                Active
              </Label>
            </div>
          </div>

          <Separator />

          {/* Trigger */}
          <div className="space-y-2">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
              Trigger
            </p>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label className="text-xs">When</Label>
                <Select
                  value={triggerType}
                  onValueChange={(v) => setValue('trigger_type', v ?? '')}
                >
                  <SelectTrigger className="mt-1 h-8 text-xs">
                    <span className="flex flex-1 text-left text-xs truncate">
                      {resolvedTriggerOptions.find((t) => t.value === triggerType)?.label ??
                        triggerType}
                    </span>
                  </SelectTrigger>
                  <SelectContent>
                    {resolvedTriggerOptions.map((t) => (
                      <SelectItem key={t.value} value={t.value} className="text-xs">
                        {t.label}
                      </SelectItem>
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

            {/* Inbound webhook — endpoint selector */}
            {triggerType === 'inbound_webhook' && (
              <div>
                <Label className="text-xs">Webhook endpoint</Label>
                {webhookEndpoints.length === 0 ? (
                  <p className="mt-1 text-xs text-muted-foreground">
                    No endpoints yet — create one in the Webhooks dialog first.
                  </p>
                ) : (
                  <Select
                    value={webhookEndpointId}
                    onValueChange={(v) => setWebhookEndpointId(v ?? '')}
                  >
                    <SelectTrigger className="mt-1 h-8 text-xs">
                      <span className="flex flex-1 text-left text-xs truncate">
                        {webhookEndpoints.find((ep) => ep.id === webhookEndpointId)?.name ?? (
                          <span className="text-muted-foreground">Select endpoint</span>
                        )}
                      </span>
                    </SelectTrigger>
                    <SelectContent>
                      {webhookEndpoints.map((ep) => (
                        <SelectItem key={ep.id} value={ep.id} className="text-xs">
                          {ep.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </div>
            )}
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
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
              Actions
            </p>
            <ActionEditor
              actions={actions}
              templates={templates}
              onChange={setActions}
              actionTypeLabels={actionTypeLabelsProp}
            />
          </div>

          {submitError && <p className="text-xs text-destructive">{submitError}</p>}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? 'Saving…' : 'Save automation'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

// ─── PlaceholderPanel ────────────────────────────────────────────────────────

const PLACEHOLDER_GROUPS = [
  {
    label: 'Contact',
    items: [
      { key: 'firstname', hint: 'First name' },
      { key: 'lastname', hint: 'Last name' },
      { key: 'acquisition_stage', hint: 'Trial booked / Trial attended / Joined' },
      { key: 'affiliation_summary', hint: 'Has active affiliation (true/false)' },
      { key: 'sessions_count', hint: 'Sessions attended' },
    ],
  },
  {
    label: 'Team',
    items: [
      { key: 'teamName', hint: 'Team name' },
      { key: 'bookingUrl', hint: 'Trial booking page' },
      { key: 'membershipUrl', hint: 'Membership signup' },
      { key: 'bioLinkUrl', hint: 'Bio-link page' },
      { key: 'websiteUrl', hint: 'Website (if set)' },
      { key: 'reviewUrl', hint: 'Review page (if set)' },
    ],
  },
  {
    label: 'Dates',
    items: [
      { key: 'date', hint: 'Today' },
      { key: 'date+7', hint: '+7 days (any N)' },
      { key: 'date-7', hint: '-7 days (any N)' },
    ],
  },
]

function PlaceholderPanel({ customPlaceholders }: { customPlaceholders: Record<string, string> }) {
  const [copied, setCopied] = useState<string>('')

  const copyToken = (key: string) => {
    const token = `{{${key}}}`
    navigator.clipboard.writeText(token).catch(() => {})
    setCopied(key)
    setTimeout(() => setCopied(''), 2000)
  }

  return (
    <div className="w-56 shrink-0 border-l overflow-y-auto px-3 py-4 space-y-4">
      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
        Placeholders
      </p>
      <p className="text-xs text-muted-foreground -mt-2">Click to copy</p>

      {PLACEHOLDER_GROUPS.map((group) => (
        <div key={group.label}>
          <p className="text-xs font-medium text-foreground mb-1">{group.label}</p>
          <div className="space-y-0.5">
            {group.items.map((item) => (
              <button
                key={item.key}
                type="button"
                onClick={() => copyToken(item.key)}
                className="w-full text-left px-2 py-1 rounded hover:bg-accent transition-colors group"
              >
                <span className="font-mono text-xs text-primary group-hover:underline">
                  {copied === item.key ? '✓ Copied' : `{{${item.key}}}`}
                </span>
                <span className="block text-xs text-muted-foreground leading-tight">
                  {item.hint}
                </span>
              </button>
            ))}
          </div>
        </div>
      ))}

      {/* Custom variables */}
      <div>
        <p className="text-xs font-medium text-foreground mb-1">Custom</p>
        {Object.keys(customPlaceholders).length === 0 ? (
          <div className="space-y-1">
            <p className="text-xs text-muted-foreground italic">No custom variables yet.</p>
            <Link
              href="/team/settings"
              className="text-xs text-primary hover:underline"
              onClick={() => {}}
            >
              Manage in Settings → Outreach
            </Link>
          </div>
        ) : (
          <div className="space-y-0.5">
            {Object.entries(customPlaceholders).map(([key, value]) => (
              <button
                key={key}
                type="button"
                onClick={() => copyToken(key)}
                className="w-full text-left px-2 py-1 rounded hover:bg-accent transition-colors group"
              >
                <span className="font-mono text-xs text-primary group-hover:underline">
                  {copied === key ? '✓ Copied' : `{{${key}}}`}
                </span>
                <span className="block text-xs text-muted-foreground leading-tight truncate">
                  {value}
                </span>
              </button>
            ))}
            <Link
              href="/team/settings"
              className="block text-xs text-muted-foreground hover:underline mt-1 px-2"
            >
              Manage in Settings → Outreach
            </Link>
          </div>
        )}
      </div>
    </div>
  )
}

// ─── TemplateDialog ───────────────────────────────────────────────────────────

const tmplSchema = z.object({
  name: z.string().min(1, 'Required'),
  subject: z.string().min(1, 'Required'),
  body: z.string().min(1, 'Required'),
  language: z.string().min(1),
})
type TmplFormValues = z.infer<typeof tmplSchema>

function TemplateDialog({
  open,
  onOpenChange,
  teamId,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  teamId: string
}) {
  const qc = useQueryClient()
  const { data: allTemplates = [], isLoading } = useQuery<OutreachTemplate[]>({
    queryKey: ['outreach_templates_all', teamId],
    enabled: open && !!teamId,
    queryFn: async () => {
      const snap = await getDocs(
        query(
          collection(db, TEAMS_COLLECTION, teamId, 'outreach_templates'),
          orderBy('name', 'asc')
        )
      )
      return snap.docs.map((d) => ({ ...d.data(), id: d.id }) as OutreachTemplate)
    },
  })

  // Fetch team data for custom placeholders
  const { data: teamDoc } = useQuery({
    queryKey: ['team_for_templates', teamId],
    enabled: open && !!teamId,
    staleTime: 60_000,
    queryFn: async () => {
      const snap = await getDoc(doc(db, TEAMS_COLLECTION, teamId))
      return snap.data() ?? {}
    },
  })
  const customPlaceholders = (teamDoc?.outreach_placeholders as Record<string, string>) ?? {}

  const [editingTmpl, setEditingTmpl] = useState<OutreachTemplate | null>(null)
  const [formOpen, setFormOpen] = useState(false)
  const [submitErr, setSubmitErr] = useState('')

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<TmplFormValues>({
    resolver: zodResolver(tmplSchema),
    defaultValues: { name: '', subject: '', body: '', language: 'en' },
  })

  useEffect(() => {
    if (!formOpen) {
      reset({ name: '', subject: '', body: '', language: 'en' })
      setEditingTmpl(null)
      setSubmitErr('')
    } else if (editingTmpl)
      reset({
        name: editingTmpl.name,
        subject: editingTmpl.subject,
        body: editingTmpl.body,
        language: editingTmpl.language,
      })
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
    } catch (err) {
      setSubmitErr((err as Error).message)
    }
  }

  const onDelete = async (tmpl: OutreachTemplate) => {
    await updateDoc(doc(db, TEAMS_COLLECTION, teamId, 'outreach_templates', tmpl.id), {
      active: false,
    })
    invalidate()
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className={`sm:max-w-[900px] max-h-[85vh] flex flex-col p-0 gap-0 overflow-hidden`}
      >
        <DialogHeader className="px-6 pt-5 pb-4 shrink-0 border-b">
          <DialogTitle>Email templates</DialogTitle>
        </DialogHeader>

        {!formOpen ? (
          /* ── List view — full width ── */
          <div className="flex-1 overflow-y-auto px-6 py-4 space-y-3">
            {isLoading && <Skeleton className="h-20 w-full" />}

            {!isLoading && allTemplates.length === 0 && (
              <p className="text-sm text-muted-foreground py-4 text-center">
                No templates yet. Create one to use in automation rules.
              </p>
            )}

            {allTemplates.map((tmpl) => (
              <div
                key={tmpl.id}
                className="flex items-start justify-between gap-2 border rounded-lg p-3"
              >
                <div className="min-w-0">
                  <p className="font-medium text-sm truncate">{tmpl.name}</p>
                  <p className="text-xs text-muted-foreground truncate">{tmpl.subject}</p>
                  {!tmpl.active && (
                    <Badge variant="secondary" className="text-xs mt-1">
                      Inactive
                    </Badge>
                  )}
                </div>
                <div className="flex gap-1 shrink-0">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7"
                    onClick={() => {
                      setEditingTmpl(tmpl)
                      setFormOpen(true)
                    }}
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7"
                    onClick={() => onDelete(tmpl)}
                  >
                    <Trash2 className="h-3.5 w-3.5 text-muted-foreground" />
                  </Button>
                </div>
              </div>
            ))}

            <Button variant="outline" className="w-full" onClick={() => setFormOpen(true)}>
              <Plus className="h-4 w-4 mr-2" />
              New template
            </Button>
          </div>
        ) : (
          /* ── Form view — two-panel ── */
          <div className="flex flex-1 min-h-0">
            {/* Left: form */}
            <form
              onSubmit={handleSubmit(onSaveTmpl)}
              className="flex-1 overflow-y-auto px-6 py-5 space-y-4"
            >
              <div>
                <Label className="text-xs">Template name</Label>
                <Input
                  {...register('name')}
                  placeholder="e.g. No-show follow-up"
                  className="mt-1"
                />
                {errors.name && (
                  <p className="text-xs text-destructive mt-1">{errors.name.message}</p>
                )}
              </div>
              <div>
                <Label className="text-xs">Email subject</Label>
                <Input {...register('subject')} placeholder="We missed you!" className="mt-1" />
                {errors.subject && (
                  <p className="text-xs text-destructive mt-1">{errors.subject.message}</p>
                )}
              </div>
              <div>
                <Label className="text-xs">Body</Label>
                <Textarea
                  {...register('body')}
                  rows={12}
                  placeholder="Hi {{firstname}},&#10;&#10;We noticed you missed our session…"
                  className="mt-1 font-mono text-xs"
                />
                {errors.body && (
                  <p className="text-xs text-destructive mt-1">{errors.body.message}</p>
                )}
              </div>
              <div className="w-36">
                <Label className="text-xs">Language</Label>
                <select
                  {...register('language')}
                  className="mt-1 w-full h-9 rounded-md border border-input bg-background px-3 py-1 text-sm"
                >
                  <option value="en">English</option>
                  <option value="de">Deutsch</option>
                  <option value="fr">Français</option>
                  <option value="it">Italiano</option>
                </select>
              </div>
              {submitErr && <p className="text-xs text-destructive">{submitErr}</p>}
              <div className="flex justify-between pt-1 pb-4">
                <Button type="button" variant="ghost" onClick={() => setFormOpen(false)}>
                  ← Back
                </Button>
                <Button type="submit" disabled={isSubmitting}>
                  {isSubmitting ? 'Saving…' : editingTmpl ? 'Save changes' : 'Create template'}
                </Button>
              </div>
            </form>

            {/* Right: placeholder sidebar */}
            <PlaceholderPanel customPlaceholders={customPlaceholders} />
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

// ─── page ────────────────────────────────────────────────────────────────────

export default function AutomationsPage() {
  const { currentTeamId, user } = useAuth()
  const { isAtLeast } = usePlan()
  // Automations are available on every tier; Studio/Org get the full suite while
  // Free/Coach are limited to the triggers/actions of their active modules and
  // installed add-ons (the builder only offers those). Show a note below Studio.
  const fullAutomations = isAtLeast('studio')
  const qc = useQueryClient()

  // Plugin-contributed triggers and actions
  const { plugins: installedPlugins } = useInstalledPlugins()

  const allTriggerOptions = [
    ...TRIGGER_OPTIONS,
    ...installedPlugins.flatMap((p) =>
      (p.manifest.automationTriggers ?? []).map((tr) => ({
        value: tr.id,
        label: tr.labelKey
          .replace('Plugins.', '')
          .replace(/([A-Z])/g, ' $1')
          .trim(),
        icon: Zap,
        supportsDelay: tr.supportsDelay,
        isPlugin: true,
      }))
    ),
  ]

  const pluginActionLabels: Record<string, string> = Object.fromEntries(
    installedPlugins.flatMap((p) =>
      (p.manifest.automationActions ?? []).map((ac) => [
        ac.id,
        ac.labelKey
          .replace('Plugins.', '')
          .replace(/([A-Z])/g, ' $1')
          .trim(),
      ])
    )
  )

  const allActionTypeLabels: Record<string, string> = {
    ...ACTION_TYPE_LABELS,
    ...pluginActionLabels,
  }

  const { data: rules = [], isLoading: rulesLoading } = useRules(currentTeamId)
  const { data: templates = [] } = useTemplates(currentTeamId)
  const { data: webhookEndpoints = [] } = useQuery<WebhookEndpoint[]>({
    queryKey: ['webhook_endpoints', currentTeamId],
    enabled: !!currentTeamId,
    queryFn: async () => {
      if (!currentTeamId) return []
      const snap = await getDocs(
        collection(db, TEAMS_COLLECTION, currentTeamId, 'webhook_endpoints')
      )
      return snap.docs.map((d) => ({ ...d.data(), id: d.id }) as WebhookEndpoint)
    },
  })

  const [ruleDialogOpen, setRuleDialogOpen] = useState(false)
  const [editingRule, setEditingRule] = useState<AutomationRule | null>(null)
  const [templateDialogOpen, setTemplateDialogOpen] = useState(false)
  const [libraryOpen, setLibraryOpen] = useState(false)
  const [webhooksOpen, setWebhooksOpen] = useState(false)
  const [quickStarting, setQuickStarting] = useState(false)

  const invalidateRules = () =>
    qc.invalidateQueries({ queryKey: ['automation_rules', currentTeamId] })
  const invalidateTemplates = () =>
    qc.invalidateQueries({ queryKey: ['outreach_templates', currentTeamId] })
  const invalidateAll = () => {
    invalidateRules()
    invalidateTemplates()
    qc.invalidateQueries({ queryKey: ['outreach_templates_for_library', currentTeamId] })
  }

  async function handleQuickStart() {
    if (!currentTeamId) return
    setQuickStarting(true)
    try {
      const snap = await getDocs(
        collection(db, TEAMS_COLLECTION, currentTeamId, 'outreach_templates')
      )
      const allTmpl = snap.docs.map((d) => ({ ...d.data(), id: d.id }))
      const installedRuleKeys = new Set(rules.flatMap((r) => (r.system_key ? [r.system_key] : [])))
      await installStarterBundle(currentTeamId, allTmpl, installedRuleKeys)
      invalidateAll()
    } catch (err) {
      console.error('[QuickStart] failed:', err)
    } finally {
      setQuickStarting(false)
    }
  }

  async function handleToggle(rule: AutomationRule) {
    if (!currentTeamId) return
    await updateDoc(doc(db, TEAMS_COLLECTION, currentTeamId, 'automation_rules', rule.id), {
      active: !rule.active,
    })
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

  const activeRules = rules.filter((r) => r.active)
  const pausedRules = rules.filter((r) => !r.active)

  return (
    <>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
              <Workflow className="h-6 w-6" />
              Automations
            </h1>
            <p className="text-muted-foreground text-sm mt-1">
              Trigger emails and alerts automatically based on contact activity.
            </p>
          </div>
          <div className="flex flex-wrap gap-2 sm:shrink-0 sm:justify-end">
            <Button variant="outline" size="sm" onClick={() => setTemplateDialogOpen(true)}>
              <FileText className="h-4 w-4 mr-1.5" />
              Templates
            </Button>
            <Button variant="outline" size="sm" onClick={() => setLibraryOpen(true)}>
              <BookOpen className="h-4 w-4 mr-1.5" />
              Library
            </Button>
            <Button variant="outline" size="sm" onClick={() => setWebhooksOpen(true)}>
              <Webhook className="h-4 w-4 mr-1.5" />
              Webhooks
            </Button>
            <Button
              size="sm"
              onClick={() => {
                setEditingRule(null)
                setRuleDialogOpen(true)
              }}
            >
              <Plus className="h-4 w-4 mr-1.5" />
              New automation
            </Button>
          </div>
        </div>

        {/* Limited-plan note: Free/Coach get automations scoped to their active
            modules and add-ons; Studio unlocks the full suite. */}
        {!fullAutomations && (
          <div className="rounded-lg border border-primary/30 bg-primary/[0.04] px-4 py-3 text-sm">
            <p className="font-medium">Automations on your plan are limited</p>
            <p className="text-muted-foreground">
              You can automate around your active modules and installed add-ons. Upgrade to Studio
              for the full automation suite — including every add-on&apos;s triggers and actions.
            </p>
          </div>
        )}

        {/* Loading */}
        {rulesLoading && (
          <div className="grid gap-6 sm:grid-cols-2">
            {[1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-36 rounded-xl" />
            ))}
          </div>
        )}

        {/* Empty state */}
        {!rulesLoading && rules.length === 0 && (
          <div className="flex flex-col items-center gap-5 py-16 text-center">
            <div className="rounded-full bg-muted p-4">
              <Workflow className="h-8 w-8 text-muted-foreground" />
            </div>
            <div>
              <p className="font-semibold">No automations yet</p>
              <p className="text-muted-foreground text-sm mt-1 max-w-xs">
                Load a starter kit in one click, browse the library to pick individual rules, or
                build your own.
              </p>
            </div>
            <div className="flex gap-2 flex-wrap justify-center">
              <Button variant="outline" onClick={handleQuickStart} disabled={quickStarting}>
                <Sparkles className="h-4 w-4 mr-2" />
                {quickStarting ? 'Installing…' : 'Quick-start (8 rules)'}
              </Button>
              <Button onClick={() => setLibraryOpen(true)}>
                <BookOpen className="h-4 w-4 mr-2" />
                Browse library
              </Button>
            </div>
          </div>
        )}

        {/* Active rules */}
        {activeRules.length > 0 && (
          <div className="space-y-3">
            <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
              Active
            </h2>
            <div className="grid gap-6 sm:grid-cols-2">
              {activeRules.map((rule) => (
                <RuleCard
                  key={rule.id}
                  rule={rule}
                  templates={templates}
                  onEdit={() => {
                    setEditingRule(rule)
                    setRuleDialogOpen(true)
                  }}
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
            <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
              Paused
            </h2>
            <div className="grid gap-6 sm:grid-cols-2">
              {pausedRules.map((rule) => (
                <RuleCard
                  key={rule.id}
                  rule={rule}
                  templates={templates}
                  onEdit={() => {
                    setEditingRule(rule)
                    setRuleDialogOpen(true)
                  }}
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
          onClick={() => {
            setEditingRule(null)
            setRuleDialogOpen(true)
          }}
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
            webhookEndpoints={webhookEndpoints}
            onSaved={invalidateRules}
            triggerOptions={allTriggerOptions}
            actionTypeLabels={allActionTypeLabels}
          />
          <TemplateDialog
            open={templateDialogOpen}
            onOpenChange={setTemplateDialogOpen}
            teamId={currentTeamId}
          />
          <LibraryDialog
            open={libraryOpen}
            onOpenChange={setLibraryOpen}
            teamId={currentTeamId}
            rules={rules}
            onInstalled={invalidateAll}
          />
          <WebhookEndpointsDialog
            open={webhooksOpen}
            onOpenChange={setWebhooksOpen}
            teamId={currentTeamId}
          />
        </>
      )}
    </>
  )
}
