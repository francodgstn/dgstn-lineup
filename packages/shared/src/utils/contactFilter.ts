// The ONE contact predicate — "does this contact match this filter?" — shared by
// every surface: the contacts list, saved filter presets, dynamic contact groups,
// and the automation engine's `in_group` condition. Pure function of
// (contact, filter, ctx): no Firestore, no firebase imports (it ships to the
// client bundle).
//
// It replaces the previously-divergent implementations:
//  • apps/web contacts/page.tsx applyFiltersAndSearch (the contacts list)
//  • packages/functions automationEngine evaluateContactConditions (partially —
//    the automation conditions remain their own vocabulary; only group
//    membership is resolved through here)
//
// NEVER add a parallel contact-matching check. Extend this resolver, the same
// way resolvePaymentOptions owns coverage/pricing. Fixtures live in
// contactFilter.test.ts.
//
// Membership of a DYNAMIC group is always DERIVED here, never stored: there is
// no materialization step and nothing to invalidate. Every membership question
// is asked from a position that already holds the data — a page holding the
// contact list filters it, a page holding one contact tests that contact, and
// the automation scan tests the contact already in hand.

import type { Contact, ContactGroup } from '../types/contact'
import type { EngagementBand, EngagementThresholds } from '../types/engagement'
import { computeEngagementBand } from '../types/engagement'
import { waiverAcceptanceState, type WaiverAcceptanceState, type WaiverSignerFacts } from '../types/waiver'
import { expandGroupSelection } from './contactGroups'

// ─── filter shape ─────────────────────────────────────────────────────────────

export type InactivityPreset = 'never' | '30d' | '60d' | '90d'

/** systemId → selected level values */
export type RankFilter = Record<string, number[]>

/**
 * Age / birth-year window.
 *
 * Two modes, because they are genuinely different questions and sports use both:
 *  • 'age'        — the contact's age TODAY (min/max inclusive). "Kids 8–12".
 *  • 'birth_year' — the calendar year of birth (min/max inclusive). Competition
 *    and roster categories are year-based: a child born in December and one born
 *    the following January are the same category all season, but their current
 *    ages differ for eleven months of it.
 *
 * `includeUnknown` keeps contacts with no birthdate in the result — off by
 * default, since a missing birthdate is common and silently dropping those
 * contacts from an age-based group is the kind of thing nobody notices.
 */
export interface AgeFilter {
  mode: 'age' | 'birth_year'
  min: number | null
  max: number | null
  includeUnknown?: boolean
}

export type CustomFieldOp =
  | 'equals'
  | 'contains'
  | 'gt'
  | 'lt'
  | 'is_set'
  | 'is_empty'

/**
 * One condition against a Custom Fields plugin value (Contact.custom_fields,
 * keyed by CustomFieldDefinition.id). Dates are stored as ISO 'YYYY-MM-DD'
 * strings, so gt/lt compare correctly as plain string comparisons.
 */
export interface CustomFieldCondition {
  fieldId: string
  op: CustomFieldOp
  value?: string | number | boolean
}

/**
 * "Has this person accepted document X, and if not, what happened?"
 *
 * ONE document × the states it may be in. The states are `waiverAcceptanceState`'s
 * five, evaluated by that function and never re-derived here: supersession and
 * expiry are DERIVED facts (a `require_resign` publish moves one number and writes
 * zero signer rows), so a second state machine in a filter would disagree with the
 * gate the day a studio republished.
 *
 * It covers BOTH consent surfaces, because both write the same ledger: a document
 * shown at signup and a document required before booking each produce a signer
 * row, and this dimension asks about the row.
 *
 * `states: []` (or no documentId) = the dimension is off. The usual selection is
 * `['none']` — "everyone I have never got a signature from" — which is the whole
 * reason the dimension exists: a studio that makes a document mandatory needs to
 * find the people already on its books.
 */
export interface ConsentFilter {
  documentId: string
  states: WaiverAcceptanceState[]
}

