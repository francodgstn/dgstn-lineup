'use client'

import React, { useState, useEffect, useMemo } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import {
  collection,
  query,
  where,
  orderBy,
  getDocs,
  addDoc,
  updateDoc,
  deleteDoc,
  doc,
  serverTimestamp,
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
import { Button, buttonVariants } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { usePlan } from '@/hooks/usePlan'
import { usePlanName } from '@/hooks/usePlanName'
import { useSubscriptionTypes } from '@/hooks/useSubscriptionTypes'
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
  Sparkles,
  BookOpen,
  Tag,
  Webhook,
} from 'lucide-react'
import { TEAMS_COLLECTION, SUBSCRIPTION_ROLLUP_STATUSES, CONTACT_SOURCES } from '@linyup/shared'
import type { SubscriptionType, CustomFieldDefinition, RankingSystem } from '@linyup/shared'
import { Link, useRouter } from '@/i18n/navigation'
import { useSearchParams } from 'next/navigation'
import type { Route } from 'next'
import { LibraryDialog, installStarterBundle } from './LibraryDialog'
import { WebhookEndpointsDialog, type WebhookEndpoint } from './WebhookEndpointsDialog'
import { useInstalledPlugins } from '@/hooks/useInstalledPlugins'
import { useContactGroups } from '@/plugins/contact-groups/hooks'

// ─── types ────────────────────────────────────────────────────────────────────

interface AutomationTrigger {
  type: string
  delayMinutes?: number
  webhook_endpoint_id?: string // inbound_webhook only
  subscriptionTypeId?: string // subscription_added/removed: scope to a specific type ('' = any)
  affiliationTypeKey?: string // affiliation_added/removed: scope to a specific type key ('' = any)
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
  note?: string // add_note
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
  note?: string // add_note — note content (markdown / placeholders)
  tag?: string // assign_tag / remove_tag
  url?: string // webhook
  group_id?: string // add_to_group / remove_from_group
}

// ─── constants ────────────────────────────────────────────────────────────────

// `group` drives the sectioned dropdown (SelectGroup + divider) — machine keys,
// translated for display via Automations.groups.* (see renderGroupedOptions).
const TRIGGER_GROUP_ORDER = ['contact', 'booking', 'attendance', 'subscription', 'affiliation', 'general', 'plugins']
const CONDITION_GROUP_ORDER = ['acquisition', 'subscription', 'affiliation', 'attendance', 'other']

const TRIGGER_OPTIONS = [
  { value: 'schedule_daily', icon: Clock, supportsDelay: false, group: 'general' },
  { value: 'contact_created', icon: UserPlus, supportsDelay: true, group: 'contact' },
  { value: 'booking_confirmed', icon: CheckCircle, supportsDelay: true, group: 'booking' },
  { value: 'booking_no_show', icon: XCircle, supportsDelay: true, group: 'booking' },
  { value: 'booking_cancelled', icon: XCircle, supportsDelay: true, group: 'booking' },
  { value: 'subscription_added', icon: CreditCard, supportsDelay: true, group: 'subscription' },
  { value: 'subscription_removed', icon: CreditCard, supportsDelay: true, group: 'subscription' },
  { value: 'subscription_changed', icon: CreditCard, supportsDelay: true, group: 'subscription' },
  { value: 'affiliation_added', icon: ShieldCheck, supportsDelay: true, group: 'affiliation' },
  { value: 'affiliation_removed', icon: ShieldCheck, supportsDelay: true, group: 'affiliation' },
  { value: 'affiliation_changed', icon: ShieldCheck, supportsDelay: true, group: 'affiliation' },
  { value: 'session_ended', icon: CalendarCheck, supportsDelay: true, group: 'attendance' },
  { value: 'inbound_webhook', icon: Webhook, supportsDelay: false, group: 'general' },
  { value: 'manual', icon: Play, supportsDelay: false, group: 'general' },
]

const CONDITION_TYPE_OPTIONS = [
  { value: 'acquisition_stage', input: 'acquisition_stage_select', group: 'acquisition' },
  { value: 'days_since_created', input: 'number', group: 'acquisition' },
  { value: 'subscription', input: 'subscription_select', group: 'subscription' },
  { value: 'subscription_status', input: 'subscription_status_select', group: 'subscription' },
  { value: 'subscription_expires_in', input: 'number', group: 'subscription' },
  { value: 'has_affiliation', input: 'none', group: 'affiliation' },
  { value: 'affiliation_type', input: 'affiliation_type_select', group: 'affiliation' },
  { value: 'sessions_attended_min', input: 'number', group: 'attendance' },
  { value: 'sessions_attended_max', input: 'number', group: 'attendance' },
  { value: 'sessions_attended_exactly', input: 'number', group: 'attendance' },
  { value: 'inactivity_days', input: 'number', group: 'attendance' },
  { value: 'inactivity_days_max', input: 'number', group: 'attendance' },
  { value: 'bio_link_booking_no_show', input: 'none', group: 'attendance' },
  { value: 'tag', input: 'text', group: 'other' },
  { value: 'field_equals', input: 'field_equals', group: 'other' },
  { value: 'birthday_today', input: 'none', group: 'other' },
]

