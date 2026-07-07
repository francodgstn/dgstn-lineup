// System-default automation rules provisioned for every NEW team (Firestore
// onTeamCreated trigger) and also offered in the web automation library so studios
// can reinstall/inspect them. Single source of truth — the web LibraryItem for the
// same system_key must render THIS shape (automationLibrary.ts references it).
//
// Unlike library installs (active: false, review-first), default-provisioned rules
// ship ACTIVE: most studios never think about lead hygiene, and anyone who cares
// can pause/edit the rule like any other automation.

/** Stable rule identity — doc field `system_key` on teams/{id}/automation_rules. */
export const TRIAL_CLEANUP_RULE_KEY = 'lib_trial_cleanup'

/** Days a never-attended trial booking may sit before the default rule archives it. */
export const TRIAL_CLEANUP_DEFAULT_DAYS = 30

/**
 * "Archive stale trial bookings" — archives (never deletes) trial leads that booked
 * but never attended within TRIAL_CLEANUP_DEFAULT_DAYS. Conditions/actions use the
 * automation engine's vocabulary (see functions utils/automationEngine.ts).
 */
export const TRIAL_CLEANUP_RULE = {
  system_key: TRIAL_CLEANUP_RULE_KEY,
  name: 'Archive stale trial bookings',
  trigger: { type: 'schedule_daily' },
  conditions: [
    { type: 'acquisition_stage', value: 'trial_booked' },
    { type: 'sessions_attended_exactly', value: 0 },
    { type: 'days_since_created', value: TRIAL_CLEANUP_DEFAULT_DAYS },
  ],
  actions: [{ type: 'archive_contact' }],
} as const
