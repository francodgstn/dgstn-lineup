// Generalized workflow automation engine for Linyup.
// Handles condition evaluation, action dispatch, and rule execution
// across all three trigger tiers: scheduled (Tier 3), event-based (Tier 1),
// and delayed via Cloud Tasks (Tier 2 — Phase 3).
//
// All three execution paths (daily scanner, event triggers, manual callable)
// funnel through runRule() for consistent behaviour.

import * as admin from 'firebase-admin'
import { FieldValue, Timestamp } from 'firebase-admin/firestore'
import { to } from './async'
import { sendEmail } from './email'
import { logActivity } from './users'
import { substituteVariables, renderBody, buildOutreachEmail } from './outreachEmail'
import { pluginActionHandlers } from '../plugins/index'
import type { PluginActionId, PluginTriggerId, ContactGroup, EngagementThresholds } from '@linyup/shared'
import {
  matchesFilter,
  TEAMS_COLLECTION, CONTACT_GROUPS_SUBCOLLECTION,
} from '@linyup/shared'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type AutomationTriggerType =
  // Tier 3 — daily scheduled scan
  | 'schedule_daily'
  // Tier 1 — Firestore event triggers (real-time)
  | 'contact_created'
  | 'contact_updated'
  | 'booking_confirmed'
  | 'booking_no_show'
  | 'booking_cancelled'
  | 'acquisition_stage_changed'
  // Legacy coarse subscription/affiliation triggers (back-compat; still accepted by engine)
  | 'subscription_changed'
  | 'affiliation_changed'
  // Delta-aware subscription triggers — carry the specific type that was added/removed
  | 'subscription_added'
  | 'subscription_removed'
  // Delta-aware affiliation triggers — carry the specific type_key that was added/removed
  | 'affiliation_added'
  | 'affiliation_removed'
  // Tier 1+2 — event trigger + optional Cloud Tasks delay
  | 'session_ended'
  // Inbound webhook — external system POSTs to a team's unique URL
  | 'inbound_webhook'
  // Always available
  | 'manual'
  // Plugin-contributed triggers (namespaced: 'plugin:{pluginId}:{name}')
  | PluginTriggerId

export type AutomationCondition =
  | { type: 'bio_link_booking_no_show'; delay_days?: number; delay_hours?: number }
  | { type: 'sessions_attended_exactly'; value: number }
  | { type: 'sessions_attended_min'; value: number }
  | { type: 'sessions_attended_max'; value: number }
  | { type: 'inactivity_days'; value: number }
  | { type: 'inactivity_days_max'; value: number }
  | { type: 'acquisition_stage'; value: string }
  | { type: 'subscription'; value: string }
  | { type: 'subscription_missing' } // legacy alias → subscription: none
  | { type: 'subscription_set' } // legacy alias → subscription: any
  // Stripe billing rollup status (active/trialing/past_due/paused/cancelled/none)
  | { type: 'subscription_status'; value: string }
  | { type: 'tag'; value: string }
  | { type: 'field_equals'; field: string; value: unknown }
  // Subscription renewal
  | { type: 'subscription_expires_in'; days: number } // expires in ≤ N days (and not expired)
  // Lifecycle
  | { type: 'days_since_created'; value: number } // created N+ days ago
  | { type: 'birthday_today' } // birthdate day+month matches today
  // Affiliation axis conditions (summary-based, no subcollection read required)
  | { type: 'has_affiliation' } // affiliation_summary.has_active === true
  | { type: 'affiliation_type'; value: string } // affiliation_summary.types includes value
  // Contact Groups plugin — is the contact in this group (subgroups included)?
  // Works for BOTH kinds: a manual group tests group_ids, a dynamic group
  // resolves its saved rule per contact. Nothing is materialized either way.
  | { type: 'in_group'; group_id: string }
  // NOTE: affiliation_status (per-affiliation status_id check) and affiliation_expires_in
  // are deferred — they require reading the affiliations subcollection per contact in the
  // scheduled scan path, which is expensive. The summary covers the primary use cases.

export type AutomationAction =
  | { type: 'send_email'; templateId: string }
  | { type: 'create_alert'; presetId: string }
  | { type: 'assign_tag'; tag: string }
  | { type: 'remove_tag'; tag: string }
  | { type: 'update_field'; field: string; value: string | number | boolean | null }
  // Archive (never delete) the contact. The daily scan skips archived contacts,
  // so schedule_daily rules using this are naturally idempotent. Powers the
  // default 'lib_trial_cleanup' rule (stale never-attended trial bookings).
  | { type: 'archive_contact' }
  // Append a timestamped note to the contact (contact_notes subcollection). The
  // note supports the same {{firstname}}/{{date}}… placeholders as emails.
  | { type: 'add_note'; note: string }
  | { type: 'notify_team'; subject: string; body: string }
  | { type: 'log_activity'; message: string }
  | { type: 'webhook'; url: string }
  // Affiliation action — sets the status of the contact's affiliation of a given type.
  // Targets the contact's FIRST affiliation whose type_key matches affiliation_type_key
  // (or any affiliation if affiliation_type_key is omitted). Best-effort: no-op if none found.
  | { type: 'set_affiliation_status'; status_id: string; affiliation_type_key?: string }
  // Contact Groups plugin — add/remove a contact from a group (Contact.group_ids).
  // No-op if group_id is missing/empty.
  | { type: 'add_to_group'; group_id: string }
  | { type: 'remove_from_group'; group_id: string }
  // Plugin-contributed actions (namespaced: 'plugin:{pluginId}:{name}')
  | { type: PluginActionId; config?: Record<string, unknown> }

export interface AutomationRule {
  id: string
  name: string
  active: boolean
  trigger: {
    type: AutomationTriggerType
    delayMinutes?: number
    webhook_endpoint_id?: string // inbound_webhook: which endpoint fires this rule
    // Delta scoping for subscription_added / subscription_removed:
    // when set, the rule only fires when the specific subscription type was added/removed.
    // Absent or empty string = match ANY add/remove.
    subscriptionTypeId?: string
    // Delta scoping for affiliation_added / affiliation_removed:
    // when set, the rule only fires when the specific affiliation type_key was added/removed.
    // Absent or empty string = match ANY add/remove.
    affiliationTypeKey?: string
  }
  conditions: AutomationCondition[]
  actions: AutomationAction[]
  // Legacy fields (old format, kept for backward compat — normalizeRule converts these)
  template_id?: string
  alert_preset_id?: string
  last_run_at?: Timestamp
  last_run_sent?: number
}