// Render a flat option list as grouped <SelectGroup> sections with dividers, in the
// given group order (unknown groups — e.g. plugin-contributed — fall to the end).
type GroupableOption = { value: string; label: string; group?: string }
function renderGroupedOptions(
  options: ReadonlyArray<GroupableOption>,
  order: string[],
  groupLabel: (g: string) => string = (g) => g
) {
  const byGroup = new Map<string, GroupableOption[]>()
  for (const o of options) {
    const g = o.group ?? 'plugins'
    const arr = byGroup.get(g) ?? []
    arr.push(o)
    byGroup.set(g, arr)
  }
  const groups = [
    ...order.filter((g) => byGroup.has(g)),
    ...[...byGroup.keys()].filter((g) => !order.includes(g)),
  ]
  return groups.map((g, gi) => (
    <React.Fragment key={g}>
      {gi > 0 && <SelectSeparator />}
      <SelectGroup>
        <SelectLabel>{groupLabel(g)}</SelectLabel>
        {byGroup.get(g)!.map((o) => (
          <SelectItem key={o.value} value={o.value} className="text-xs">
            {o.label}
          </SelectItem>
        ))}
      </SelectGroup>
    </React.Fragment>
  ))
}

const ACQUISITION_STAGE_VALUES = ['trial_booked', 'trial_attended', 'joined'] as const

const ACTION_TYPE_VALUES = [
  'send_email',
  'add_note',
  'update_field',
  'archive_contact',
  'assign_tag',
  'remove_tag',
  'notify_team',
  'log_activity',
  'webhook',
  'add_to_group',
  'remove_from_group',
  'create_alert',
] as const

function defaultActionTypeLabels(t: ReturnType<typeof useTranslations>): Record<string, string> {
  return Object.fromEntries(
    ACTION_TYPE_VALUES.map((v) => [v, t(`actions.types.${v}` as Parameters<typeof t>[0])])
  )
}

// ─── helpers ──────────────────────────────────────────────────────────────────

function triggerTypeLabel(t: ReturnType<typeof useTranslations>, type: string): string {
  return TRIGGER_OPTIONS.some((o) => o.value === type)
    ? t(`triggers.${type}` as Parameters<typeof t>[0])
    : type
}

function conditionTypeLabel(t: ReturnType<typeof useTranslations>, type: string): string {
  return CONDITION_TYPE_OPTIONS.some((o) => o.value === type)
    ? t(`conditions.types.${type}` as Parameters<typeof t>[0])
    : type
}

function subscriptionStatusLabel(t: ReturnType<typeof useTranslations>, status: string): string {
  return t(`subscriptionStatus.${status}` as Parameters<typeof t>[0])
}

function acquisitionStageLabel(t: ReturnType<typeof useTranslations>, stage: string): string {
  return t(`acquisitionStage.${stage}` as Parameters<typeof t>[0])
}

const UPDATE_FIELD_LABEL_KEYS: Record<string, string> = {
  acquisition_stage: 'actions.updateField.acquisitionStage',
  source: 'actions.updateField.source',
  source_detail: 'actions.updateField.sourceDetail',
  notes: 'actions.updateField.notes',
  lead_acknowledged: 'actions.updateField.leadAcknowledged',
}

function updateFieldLabel(
  t: ReturnType<typeof useTranslations>,
  field: string,
  customLabel?: string
): string {
  if (customLabel) return customLabel
  const key = UPDATE_FIELD_LABEL_KEYS[field]
  if (key) return t(key as Parameters<typeof t>[0])
  // Custom fields are stored as dotted paths — show the definition id as fallback.
  return field.startsWith('custom_fields.') ? field.slice('custom_fields.'.length) : field
}

function conditionSummary(
  t: ReturnType<typeof useTranslations>,
  c: AutomationCondition,
  subName?: (id: string) => string
): string {
  const opt = CONDITION_TYPE_OPTIONS.find((o) => o.value === c.type)
  if (!opt) return c.type
  const label = conditionTypeLabel(t, c.type)
  if (opt.input === 'none') return label
  if (opt.input === 'number') return t('conditions.summaryNumber', { label, value: c.value ?? '' })
  if (c.type === 'field_equals')
    return t('conditions.summaryFieldEquals', { field: c.field ?? '?', value: c.value ?? '' })
  if (c.type === 'subscription' && c.value && c.value !== 'any' && c.value !== 'none') {
    return t('conditions.summarySubscription', { name: subName?.(c.value) ?? c.value })
  }
  return t('conditions.summaryWithValue', { label, value: c.value ?? '' })
}

function actionSummary(
  t: ReturnType<typeof useTranslations>,
  a: AutomationAction,
  templates: OutreachTemplate[],
  pluginActionLabels?: Record<string, string>
): string {
  if (a.type === 'send_email') {
    const tmpl = templates.find((tm) => tm.id === (a.templateId ?? ''))
    return t('actions.summarySendEmail', { name: tmpl?.name ?? a.templateId ?? '—' })
  }
  if (a.type === 'create_alert') return t('actions.summaryCreateAlert')
  if (a.type === 'update_field')
    return t('actions.summaryUpdateField', {
      field: updateFieldLabel(t, a.field ?? '—'),
      value: String(a.value ?? '—'),
    })
  if (a.type === 'archive_contact') return t('actions.summaryArchiveContact')
  if (a.type === 'add_note') return t('actions.summaryAddNote', { note: a.note ?? '' })
  if (a.type === 'notify_team') return t('actions.summaryNotifyTeam', { subject: a.subject ?? '' })
  if (a.type === 'log_activity') return t('actions.summaryLogActivity', { message: a.message ?? '' })
  if (a.type === 'assign_tag') return t('actions.summaryAssignTag', { tag: a.tag ?? '—' })
  if (a.type === 'remove_tag') return t('actions.summaryRemoveTag', { tag: a.tag ?? '—' })
  if (a.type === 'webhook') return t('actions.summaryWebhook', { url: a.url ?? '—' })
  // Plugin-contributed actions — use the label from the manifest if available
  if (a.type.startsWith('plugin:')) {
    return pluginActionLabels?.[a.type] ?? a.type
  }
  return a.type
}

