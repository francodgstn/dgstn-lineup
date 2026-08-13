// Firestore collection and subcollection path constants

export const USERS_COLLECTION = 'users'
export const USER_PUBLIC_PROFILE_SUBCOLLECTION = 'public_profile'

export const TEAMS_COLLECTION = 'teams'
export const TEAM_MEMBERS_SUBCOLLECTION = 'team_members'
export const TEAM_PLACES_SUBCOLLECTION = 'team_places'
export const TEAM_SESSIONS_TAGS_SUBCOLLECTION = 'sessions_tags'
export const TEAM_ACTIVITY_LOG_SUBCOLLECTION = 'activity_log'
export const TEAM_WEEKLY_REPORTS_SUBCOLLECTION = 'team_weekly_reports'
export const TEAM_INVITATIONS_SUBCOLLECTION = 'team_invitations'
export const CONTACT_REQUESTS_SUBCOLLECTION = 'contact_requests'
export const TEAM_ALERTS_SUBCOLLECTION = 'team_alerts'
export const ALERT_PRESETS_SUBCOLLECTION = 'alert_presets'
// Per-team overrides for customizable roles (currently only the Coach role).
// Doc id = the role id, e.g. teams/{teamId}/role_config/coach.
export const ROLE_CONFIG_SUBCOLLECTION = 'role_config'
export const SUBSCRIPTION_TYPES_SUBCOLLECTION = 'subscription_types'
export const PRODUCTS_SUBCOLLECTION = 'products'
export const CONTACT_FILTERS_SUBCOLLECTION = 'contact_filters'
export const CONTACT_GROUPS_SUBCOLLECTION = 'contact_groups'
export const OUTREACH_TEMPLATES_SUBCOLLECTION = 'outreach_templates'
export const AUTOMATION_RULES_SUBCOLLECTION = 'automation_rules'
export const AUTOMATION_LOGS_SUBCOLLECTION = 'automation_logs'
export const TEAM_REBUILD_JOBS_SUBCOLLECTION = 'rebuild_jobs'

// Platform-wide operator configuration (SMTP, etc.). Single well-known doc.
// Read by Cloud Functions (getAppSettings) and written by the operator console.
export const APP_SETTINGS_COLLECTION = 'app_settings'
export const GLOBAL_SETTINGS_DOC = 'global_settings'
// Public, world-readable subset of app settings (e.g. the signup flag). Kept in
// a SEPARATE doc from global_settings so the public read rule never exposes the
// private operator/SMTP config.
export const PUBLIC_SETTINGS_DOC = 'public'

// Signup gating (limited-launch). Both are Admin-SDK only (PII / security).
// signup_allowlist: emails permitted to create a Linyup account while public
// signup is closed. signup_invites: write-to-send-an-invite-email queue.
export const SIGNUP_ALLOWLIST_COLLECTION = 'signup_allowlist'
export const SIGNUP_INVITES_COLLECTION = 'signup_invites'

// SaaS-specific (new in Linyup)
export const SAAS_SUBSCRIPTIONS_COLLECTION = 'saas_subscriptions'
// Daily platform-wide operator metric snapshots (doc id = YYYY-MM-DD).
// Written by the capturePlatformMetrics function; read by the operator console.
export const PLATFORM_METRICS_COLLECTION = 'platform_metrics'
export const ORGANIZATIONS_COLLECTION = 'organizations'
export const ORG_MEMBERS_SUBCOLLECTION = 'org_members'
export const ORG_TEAMS_SUBCOLLECTION = 'org_teams'
export const ORG_INVITATIONS_SUBCOLLECTION = 'org_invitations'
export const ORG_ACCESS_REQUESTS_SUBCOLLECTION = 'org_access_requests'
export const ORG_AFFILIATION_STATUSES_SUBCOLLECTION = 'affiliation_statuses'
export const ORG_PLACES_SUBCOLLECTION = 'org_places'
// Affiliation type catalog — same subcollection name under organizations/{orgId}
// (org-wide types) AND teams/{teamId} (team-local types). See AffiliationType.
export const AFFILIATION_TYPES_SUBCOLLECTION = 'affiliation_types'
export const TEAM_INTEGRATIONS_SUBCOLLECTION = 'integrations'
export const INSTALLED_PLUGINS_SUBCOLLECTION = 'installed_plugins'
// Same subcollection name, under organizations/{orgId} instead of teams/{teamId}.
// Exported as a separate constant for clarity at call sites.
export const ORG_INSTALLED_PLUGINS_SUBCOLLECTION = 'installed_plugins'
// Well-known integration doc id for a studio's email sender configuration
// (teams|organizations/{id}/integrations/email_sender). See EmailSenderConfig.
export const EMAIL_SENDER_INTEGRATION_DOC = 'email_sender'

