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
export const CONTACT_FILTERS_SUBCOLLECTION = 'contact_filters'
export const CONTACT_GROUPS_SUBCOLLECTION = 'contact_groups'
export const OUTREACH_TEMPLATES_SUBCOLLECTION = 'outreach_templates'
export const AUTOMATION_RULES_SUBCOLLECTION = 'automation_rules'
export const AUTOMATION_LOGS_SUBCOLLECTION = 'automation_logs'
export const TEAM_REBUILD_JOBS_SUBCOLLECTION = 'rebuild_jobs'

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
export const TEAM_INTEGRATIONS_SUBCOLLECTION = 'integrations'
export const INSTALLED_PLUGINS_SUBCOLLECTION = 'installed_plugins'

export const PROJECTS_COLLECTION = 'projects'
export const CONTACTS_COLLECTION = 'contacts'
export const CONTACT_ALERTS_SUBCOLLECTION = 'contact_alerts'
export const CONTACT_WEEKLY_REPORTS_SUBCOLLECTION = 'contact_weekly_reports'
export const CONTACT_NOTES_SUBCOLLECTION = 'contact_notes'
export const CONTACT_GOALS_SUBCOLLECTION = 'goals'
export const CONTACT_TRAINING_CHECKINS_SUBCOLLECTION = 'training_checkins'
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

// Website plugin (studio site builder)
// site_drafts: PRIVATE working copy (manager+). site_published: PUBLIC snapshot
// (public read, written only by the publishWebsite Cloud Function). Both keyed by teamId.
export const SITE_DRAFTS_COLLECTION = 'site_drafts'
export const SITE_PUBLISHED_COLLECTION = 'site_published'