function timeAgo(t: ReturnType<typeof useTranslations>, ts: { toDate(): Date } | null | undefined): string {
  if (!ts) return ''
  const ms = Date.now() - ts.toDate().getTime()
  const mins = Math.floor(ms / 60000)
  if (mins < 60) return t('timeAgo.minutes', { mins })
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return t('timeAgo.hours', { hrs })
  return t('timeAgo.days', { days: Math.floor(hrs / 24) })
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
  const opt = TRIGGER_OPTIONS.find((o) => o.value === type)
  const Icon = opt?.icon ?? Zap
  return <Icon className={className ?? 'h-4 w-4'} />
}

function RuleCard({
  rule,
  templates,
  subscriptionTypes,
  onEdit,
  onToggle,
  onRunNow,
  onDelete,
}: {
  rule: AutomationRule
  templates: OutreachTemplate[]
  subscriptionTypes: SubscriptionType[]
  onEdit: () => void
  onToggle: () => void
  onRunNow: () => void
  onDelete: () => void
}) {
  const t = useTranslations('Automations')
  const [running, setRunning] = useState(false)
  const subName = (id: string) => subscriptionTypes.find((s) => s.id === id)?.name ?? id

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
            {rule.name || t('ruleCard.unnamed')}
          </h3>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Badge variant={rule.active ? 'default' : 'secondary'} className="text-xs">
            {rule.active ? t('common.active') : t('common.paused')}
          </Badge>
          <DropdownMenu>
            <DropdownMenuTrigger className="inline-flex items-center justify-center h-7 w-7 rounded-md hover:bg-accent transition-colors">
              <MoreVertical className="h-3.5 w-3.5" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={onEdit}>
                <Pencil className="h-3.5 w-3.5 mr-2" />
                {t('common.edit')}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={onToggle}>
                {rule.active ? (
                  <>
                    <CirclePause className="h-3.5 w-3.5 mr-2" />
                    {t('ruleCard.pauseAction')}
                  </>
                ) : (
                  <>
                    <CirclePlay className="h-3.5 w-3.5 mr-2" />
                    {t('ruleCard.activateAction')}
                  </>
                )}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={handleRunNow} disabled={running}>
                <Play className="h-3.5 w-3.5 mr-2" />
                {running ? t('ruleCard.running') : t('ruleCard.runNow')}
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={onDelete}
                className="text-destructive focus:text-destructive"
              >
                <Trash2 className="h-3.5 w-3.5 mr-2" />
                {t('common.delete')}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* Trigger line */}
      <div className="text-xs text-muted-foreground">
        <span className="font-medium text-foreground">{triggerTypeLabel(t, trigger.type)}</span>
        {trigger.delayMinutes && trigger.delayMinutes > 0 && (
          <span className="ml-1">
            ·{' '}
            {trigger.delayMinutes < 60
              ? t('ruleCard.delayMinutes', { mins: trigger.delayMinutes })
              : t('ruleCard.delayHours', { hrs: trigger.delayMinutes / 60 })}
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
              {conditionSummary(t, c, subName)}
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
              {actionSummary(t, a, templates)}
            </span>
          ))}
        </div>
      )}

      {/* Footer */}
      {rule.last_run_at && (
        <p className="text-xs text-muted-foreground border-t pt-2 mt-1">
          {t('ruleCard.lastRun', { timeAgo: timeAgo(t, rule.last_run_at) })}
          {rule.last_run_sent != null && ` · ${t('ruleCard.sentCount', { count: rule.last_run_sent })}`}
        </p>
      )}
    </div>
  )
}

// ─── Condition editor ─────────────────────────────────────────────────────────