export interface ContactData {
  id: string
  firstname?: string
  lastname?: string
  email?: string
  email_unsubscribed?: boolean
  acquisition_stage?: string
  subscription_type_id?: string
  subscription_status?: string
  // All currently-active subscriptions the contact holds, deduped by type.
  // Maintained by onMemberSubscriptionWrite. Absent/empty = no active subscriptions.
  // The condition evaluator checks this in addition to subscription_type_id for back-compat.
  active_subscriptions?: { subscription_type_id: string }[]
  total_sessions?: number
  last_session_at?: Timestamp | { seconds: number; nanoseconds: number } | null
  deleted_at?: Timestamp | null
  archived_at?: Timestamp | null
  outreach_rules_sent?: Record<string, Timestamp>
  avatar_url?: string | null
  // Tag-based filtering + assign_tag action
  tags?: string[]
  // Lifecycle conditions
  created_at?: Timestamp | { seconds: number; nanoseconds: number } | null
  birthdate?: Timestamp | { seconds: number; nanoseconds: number } | null
  // Affiliation axis — summary maintained by onAffiliationWrite
  affiliation_summary?: { has_active: boolean; types: string[]; org_ids: string[] }
  // Read by the `in_group` condition via the shared contact predicate. Declared
  // explicitly (not left to the index signature) so ContactData satisfies
  // ContactFilterSubject — a dynamic group's rule may filter on any of these.
  group_ids?: string[]
  source?: string
  ranks?: Record<string, number>
  custom_fields?: Record<string, string | number | boolean>
  alerts_count?: number
  pending_signup?: boolean
  [key: string]: unknown
}

export interface AutomationContext {
  /**
   * Trigger-supplied data addressable from action templates as {{payload.*}}.
   * For inbound_webhook this is the raw POST body. Never persisted — it lives
   * only for the duration of the run, since it may carry the caller's secrets.
   */
  payload?: Record<string, unknown>
  /** Extra data passed by the triggering event (e.g. sessionId for session_ended) */
  [key: string]: unknown
}

/**
 * Delta payload for subscription_added/removed and affiliation_added/removed triggers.
 * Carries the specific type that changed so the engine can scope rules that opt-in
 * to a particular type via trigger.subscriptionTypeId / trigger.affiliationTypeKey.
 */
export interface EventDelta {
  /** For subscription_added / subscription_removed: the subscription_type_id that changed. */
  subscriptionTypeId?: string
  /** For affiliation_added / affiliation_removed: the affiliation type_key that changed. */
  affiliationTypeKey?: string
}

export interface RunRuleOptions {
  dryRun?: boolean // evaluate conditions but do not execute actions or mark sent
  triggerTier?: 'event' | 'delayed' | 'scheduled' | 'manual'
  force?: boolean // bypass dedup (used by triggerAutomationRule callable)
  context?: AutomationContext // trigger-supplied data, exposed to actions as {{payload.*}}
}

export interface RuleStats {
  processed: number
  sent: number
  skipped: number
  errors: number
}

export interface AutomationLogData {
  rule_id: string
  rule_name: string
  triggered_at: FieldValue
  trigger_type: string
  trigger_tier: string
  contacts_matched: number
  actions_executed: number
  actions_failed: number
  error?: string
}

// ---------------------------------------------------------------------------
// normalizeRule — converts legacy hmd-lineup rule format to the new schema
// ---------------------------------------------------------------------------

/**
 * Normalises old-format rules (trigger_type field, template_id/alert_preset_id top-level)
 * into the new schema with trigger.type, conditions[], and actions[].
 * Old rules without a trigger field are treated as schedule_daily.
 */
export function normalizeRule(ruleId: string, ruleData: Record<string, unknown>): AutomationRule {
  let conditions: AutomationCondition[] = []
  let actions: AutomationAction[] = []
  let triggerType: AutomationTriggerType = 'schedule_daily'

  // Normalise conditions
  if (Array.isArray(ruleData.conditions)) {
    conditions = (ruleData.conditions as AutomationCondition[]).map((c) =>
      // legacy hmd-lineup alias → canonical bio_link_booking_no_show
      (c as { type: string }).type === 'portal_booking_pending'
        ? { ...c, type: 'bio_link_booking_no_show' as const }
        : c
    )
  } else if (ruleData.trigger_type === 'no_show_trial_booking') {
    conditions = [
      {
        type: 'bio_link_booking_no_show',
        delay_days: Math.round(((ruleData.delay_hours as number) || 24) / 24) || 1,
      },
      { type: 'sessions_attended_max', value: 0 },
    ]
  }

  // Normalise trigger
  if (ruleData.trigger && typeof ruleData.trigger === 'object') {
    const t = ruleData.trigger as { type?: string; delayMinutes?: number }
    triggerType = (t.type as AutomationTriggerType) || 'schedule_daily'
  }

  // Normalise actions — prefer explicit actions array, otherwise build from legacy fields
  if (Array.isArray(ruleData.actions) && (ruleData.actions as unknown[]).length > 0) {
    actions = ruleData.actions as AutomationAction[]
  } else {
    if (ruleData.template_id) {
      actions.push({ type: 'send_email', templateId: ruleData.template_id as string })
    }
    if (ruleData.alert_preset_id) {
      actions.push({ type: 'create_alert', presetId: ruleData.alert_preset_id as string })
    }
  }

  const trigger =
    ruleData.trigger && typeof ruleData.trigger === 'object'
      ? (ruleData.trigger as { type: AutomationTriggerType; delayMinutes?: number })
      : { type: triggerType }

  return {
    id: ruleId,
    name: (ruleData.name as string) || '',
    active: Boolean(ruleData.active),
    trigger,
    conditions,
    actions,
    template_id: ruleData.template_id as string | undefined,
    alert_preset_id: ruleData.alert_preset_id as string | undefined,
    last_run_at: ruleData.last_run_at as Timestamp | undefined,
    last_run_sent: ruleData.last_run_sent as number | undefined,
  }
}

// ---------------------------------------------------------------------------
// Condition evaluation
// ---------------------------------------------------------------------------

function resolveTimestampMs(ts: unknown): number | null {
  if (!ts) return null
  if (typeof (ts as Timestamp).toMillis === 'function') return (ts as Timestamp).toMillis()
  if (typeof (ts as { seconds: number }).seconds === 'number') {
    const t = ts as { seconds: number; nanoseconds?: number }
    return t.seconds * 1000 + (t.nanoseconds || 0) / 1e6
  }
  const ms = new Date(ts as string).getTime()
  return isNaN(ms) ? null : ms
}

/**
 * Evaluates non-booking conditions against a contact.
 * Returns true only when ALL applicable conditions pass (AND logic).
 * bio_link_booking_no_show conditions are skipped — they are handled by
 * the booking-based execution path.
 */
/**
 * What `in_group` needs to answer a membership question. Loaded once per team
 * per run (loadGroupContext) — a handful of docs, not per contact.
 */
export interface ConditionContext {
  groups?: ContactGroup[]
  engagementThresholds?: EngagementThresholds
}