// Mail pipeline (Brevo). Both are Admin-SDK only — written by Cloud Functions
// (the webhook handler + mail service), never by clients.
// mail_suppressions: dead/complained recipients (doc id = sha256(email)).
// mail_sends: idempotency + delivery ledger (doc id = idempotency key).
export const MAIL_SUPPRESSIONS_COLLECTION = 'mail_suppressions'
export const MAIL_SENDS_COLLECTION = 'mail_sends'
// sms_suppressions: opted-out/undeliverable phone numbers (doc id = sha256(E.164)).
// Same Admin-SDK-only posture as the mail collections.
export const SMS_SUPPRESSIONS_COLLECTION = 'sms_suppressions'
// messaging_policies: OPERATOR-controlled per-tenant outbound-delivery policy
// (doc id = teamId | orgId | 'system'). Admin-SDK-only; see MessagingPolicy.
export const MESSAGING_POLICIES_COLLECTION = 'messaging_policies'
// Well-known integration doc id for a studio's SMS sender configuration
// (teams/{id}/integrations/sms_sender): { type, senderName, enabled }.
export const SMS_SENDER_INTEGRATION_DOC = 'sms_sender'

// In-app feedback (see types/feedback.ts).
// feedback: client CREATE with strict rules validation; read/update via the
// operator console only (Admin SDK). feedback_prompts: ops-authored prompt
// questions — any signed-in user reads, Admin-SDK-only writes.
export const FEEDBACK_COLLECTION = 'feedback'
export const FEEDBACK_PROMPTS_COLLECTION = 'feedback_prompts'

export const PROJECTS_COLLECTION = 'projects'
export const CONTACTS_COLLECTION = 'contacts'
export const CONTACT_ALERTS_SUBCOLLECTION = 'contact_alerts'
export const CONTACT_WEEKLY_REPORTS_SUBCOLLECTION = 'contact_weekly_reports'
export const CONTACT_NOTES_SUBCOLLECTION = 'contact_notes'
export const CONTACT_GOALS_SUBCOLLECTION = 'goals'
export const CONTACT_PERFORMANCE_CHECKINS_SUBCOLLECTION = 'performance_checkins'
export const CONTACT_SUBSCRIPTION_HISTORY_SUBCOLLECTION = 'subscription_history'
// Lesson-credit grants (pack purchases) — functions-only writes; see CreditGrant.
export const CONTACT_CREDIT_GRANTS_SUBCOLLECTION = 'credit_grants'
export const SUBSCRIPTION_TRANSITIONS_SUBCOLLECTION = 'subscription_transitions'
// Affiliation set — a contact may hold several (club + federation licence + grading).
export const CONTACT_AFFILIATIONS_SUBCOLLECTION = 'affiliations'

