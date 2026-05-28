// Generalized workflow automation engine for Lineup.
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
  | 'membership_status_changed'
  | 'subscription_changed'
  // Tier 1+2 — event trigger + optional Cloud Tasks delay
  | 'session_ended'
  // Inbound webhook — external system POSTs to a team's unique URL
  | 'inbound_webhook'
  // Always available
  | 'manual'

export type AutomationCondition =
  | { type: 'portal_booking_no_show'; delay_days?: number; delay_hours?: number }
  | { type: 'sessions_attended_exactly'; value: number }
  | { type: 'sessions_attended_min'; value: number }
  | { type: 'sessions_attended_max'; value: number }
  | { type: 'inactivity_days'; value: number }
  | { type: 'inactivity_days_max'; value: number }
  | { type: 'contact_type'; value: string }
  | { type: 'membership_status'; value: string }
  | { type: 'subscription'; value: string }
  | { type: 'subscription_missing' }            // legacy alias → subscription: none
  | { type: 'subscription_set' }                // legacy alias → subscription: any
  | { type: 'tag'; value: string }
  | { type: 'field_equals'; field: string; value: unknown }
  // Subscription renewal
  | { type: 'subscription_expires_in'; days: number }  // expires in ≤ N days (and not expired)
  // Lifecycle
  | { type: 'days_since_created'; value: number }       // created N+ days ago
  | { type: 'birthday_today' }                          // birthdate day+month matches today

export type AutomationAction =
  | { type: 'send_email'; templateId: string }
  | { type: 'create_alert'; presetId: string }
  | { type: 'assign_tag'; tag: string }
  | { type: 'remove_tag'; tag: string }
  | { type: 'update_field'; field: string; value: string | number | boolean | null }
  | { type: 'notify_team'; subject: string; body: string }
  | { type: 'log_activity'; message: string }
  | { type: 'webhook'; url: string }

