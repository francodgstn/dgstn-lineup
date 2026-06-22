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
export const ORG_MEMBERSHIP_STATUSES_SUBCOLLECTION = 'membership_statuses'
export const ORG_PLACES_SUBCOLLECTION = 'org_places'
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

export const PROJECTS_COLLECTION = 'projects'
export const CONTACTS_COLLECTION = 'contacts'
export const CONTACT_ALERTS_SUBCOLLECTION = 'contact_alerts'
export const CONTACT_WEEKLY_REPORTS_SUBCOLLECTION = 'contact_weekly_reports'
export const CONTACT_NOTES_SUBCOLLECTION = 'contact_notes'
export const CONTACT_GOALS_SUBCOLLECTION = 'goals'
export const CONTACT_PERFORMANCE_CHECKINS_SUBCOLLECTION = 'performance_checkins'
export const CONTACT_SUBSCRIPTION_HISTORY_SUBCOLLECTION = 'subscription_history'
export const SUBSCRIPTION_TRANSITIONS_SUBCOLLECTION = 'subscription_transitions'

export const EVENTS_COLLECTION = 'events'
export const EVENT_TYPES_SUBCOLLECTION = 'event_types'
export const EVENT_CATEGORIES_SUBCOLLECTION = 'categories'
export const EVENT_INVITATIONS_SUBCOLLECTION = 'invitations'
export const EVENT_ATTENDEES_SUBCOLLECTION = 'attendees'
export const CHECKINS_COLLECTION = 'checkins'
export const SESSIONS_COLLECTION = 'sessions'
export const PARTICIPANTS_SUBCOLLECTION = 'participants'
export const MONTHLY_SCORES_SUBCOLLECTION = 'monthly_scores'
export const ACTIVITIES_COLLECTION = 'activities'
export const SESSION_SERIES_COLLECTION = 'session_series'

export const REFERRALS_COLLECTION = 'referrals'
export const REFERRAL_CODES_COLLECTION = 'referral_codes'

export const COACH_AVAILABILITY_COLLECTION = 'coach_availability'
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

// Website plugin (studio site builder)
// site_drafts: PRIVATE working copy (manager+). site_published: PUBLIC snapshot
// (public read, written only by the publishWebsite Cloud Function). Both keyed by teamId.
export const SITE_DRAFTS_COLLECTION = 'site_drafts'
export const SITE_PUBLISHED_COLLECTION = 'site_published'

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
// Idempotency markers for the Connect webhook (doc id = Stripe event id).
// Admin-SDK only; clients never read or write it.
export const CONNECT_WEBHOOK_EVENTS_COLLECTION = 'connect_webhook_events'