export function evaluateContactConditions(
  conditions: AutomationCondition[],
  contact: ContactData,
  now: Date,
  ctx: ConditionContext = {}
): boolean {
  for (const cond of conditions) {
    switch (cond.type) {
      // Group membership is a PER-CONTACT predicate, never a materialized set:
      // the contact is already in hand, so a manual group checks its group_ids
      // and a dynamic group resolves its rule right here. Both go through the
      // shared resolver so "in the group" means one thing everywhere.
      case 'in_group': {
        // Delegated, NOT reimplemented: descendant expansion, dynamic-rule
        // resolution and the not-in-context fallback all live in the shared
        // resolver. Duplicating them here is exactly the parallel check its
        // docstring forbids — the copies would drift on the next change.
        const matched = matchesFilter(
          contact,
          { groups: [cond.group_id] },
          {
            groups: ctx.groups ?? [],
            engagementThresholds: ctx.engagementThresholds,
            nowMs: now.getTime(),
          },
        )
        if (!matched) return false
        break
      }

      case 'bio_link_booking_no_show':
        // handled separately in booking path
        continue

      case 'sessions_attended_exactly':
        if ((contact.total_sessions || 0) !== cond.value) return false
        break

      case 'sessions_attended_min':
        if ((contact.total_sessions || 0) < cond.value) return false
        break

      case 'sessions_attended_max':
        if ((contact.total_sessions || 0) > cond.value) return false
        break

      case 'inactivity_days': {
        if (!contact.last_session_at) return false
        const lastMs = resolveTimestampMs(contact.last_session_at)
        if (lastMs === null) return false
        const daysSince = (now.getTime() - lastMs) / 86400000
        if (daysSince < cond.value) return false
        break
      }

      case 'inactivity_days_max': {
        if (!contact.last_session_at) return false
        const lastMs = resolveTimestampMs(contact.last_session_at)
        if (lastMs === null) return false
        const daysSince = (now.getTime() - lastMs) / 86400000
        if (daysSince > cond.value) return false
        break
      }

      case 'acquisition_stage':
        if (contact.acquisition_stage !== cond.value) return false
        break

      case 'has_affiliation':
        if (contact.affiliation_summary?.has_active !== true) return false
        break

      case 'affiliation_type':
        if (!contact.affiliation_summary?.types?.includes(cond.value)) return false
        break

      case 'subscription': {
        // Gather the full set of subscription type IDs the contact holds.
        // active_subscriptions is the authoritative multi-sub array; subscription_type_id
        // is the legacy primary field kept for back-compat. Union both to catch contacts
        // that only have the primary field set (manual assignment, pre-Stripe data).
        const activeSubs = contact.active_subscriptions ?? []
        const activeSubIds = new Set<string>(activeSubs.map((s) => s.subscription_type_id))
        if (contact.subscription_type_id) activeSubIds.add(contact.subscription_type_id)

        if (cond.value === 'none') {
          // Passes only when the contact holds NO subscriptions at all
          if (activeSubIds.size > 0) return false
        } else if (cond.value === 'any') {
          // Passes only when the contact holds at least one subscription
          if (activeSubIds.size === 0) return false
        } else {
          // Specific subscription type ID — passes when it is in the active set
          if (!activeSubIds.has(cond.value)) return false
        }
        break
      }

      case 'subscription_status':
        if ((contact.subscription_status ?? 'none') !== cond.value) return false
        break

      // legacy aliases — use the same multi-sub logic as the canonical 'subscription' condition
      case 'subscription_missing': {
        const activeSubs = contact.active_subscriptions ?? []
        const hasAny = activeSubs.length > 0 || Boolean(contact.subscription_type_id)
        if (hasAny) return false
        break
      }
      case 'subscription_set': {
        const activeSubs = contact.active_subscriptions ?? []
        const hasAny = activeSubs.length > 0 || Boolean(contact.subscription_type_id)
        if (!hasAny) return false
        break
      }

      case 'tag':
        if (!contact.tags?.includes(cond.value)) return false
        break

      case 'field_equals': {
        const contactVal = (contact as Record<string, unknown>)[cond.field]
        // eslint-disable-next-line eqeqeq
        if (contactVal != cond.value) return false // loose equality to handle string↔number
        break
      }

      case 'subscription_expires_in': {
        // True only if membership expires in ≤ N days AND hasn't already expired
        if (!contact.membership_expiration) return false
        const expiresMs = resolveTimestampMs(contact.membership_expiration)
        if (expiresMs === null) return false
        const daysUntil = (expiresMs - now.getTime()) / 86400000
        if (daysUntil < 0 || daysUntil > cond.days) return false
        break
      }

      case 'days_since_created': {
        if (!contact.created_at) return false
        const createdMs = resolveTimestampMs(contact.created_at)
        if (createdMs === null) return false
        const daysSince = (now.getTime() - createdMs) / 86400000
        if (daysSince < cond.value) return false
        break
      }

      case 'birthday_today': {
        if (!contact.birthdate) return false
        const bdMs = resolveTimestampMs(contact.birthdate)
        if (bdMs === null) return false
        const bday = new Date(bdMs)
        if (bday.getMonth() !== now.getMonth() || bday.getDate() !== now.getDate()) return false
        break
      }

      default:
        // Unknown condition — FAIL CLOSED. A legacy/typo'd condition must never
        // silently widen a rule's audience (an ignored `contact_type` condition once
        // turned a "welcome new trial" rule into "email every new contact", spamming
        // shop registrations). Blocking + logging makes the dead condition visible.
        console.warn(
          `[automation] unknown condition type '${(cond as { type?: string }).type}' — rule blocked (fail closed)`
        ) // eslint-disable-line no-console
        return false
    }
  }
  return true
}

// ---------------------------------------------------------------------------
// Pure action-payload helpers (exported for testing)
// ---------------------------------------------------------------------------

/**
 * Returns the Firestore update payload for an add_to_group or remove_from_group
 * action, or null if group_id is missing/empty (no-op guard).
 * Pure — no Firestore calls; used by executeActionsForContact and by unit tests.
 */
export function groupActionUpdate(
  action: { type: 'add_to_group' | 'remove_from_group'; group_id: string }
): { group_ids: ReturnType<typeof FieldValue.arrayUnion> | ReturnType<typeof FieldValue.arrayRemove> } | null {
  if (!action.group_id) return null
  return {
    group_ids:
      action.type === 'add_to_group'
        ? FieldValue.arrayUnion(action.group_id)
        : FieldValue.arrayRemove(action.group_id),
  }
}

// ---------------------------------------------------------------------------
// Action execution helpers
// ---------------------------------------------------------------------------

export interface ResolvedActions {
  template: Record<string, unknown> | null
  alertPreset: Record<string, unknown> | null
  language: string
}