export interface ContactFilter {
  /** Free-text over name + email. Part of the filter so saved presets capture it. */
  search: string
  stages: string[]           // AcquisitionStage values
  sources: string[]          // ContactSource values
  statuses: string[]         // 'active' (affiliated) / 'none'
  subscriptions: string[]    // subscription_type_id values; 'none' = no subscription
  groups: string[]           // contact_groups IDs; parents include subgroups
  engagement: EngagementBand[]
  tags: string[]
  hasAlerts: boolean
  pendingSignup: boolean
  sessionsMin: number | null
  sessionsMax: number | null
  inactivity: InactivityPreset | null
  rankFilter: RankFilter | null
  age: AgeFilter | null
  customFields: CustomFieldCondition[]
  consent: ConsentFilter | null
}

export const EMPTY_CONTACT_FILTER: ContactFilter = {
  search: '',
  stages: [], sources: [], statuses: [], subscriptions: [], groups: [],
  engagement: [], tags: [],
  hasAlerts: false, pendingSignup: false,
  sessionsMin: null, sessionsMax: null,
  inactivity: null, rankFilter: null, age: null, customFields: [],
  consent: null,
}

/**
 * Normalize a persisted/partial filter to a complete one. Saved presets and
 * group rules written before a dimension existed simply lack the key.
 *
 * Array/object fields are CLONED: a plain spread of EMPTY_CONTACT_FILTER would
 * hand every caller the same array instances, so one in-place edit anywhere
 * would silently rewrite every other filter in the app.
 */
export function normalizeContactFilter(filter: Partial<ContactFilter> | null | undefined): ContactFilter {
  const f = filter ?? {}
  return {
    search: f.search ?? '',
    stages: [...(f.stages ?? [])],
    sources: [...(f.sources ?? [])],
    statuses: [...(f.statuses ?? [])],
    subscriptions: [...(f.subscriptions ?? [])],
    groups: [...(f.groups ?? [])],
    engagement: [...(f.engagement ?? [])],
    tags: [...(f.tags ?? [])],
    hasAlerts: f.hasAlerts ?? false,
    pendingSignup: f.pendingSignup ?? false,
    sessionsMin: f.sessionsMin ?? null,
    sessionsMax: f.sessionsMax ?? null,
    inactivity: f.inactivity ?? null,
    rankFilter: f.rankFilter ? { ...f.rankFilter } : null,
    age: f.age ? { ...f.age } : null,
    customFields: (f.customFields ?? []).map((c) => ({ ...c })),
    consent: f.consent ? { ...f.consent, states: [...(f.consent.states ?? [])] } : null,
  }
}

/** A fresh empty filter — safe to mutate, unlike the shared EMPTY_CONTACT_FILTER. */
export function emptyContactFilter(): ContactFilter {
  return normalizeContactFilter(null)
}

/** Which dimensions carry a value — drives the chip row and the "N active" badge. */
export function activeFilterKeys(filter: Partial<ContactFilter> | null | undefined): (keyof ContactFilter)[] {
  const f = normalizeContactFilter(filter)
  const keys: (keyof ContactFilter)[] = []
  if (f.search.trim()) keys.push('search')
  if (f.stages.length) keys.push('stages')
  if (f.sources.length) keys.push('sources')
  if (f.statuses.length) keys.push('statuses')
  if (f.subscriptions.length) keys.push('subscriptions')
  if (f.groups.length) keys.push('groups')
  if (f.engagement.length) keys.push('engagement')
  if (f.tags.length) keys.push('tags')
  if (f.hasAlerts) keys.push('hasAlerts')
  if (f.pendingSignup) keys.push('pendingSignup')
  if (f.sessionsMin != null || f.sessionsMax != null) keys.push('sessionsMin')
  if (f.inactivity) keys.push('inactivity')
  if (f.rankFilter && Object.values(f.rankFilter).some((l) => l.length > 0)) keys.push('rankFilter')
  if (f.age && (f.age.min != null || f.age.max != null)) keys.push('age')
  if (f.customFields.length) keys.push('customFields')
  if (f.consent?.documentId && f.consent.states.length) keys.push('consent')
  return keys
}