function ConditionEditor({
  conditions,
  onChange,
  subscriptionTypes,
}: {
  conditions: FormCondition[]
  onChange: (c: FormCondition[]) => void
  subscriptionTypes: SubscriptionType[]
}) {
  const t = useTranslations('Automations')
  const groupLabel = (g: string) => t(`groups.${g}` as Parameters<typeof t>[0])
  // 'any' / 'none' plus the team's actual subscription types, so a rule can target
  // a specific one (e.g. "subscribed to Athlete plan").
  const subscriptionOptions = [
    { value: 'any', label: t('conditions.subscriptionScope.any'), group: 'general' },
    { value: 'none', label: t('conditions.subscriptionScope.none'), group: 'general' },
    ...subscriptionTypes.map((s) => ({ value: s.id, label: s.name, group: 'subscriptionTypes' })),
  ]
  const resolvedConditionOptions = CONDITION_TYPE_OPTIONS.map((o) => ({
    ...o,
    label: conditionTypeLabel(t, o.value),
  }))
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
                      {conditionTypeLabel(t, cond.type)}
                    </span>
                  </SelectTrigger>
                  <SelectContent>
                    {renderGroupedOptions(resolvedConditionOptions, CONDITION_GROUP_ORDER, groupLabel)}
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
                            <SelectItem key={s} value={s} className="text-xs">
                              {acquisitionStageLabel(t, s)}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                    {opt?.input === 'affiliation_type_select' && (
                      <Input
                        className="h-8 text-xs"
                        placeholder={t('conditions.affiliationTypeKeyPlaceholder')}
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
                            {subscriptionOptions.find((sv) => sv.value === cond.value)?.label ??
                              cond.value}
                          </span>
                        </SelectTrigger>
                        <SelectContent>
                          {renderGroupedOptions(subscriptionOptions, ['general', 'subscriptionTypes'], groupLabel)}
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
                            {subscriptionStatusLabel(t, cond.value)}
                          </span>
                        </SelectTrigger>
                        <SelectContent>
                          {SUBSCRIPTION_ROLLUP_STATUSES.map((sv) => (
                            <SelectItem key={sv} value={sv} className="text-xs">
                              {subscriptionStatusLabel(t, sv)}
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
                        placeholder={t('conditions.tagPlaceholder')}
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
                    placeholder={t('conditions.fieldEqualsFieldPlaceholder')}
                    value={cond.condField ?? ''}
                    onChange={(e) => update(i, { condField: e.target.value })}
                  />
                  <Input
                    className="h-8 text-xs"
                    placeholder={t('conditions.valuePlaceholder')}
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
        {t('conditions.addCondition')}
      </Button>
    </div>
  )
}

// ─── Action editor ────────────────────────────────────────────────────────────

// update_field catalog: built-in contact fields + (in ActionEditor) the team's
// custom fields. `kind` drives the value editor; keep in lockstep with the engine
// allowlist in packages/functions/src/utils/automationEngine.ts.
interface UpdateFieldOption {
  value: string
  /** Custom fields / ranks: the display label (built-ins translate via updateFieldLabel). */
  label?: string
  kind: 'enum' | 'text' | 'boolean' | 'number' | 'date'
  values?: readonly string[]
  /** For enum kinds whose raw values need friendly labels (e.g. rank levels). */
  valueLabels?: Record<string, string>
}

const STATIC_UPDATE_FIELD_OPTIONS: readonly UpdateFieldOption[] = [
  { value: 'acquisition_stage', kind: 'enum', values: ACQUISITION_STAGE_VALUES },
  { value: 'source', kind: 'enum', values: CONTACT_SOURCES },
  { value: 'source_detail', kind: 'text' },
  { value: 'notes', kind: 'text' },
  { value: 'lead_acknowledged', kind: 'boolean' },
]

/** Map a custom-field definition to an update_field option (dotted path). */
function customFieldOption(d: CustomFieldDefinition): UpdateFieldOption {
  return {
    value: `custom_fields.${d.id}`,
    label: d.label || d.id,
    kind:
      d.type === 'number' ? 'number'
      : d.type === 'checkbox' ? 'boolean'
      : d.type === 'date' ? 'date'
      : d.type === 'select' ? 'enum'
      : 'text',
    ...(d.type === 'select' ? { values: d.options ?? [] } : {}),
  }
}

/** Map a ranking system to an update_field option (dotted path `ranks.{id}`). */
function rankSystemOption(r: RankingSystem): UpdateFieldOption {
  const levels = [...(r.levels ?? [])].sort((a, b) => a.value - b.value)
  return {
    value: `ranks.${r.id}`,
    label: r.name || r.id,
    kind: 'enum',
    values: levels.map((l) => String(l.value)),
    valueLabels: Object.fromEntries(levels.map((l) => [String(l.value), l.label])),
  }
}

function ActionEditor({
  actions,
  templates,
  onChange,
  actionTypeLabels: labelOverrides,
  contactGroups,
  groupsEnabled,
}: {
  actions: FormAction[]
  templates: OutreachTemplate[]
  onChange: (a: FormAction[]) => void
  actionTypeLabels?: Record<string, string>
  contactGroups: { id: string; name: string }[]
  groupsEnabled: boolean
}) {
  const t = useTranslations('Automations')
  const { team } = useAuth()
  const resolvedActionLabels = labelOverrides ?? defaultActionTypeLabels(t)
  function add() {
    onChange([...actions, { type: 'send_email', templateId: '' }])
  }
  function remove(i: number) {
    onChange(actions.filter((_, idx) => idx !== i))
  }
  function update(i: number, patch: Partial<FormAction>) {
    onChange(actions.map((a, idx) => (idx === i ? { ...a, ...patch } : a)))
  }

  // Built-in fields + the team's ranking systems + custom fields (plugin definitions).
  const updateFieldOptions = useMemo<UpdateFieldOption[]>(
    () => [
      ...STATIC_UPDATE_FIELD_OPTIONS,
      ...(team?.ranking_systems ?? []).map(rankSystemOption),
      ...(team?.custom_field_definitions ?? []).map(customFieldOption),
    ],
    [team]
  )

  const selectedFieldMeta = (action: FormAction) =>
    updateFieldOptions.find((o) => o.value === action.field)

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
                    note: undefined,
                    tag: undefined,
                    url: undefined,
                    group_id: undefined,
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
                    {t('actions.types.send_email')}
                  </SelectItem>
                  <SelectItem value="add_note" className="text-xs">
                    {t('actions.types.add_note')}
                  </SelectItem>
                  <SelectItem value="update_field" className="text-xs">
                    {t('actions.types.update_field')}
                  </SelectItem>
                  <SelectItem value="assign_tag" className="text-xs">
                    {t('actions.types.assign_tag')}
                  </SelectItem>
                  <SelectItem value="remove_tag" className="text-xs">
                    {t('actions.types.remove_tag')}
                  </SelectItem>
                  <SelectItem value="notify_team" className="text-xs">
                    {t('actions.types.notify_team')}
                  </SelectItem>
                  <SelectItem value="log_activity" className="text-xs">
                    {t('actions.types.log_activity')}
                  </SelectItem>
                  <SelectItem value="webhook" className="text-xs">
                    {t('actions.types.webhook')}
                  </SelectItem>
                  {groupsEnabled && (
                    <>
                      <SelectItem value="add_to_group" className="text-xs">
                        {t('actions.types.add_to_group')}
                      </SelectItem>
                      <SelectItem value="remove_from_group" className="text-xs">
                        {t('actions.types.remove_from_group')}
                      </SelectItem>
                    </>
                  )}
                  <SelectItem value="create_alert" className="text-xs">
                    {t('actions.types.create_alert')}
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
                      {templates.find((tm) => tm.id === action.templateId)?.name ?? (
                        <span className="text-muted-foreground">{t('actions.selectTemplatePlaceholder')}</span>
                      )}
                    </span>
                  </SelectTrigger>
                  <SelectContent>
                    {templates.length === 0 ? (
                      <SelectItem value="__none" disabled className="text-xs text-muted-foreground">
                        {t('actions.noTemplates')}
                      </SelectItem>
                    ) : (
                      templates.map((tm) => (
                        <SelectItem key={tm.id} value={tm.id} className="text-xs">
                          {tm.name}
                        </SelectItem>
                      ))
                    )}
                  </SelectContent>
                </Select>
              )}

              {/* create_alert placeholder */}
              {action.type === 'create_alert' && (
                <p className="text-xs text-muted-foreground self-center">
                  {t('actions.alertPresetsComingSoon')}
                </p>
              )}
            </div>

            {/* Row 2+: expanded controls for complex types */}

            {action.type === 'update_field' && (
              <div className="grid grid-cols-2 gap-2">
                <Select
                  value={action.field ?? ''}
                  onValueChange={(v) => {
                    const meta = updateFieldOptions.find((o) => o.value === v)
                    update(i, {
                      field: v ?? '',
                      // Sensible default per kind: first enum value / 'true' / empty text.
                      fieldValue:
                        meta?.kind === 'enum'
                          ? (meta.values?.[0] ?? '')
                          : meta?.kind === 'boolean'
                            ? 'true'
                            : '',
                    })
                  }}
                >
                  <SelectTrigger className="h-8 text-xs">
                    <span className="flex flex-1 text-left text-xs truncate">
                      {action.field ? (
                        updateFieldLabel(t, action.field, selectedFieldMeta(action)?.label)
                      ) : (
                        <span className="text-muted-foreground">{t('actions.fieldPlaceholder')}</span>
                      )}
                    </span>
                  </SelectTrigger>
                  <SelectContent>
                    {updateFieldOptions.map((o) => (
                      <SelectItem key={o.value} value={o.value} className="text-xs">
                        {updateFieldLabel(t, o.value, o.label)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                {(() => {
                  const meta = selectedFieldMeta(action)
                  // Enum fields (stage / source / select custom fields) → picker.
                  if (!meta || meta.kind === 'enum') {
                    return (
                      <Select
                        value={action.fieldValue ?? ''}
                        onValueChange={(v) => update(i, { fieldValue: v ?? '' })}
                      >
                        <SelectTrigger className="h-8 text-xs">
                          <SelectValue placeholder={t('actions.valuePlaceholder')} />
                        </SelectTrigger>
                        <SelectContent>
                          {(meta?.values ?? []).map((v) => (
                            <SelectItem key={v} value={v} className="text-xs">
                              {meta?.value === 'acquisition_stage'
                                ? acquisitionStageLabel(t, v)
                                : (meta?.valueLabels?.[v] ?? v)}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )
                  }
                  if (meta.kind === 'boolean') {
                    return (
                      <Select
                        value={action.fieldValue ?? 'true'}
                        onValueChange={(v) => update(i, { fieldValue: v ?? 'true' })}
                      >
                        <SelectTrigger className="h-8 text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="true" className="text-xs">{t('actions.boolTrue')}</SelectItem>
                          <SelectItem value="false" className="text-xs">{t('actions.boolFalse')}</SelectItem>
                        </SelectContent>
                      </Select>
                    )
                  }
                  // text / number / date → typed input (value stored as string; the
                  // engine coerces per the field definition).
                  return (
                    <Input
                      type={meta.kind === 'number' ? 'number' : meta.kind === 'date' ? 'date' : 'text'}
                      value={action.fieldValue ?? ''}
                      onChange={(e) => update(i, { fieldValue: e.target.value })}
                      placeholder={t('actions.valuePlaceholder')}
                      className="h-8 text-xs"
                    />
                  )
                })()}
              </div>
            )}

            {action.type === 'notify_team' && (
              <div className="space-y-2">
                <Input
                  className="h-8 text-xs"
                  placeholder={t('actions.notifyTeam.subjectPlaceholder')}
                  value={action.subject ?? ''}
                  onChange={(e) => update(i, { subject: e.target.value })}
                />
                <Textarea
                  className="text-xs font-mono resize-none"
                  rows={3}
                  placeholder={t('actions.notifyTeam.bodyPlaceholder')}
                  value={action.body ?? ''}
                  onChange={(e) => update(i, { body: e.target.value })}
                />
              </div>
            )}

            {action.type === 'log_activity' && (
              <Input
                className="h-8 text-xs"
                placeholder={t('actions.logActivity.messagePlaceholder')}
                value={action.message ?? ''}
                onChange={(e) => update(i, { message: e.target.value })}
              />
            )}

            {action.type === 'add_note' && (
              <div className="space-y-1">
                <Textarea
                  className="text-xs resize-none"
                  rows={3}
                  placeholder={t('actions.addNote.placeholder')}
                  value={action.note ?? ''}
                  onChange={(e) => update(i, { note: e.target.value })}
                />
                <p className="text-[11px] text-muted-foreground">{t('actions.addNote.hint')}</p>
              </div>
            )}

            {(action.type === 'assign_tag' || action.type === 'remove_tag') && (
              <Input
                className="h-8 text-xs"
                placeholder={t('actions.tagPlaceholder')}
                value={action.tag ?? ''}
                onChange={(e) => update(i, { tag: e.target.value })}
              />
            )}

            {action.type === 'webhook' && (
              <Input
                className="h-8 text-xs"
                placeholder={t('actions.webhookUrlPlaceholder')}
                value={action.url ?? ''}
                onChange={(e) => update(i, { url: e.target.value })}
              />
            )}

            {(action.type === 'add_to_group' || action.type === 'remove_from_group') && (
              <Select value={action.group_id ?? ''} onValueChange={(v) => update(i, { group_id: v ?? '' })}>
                <SelectTrigger className="h-8 text-xs">
                  <span className="flex flex-1 text-left text-xs truncate">
                    {contactGroups.find((g) => g.id === action.group_id)?.name ?? (
                      <span className="text-muted-foreground">{t('actions.selectGroupPlaceholder')}</span>
                    )}
                  </span>
                </SelectTrigger>
                <SelectContent>
                  {contactGroups.length === 0 ? (
                    <SelectItem value="__none" disabled className="text-xs text-muted-foreground">
                      {t('actions.noGroupsYet')}
                    </SelectItem>
                  ) : (
                    contactGroups.map((g) => (
                      <SelectItem key={g.id} value={g.id} className="text-xs">
                        {g.name}
                      </SelectItem>
                    ))
                  )}
                </SelectContent>
              </Select>
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
        {t('actions.addAction')}
      </Button>
    </div>
  )
}

// ─── RuleDialog ───────────────────────────────────────────────────────────────

function createRuleSchema(t: ReturnType<typeof useTranslations>) {
  return z.object({
    name: z.string().min(1, t('validation.nameRequired')),
    trigger_type: z.string().min(1, t('validation.triggerRequired')),
    delay_minutes: z.coerce.number().min(0).optional(),
    active: z.boolean(),
  })
}

type RuleFormValues = z.infer<ReturnType<typeof createRuleSchema>>

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
  prefill,
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
  // Deep-link prefill for a NEW rule (e.g. from the subscription editor).
  prefill?: { triggerType?: string; subscriptionTypeId?: string }
}) {
  const t = useTranslations('Automations')
  const groupLabel = (g: string) => t(`groups.${g}` as Parameters<typeof t>[0])
  const resolvedTriggerOptions =
    triggerOptionsProp ?? TRIGGER_OPTIONS.map((o) => ({ ...o, label: triggerTypeLabel(t, o.value) }))
  const { data: subscriptionTypes = [] } = useSubscriptionTypes(teamId)
  const { isInstalled } = useInstalledPlugins()
  const groupsEnabled = isInstalled('contact-groups')
  const { data: contactGroups = [] } = useContactGroups(groupsEnabled ? teamId : null)
  const [conditions, setConditions] = useState<FormCondition[]>([])
  const [actions, setActions] = useState<FormAction[]>([])
  const [webhookEndpointId, setWebhookEndpointId] = useState('')
  // Scope for the added/removed delta triggers ('' = any type).
  const [triggerSubTypeId, setTriggerSubTypeId] = useState('')
  const [triggerAffTypeKey, setTriggerAffTypeKey] = useState('')
  const [submitError, setSubmitError] = useState('')
  const ruleSchema = useMemo(() => createRuleSchema(t), [t])

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
    resolvedTriggerOptions.find((opt) => opt.value === triggerType)?.supportsDelay ?? false

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
          note: (a as { note?: string }).note,
          tag: (a as { tag?: string }).tag,
          url: (a as { url?: string }).url,
          group_id: (a as { group_id?: string }).group_id,
        }))
      )
      setWebhookEndpointId(editing.trigger.webhook_endpoint_id ?? '')
      setTriggerSubTypeId(editing.trigger.subscriptionTypeId ?? '')
      setTriggerAffTypeKey(editing.trigger.affiliationTypeKey ?? '')
    } else {
      reset({
        name: '',
        trigger_type: prefill?.triggerType ?? 'schedule_daily',
        delay_minutes: 0,
        active: true,
      })
      setConditions([])
      setActions([])
      setWebhookEndpointId('')
      setTriggerSubTypeId(prefill?.subscriptionTypeId ?? '')
      setTriggerAffTypeKey('')
    }
    setSubmitError('')
  }, [open, editing, reset, prefill])

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
          ...((values.trigger_type === 'subscription_added' ||
            values.trigger_type === 'subscription_removed') &&
          triggerSubTypeId
            ? { subscriptionTypeId: triggerSubTypeId }
            : {}),
          ...((values.trigger_type === 'affiliation_added' ||
            values.trigger_type === 'affiliation_removed') &&
          triggerAffTypeKey.trim()
            ? { affiliationTypeKey: triggerAffTypeKey.trim() }
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
          .filter(
            (a) =>
              !((a.type === 'add_to_group' || a.type === 'remove_from_group') && !a.group_id)
          )
          .map((a) => {
            if (a.type === 'send_email') return { type: 'send_email', templateId: a.templateId }
            if (a.type === 'add_note') return { type: 'add_note', note: a.note ?? '' }
            if (a.type === 'update_field')
              return { type: 'update_field', field: a.field ?? '', value: a.fieldValue ?? '' }
            if (a.type === 'notify_team')
              return { type: 'notify_team', subject: a.subject ?? '', body: a.body ?? '' }
            if (a.type === 'log_activity') return { type: 'log_activity', message: a.message ?? '' }
            if (a.type === 'assign_tag') return { type: 'assign_tag', tag: a.tag ?? '' }
            if (a.type === 'remove_tag') return { type: 'remove_tag', tag: a.tag ?? '' }
            if (a.type === 'webhook') return { type: 'webhook', url: a.url ?? '' }
            if (a.type === 'add_to_group') return { type: 'add_to_group', group_id: a.group_id ?? '' }
            if (a.type === 'remove_from_group')
              return { type: 'remove_from_group', group_id: a.group_id ?? '' }
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
      setSubmitError((err as Error).message || t('dialogs.rule.saveFailed'))
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[680px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{editing ? t('dialogs.rule.editTitle') : t('common.newAutomation')}</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
          {/* Name + active */}
          <div className="flex gap-3 items-end">
            <div className="flex-1">
              <Label htmlFor="rl-name" className="text-xs font-medium">
                {t('dialogs.rule.nameLabel')}
              </Label>
              <Input
                id="rl-name"
                {...register('name')}
                placeholder={t('dialogs.rule.namePlaceholder')}
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
                {t('common.active')}
              </Label>
            </div>
          </div>

          <Separator />

          {/* Trigger */}
          <div className="space-y-2">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
              {t('sections.trigger')}
            </p>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label className="text-xs">{t('dialogs.rule.whenLabel')}</Label>
                <Select
                  value={triggerType}
                  onValueChange={(v) => setValue('trigger_type', v ?? '')}
                >
                  <SelectTrigger className="mt-1 h-8 text-xs">
                    <span className="flex flex-1 text-left text-xs truncate">
                      {resolvedTriggerOptions.find((opt) => opt.value === triggerType)?.label ??
                        triggerType}
                    </span>
                  </SelectTrigger>
                  <SelectContent>
                    {renderGroupedOptions(resolvedTriggerOptions, TRIGGER_GROUP_ORDER, groupLabel)}
                  </SelectContent>
                </Select>
              </div>

              {supportsDelay && (
                <div>
                  <Label className="text-xs">{t('dialogs.rule.delayLabel')}</Label>
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
                <Label className="text-xs">{t('dialogs.rule.webhookEndpointLabel')}</Label>
                {webhookEndpoints.length === 0 ? (
                  <p className="mt-1 text-xs text-muted-foreground">
                    {t('dialogs.rule.noWebhookEndpoints')}
                  </p>
                ) : (
                  <Select
                    value={webhookEndpointId}
                    onValueChange={(v) => setWebhookEndpointId(v ?? '')}
                  >
                    <SelectTrigger className="mt-1 h-8 text-xs">
                      <span className="flex flex-1 text-left text-xs truncate">
                        {webhookEndpoints.find((ep) => ep.id === webhookEndpointId)?.name ?? (
                          <span className="text-muted-foreground">{t('dialogs.rule.selectEndpointPlaceholder')}</span>
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

            {/* Delta trigger scope — which subscription type was added/removed */}
            {(triggerType === 'subscription_added' || triggerType === 'subscription_removed') && (
              <div>
                <Label className="text-xs">{t('dialogs.rule.subscriptionTypeLabel')}</Label>
                <Select value={triggerSubTypeId} onValueChange={(v) => setTriggerSubTypeId(v ?? '')}>
                  <SelectTrigger className="mt-1 h-8 text-xs">
                    <span className="flex flex-1 text-left text-xs truncate">
                      {triggerSubTypeId
                        ? (subscriptionTypes.find((s) => s.id === triggerSubTypeId)?.name ??
                          triggerSubTypeId)
                        : t('conditions.subscriptionScope.any')}
                    </span>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="" className="text-xs">{t('conditions.subscriptionScope.any')}</SelectItem>
                    {subscriptionTypes.map((s) => (
                      <SelectItem key={s.id} value={s.id} className="text-xs">
                        {s.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {/* Delta trigger scope — which affiliation type was added/removed */}
            {(triggerType === 'affiliation_added' || triggerType === 'affiliation_removed') && (
              <div>
                <Label className="text-xs">{t('dialogs.rule.affiliationTypeKeyLabel')}</Label>
                <Input
                  className="mt-1 h-8 text-xs"
                  placeholder={t('dialogs.rule.affiliationTypeKeyPlaceholder')}
                  value={triggerAffTypeKey}
                  onChange={(e) => setTriggerAffTypeKey(e.target.value)}
                />
              </div>
            )}
          </div>

          <Separator />

          {/* Conditions */}
          <div className="space-y-2">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
              {t('sections.conditions')} <span className="normal-case font-normal">{t('sections.conditionsHint')}</span>
            </p>
            <ConditionEditor
              conditions={conditions}
              onChange={setConditions}
              subscriptionTypes={subscriptionTypes}
            />
          </div>

          <Separator />

          {/* Actions */}
          <div className="space-y-2">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
              {t('sections.actions')}
            </p>
            <ActionEditor
              actions={actions}
              templates={templates}
              onChange={setActions}
              actionTypeLabels={actionTypeLabelsProp}
              contactGroups={contactGroups}
              groupsEnabled={groupsEnabled}
            />
          </div>

          {submitError && <p className="text-xs text-destructive">{submitError}</p>}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? t('common.saving') : t('dialogs.rule.submit')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

// ─── page ────────────────────────────────────────────────────────────────────

export default function AutomationsPage() {
  const t = useTranslations('Automations')
  const planName = usePlanName()
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
    ...TRIGGER_OPTIONS.map((o) => ({ ...o, label: triggerTypeLabel(t, o.value) })),
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
    ...defaultActionTypeLabels(t),
    ...pluginActionLabels,
  }

  const { data: rules = [], isLoading: rulesLoading } = useRules(currentTeamId)
  const { data: subscriptionTypes = [] } = useSubscriptionTypes(currentTeamId)
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

  // Rules vs the system-emails inventory — segmented views so the System emails
  // panel isn't pushed below a long rule list.
  const [ruleDialogOpen, setRuleDialogOpen] = useState(false)
  const [editingRule, setEditingRule] = useState<AutomationRule | null>(null)
  const [prefill, setPrefill] = useState<
    { triggerType?: string; subscriptionTypeId?: string } | undefined
  >(undefined)
  const [libraryOpen, setLibraryOpen] = useState(false)
  const [webhooksOpen, setWebhooksOpen] = useState(false)
  const [quickStarting, setQuickStarting] = useState(false)

  // Deep-link entry: ?editRule=<id> opens that rule; ?newTrigger=<type>&subType=<id>
  // opens a NEW rule prefilled (e.g. from the subscription editor). Params are cleared
  // after handling so closing the dialog doesn't reopen it.
  const router = useRouter()
  const searchParams = useSearchParams()
  useEffect(() => {
    const editRule = searchParams.get('editRule')
    const newTrigger = searchParams.get('newTrigger')
    const subType = searchParams.get('subType')
    if (editRule) {
      const r = rules.find((x) => x.id === editRule)
      if (!r) return // rules not loaded yet — re-run when they are
      setPrefill(undefined)
      setEditingRule(r)
      setRuleDialogOpen(true)
      router.replace('/automations' as Route)
    } else if (newTrigger) {
      setEditingRule(null)
      setPrefill({ triggerType: newTrigger, subscriptionTypeId: subType ?? undefined })
      setRuleDialogOpen(true)
      router.replace('/automations' as Route)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams, rules])

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
    if (!currentTeamId || !confirm(t('deleteConfirm', { name: rule.name }))) return
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
              {t('page.title')}
            </h1>
            <p className="text-muted-foreground text-sm mt-1">
              {t('page.subtitle')}
            </p>
          </div>
          <div className="flex flex-wrap gap-2 sm:shrink-0 sm:justify-end">
            {/* Email templates + system-email toggles live in Settings → Emails */}
            <Link
              href={'/settings/emails' as Route}
              className={buttonVariants({ variant: 'outline', size: 'sm' })}
            >
              <Mail className="h-4 w-4 mr-1.5" />
              {t('page.templatesButton')}
            </Link>
            <Button variant="outline" size="sm" onClick={() => setLibraryOpen(true)}>
              <BookOpen className="h-4 w-4 mr-1.5" />
              {t('page.libraryButton')}
            </Button>
            <Button variant="outline" size="sm" onClick={() => setWebhooksOpen(true)}>
              <Webhook className="h-4 w-4 mr-1.5" />
              {t('page.webhooksButton')}
            </Button>
            <Button
              size="sm"
              onClick={() => {
                setEditingRule(null)
                setRuleDialogOpen(true)
              }}
            >
              <Plus className="h-4 w-4 mr-1.5" />
              {t('common.newAutomation')}
            </Button>
          </div>
        </div>

        {/* Limited-plan note: Free/Coach get automations scoped to their active
            modules and add-ons; Studio unlocks the full suite. */}
        {!fullAutomations && (
          <div className="rounded-lg border border-primary/30 bg-primary/[0.04] px-4 py-3 text-sm">
            <p className="font-medium">{t('page.limitedPlanTitle')}</p>
            <p className="text-muted-foreground">
              {t('page.limitedPlanBody', { plan: planName('studio') })}
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
              <p className="font-semibold">{t('page.emptyTitle')}</p>
              <p className="text-muted-foreground text-sm mt-1 max-w-xs">
                {t('page.emptyBody')}
              </p>
            </div>
            <div className="flex gap-2 flex-wrap justify-center">
              <Button variant="outline" onClick={handleQuickStart} disabled={quickStarting}>
                <Sparkles className="h-4 w-4 mr-2" />
                {quickStarting ? t('page.installing') : t('page.quickStart')}
              </Button>
              <Button onClick={() => setLibraryOpen(true)}>
                <BookOpen className="h-4 w-4 mr-2" />
                {t('page.browseLibrary')}
              </Button>
            </div>
          </div>
        )}

        {/* Active rules */}
        {activeRules.length > 0 && (
          <div className="space-y-3">
            <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
              {t('common.active')}
            </h2>
            <div className="grid gap-6 sm:grid-cols-2">
              {activeRules.map((rule) => (
                <RuleCard
                  key={rule.id}
                  rule={rule}
                  templates={templates}
                  subscriptionTypes={subscriptionTypes}
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
              {t('common.paused')}
            </h2>
            <div className="grid gap-6 sm:grid-cols-2">
              {pausedRules.map((rule) => (
                <RuleCard
                  key={rule.id}
                  rule={rule}
                  templates={templates}
                  subscriptionTypes={subscriptionTypes}
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
            onOpenChange={(v) => {
              setRuleDialogOpen(v)
              if (!v) setPrefill(undefined)
            }}
            teamId={currentTeamId}
            editing={editingRule}
            templates={templates}
            webhookEndpoints={webhookEndpoints}
            onSaved={invalidateRules}
            triggerOptions={allTriggerOptions}
            actionTypeLabels={allActionTypeLabels}
            prefill={prefill}
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