async function resolveActionResources(
  actions: AutomationAction[],
  teamId: string,
  teamData: Record<string, unknown>
): Promise<ResolvedActions> {
  const db = admin.firestore()
  const teamRef = db.collection('teams').doc(teamId)

  let template: Record<string, unknown> | null = null
  let alertPreset: Record<string, unknown> | null = null
  let language = (teamData.language as string) || 'en'

  for (const action of actions) {
    if (action.type === 'send_email' && !template) {
      const [tmplErr, tmplDoc] = await to(
        teamRef.collection('outreach_templates').doc(action.templateId).get()
      )
      if (
        !tmplErr &&
        tmplDoc &&
        tmplDoc.exists &&
        (tmplDoc.data() as Record<string, unknown>).active
      ) {
        template = tmplDoc.data() as Record<string, unknown>
        language = (template.language as string) || language
      } else {
        console.log(`[automationEngine] Template ${action.templateId} not found or inactive`)
      }
    }

    if (action.type === 'create_alert' && !alertPreset) {
      const [presetErr, presetDoc] = await to(
        teamRef.collection('alert_presets').doc(action.presetId).get()
      )
      if (!presetErr && presetDoc && presetDoc.exists) {
        alertPreset = presetDoc.data() as Record<string, unknown>
      } else {
        console.log(`[automationEngine] Alert preset ${action.presetId} not found`)
      }
    }
  }

  return { template, alertPreset, language }
}

async function createContactAlertDoc(
  contactId: string,
  teamId: string,
  contact: ContactData,
  alertData: {
    schedule: { type: string; value: unknown }
    message: string
    alert_type?: string
    show_in_app?: boolean
  }
): Promise<void> {
  const alertRef = admin
    .firestore()
    .collection('contacts')
    .doc(contactId)
    .collection('contact_alerts')
    .doc()

  await alertRef.set({
    teamId,
    contact: {
      id: contactId,
      firstname: contact.firstname || '',
      lastname: contact.lastname || '',
      avatar_url: contact.avatar_url || null,
    },
    schedule: alertData.schedule,
    message: alertData.message || '',
    alert_type: alertData.alert_type || null,
    show_in_app: alertData.show_in_app || false,
    created_at: FieldValue.serverTimestamp(),
    archived_at: null,
  })
}

/**
 * Returns true if the rule has at least one action that can currently be executed.
 *
 * - send_email:    needs a resolved template
 * - create_alert:  needs a resolved alertPreset
 * - update_field:  self-contained (field allowlist enforced at runtime)
 * - notify_team:   self-contained (team email resolved at runtime)
 * - log_activity:  self-contained (always succeeds)
 * - assign_tag / remove_tag / add_to_group / remove_from_group / webhook: self-contained
 *
 * Exported for use by rule validators and tests.
 */
export function hasResolvableActions(actions: AutomationAction[], resolved: ResolvedActions): boolean {
  for (const a of actions) {
    if (a.type === 'send_email' && resolved.template) return true
    if (a.type === 'create_alert' && resolved.alertPreset) return true
    if (a.type === 'update_field') return true
    if (a.type === 'archive_contact') return true
    if (a.type === 'add_note') return true
    if (a.type === 'notify_team') return true
    if (a.type === 'log_activity') return true
    if (a.type === 'assign_tag') return true
    if (a.type === 'remove_tag') return true
    if (a.type === 'add_to_group') return true
    if (a.type === 'remove_from_group') return true
    if (a.type === 'webhook') return true
  }
  return false
}

/**
 * Executes all resolved actions for a single contact.
 * Returns { executed, failed }.
 */