export function countActiveFilters(filter: Partial<ContactFilter> | null | undefined): number {
  return activeFilterKeys(filter).length
}

/**
 * Every document id a set of filters asks about — the shopping list a caller
 * loads ledgers for before it evaluates anything.
 *
 * ONE derivation, shared by the contacts page (its own filter), the group
 * surfaces (every dynamic group's rule) and the automation engine (the same
 * rules, server-side). A caller that computed this itself would eventually load a
 * different set from the one the predicate reads, and the consent dimension fails
 * CLOSED — so the symptom would be a filter that silently matches nobody.
 */
export function consentDocumentIds(
  filters: (Partial<ContactFilter> | null | undefined)[]
): string[] {
  const ids = new Set<string>()
  for (const f of filters) {
    const consent = f?.consent
    if (consent?.documentId && (consent.states?.length ?? 0) > 0) ids.add(consent.documentId)
  }
  return [...ids].sort()
}

export function isEmptyContactFilter(filter: Partial<ContactFilter> | null | undefined): boolean {
  return activeFilterKeys(filter).length === 0
}

// ─── subject + context ────────────────────────────────────────────────────────

/** Tolerant timestamp: client Timestamp, admin Timestamp, raw doc data, or ISO. */
export type TimestampLike =
  | { toDate(): Date }
  | { seconds: number; nanoseconds?: number }
  | { _seconds: number }
  | Date
  | string
  | number
  | null
  | undefined

export function resolveTimestampMs(value: TimestampLike): number | null {
  if (value == null) return null
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value === 'string') {
    const ms = new Date(value).getTime()
    return Number.isNaN(ms) ? null : ms
  }
  if (value instanceof Date) return value.getTime()
  if (typeof (value as { toDate?: unknown }).toDate === 'function') {
    try {
      return (value as { toDate(): Date }).toDate().getTime()
    } catch {
      return null
    }
  }
  const secs =
    (value as { seconds?: number }).seconds ?? (value as { _seconds?: number })._seconds
  return typeof secs === 'number' ? secs * 1000 : null
}

/**
 * What the predicate may read off a contact. Deliberately structural and fully
 * optional so BOTH the client `Contact` and the functions' raw doc data satisfy
 * it without conversion.
 */
export interface ContactFilterSubject {
  /**
   * The contact's document id. Optional like everything else here — but the
   * `consent` dimension is the one that NEEDS it: a signer row is keyed on
   * contactId, so a subject with no id cannot be answered and is excluded rather
   * than defaulted into the "never signed" bucket.
   */
  id?: string
  firstname?: string
  lastname?: string
  email?: string
  acquisition_stage?: string
  source?: string
  affiliation_summary?: { has_active?: boolean }
  subscription_type_id?: string
  active_subscriptions?: { subscription_type_id: string }[]
  group_ids?: string[]
  tags?: string[]
  alerts_count?: number
  pending_signup?: boolean
  total_sessions?: number
  last_session_at?: TimestampLike
  created_at?: TimestampLike
  birthdate?: TimestampLike
  ranks?: Record<string, number>
  custom_fields?: Record<string, string | number | boolean>
}

export interface ContactFilterContext {
  /** All groups of the team — needed to expand parents and resolve dynamic rules. */
  groups?: ContactGroup[]
  engagementThresholds?: EngagementThresholds
  /**
   * documentId → that document's whole signature ledger, for every document the
   * `consent` dimension (or a dynamic group's consent rule) names.
   *
   * THIS IS HOW THE DIMENSION AVOIDS A PER-CONTACT FAN-OUT. `matchesFilter` is
   * pure and reads what the caller already holds, and "has this contact signed
   * document X" is not on the contact document — it is a row under
   * `documents/{X}/signers/{contactId}`. Asking per contact would be one read per
   * row of the list. So the CALLER loads the ledger ONCE PER DOCUMENT (a single
   * subcollection query, bounded by how many people ever signed that document —
   * never by how many contacts are being filtered) and hands the map in here.
   * The same map answers every contact in the list, every dynamic-group count and
   * every automation scan.
   *
   * A documentId with NO entry cannot be answered, and the predicate then matches
   * NOBODY — the same direction the group fallback takes: a partial context must
   * never silently widen a result set. A caller that forgets to load the ledger
   * therefore shows an empty list (visible) rather than everybody (wrong).
   */
  consent?: Record<string, ConsentLedger>
  /** Injectable clock — pass in tests; defaults to Date.now(). */
  nowMs?: number
}