export interface AutomationRule {
  id: string
  name: string
  active: boolean
  trigger: {
    type: AutomationTriggerType
    delayMinutes?: number
    webhook_endpoint_id?: string   // inbound_webhook: which endpoint fires this rule
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
  type?: string
  membership_status?: string
  subscription_type_id?: string
  total_sessions_count?: number
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
  // Subscription renewal condition
  membership_expiration?: Timestamp | { seconds: number; nanoseconds: number } | null
  [key: string]: unknown
}

export interface AutomationContext {
  /** Extra data passed by the triggering event (e.g. sessionId for session_ended) */
  [key: string]: unknown
}

export interface RunRuleOptions {
  dryRun?: boolean         // evaluate conditions but do not execute actions or mark sent
  triggerTier?: 'event' | 'delayed' | 'scheduled' | 'manual'
  force?: boolean          // bypass dedup (used by triggerAutomationRule callable)
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
      // legacy type alias
      (c as { type: string }).type === 'portal_booking_pending'
        ? { ...c, type: 'portal_booking_no_show' as const }
        : c
    )
  } else if (ruleData.trigger_type === 'no_show_trial_booking') {
    conditions = [
      {
        type: 'portal_booking_no_show',
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

  const trigger = ruleData.trigger && typeof ruleData.trigger === 'object'
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
 * portal_booking_no_show conditions are skipped — they are handled by
 * the booking-based execution path.
 */
export function evaluateContactConditions(
  conditions: AutomationCondition[],
  contact: ContactData,
  now: Date
): boolean {
  for (const cond of conditions) {
    switch (cond.type) {
      case 'portal_booking_no_show':
        // handled separately in booking path
        continue

      case 'sessions_attended_exactly':
        if ((contact.total_sessions_count || 0) !== cond.value) return false
        break

      case 'sessions_attended_min':
        if ((contact.total_sessions_count || 0) < cond.value) return false
        break

      case 'sessions_attended_max':
        if ((contact.total_sessions_count || 0) > cond.value) return false
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

      case 'contact_type':
        if (contact.type !== cond.value) return false
        break

      case 'membership_status':
        if (contact.membership_status !== cond.value) return false
        break

      case 'subscription':
        if (cond.value === 'none' && contact.subscription_type_id) return false
        if (cond.value === 'any' && !contact.subscription_type_id) return false
        if (cond.value !== 'none' && cond.value !== 'any' && contact.subscription_type_id !== cond.value)
          return false
        break

      // legacy aliases
      case 'subscription_missing':
        if (contact.subscription_type_id) return false
        break
      case 'subscription_set':
        if (!contact.subscription_type_id) return false
        break

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
        // unknown condition — pass (don't block)
        break
    }
  }
  return true
}

// ---------------------------------------------------------------------------
// Action execution helpers
// ---------------------------------------------------------------------------

interface ResolvedActions {
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
      if (!tmplErr && tmplDoc && tmplDoc.exists && (tmplDoc.data() as Record<string, unknown>).active) {
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
 * - assign_tag / webhook: Phase 2+ — no-ops, not errors
 */
function hasResolvableActions(actions: AutomationAction[], resolved: ResolvedActions): boolean {
  for (const a of actions) {
    if (a.type === 'send_email' && resolved.template) return true
    if (a.type === 'create_alert' && resolved.alertPreset) return true
    if (a.type === 'update_field') return true
    if (a.type === 'notify_team') return true
    if (a.type === 'log_activity') return true
    if (a.type === 'assign_tag') return true
    if (a.type === 'remove_tag') return true
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
  ruleId: string
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
          teamData
        )
        const rawBody = substituteVariables(
          resolved.template.body as string,
          contact,
          teamName,
          now,
          teamData
        )
        const htmlBody = renderBody(resolved.template, rawBody)
        const { html, text } = buildOutreachEmail({
          body: htmlBody,
          teamName,
          language: resolved.language,
          teamData,
        })
        await sendEmail({ to: contact.email!, subject, html, text })

        await to(
          logActivity(teamId, {
            date: FieldValue.serverTimestamp(),
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
          teamData
        )
        await createContactAlertDoc(contactId, teamId, contact, {
          schedule: { type: 'datetime', value: Timestamp.now() },
          message: alertMessage,
          alert_type: 'automation',
          show_in_app: (resolved.alertPreset.show_in_app as boolean) || false,
        })
        executed++
      }

      // update_field — write a whitelisted contact field
      if (action.type === 'update_field') {
        const ALLOWED_UPDATE_FIELDS = ['type', 'membership_status'] as const
        const field = action.field
        if (!(ALLOWED_UPDATE_FIELDS as readonly string[]).includes(field)) {
          console.log(`[automationEngine] update_field: field '${field}' not in allowlist, skipping`)
        } else {
          await admin.firestore().collection('contacts').doc(contactId).update({ [field]: action.value })
          await to(
            logActivity(teamId, {
              date: FieldValue.serverTimestamp(),
              event: 'automation_update_field',
              parameters: {
                description: `Automation set '${field}' to '${String(action.value)}' for ${contact.firstname || ''} ${contact.lastname || ''}.`.trim(),
                field,
                value: action.value,
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
          console.log(`[automationEngine] notify_team: no team email configured for team ${teamId}, skipping`)
        } else {
          const subject = substituteVariables(action.subject, contact, teamName, now, teamData)
          const rawBody = substituteVariables(action.body, contact, teamName, now, teamData)
          const htmlBody = renderBody({ body_mode: 'markdown' }, rawBody)
          const { html, text } = buildOutreachEmail({ body: htmlBody, teamName, teamData })
          await sendEmail({ to: toEmail, subject, html, text })
          executed++
        }
      }

      // log_activity — append a note to the team activity log
      if (action.type === 'log_activity') {
        const message = substituteVariables(action.message, contact, teamName, now, teamData)
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
        await admin.firestore().collection('contacts').doc(contactId).update({
          tags: FieldValue.arrayUnion(action.tag),
        })
        await to(
          logActivity(teamId, {
            date: FieldValue.serverTimestamp(),
            event: 'automation_assign_tag',
            parameters: {
              description: `Automation added tag '${action.tag}' to ${contact.firstname || ''} ${contact.lastname || ''}.`.trim(),
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
        await admin.firestore().collection('contacts').doc(contactId).update({
          tags: FieldValue.arrayRemove(action.tag),
        })
        await to(
          logActivity(teamId, {
            date: FieldValue.serverTimestamp(),
            event: 'automation_remove_tag',
            parameters: {
              description: `Automation removed tag '${action.tag}' from ${contact.firstname || ''} ${contact.lastname || ''}.`.trim(),
              tag: action.tag,
              rule_id: ruleId,
              automated: true,
            },
            refs: { contact: contactId, user: null },
          })
        )
        executed++
      }

      // webhook — POST a JSON payload to an external HTTPS endpoint
      if (action.type === 'webhook') {
        const url = action.url
        if (!url?.startsWith('https://')) {
          console.log(`[automationEngine] webhook: skipping non-HTTPS or empty URL for rule ${ruleId}`)
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
              type: contact.type,
              membership_status: contact.membership_status,
              total_sessions_count: contact.total_sessions_count,
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
                'User-Agent': 'Lineup-Automation/1.0',
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
      console.error(`[automationEngine] Action '${action.type}' failed for contact ${contactId}:`, (err as Error).message)
      failed++
    }
  }

  return { executed, failed }
}

// ---------------------------------------------------------------------------
// Booking-based rule path (portal_booking_no_show)
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

  const bookingCond = rule.conditions.find((c) => c.type === 'portal_booking_no_show') as
    | { type: 'portal_booking_no_show'; delay_days?: number; delay_hours?: number }
    | undefined

  const delayDays = bookingCond?.delay_days || Math.round(((bookingCond?.delay_hours || 24)) / 24) || 1
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
    console.error(`[automationEngine] Rule ${rule.id}: no executable action resources found, skipping`)
    stats.errors++
    return
  }

  for (const sessionDoc of allSessionDocs) {
    const [bookingsErr, bookingsSnap] = await to(
      sessionDoc.ref
        .collection('bookings')
        .where('fromPortal', '==', true)
        .where('status', '==', 'no_show')
        .get()
    )
    if (bookingsErr) {
      console.error(`[automationEngine] Error fetching bookings for session ${sessionDoc.id}:`, bookingsErr)
      stats.errors++
      continue
    }

    const eligible = bookingsSnap!.docs.filter((d) => options.force || !d.data().noShowOutreachSentAt)

    for (const bookingDoc of eligible) {
      stats.processed++
      const booking = bookingDoc.data()

      let contact: ContactData = {
        id: '',
        firstname: booking.firstname || '',
        lastname: booking.lastname || '',
        email: booking.email || '',
        total_sessions_count: 0,
      }
      const contactId: string = booking.contactId || booking.contact || ''
      if (contactId) {
        const [cErr, cDoc] = await to(db.collection('contacts').doc(contactId).get())
        if (!cErr && cDoc && cDoc.exists) {
          contact = { id: contactId, ...cDoc.data() as Omit<ContactData, 'id'> }
        }
      }

      if (!contact.email) { stats.skipped++; continue }
      if (contact.email_unsubscribed) { stats.skipped++; continue }
      if (!evaluateContactConditions(rule.conditions, contact, now)) { stats.skipped++; continue }

      if (options.dryRun) { stats.sent++; continue }

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

async function runContactRule(
  rule: AutomationRule,
  contacts: ContactData[],
  teamId: string,
  teamData: Record<string, unknown>,
  now: Date,
  stats: RuleStats,
  options: RunRuleOptions
): Promise<void> {
  const db = admin.firestore()

  console.log(`[automationEngine] rule=${rule.id} team=${teamId}: evaluating ${contacts.length} contacts`)

  const resolved = await resolveActionResources(rule.actions, teamId, teamData)
  if (!hasResolvableActions(rule.actions, resolved)) {
    console.error(`[automationEngine] Rule ${rule.id}: no executable action resources found, skipping`)
    stats.errors++
    return
  }

  for (const contact of contacts) {
    if (contact.deleted_at || contact.archived_at) continue
    if (!contact.email) { stats.skipped++; continue }
    if (contact.email_unsubscribed) { stats.skipped++; continue }

    // Dedup — skip if rule already fired for this contact recently (unless force=true)
    if (!options.force) {
      const lastSent = contact.outreach_rules_sent?.[rule.id]
      if (lastSent) {
        const lastMs = resolveTimestampMs(lastSent)
        if (lastMs !== null) {
          const windowMs = options.triggerTier === 'scheduled'
            ? 30 * 86400000  // 30-day window: lets re-engagement rules re-fire (e.g. inactivity)
            : 7 * 86400000   // 7-day window for event-triggered rules
          if (now.getTime() - lastMs < windowMs) { stats.skipped++; continue }
        }
      }
    }

    if (!evaluateContactConditions(rule.conditions, contact, now)) { stats.skipped++; continue }

    stats.processed++

    if (options.dryRun) { stats.sent++; continue }

    const { executed, failed } = await executeActionsForContact(
      contact.id,
      contact,
      rule.actions,
      resolved,
      teamId,
      teamData,
      rule.id
    )
    stats.sent += executed
    stats.errors += failed

    // Mark rule as sent for this contact
    if (executed > 0) {
      await to(
        db.collection('contacts').doc(contact.id).update({
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
 * For portal_booking_no_show rules, `contacts` is ignored — bookings are
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
  } else if (!rule.conditions.length) {
    console.log(`[automationEngine] Rule ${rule.id} has no conditions, skipping`)
    stats.skipped++
  } else {
    const hasBookingCondition = rule.conditions.some((c) => c.type === 'portal_booking_no_show')

    if (hasBookingCondition) {
      await runBookingRule(rule, teamId, teamData, now, stats, options)
    } else {
      await runContactRule(rule, contacts, teamId, teamData, now, stats, options)
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

  console.log(`[automationEngine] enqueued delayed rule=${rule.id} session=${sessionId} at=${scheduleTime.toISOString()}`) // eslint-disable-line no-console
}

// ---------------------------------------------------------------------------
// fireEventRules — used by Tier 1 event triggers (Phase 2)
// ---------------------------------------------------------------------------

/**
 * Finds all active automation rules for the given team and triggerType,
 * then runs each against the supplied subjects.
 * Called by onContactWrite, onBookingWrite, onSessionWrite triggers.
 */
export async function fireEventRules(
  teamId: string,
  triggerType: AutomationTriggerType,
  subjects: ContactData[],
  _context?: AutomationContext
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
    console.error(`[automationEngine] fireEventRules: error loading rules for team ${teamId}:`, rulesErr)
    return
  }

  const [teamErr, teamDoc] = await to(db.collection('teams').doc(teamId).get())
  const teamData = !teamErr && teamDoc && teamDoc.exists ? (teamDoc.data() as Record<string, unknown>) : {}

  // Plan gate: automation rules require club+ plan
  const teamPlan = (teamData.plan as string) || 'coach'
  if (!['club', 'org', 'enterprise'].includes(teamPlan)) {
    console.log(`[automationEngine] fireEventRules: team ${teamId} on plan '${teamPlan}' — automation requires club+, skipping`) // eslint-disable-line no-console
    return
  }

  for (const ruleDoc of rulesSnap.docs) {
    const rule = normalizeRule(ruleDoc.id, ruleDoc.data() as Record<string, unknown>)
    if (rule.trigger.type !== triggerType) continue

    // inbound_webhook rules are scoped to a specific endpoint
    if (
      triggerType === 'inbound_webhook' &&
      rule.trigger.webhook_endpoint_id &&
      rule.trigger.webhook_endpoint_id !== _context?.webhook_endpoint_id
    ) continue

    const log = await runRule(rule, subjects, teamId, teamData, {
      triggerTier: 'event',
    })

    // Write log and update rule metadata
    await to(
      db.collection('teams').doc(teamId).collection('automation_logs').add(log)
    )
    await to(
      db.collection('teams').doc(teamId).collection('automation_rules').doc(rule.id).update({
        last_run_at: FieldValue.serverTimestamp(),
        last_run_sent: log.actions_executed,
      })
    )
  }
}