async function executeActionsForContact(
  contactId: string,
  contact: ContactData,
  actions: AutomationAction[],
  resolved: ResolvedActions,
  teamId: string,
  teamData: Record<string, unknown>,
  ruleId: string,
  payload?: Record<string, unknown>
): Promise<{ executed: number; failed: number }> {
  const now = new Date()
  const teamName = (teamData.name as string) || ''
  let executed = 0
  let failed = 0

  for (const action of actions) {
    try {
      if (action.type === 'send_email' && resolved.template) {
        const subject = substituteVariables(
          resolved.template.subject as string,
          contact,
          teamName,
          now,
          teamData,
          payload
        )
        const rawBody = substituteVariables(
          resolved.template.body as string,
          contact,
          teamName,
          now,
          teamData,
          payload
        )
        const htmlBody = renderBody(resolved.template, rawBody)
        const { html, text } = buildOutreachEmail({
          body: htmlBody,
          teamName,
          language: resolved.language,
          teamData,
        })
        await sendEmail({ to: contact.email!, subject, html, text, teamId })

        await to(
          logActivity(teamId, {
            created_at: FieldValue.serverTimestamp(),
            event: 'outreach_email_sent',
            parameters: {
              description: `Outreach email "${resolved.template.name as string}" sent automatically to ${contact.firstname || ''} ${contact.lastname || ''}.`,
              template_name: resolved.template.name as string,
              template_id: (resolved.template as Record<string, unknown>).id,
              subject,
              automated: true,
              rule_id: ruleId,
            },
            refs: { contact: contactId, user: null },
          })
        )
        executed++
      }

      if (action.type === 'create_alert' && resolved.alertPreset) {
        const alertMessage = substituteVariables(
          resolved.alertPreset.message as string,
          contact,
          teamName,
          now,
          teamData,
          payload
        )
        await createContactAlertDoc(contactId, teamId, contact, {
          schedule: { type: 'datetime', value: Timestamp.now() },
          message: alertMessage,
          alert_type: 'automation',
          show_in_app: (resolved.alertPreset.show_in_app as boolean) || false,
        })
        executed++
      }

      // update_field — write an allowlisted contact field. Built-ins plus the
      // team's custom fields (dotted 'custom_fields.{id}' paths, validated against
      // custom_field_definitions so a rule can never write arbitrary keys).
      if (action.type === 'update_field') {
        const ALLOWED_UPDATE_FIELDS = [
          'acquisition_stage',
          'notes',
          'tags',
          'source',
          'source_detail',
          'lead_acknowledged',
        ] as const
        const field = action.field
        const customFieldId = field.startsWith('custom_fields.')
          ? field.slice('custom_fields.'.length)
          : null
        const customDef = customFieldId
          ? (
              teamData.custom_field_definitions as
                | Array<{ id: string; type?: string }>
                | undefined
            )?.find((d) => d.id === customFieldId)
          : undefined
        // Rank fields ('ranks.{systemId}') — validate the system id against the
        // team's configured ranking systems, never write an arbitrary key.
        const rankSystemId = field.startsWith('ranks.') ? field.slice('ranks.'.length) : null
        const isKnownRank =
          rankSystemId != null &&
          ((teamData.ranking_systems as Array<{ id: string }> | undefined) ?? []).some(
            (r) => r.id === rankSystemId
          )
        const allowed =
          customDef != null ||
          isKnownRank ||
          (ALLOWED_UPDATE_FIELDS as readonly string[]).includes(field)
        if (!allowed) {
          console.log(
            `[automationEngine] update_field: field '${field}' not in allowlist, skipping`
          )
        } else {
          // The builder stores values as strings — coerce per field type
          // (CustomFieldType: text | number | date | select | checkbox; ranks: number).
          let value: string | number | boolean | null = action.value
          if (field === 'lead_acknowledged' || customDef?.type === 'checkbox') {
            value = value === true || value === 'true'
          } else if (customDef?.type === 'number' || isKnownRank) {
            const n = Number(value)
            value = Number.isFinite(n) ? n : null
          }
          const update: Record<string, unknown> = { [field]: value }
          // Stage writes behave like a manual promotion: stamp the milestone and,
          // for attended/joined, MATERIALIZE a provisional lead (it now counts
          // toward the contact cap — see Contact.provisional).
          if (field === 'acquisition_stage') {
            update.acquisition_stage_updated_at = FieldValue.serverTimestamp()
            if (value === 'trial_attended') update.trial_attended_at = FieldValue.serverTimestamp()
            if (value === 'joined') update.converted_at = FieldValue.serverTimestamp()
            if (value === 'trial_attended' || value === 'joined') {
              update.provisional = FieldValue.delete()
              update.provisional_expires_at = FieldValue.delete()
            }
          }
          await admin.firestore().collection('contacts').doc(contactId).update(update)
          await to(
            logActivity(teamId, {
              date: FieldValue.serverTimestamp(),
              event: 'automation_update_field',
              parameters: {
                description:
                  `Automation set '${field}' to '${String(value)}' for ${contact.firstname || ''} ${contact.lastname || ''}.`.trim(),
                field,
                value,
                rule_id: ruleId,
                automated: true,
              },
              refs: { contact: contactId, user: null },
            })
          )
          executed++
        }
      }

      // archive_contact — archive (never delete) the contact; the daily scan skips
      // archived contacts, so re-runs are naturally idempotent.
      if (action.type === 'archive_contact') {
        await admin.firestore().collection('contacts').doc(contactId).update({
          archived_at: FieldValue.serverTimestamp(),
          archived_reason: 'automation',
        })
        await to(
          logActivity(teamId, {
            date: FieldValue.serverTimestamp(),
            event: 'automation_archive_contact',
            parameters: {
              description:
                `Automation archived ${contact.firstname || ''} ${contact.lastname || ''}.`.trim(),
              rule_id: ruleId,
              automated: true,
            },
            refs: { contact: contactId, user: null },
          })
        )
        executed++
      }

      // add_note — append a timestamped note to the contact (contact_notes
      // subcollection), same shape the contact-detail Notes tab reads/writes.
      if (action.type === 'add_note') {
        const content = substituteVariables(
          action.note,
          contact,
          teamName,
          now,
          teamData,
          payload
        ).trim()
        if (content) {
          await admin
            .firestore()
            .collection('contacts')
            .doc(contactId)
            .collection('contact_notes')
            .add({
              content,
              source: 'automation',
              rule_id: ruleId,
              created_at: FieldValue.serverTimestamp(),
              updated_at: FieldValue.serverTimestamp(),
            })
          await to(
            logActivity(teamId, {
              date: FieldValue.serverTimestamp(),
              event: 'automation_add_note',
              parameters: {
                description: `Automation added a note to ${contact.firstname || ''} ${contact.lastname || ''}.`.trim(),
                rule_id: ruleId,
                automated: true,
              },
              refs: { contact: contactId, user: null },
            })
          )
          executed++
        }
      }

      // notify_team — send an internal email to the team's notification address
      if (action.type === 'notify_team') {
        const settings = (teamData.settings as Record<string, unknown>) || {}
        const toEmail = (settings.teamEmail as string) || (teamData.email as string) || ''
        if (!toEmail) {
          console.log(
            `[automationEngine] notify_team: no team email configured for team ${teamId}, skipping`
          )
        } else {
          const subject = substituteVariables(
            action.subject,
            contact,
            teamName,
            now,
            teamData,
            payload
          )
          const rawBody = substituteVariables(
            action.body,
            contact,
            teamName,
            now,
            teamData,
            payload
          )
          const htmlBody = renderBody({ body_mode: 'markdown' }, rawBody)
          const { html, text } = buildOutreachEmail({ body: htmlBody, teamName, teamData })
          await sendEmail({ to: toEmail, subject, html, text, teamId })
          executed++
        }
      }

      // log_activity — append a note to the team activity log
      if (action.type === 'log_activity') {
        const message = substituteVariables(
          action.message,
          contact,
          teamName,
          now,
          teamData,
          payload
        )
        await logActivity(teamId, {
          date: FieldValue.serverTimestamp(),
          event: 'automation_action',
          parameters: {
            description: message,
            rule_id: ruleId,
            automated: true,
          },
          refs: { contact: contactId, user: null },
        })
        executed++
      }

      // assign_tag — add a tag to the contact's tags array
      if (action.type === 'assign_tag') {
        await admin
          .firestore()
          .collection('contacts')
          .doc(contactId)
          .update({
            tags: FieldValue.arrayUnion(action.tag),
          })
        await to(
          logActivity(teamId, {
            date: FieldValue.serverTimestamp(),
            event: 'automation_assign_tag',
            parameters: {
              description:
                `Automation added tag '${action.tag}' to ${contact.firstname || ''} ${contact.lastname || ''}.`.trim(),
              tag: action.tag,
              rule_id: ruleId,
              automated: true,
            },
            refs: { contact: contactId, user: null },
          })
        )
        executed++
      }

      // remove_tag — remove a tag from the contact's tags array
      if (action.type === 'remove_tag') {
        await admin
          .firestore()
          .collection('contacts')
          .doc(contactId)
          .update({
            tags: FieldValue.arrayRemove(action.tag),
          })
        await to(
          logActivity(teamId, {
            date: FieldValue.serverTimestamp(),
            event: 'automation_remove_tag',
            parameters: {
              description:
                `Automation removed tag '${action.tag}' from ${contact.firstname || ''} ${contact.lastname || ''}.`.trim(),
              tag: action.tag,
              rule_id: ruleId,
              automated: true,
            },
            refs: { contact: contactId, user: null },
          })
        )
        executed++
      }

      // add_to_group — add the contact to a Contact Group (group_ids arrayUnion)
      if (action.type === 'add_to_group') {
        const payload = groupActionUpdate(action)
        if (!payload) {
          console.log(
            `[automationEngine] add_to_group: missing group_id for rule ${ruleId}, skipping`
          )
        } else {
          await admin.firestore().collection('contacts').doc(contactId).update(payload)
          await to(
            logActivity(teamId, {
              date: FieldValue.serverTimestamp(),
              event: 'automation_add_to_group',
              parameters: {
                description:
                  `Automation added ${contact.firstname || ''} ${contact.lastname || ''} to group '${action.group_id}'.`.trim(),
                group_id: action.group_id,
                rule_id: ruleId,
                automated: true,
              },
              refs: { contact: contactId, user: null },
            })
          )
          executed++
        }
      }

      // remove_from_group — remove the contact from a Contact Group (group_ids arrayRemove)
      if (action.type === 'remove_from_group') {
        const payload = groupActionUpdate(action)
        if (!payload) {
          console.log(
            `[automationEngine] remove_from_group: missing group_id for rule ${ruleId}, skipping`
          )
        } else {
          await admin.firestore().collection('contacts').doc(contactId).update(payload)
          await to(
            logActivity(teamId, {
              date: FieldValue.serverTimestamp(),
              event: 'automation_remove_from_group',
              parameters: {
                description:
                  `Automation removed ${contact.firstname || ''} ${contact.lastname || ''} from group '${action.group_id}'.`.trim(),
                group_id: action.group_id,
                rule_id: ruleId,
                automated: true,
              },
              refs: { contact: contactId, user: null },
            })
          )
          executed++
        }
      }

      // set_affiliation_status — update the status (and active flag) of the
      // contact's first affiliation matching the given type_key (or any affiliation
      // if no type_key is specified). Best-effort: silently skips when no match.
      if (action.type === 'set_affiliation_status') {
        const { CONTACT_AFFILIATIONS_SUBCOLLECTION, DEFAULT_ORG_AFFILIATION_STATUSES } =
          await import('@linyup/shared')
        const affiliationsSnap = await admin
          .firestore()
          .collection('contacts')
          .doc(contactId)
          .collection(CONTACT_AFFILIATIONS_SUBCOLLECTION)
          .get()

        const target = affiliationsSnap.docs.find((d) => {
          if (!action.affiliation_type_key) return true // first any
          return d.data().type_key === action.affiliation_type_key
        })

        if (target) {
          const affData = target.data() as { issuer?: string; org_id?: string }
          // Resolve active flag from status defs (org or default)
          let statusDefs = DEFAULT_ORG_AFFILIATION_STATUSES
          if (affData.issuer === 'org' && affData.org_id) {
            try {
              const orgStatusSnap = await admin
                .firestore()
                .collection('organizations')
                .doc(affData.org_id as string)
                .collection('affiliation_statuses')
                .get()
              if (!orgStatusSnap.empty) {
                statusDefs = orgStatusSnap.docs.map(
                  (d) => d.data() as (typeof DEFAULT_ORG_AFFILIATION_STATUSES)[number]
                )
              }
            } catch {
              // best-effort
            }
          }
          const statusDef = statusDefs.find((s) => s.id === action.status_id)
          const active = statusDef?.countsAsActive ?? false

          await target.ref.update({
            status_id: action.status_id,
            active,
            updated_at: admin.firestore.FieldValue.serverTimestamp(),
          })
          executed++
          console.log(
            `[automationEngine] set_affiliation_status: contact=${contactId} affiliation=${target.id} status=${action.status_id}`
          )
        } else {
          console.log(
            `[automationEngine] set_affiliation_status: no matching affiliation for contact=${contactId} type_key=${action.affiliation_type_key ?? '(any)'}, skipping`
          )
        }
      }

      // plugin action — dispatch to the plugin's registered handler
      if ((action.type as string).startsWith('plugin:')) {
        const handler = pluginActionHandlers[action.type as PluginActionId]
        if (handler) {
          await handler({
            action: action as { type: PluginActionId; config?: Record<string, unknown> },
            contact,
            contactId,
            teamId,
            teamData,
            ruleId,
          })
          executed++
        } else {
          console.log(
            `[automationEngine] No handler registered for plugin action '${action.type}', skipping`
          )
        }
      }

      // webhook — POST a JSON payload to an external HTTPS endpoint
      if (action.type === 'webhook') {
        const url = action.url
        if (!url?.startsWith('https://')) {
          console.log(
            `[automationEngine] webhook: skipping non-HTTPS or empty URL for rule ${ruleId}`
          )
        } else {
          const payload = {
            event: 'automation_rule_fired',
            rule_id: ruleId,
            team_id: teamId,
            triggered_at: now.toISOString(),
            contact: {
              id: contactId,
              firstname: contact.firstname,
              lastname: contact.lastname,
              email: contact.email,
              acquisition_stage: contact.acquisition_stage,
              affiliation_summary: contact.affiliation_summary ?? null,
              total_sessions: contact.total_sessions,
              tags: contact.tags ?? [],
            },
          }
          const controller = new AbortController()
          const timeoutId = setTimeout(() => controller.abort(), 10000)
          try {
            const response = await fetch(url, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'User-Agent': 'Linyup-Automation/1.0',
              },
              body: JSON.stringify(payload),
              signal: controller.signal,
            })
            clearTimeout(timeoutId)
            if (!response.ok) {
              throw new Error(`Webhook returned HTTP ${response.status}`)
            }
            executed++
          } finally {
            clearTimeout(timeoutId)
          }
        }
      }
    } catch (err) {
      console.error(
        `[automationEngine] Action '${action.type}' failed for contact ${contactId}:`,
        (err as Error).message
      )
      failed++
    }
  }

  return { executed, failed }
}