/** One document's signature ledger, as the filter reads it. */
export interface ConsentLedger {
  /**
   * The floor a signature must meet: the policy entry's `min_valid_version` where
   * the document is a required waiver, else the document's own. Moved by a
   * `require_resign` publish, which is what makes a signature `superseded`.
   */
  minValidVersion: number
  /** contactId → the four facts `waiverAcceptanceState` reads. ABSENT means never
   *  signed, which is `none` — the common case, and the one a studio filters for. */
  signers: Record<string, WaiverSignerFacts>
}

// ─── age ──────────────────────────────────────────────────────────────────────

/** Calendar-correct age in whole years (not a 365.25-day division). */
export function calcAgeYears(birthMs: number, nowMs: number): number {
  const b = new Date(birthMs)
  const n = new Date(nowMs)
  let age = n.getFullYear() - b.getFullYear()
  const monthDelta = n.getMonth() - b.getMonth()
  if (monthDelta < 0 || (monthDelta === 0 && n.getDate() < b.getDate())) age--
  return age
}

function matchesAge(subject: ContactFilterSubject, age: AgeFilter, nowMs: number): boolean {
  const birthMs = resolveTimestampMs(subject.birthdate)
  if (birthMs === null) return age.includeUnknown === true
  const value = age.mode === 'birth_year'
    ? new Date(birthMs).getFullYear()
    : calcAgeYears(birthMs, nowMs)
  if (age.min != null && value < age.min) return false
  if (age.max != null && value > age.max) return false
  return true
}

// ─── custom fields ────────────────────────────────────────────────────────────

function matchesCustomField(subject: ContactFilterSubject, cond: CustomFieldCondition): boolean {
  const raw = subject.custom_fields?.[cond.fieldId]
  const isEmpty = raw === undefined || raw === null || raw === ''
  switch (cond.op) {
    case 'is_set':   return !isEmpty
    case 'is_empty': return isEmpty
    case 'equals':
      if (isEmpty) return false
      if (typeof raw === 'boolean') return raw === (cond.value === true || cond.value === 'true')
      return String(raw).toLowerCase() === String(cond.value ?? '').toLowerCase()
    case 'contains':
      if (isEmpty) return false
      return String(raw).toLowerCase().includes(String(cond.value ?? '').toLowerCase())
    case 'gt':
    case 'lt': {
      if (isEmpty) return false
      // Numbers compare numerically; ISO 'YYYY-MM-DD' dates compare lexically.
      if (typeof raw === 'number') {
        const other = Number(cond.value)
        if (Number.isNaN(other)) return false
        return cond.op === 'gt' ? raw > other : raw < other
      }
      const a = String(raw)
      const b = String(cond.value ?? '')
      return cond.op === 'gt' ? a > b : a < b
    }
    default:
      return true
  }
}

// ─── group membership ─────────────────────────────────────────────────────────

/**
 * Is this contact in this group?
 *
 * Manual group  → membership is the stored `group_ids` array.
 * Dynamic group → membership is DERIVED by evaluating the group's rule right
 *   here, right now. Nothing is stored and nothing can go stale.
 *
 * The `groups` dimension is stripped when evaluating a dynamic rule: a dynamic
 * group whose rule filters on group membership could recurse (A → B → A), so
 * the dimension is structurally unavailable inside a rule rather than merely
 * discouraged in the editor.
 */
