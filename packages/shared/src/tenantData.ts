// Canonical registry of where a single TENANT's (team's) data lives in Firestore
// and Cloud Storage. This is the single source of truth consumed by per-team
// teardown (purgeTeam) and future per-tenant export/GDPR tooling, so a new
// tenant-scoped collection only ever has to be registered in ONE place.
//
// A completeness test (packages/functions/src/saas-billing/tenantData.test.ts)
// asserts that every top-level `*_COLLECTION` constant is consciously classified
// here as tenant, platform, or retired — so adding a new top-level collection
// without classifying it fails CI rather than silently leaking out of teardown.

import {
  TEAMS_COLLECTION,
  CONTACTS_COLLECTION,
  SESSIONS_COLLECTION,
  ACTIVITIES_COLLECTION,
  EVENTS_COLLECTION,
  CHECKINS_COLLECTION,
  SESSION_SERIES_COLLECTION,
  COURSES_COLLECTION,
  FORMS_COLLECTION,
  DOCUMENTS_COLLECTION,
  COACH_AVAILABILITY_COLLECTION,
  REFERRAL_CODES_COLLECTION,
  REFERRALS_COLLECTION,
  CONNECT_ACCOUNTS_COLLECTION,
  SAAS_SUBSCRIPTIONS_COLLECTION,
  SITE_DRAFTS_COLLECTION,
  SITE_PUBLISHED_COLLECTION,
  EMBED_WIDGETS_COLLECTION,
  MESSAGING_POLICIES_COLLECTION,
  // platform-wide / cross-tenant
  USERS_COLLECTION,
  APP_SETTINGS_COLLECTION,
  SIGNUP_ALLOWLIST_COLLECTION,
  SIGNUP_INVITES_COLLECTION,
  PLATFORM_METRICS_COLLECTION,
  ORGANIZATIONS_COLLECTION,
  MAIL_SUPPRESSIONS_COLLECTION,
  MAIL_SENDS_COLLECTION,
  SMS_SUPPRESSIONS_COLLECTION,
  PROJECTS_COLLECTION,
  CATEGORIES_COLLECTION,
  CONNECT_WEBHOOK_EVENTS_COLLECTION,
  COACH_SLOTS_COLLECTION,
  ORG_SITE_DRAFTS_COLLECTION,
  ORG_SITE_PUBLISHED_COLLECTION,
} from './paths'

/** How a top-level collection's documents are matched to a team. */
export type TenantMatch =
  | { by: 'field'; field: string } // top-level docs where <field> == teamId
  | { by: 'docId' } // a single doc whose id IS the teamId

export interface TenantCollection {
  collection: string
  match: TenantMatch
  /**
   * Provider-side state that deleting the Firestore doc does NOT remove and which
   * must be torn down separately (e.g. cancel/disconnect the Stripe Connect
   * account and its member subscriptions). Surfaced so teardown can warn/handle it.
   */
  externalTeardown?: 'stripe_connect'
}

/**
 * The team document subtree: `teams/{teamId}` plus ALL of its subcollections
 * (team_members, installed_plugins, integrations, subscription_types, products,
 * member_payments, member_subscriptions, …). Removed wholesale by a recursive
 * delete, so its subcollections are intentionally NOT enumerated here.
 */
export const TENANT_TEAM_DOC_COLLECTION = TEAMS_COLLECTION

/** Cloud Storage path prefix holding all of a team's files. */
export function tenantStoragePrefix(teamId: string): string {
  return `${TEAMS_COLLECTION}/${teamId}/`
}

/**
 * Every TENANT-SCOPED top-level Firestore collection. Documents that match a
 * team are removed by per-team teardown; for `field` matches each matched doc is
 * recursively deleted so its own subcollections go too (e.g. contact goals,
 * session bookings, event attendees, course modules/lessons/purchases).
 *
 * NOTE: the `teams/{teamId}` subtree (TENANT_TEAM_DOC_COLLECTION) and the Storage
 * prefix (tenantStoragePrefix) are handled separately by the caller.
 */