// ---------------------------------------------------------------------------
// Booking-based rule path (bio_link_booking_no_show)
// ---------------------------------------------------------------------------

async function runBookingRule(
  rule: AutomationRule,
  teamId: string,
  teamData: Record<string, unknown>,
  now: Date,
  stats: RuleStats,
  options: RunRuleOptions
): Promise<void> {
  const db = admin.firestore()

  const bookingCond = rule.conditions.find((c) => c.type === 'bio_link_booking_no_show') as
    | { type: 'bio_link_booking_no_show'; delay_days?: number; delay_hours?: number }
    | undefined

  const conditionCtx = await loadConditionContext(rule, teamId, teamData)

  const delayDays =
    bookingCond?.delay_days || Math.round((bookingCond?.delay_hours || 24) / 24) || 1
  const delayHours = delayDays * 24
  const windowEnd = new Date(now.getTime() - (delayHours - 12) * 3600000)
  const windowStart = new Date(now.getTime() - (delayHours + 36) * 3600000)

  const [sessErr, sessSnap] = await to(
    db
      .collection('sessions')
      .where('teamId', '==', teamId)
      .where('end', '>=', admin.firestore.Timestamp.fromDate(windowStart))
      .where('end', '<', admin.firestore.Timestamp.fromDate(windowEnd))
      .get()
  )
  if (sessErr) {
    console.error(`[automationEngine] Error fetching sessions for team ${teamId}:`, sessErr)
    stats.errors++
    return
  }

  // Legacy sessions with teacher field instead of teamId
  const [legacySessErr, legacySessSnap] = await to(
    db
      .collection('sessions')
      .where('teacher', '==', teamId)
      .where('end', '>=', admin.firestore.Timestamp.fromDate(windowStart))
      .where('end', '<', admin.firestore.Timestamp.fromDate(windowEnd))
      .get()
  )
  const seenSessionIds = new Set(sessSnap!.docs.map((d) => d.id))
  const allSessionDocs = [...sessSnap!.docs]
  if (!legacySessErr && legacySessSnap) {
    for (const doc of legacySessSnap.docs) {
      if (!seenSessionIds.has(doc.id)) allSessionDocs.push(doc)
    }
  }

  if (allSessionDocs.length === 0) return

  const resolved = await resolveActionResources(rule.actions, teamId, teamData)
  if (!hasResolvableActions(rule.actions, resolved)) {
    console.error(
      `[automationEngine] Rule ${rule.id}: no executable action resources found, skipping`
    )
    stats.errors++
    return
  }

  for (const sessionDoc of allSessionDocs) {
    const [bookingsErr, bookingsSnap] = await to(
      sessionDoc.ref
        .collection('bookings')
        .where('fromBioLink', '==', true)
        .where('status', '==', 'no_show')
        .get()
    )
    if (bookingsErr) {
      console.error(
        `[automationEngine] Error fetching bookings for session ${sessionDoc.id}:`,
        bookingsErr
      )
      stats.errors++
      continue
    }

    const eligible = bookingsSnap!.docs.filter(
      (d) => options.force || !d.data().noShowOutreachSentAt
    )

    for (const bookingDoc of eligible) {
      stats.processed++
      const booking = bookingDoc.data()

      let contact: ContactData = {
        id: '',
        firstname: booking.firstname || '',
        lastname: booking.lastname || '',
        email: booking.email || '',
        total_sessions: 0,
      }
      const contactId: string = booking.contactId || booking.contact || ''
      if (contactId) {
        const [cErr, cDoc] = await to(db.collection('contacts').doc(contactId).get())
        if (!cErr && cDoc && cDoc.exists) {
          contact = { id: contactId, ...(cDoc.data() as Omit<ContactData, 'id'>) }
        }
      }

      if (!contact.email) {
        stats.skipped++
        continue
      }
      if (contact.email_unsubscribed) {
        stats.skipped++
        continue
      }
      if (!evaluateContactConditions(rule.conditions, contact, now, conditionCtx)) {
        stats.skipped++
        continue
      }

      if (options.dryRun) {
        stats.sent++
        continue
      }

      const { executed, failed } = await executeActionsForContact(
        contactId || bookingDoc.id,
        contact,
        rule.actions,
        resolved,
        teamId,
        teamData,
        rule.id
      )
      stats.sent += executed
      stats.errors += failed

      // Mark booking as processed
      await to(bookingDoc.ref.update({ noShowOutreachSentAt: FieldValue.serverTimestamp() }))
    }
  }
}