export function contactMatchesGroup(
  subject: ContactFilterSubject,
  group: ContactGroup,
  ctx: ContactFilterContext = {},
): boolean {
  if (group.rule) {
    return matchesFilter(subject, toGroupRule(group.rule), ctx)
  }
  return (subject.group_ids ?? []).includes(group.id)
}

/**
 * Every group the contact belongs to, manual or dynamic. Asked from the contact
 * side (detail-page chips): O(groups), and it needs no contact list at all.
 */
export function groupsForContact(
  subject: ContactFilterSubject,
  groups: ContactGroup[],
  ctx: ContactFilterContext = {},
): ContactGroup[] {
  return groups.filter((g) => contactMatchesGroup(subject, g, ctx))
}

/**
 * Members of a group out of an already-loaded list. Asked from the list side
 * (groups page, counts, bulk targets).
 */
export function membersOfGroup<T extends ContactFilterSubject>(
  contacts: T[],
  group: ContactGroup,
  ctx: ContactFilterContext = {},
): T[] {
  return contacts.filter((c) => contactMatchesGroup(c, group, ctx))
}

/** Does the contact belong to ANY of the selected groups (descendants included)? */
function matchesGroupSelection(
  subject: ContactFilterSubject,
  selected: string[],
  ctx: ContactFilterContext,
): boolean {
  const all = ctx.groups ?? []
  const wanted = expandGroupSelection(all, selected)
  const byId = new Map(all.map((g) => [g.id, g]))
  const memberIds = subject.group_ids ?? []
  for (const gid of wanted) {
    const group = byId.get(gid)
    if (!group) {
      // Group not loaded (or deleted): fall back to the stored membership so a
      // partial context can never silently widen the result set.
      if (memberIds.includes(gid)) return true
      continue
    }
    if (contactMatchesGroup(subject, group, ctx)) return true
  }
  return false
}

// ─── the predicate ────────────────────────────────────────────────────────────

/**
 * Does this contact match this filter? Every dimension is ANDed; within a
 * dimension, selected values are ORed.
 */
