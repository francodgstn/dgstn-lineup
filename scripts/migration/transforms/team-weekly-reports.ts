/**
 * Transform a copied HMD source `team_weekly_reports` doc to the Linyup contract.
 *
 * ── Source shape (written by hmd-lineup's getOrCreateTeamWeeklyReport / weeklyReports) ──
 *   iso_week                          string         keep
 *   generated_at / created_at         Timestamp      keep (whichever is present)
 *   active_contacts_count             number         keep
 *   contacts_count_by_stage           Record<stage,n> keep (same contract)
 *   contacts_count_by_membership_status Record<statusId,n>
 *                                                    HMD-specific; map 'active' count to
 *                                                    contacts_with_active_affiliation (see below)
 *   contacts_count_by_subscription_type Record<hmdDocId,n>
 *                                                    keyed by RAW HMD Firestore doc IDs — cannot
 *                                                    reliably remap to canonical Linyup type IDs
 *                                                    without a stored id→id map; DROPPED.
 *   contacts_count_by_recurrence      Record<rec,n>  DEPRECATED — DROPPED.
 *   sessions_count                    number         keep
 *   sessions_count_by_type            Record<type,n> keep
 *   bookings_count                    number         keep
 *   bookings_count_by_type            Record<type,n> keep
 *   trial_conversions_count           number         keep
 *   trial_dropouts_count              number         keep
 *   teamId                            string         redundant (doc path carries it) — drop
 *
 * ── Target shape (new contract) ──
 *   iso_week                          string
 *   generated_at                      Timestamp
 *   active_contacts_count             number
 *   contacts_count_by_stage           Record<stage,n>
 *   contacts_with_active_affiliation  number          derived: membership_status['active'] ?? 0
 *   contacts_count_by_affiliation_type Record<typeKey,n>
 *                                                    OMITTED for historical weeks. The source does
 *                                                    not track affiliation by type_key; HMD only
 *                                                    tracked membership_status. The live
 *                                                    weeklyReports Cloud Function will populate
 *                                                    this going forward from correctly-structured
 *                                                    contacts (contacts.affiliation_summary.types).
 *   contacts_with_active_subscription number         OMITTED for historical weeks. The source does
 *                                                    not track this directly; Contact.active_subscriptions
 *                                                    (the array the live function reads) is NOT
 *                                                    populated by the migration (it is
 *                                                    Stripe-webhook-maintained and would require
 *                                                    inventing fake Stripe state). Left for the
 *                                                    live function to populate going forward.
 *   contacts_count_by_subscription_type Record<canonicalId,n>
 *                                                    OMITTED. Source keys are raw HMD doc IDs;
 *                                                    no stored id→id mapping exists. Left for
 *                                                    the live function to populate going forward.
 *   sessions_count                    number
 *   sessions_count_by_type            Record<type,n>
 *   bookings_count                    number
 *   bookings_count_by_type            Record<type,n>
 *   trial_conversions_count           number
 *   trial_dropouts_count              number
 *
 * ── Derivation notes ──
 *
 * contacts_with_active_affiliation:
 *   Derived from `contacts_count_by_membership_status['active']` (the count of contacts
 *   whose membership_status was 'active' that week). This is the only status that maps
 *   to `active: true` in the affiliation system (mirrors ACTIVE_COUNTING_STATUS_IDS in
 *   transforms/contacts.ts). If the field is absent, defaults to 0.
 *
 * contacts_count_by_affiliation_type:
 *   Not derivable from the source — the source only had a flat membership_status count
 *   and did not decompose by affiliation type_key. Omitted so the live weeklyReports
 *   function fills it going forward.
 *
 * contacts_with_active_subscription / contacts_count_by_subscription_type:
 *   Not derivable — the source subscription_type keys in team_weekly_reports are raw
 *   HMD Firestore doc IDs that have no stored mapping to the canonical Linyup type IDs
 *   (essential / students / unlimited / intro_offer / one_time_class). The contact-level
 *   HEURISTIC name-match (matchSubscriptionType) cannot be applied retrospectively to
 *   aggregate counts. Additionally, Contact.active_subscriptions (the live function's
 *   data source) is absent on migrated contacts. Both fields are omitted for historical
 *   weeks; the live weeklyReports function populates them going forward.
 */

// The only HMD membership_status value that maps to `active: true` (mirrors
// ACTIVE_COUNTING_STATUS_IDS in transforms/contacts.ts — 'active' only).
const ACTIVE_MEMBERSHIP_STATUS = 'active'

/**
 * Transform one source `team_weekly_reports` document to the new field contract.
 *
 * @param src - Raw document data from the HMD source Firestore.
 * @returns A new document object conforming to the Linyup weekly-report contract.
 */
export function transformTeamWeeklyReport(
  src: Record<string, unknown>,
): Record<string, unknown> {
  // Start with a shallow copy; we will delete fields that must not propagate
  // and add/derive new fields.
  const out: Record<string, unknown> = { ...src }

  // ── DROPPED fields ──────────────────────────────────────────────────────────
  // contacts_count_by_recurrence: DEPRECATED per new contract.
  delete out.contacts_count_by_recurrence

  // contacts_count_by_membership_status: HMD-specific field — replaced by
  // affiliation fields below. Remove it from the output after reading from it.
  const byMembershipStatus =
    (src.contacts_count_by_membership_status as Record<string, number> | undefined) ?? {}
  delete out.contacts_count_by_membership_status

  // contacts_count_by_subscription_type: source keys are raw HMD doc IDs, not
  // canonical Linyup IDs. Cannot remap reliably. Dropped for historical weeks.
  delete out.contacts_count_by_subscription_type

  // teamId: redundant (the doc lives inside teams/{teamId}/team_weekly_reports).
  // The live weeklyReports function does not write it.
  delete out.teamId

  // ── DERIVED fields ──────────────────────────────────────────────────────────
  // contacts_with_active_affiliation: derive from the count of contacts whose
  // membership_status was 'active' that week. Defaults to 0 if no data.
  const activeAffiliationCount: number =
    typeof byMembershipStatus[ACTIVE_MEMBERSHIP_STATUS] === 'number'
      ? byMembershipStatus[ACTIVE_MEMBERSHIP_STATUS]
      : 0
  out.contacts_with_active_affiliation = activeAffiliationCount

  // contacts_count_by_affiliation_type: NOT derivable (source had no per-type
  // breakdown, only per-status). Omitted — the live function populates going forward.
  // (Do NOT write an empty map — the UI treats absence and empty map differently.)

  // contacts_with_active_subscription: NOT derivable (see module-level comment).
  // Omitted — the live function populates going forward.

  // contacts_count_by_subscription_type: NOT derivable (see module-level comment).
  // Omitted — the live function populates going forward.

  return out
}