export const EVENTS_COLLECTION = 'events'
export const EVENT_TYPES_SUBCOLLECTION = 'event_types'
export const EVENT_CATEGORIES_SUBCOLLECTION = 'categories'
export const EVENT_INVITATIONS_SUBCOLLECTION = 'invitations'
export const EVENT_ATTENDEES_SUBCOLLECTION = 'attendees'
export const CHECKINS_COLLECTION = 'checkins'
export const SESSIONS_COLLECTION = 'sessions'
export const PARTICIPANTS_SUBCOLLECTION = 'participants'
// Class waitlist — sessions/{sessionId}/waitlist/{contactId}. The doc id is the
// contactId, exactly like `bookings`, so a second join is an idempotent write
// rather than a duplicate row. Written only by Cloud Functions (Admin SDK);
// every client write is denied. Deliberately NOT registered in tenantData.ts:
// tenant teardown uses recursiveDelete on the parent session.
export const WAITLIST_SUBCOLLECTION = 'waitlist'
export const MONTHLY_SCORES_SUBCOLLECTION = 'monthly_scores'
export const ACTIVITIES_COLLECTION = 'activities'
export const SESSION_SERIES_COLLECTION = 'session_series'

export const REFERRALS_COLLECTION = 'referrals'
export const REFERRAL_CODES_COLLECTION = 'referral_codes'

export const AVAILABILITY_COLLECTION = 'availability'
// Provider time-off that OVERRIDES the availability templates — a coach is
// unavailable in [start, end) even if a template would otherwise offer it.
export const AVAILABILITY_EXCEPTIONS_COLLECTION = 'availability_exceptions'
export const COACH_SLOTS_COLLECTION = 'coach_slots'
export const COACH_SLOT_BOOKINGS_SUBCOLLECTION = 'bookings'

export const CATEGORIES_COLLECTION = 'categories'

// Online Courses plugin (lightweight LMS)
export const COURSES_COLLECTION = 'courses'
export const COURSE_MODULES_SUBCOLLECTION = 'modules'
export const COURSE_LESSONS_SUBCOLLECTION = 'lessons'
// Lifetime entitlement granted when a contact buys a 'purchase'-tier course one-off.
// Doc id is the buyer's contactId; written only by the Connect webhook (admin SDK).
export const COURSE_PURCHASES_SUBCOLLECTION = 'purchases'

// Custom Forms plugin (form builder + submissions backend)
// forms/{formId}: team-scoped form (fields embedded on the doc).
// submissions: written ONLY by the submitForm Cloud Function (Admin SDK).
export const FORMS_COLLECTION = 'forms'
export const FORM_SUBMISSIONS_SUBCOLLECTION = 'submissions'

// Documents plugin (core operational documents: terms, privacy, regulations)
// documents/{documentId}: team-scoped, authored rich text OR an external link.
// The world-readable summary lives in the generic `public_profile` subcollection
// (written by syncDocumentPublicProfile) — no dedicated subcollection constant.
export const DOCUMENTS_COLLECTION = 'documents'

// Website plugin (studio site builder)
// site_drafts: PRIVATE working copy (manager+). site_published: PUBLIC snapshot
// (public read, written only by the publishWebsite Cloud Function). Both keyed by teamId.
export const SITE_DRAFTS_COLLECTION = 'site_drafts'
export const SITE_PUBLISHED_COLLECTION = 'site_published'
// Standalone embed widgets (decoupled from the published site). PUBLIC snapshot
// keyed by teamId; managers author it directly (no draft/publish split).
export const EMBED_WIDGETS_COLLECTION = 'embed_widgets'

// Organization website (org-level site builder). Mirrors the team site but keyed
// by orgId. org_site_drafts: PRIVATE working copy (org_admin). org_site_published:
// PUBLIC snapshot, written only by the publishOrgWebsite Cloud Function.
export const ORG_SITE_DRAFTS_COLLECTION = 'org_site_drafts'
export const ORG_SITE_PUBLISHED_COLLECTION = 'org_site_published'

// Stripe Connect (member → studio payments — studio's own Stripe balance).
// connect_accounts is TOP-LEVEL, keyed by the Stripe connected account id
// (acct_...), so the Connect webhook resolves event.account → teamId with a
// single direct doc get (no reverse query, no composite index). The per-payment
// and per-subscription records live under the owning team.
export const CONNECT_ACCOUNTS_COLLECTION = 'connect_accounts'
export const MEMBER_PAYMENTS_SUBCOLLECTION = 'member_payments'
export const MEMBER_SUBSCRIPTIONS_SUBCOLLECTION = 'member_subscriptions'