// ---------------------------------------------------------------------------
// Contact-based rule path
// ---------------------------------------------------------------------------

/**
 * Load the group context for a rule — but only when a condition actually asks
 * for it. A rule with no in_group condition costs zero extra reads.
 */
export async function loadConditionContext(
  rule: AutomationRule,
  teamId: string,
  teamData: Record<string, unknown>
): Promise<ConditionContext> {
  if (!rule.conditions.some((c) => c.type === 'in_group')) return {}
  const [err, snap] = await to(
    admin.firestore().collection(TEAMS_COLLECTION).doc(teamId)
      .collection(CONTACT_GROUPS_SUBCOLLECTION).get()
  )
  if (err || !snap) {
    console.error(`[automationEngine] rule=${rule.id}: failed to load contact groups`, err)
    return {}
  }
  return {
    groups: snap.docs.map((d) => ({ ...d.data(), id: d.id }) as ContactGroup),
    engagementThresholds: teamData.engagement_thresholds as EngagementThresholds | undefined,
  }
}

async function runContactRule(
  rule: AutomationRule,
  contacts: ContactData[],
  teamId: string,
  teamData: Record<string, unknown>,
  now: Date,
  stats: RuleStats,
  options: RunRuleOptions,
  payload?: Record<string, unknown>
): Promise<void> {
  const db = admin.firestore()
  const conditionCtx = await loadConditionContext(rule, teamId, teamData)

  console.log(
    `[automationEngine] rule=${rule.id} team=${teamId}: evaluating ${contacts.length} contacts`
  )

  const resolved = await resolveActionResources(rule.actions, teamId, teamData)
  if (!hasResolvableActions(rule.actions, resolved)) {
    console.error(
      `[automationEngine] Rule ${rule.id}: no executable action resources found, skipping`
    )
    stats.errors++
    return
  }

  for (const contact of contacts) {
    if (contact.deleted_at || contact.archived_at) continue
    if (!contact.email) {
      stats.skipped++
      continue
    }
    if (contact.email_unsubscribed) {
      stats.skipped++
      continue
    }

    // Dedup — skip if rule already fired for this contact recently (unless force=true)
    if (!options.force) {
      const lastSent = contact.outreach_rules_sent?.[rule.id]
      if (lastSent) {
        const lastMs = resolveTimestampMs(lastSent)
        if (lastMs !== null) {
          const windowMs =
            options.triggerTier === 'scheduled'
              ? 30 * 86400000 // 30-day window: lets re-engagement rules re-fire (e.g. inactivity)
              : 7 * 86400000 // 7-day window for event-triggered rules
          if (now.getTime() - lastMs < windowMs) {
            stats.skipped++
            continue
          }
        }
      }
    }

    if (!evaluateContactConditions(rule.conditions, contact, now, conditionCtx)) {
      stats.skipped++
      continue
    }

    stats.processed++

    if (options.dryRun) {
      stats.sent++
      continue
    }

    const { executed, failed } = await executeActionsForContact(
      contact.id,
      contact,
      rule.actions,
      resolved,
      teamId,
      teamData,
      rule.id,
      payload
    )
    stats.sent += executed
    stats.errors += failed

    // Mark rule as sent for this contact
    if (executed > 0) {
      await to(
        db
          .collection('contacts')
          .doc(contact.id)
          .update({
            [`outreach_rules_sent.${rule.id}`]: FieldValue.serverTimestamp(),
          })
      )
    }

    console.log(`[automationEngine] rule=${rule.id} actions executed for contact=${contact.id}`)
  }
}

// ---------------------------------------------------------------------------
// runRule — main entry point
// ---------------------------------------------------------------------------

/**
 * Runs an automation rule against the supplied contacts.
 * For bio_link_booking_no_show rules, `contacts` is ignored — bookings are
 * queried internally based on the condition's delay window.
 *
 * @param rule      Normalised AutomationRule
 * @param contacts  Contacts to evaluate (used for contact-based rules)
 * @param teamId    Team owning the rule
 * @param teamData  Team document data (for variable substitution, language)
 * @param options   dryRun, triggerTier, force
 * @returns         AutomationLogData to write to automation_logs
 */