export const TENANT_DATA_COLLECTIONS: TenantCollection[] = [
  { collection: CONTACTS_COLLECTION, match: { by: 'field', field: 'teamId' } },
  { collection: SESSIONS_COLLECTION, match: { by: 'field', field: 'teamId' } },
  { collection: ACTIVITIES_COLLECTION, match: { by: 'field', field: 'teamId' } },
  { collection: EVENTS_COLLECTION, match: { by: 'field', field: 'teamId' } },
  { collection: CHECKINS_COLLECTION, match: { by: 'field', field: 'teamId' } },
  { collection: SESSION_SERIES_COLLECTION, match: { by: 'field', field: 'teamId' } },
  { collection: COURSES_COLLECTION, match: { by: 'field', field: 'teamId' } },
  { collection: FORMS_COLLECTION, match: { by: 'field', field: 'teamId' } },
  { collection: DOCUMENTS_COLLECTION, match: { by: 'field', field: 'teamId' } },
  { collection: COACH_AVAILABILITY_COLLECTION, match: { by: 'field', field: 'teamId' } },
  // referrals key the team via `team_id`; referral_codes via `teamId`.
  { collection: REFERRALS_COLLECTION, match: { by: 'field', field: 'team_id' } },
  { collection: REFERRAL_CODES_COLLECTION, match: { by: 'field', field: 'teamId' } },
  // connect_accounts is keyed by the Stripe account id but carries a teamId field.
  // Deleting the doc does not cancel the Stripe account/subscriptions — see externalTeardown.
  {
    collection: CONNECT_ACCOUNTS_COLLECTION,
    match: { by: 'field', field: 'teamId' },
    externalTeardown: 'stripe_connect',
  },
  // SaaS rate-limit ledger (no paths.ts constant); keyed by a teamId field.
  { collection: 'saas_checkout_attempts', match: { by: 'field', field: 'teamId' } },
  // doc id IS the teamId
  { collection: SAAS_SUBSCRIPTIONS_COLLECTION, match: { by: 'docId' } },
  { collection: SITE_DRAFTS_COLLECTION, match: { by: 'docId' } },
  { collection: SITE_PUBLISHED_COLLECTION, match: { by: 'docId' } },
  { collection: EMBED_WIDGETS_COLLECTION, match: { by: 'docId' } },
  // Operator-set outbound-delivery policy; doc id = teamId (or orgId/'system',
  // which per-team teardown never touches).
  { collection: MESSAGING_POLICIES_COLLECTION, match: { by: 'docId' } },
]

/**
 * Top-level collections that are PLATFORM-WIDE / cross-tenant and must NEVER be
 * touched by a per-team teardown. Enumerated so the completeness test can assert
 * every top-level collection is consciously classified (tenant vs platform).
 *
 * `organizations` spans multiple teams, so deleting one is not a single-tenant op.
 * `connect_webhook_events` are global Stripe idempotency markers.
 */
export const PLATFORM_COLLECTIONS: string[] = [
  USERS_COLLECTION,
  APP_SETTINGS_COLLECTION,
  SIGNUP_ALLOWLIST_COLLECTION,
  SIGNUP_INVITES_COLLECTION,
  PLATFORM_METRICS_COLLECTION,
  ORGANIZATIONS_COLLECTION,
  MAIL_SUPPRESSIONS_COLLECTION,
  MAIL_SENDS_COLLECTION,
  // Phone-number opt-outs span tenants (a number opts out globally, like a
  // bounced email address) — never part of a per-team teardown.
  SMS_SUPPRESSIONS_COLLECTION,
  PROJECTS_COLLECTION,
  CATEGORIES_COLLECTION,
  CONNECT_WEBHOOK_EVENTS_COLLECTION,
  // Org-level website docs are keyed by orgId (not teamId), so per-TEAM teardown
  // never touches them — they belong with the org itself.
  ORG_SITE_DRAFTS_COLLECTION,
  ORG_SITE_PUBLISHED_COLLECTION,
]

/**
 * Defined-but-retired top-level collections. `coach_slots` was removed — coaching
 * sessions now live in `sessions` (activityType === 'coaching'). Listed so the
 * completeness test stays green without misclassifying dead data as live.
 */
export const RETIRED_TOP_LEVEL_COLLECTIONS: string[] = [COACH_SLOTS_COLLECTION]