// In-app notifications for team managers/owners (e.g. org access requests).
// Written only by Cloud Functions (Admin SDK); clients read and mark-read.
export const NOTIFICATIONS_SUBCOLLECTION = 'notifications'

// BYO gateway ledger (Payrexx / Stripe-BYO). teams/{teamId}/payment_events/{id},
// doc id = `${gateway}:${gatewayRef}` for idempotency. Written only by the team
// webhook handlers + the updatePaymentRecord callable (Admin SDK); managers/owners
// read it for the payments dashboard and per-contact Payments tab. Unlike Connect,
// BYO records the payment even when no contact matches (assignment_status).
export const PAYMENT_EVENTS_SUBCOLLECTION = 'payment_events'

// Partner (aggregator) visit payout ledger — teams/{teamId}/partner_visits/{id},
// doc id = `${sessionId}_${contactId}`. One row per booking covered via a
// source:'aggregator' subscription type (FitPass, SportPass…); written by
// bookSession / cancelBooking (Admin SDK). Reporting only — see types/contact.ts.
export const PARTNER_VISITS_SUBCOLLECTION = 'partner_visits'
// Gift cards (E3): teams/{teamId}/gift_cards/{code} — the code is the doc id.
export const GIFT_CARDS_SUBCOLLECTION = 'gift_cards'
// Manager-mint claims: teams/{teamId}/gift_card_issues/{issueRef}. A create()
// on this doc is the serialisation point for issueGiftCard — whoever wins mints,
// everyone else reads the code back. Server-only: no firestore.rules block, and
// there is no `match /{document=**}` wildcard, so clients are denied by default.
export const GIFT_CARD_ISSUES_SUBCOLLECTION = 'gift_card_issues'
// No-show policy fees (E5): teams/{teamId}/policy_fees/{feeId}.
export const POLICY_FEES_SUBCOLLECTION = 'policy_fees'

// Idempotency markers for the Connect webhook (doc id = Stripe event id).
// Admin-SDK only; clients never read or write it.
export const CONNECT_WEBHOOK_EVENTS_COLLECTION = 'connect_webhook_events'

// Finance journal — the normalized, immutable money-event log all financial
// reporting derives from (see types/finance.ts). Written ONLY by Cloud Functions
// (webhooks + recordManualPayment + the backfill script); managers/owners read.
// Doc id is deterministic (financeTxnId) for idempotency across retries/backfill.
export const FINANCE_TRANSACTIONS_SUBCOLLECTION = 'finance_transactions'
// Derived monthly rollups (doc id = 'YYYY-MM'), regenerated from the journal by
// the monthlyFinanceReports cron — always overwritten (journal is source of truth).
export const FINANCE_MONTHLY_REPORTS_SUBCOLLECTION = 'finance_monthly_reports'

// Double-entry accounting (finance plugin — see types/accounting.ts).
// accounts: doc id = account code, owner-editable (name/active), system rows
// locked. settings: singleton doc. entries + period summaries: function-written
// only (corrections are reversal entries, never edits).
export const ACCOUNTING_ACCOUNTS_SUBCOLLECTION = 'accounting_accounts'
export const ACCOUNTING_SETTINGS_SUBCOLLECTION = 'accounting_settings'
export const ACCOUNTING_SETTINGS_DOC = 'config'
export const ACCOUNTING_ENTRIES_SUBCOLLECTION = 'accounting_entries'
export const ACCOUNTING_PERIOD_SUMMARIES_SUBCOLLECTION = 'accounting_period_summaries'
// Entry templates: owner-managed presets for manual entries (+ optional
// recurring auto-post — see accounting/templates.ts).
export const ACCOUNTING_ENTRY_TEMPLATES_SUBCOLLECTION = 'accounting_entry_templates'