export async function runRule(
  rule: AutomationRule,
  contacts: ContactData[],
  teamId: string,
  teamData: Record<string, unknown>,
  options: RunRuleOptions = {}
): Promise<AutomationLogData> {
  const now = new Date()
  const stats: RuleStats = { processed: 0, sent: 0, skipped: 0, errors: 0 }
  const triggerTier = options.triggerTier || 'scheduled'

  if (!rule.actions.length && !rule.template_id && !rule.alert_preset_id) {
    console.log(`[automationEngine] Rule ${rule.id} has no actions, skipping`)
    stats.skipped++
  } else if (!rule.conditions.length && rule.trigger.type === 'schedule_daily') {
    // Conditions are an AND-filter, so "no conditions" means "match everything" —
    // which is the natural intent for an event trigger (the event already scopes
    // the run to one contact), but a footgun for schedule_daily, whose contact set
    // is the ENTIRE team. An unconditioned daily rule would re-sweep every contact
    // every day, so it stays inert. The builder blocks saving one; this is the
    // backstop for rules that predate that check.
    console.log(`[automationEngine] Rule ${rule.id} is schedule_daily with no conditions, skipping`)
    stats.skipped++
  } else {
    const hasBookingCondition = rule.conditions.some((c) => c.type === 'bio_link_booking_no_show')

    if (hasBookingCondition) {
      // Booking rules are driven by the daily scan, which has no trigger payload.
      await runBookingRule(rule, teamId, teamData, now, stats, options)
    } else {
      await runContactRule(
        rule,
        contacts,
        teamId,
        teamData,
        now,
        stats,
        options,
        options.context?.payload
      )
    }
  }

  const log: AutomationLogData = {
    rule_id: rule.id,
    rule_name: rule.name,
    triggered_at: FieldValue.serverTimestamp(),
    trigger_type: rule.trigger.type,
    trigger_tier: triggerTier,
    contacts_matched: stats.processed,
    actions_executed: stats.sent,
    actions_failed: stats.errors,
  }

  console.log(`[automationEngine] runRule complete rule=${rule.id} team=${teamId}`, stats)
  return log
}

// ---------------------------------------------------------------------------
// enqueueDelayedRule — Tier 2: Cloud Tasks (Phase 3)
// ---------------------------------------------------------------------------

export interface DelayedRulePayload {
  ruleId: string
  teamId: string
  sessionId: string
  contactIds: string[]
  idempotencyKey: string
}

/**
 * Enqueues a Cloud Task to execute an automation rule after a delay.
 * scheduleTime = sessionEndTime + rule.trigger.delayMinutes
 * idempotencyKey = "{ruleId}:{sessionId}" — first execution wins; duplicates are no-ops.
 *
 * Uses firebase-admin/functions (getFunctions().taskQueue) which requires the
 * executeDelayedRule function to be deployed and registered as a task queue handler.
 * For local emulator dev, set CLOUD_TASKS_EMULATOR_HOST=localhost:9499.
 */
export async function enqueueDelayedRule(
  rule: AutomationRule,
  teamId: string,
  sessionId: string,
  sessionEndTime: Date,
  contactIds: string[]
): Promise<void> {
  const { getFunctions } = await import('firebase-admin/functions')
  const delayMs = (rule.trigger.delayMinutes || 0) * 60 * 1000
  const scheduleTime = new Date(sessionEndTime.getTime() + delayMs)
  const idempotencyKey = `${rule.id}:${sessionId}`

  const queue = getFunctions().taskQueue('executeDelayedRule')
  await queue.enqueue(
    {
      ruleId: rule.id,
      teamId,
      sessionId,
      contactIds,
      idempotencyKey,
    } satisfies DelayedRulePayload,
    { scheduleTime }
  )

  console.log(
    `[automationEngine] enqueued delayed rule=${rule.id} session=${sessionId} at=${scheduleTime.toISOString()}`
  ) // eslint-disable-line no-console
}

// ---------------------------------------------------------------------------
// fireEventRules — used by Tier 1 event triggers (Phase 2)
// ---------------------------------------------------------------------------

/**
 * Finds all active automation rules for the given team and triggerType,
 * then runs each against the supplied subjects.
 * Called by onContactWrite, onBookingWrite, onSessionWrite, onAffiliationWrite triggers.
 *
 * @param context  Trigger-supplied data. Scopes inbound_webhook rules by endpoint,
 *                 and its `payload` is exposed to action templates as {{payload.*}}.
 * @param delta  For subscription_added/removed and affiliation_added/removed: the specific
 *               type that changed. Rules with a matching trigger.subscriptionTypeId or
 *               trigger.affiliationTypeKey are scoped to this delta; absent/empty = match any.
 *               Unused for all other trigger types — pass undefined or omit.
 */
export async function fireEventRules(
  teamId: string,
  triggerType: AutomationTriggerType,
  subjects: ContactData[],
  context?: AutomationContext,
  delta?: EventDelta
): Promise<void> {
  const db = admin.firestore()

  const [rulesErr, rulesSnap] = await to(
    db
      .collection('teams')
      .doc(teamId)
      .collection('automation_rules')
      .where('active', '==', true)
      .get()
  )
  if (rulesErr || !rulesSnap) {
    console.error(
      `[automationEngine] fireEventRules: error loading rules for team ${teamId}:`,
      rulesErr
    )
    return
  }

  const [teamErr, teamDoc] = await to(db.collection('teams').doc(teamId).get())
  const teamData =
    !teamErr && teamDoc && teamDoc.exists ? (teamDoc.data() as Record<string, unknown>) : {}

  // Automations are available on every paid tier (2026-06 overhaul): Studio/Org
  // get the full suite, while Free/Coach are "half active" — limited to the
  // triggers and actions of their ACTIVE modules and installed add-ons. That
  // limit is enforced at rule-creation time (the builder only offers core
  // actions plus the team's installed-plugin actions), so the engine simply
  // runs whatever rules the team was allowed to create. No tier is skipped here.

  for (const ruleDoc of rulesSnap.docs) {
    const rule = normalizeRule(ruleDoc.id, ruleDoc.data() as Record<string, unknown>)
    if (rule.trigger.type !== triggerType) continue

    // inbound_webhook rules are scoped to a specific endpoint
    if (
      triggerType === 'inbound_webhook' &&
      rule.trigger.webhook_endpoint_id &&
      rule.trigger.webhook_endpoint_id !== context?.webhook_endpoint_id
    )
      continue

    // Delta scoping for subscription_added / subscription_removed:
    // if the rule specifies a subscriptionTypeId, only fire when the delta matches.
    if (
      (triggerType === 'subscription_added' || triggerType === 'subscription_removed') &&
      rule.trigger.subscriptionTypeId &&
      rule.trigger.subscriptionTypeId !== delta?.subscriptionTypeId
    )
      continue

    // Delta scoping for affiliation_added / affiliation_removed:
    // if the rule specifies an affiliationTypeKey, only fire when the delta matches.
    if (
      (triggerType === 'affiliation_added' || triggerType === 'affiliation_removed') &&
      rule.trigger.affiliationTypeKey &&
      rule.trigger.affiliationTypeKey !== delta?.affiliationTypeKey
    )
      continue

    const log = await runRule(rule, subjects, teamId, teamData, {
      triggerTier: 'event',
      context,
    })

    // Write log and update rule metadata
    await to(db.collection('teams').doc(teamId).collection('automation_logs').add(log))
    await to(
      db.collection('teams').doc(teamId).collection('automation_rules').doc(rule.id).update({
        last_run_at: FieldValue.serverTimestamp(),
        last_run_sent: log.actions_executed,
      })
    )
  }
}