export function matchesFilter(
  subject: ContactFilterSubject,
  filter: Partial<ContactFilter> | null | undefined,
  ctx: ContactFilterContext = {},
): boolean {
  const f = normalizeContactFilter(filter)
  const nowMs = ctx.nowMs ?? Date.now()

  if (f.stages.length > 0) {
    if (!subject.acquisition_stage || !f.stages.includes(subject.acquisition_stage)) return false
  }

  if (f.sources.length > 0) {
    if (!subject.source || !f.sources.includes(subject.source)) return false
  }

  // Affiliation: 'active' (has_active) vs 'none' (not affiliated). Both = no filter.
  if (f.statuses.length > 0) {
    const wantsActive = f.statuses.includes('active')
    const wantsNone = f.statuses.includes('none')
    if (wantsActive && !wantsNone && subject.affiliation_summary?.has_active !== true) return false
    if (wantsNone && !wantsActive && subject.affiliation_summary?.has_active === true) return false
  }

  // Subscription — reads BOTH the primary snapshot and active_subscriptions. The
  // contacts list renders from active_subscriptions, so a contact whose
  // subscriptions live only in that array used to be misfiltered as "none".
  if (f.subscriptions.length > 0) {
    const held = new Set<string>()
    if (subject.subscription_type_id) held.add(subject.subscription_type_id)
    for (const s of subject.active_subscriptions ?? []) {
      if (s?.subscription_type_id) held.add(s.subscription_type_id)
    }
    const wantsNone = f.subscriptions.includes('none')
    const wantedTypes = f.subscriptions.filter((s) => s !== 'none')
    const matched =
      (wantsNone && held.size === 0) ||
      wantedTypes.some((t) => held.has(t))
    if (!matched) return false
  }

  if (f.groups.length > 0) {
    if (!matchesGroupSelection(subject, f.groups, ctx)) return false
  }

  if (f.tags.length > 0) {
    const tags = subject.tags ?? []
    if (!f.tags.some((t) => tags.includes(t))) return false
  }

  if (f.hasAlerts && (subject.alerts_count ?? 0) <= 0) return false

  if (f.pendingSignup && subject.pending_signup !== true) return false

  if (f.sessionsMin != null && (subject.total_sessions ?? 0) < f.sessionsMin) return false
  if (f.sessionsMax != null && (subject.total_sessions ?? 0) > f.sessionsMax) return false

  if (f.inactivity) {
    const last = resolveTimestampMs(subject.last_session_at)
    if (f.inactivity === 'never') {
      if (last !== null) return false
    } else {
      const days = f.inactivity === '30d' ? 30 : f.inactivity === '60d' ? 60 : 90
      const cutoff = nowMs - days * 86_400_000
      if (!(last === null || last < cutoff)) return false
    }
  }

  if (f.rankFilter && Object.values(f.rankFilter).some((l) => l.length > 0)) {
    const matched = Object.entries(f.rankFilter).some(([systemId, levels]) => {
      if (!levels.length) return false
      const rank = subject.ranks?.[systemId]
      return rank != null && levels.includes(rank)
    })
    if (!matched) return false
  }

  // Engagement band — derived from attendance recency (last attended session,
  // falling back to join date) against the team's thresholds. Never stored.
  if (f.engagement.length > 0) {
    const refMs =
      resolveTimestampMs(subject.last_session_at) ?? resolveTimestampMs(subject.created_at)
    const band = computeEngagementBand(refMs, ctx.engagementThresholds, nowMs)
    if (!f.engagement.includes(band)) return false
  }

  if (f.age && (f.age.min != null || f.age.max != null)) {
    if (!matchesAge(subject, f.age, nowMs)) return false
  }

  for (const cond of f.customFields) {
    if (!cond.fieldId) continue
    if (!matchesCustomField(subject, cond)) return false
  }

  // Consent — "has this person accepted document X". The STATE comes from
  // `waiverAcceptanceState` and from nowhere else, so the filter and the booking
  // gate can never disagree about what a signature is worth.
  if (f.consent?.documentId && f.consent.states.length > 0) {
    const ledger = ctx.consent?.[f.consent.documentId]
    // No ledger, or a subject with no id: unanswerable. Excluded rather than
    // guessed — see ContactFilterContext.consent.
    if (!ledger || !subject.id) return false
    const state = waiverAcceptanceState(
      { min_valid_version: ledger.minValidVersion },
      ledger.signers[subject.id] ?? null,
      nowMs,
    )
    if (!f.consent.states.includes(state)) return false
  }

  const sq = f.search.trim().toLowerCase()
  if (sq) {
    const haystack = `${subject.firstname ?? ''} ${subject.lastname ?? ''}`.toLowerCase()
    if (!haystack.includes(sq) && !(subject.email ?? '').toLowerCase().includes(sq)) return false
  }

  return true
}

/** Convenience: filter a loaded list. */
export function filterContacts<T extends ContactFilterSubject>(
  contacts: T[],
  filter: Partial<ContactFilter> | null | undefined,
  ctx: ContactFilterContext = {},
): T[] {
  return contacts.filter((c) => matchesFilter(c, filter, ctx))
}

/**
 * The filter a dynamic group will ACTUALLY evaluate.
 *
 * The `groups` dimension cannot survive into a rule — a dynamic group filtering
 * on group membership can recurse (A -> B -> A), so it is stripped structurally
 * rather than merely discouraged. That makes this a LOSSY conversion: callers
 * that save a rule must save THIS, and preview from THIS, or the group will
 * quietly resolve to something wider than the list the user was looking at.
 */
export function toGroupRule(filter: Partial<ContactFilter> | null | undefined): ContactFilter {
  return { ...normalizeContactFilter(filter), groups: [] }
}

/** Would saving this filter as a dynamic rule drop a constraint? */
export function ruleWouldDropGroups(filter: Partial<ContactFilter> | null | undefined): boolean {
  return (filter?.groups?.length ?? 0) > 0
}

/** Narrowing helper so callers can pass a full `Contact` without casting. */
export type FilterableContact = Contact & ContactFilterSubject
