export interface ContactResidence {
  route?: string;
  street_number?: string;
  postal_code?: string;
  locality?: string;
  region?: string;
  country?: string;
  [key: string]: string | undefined;
}

/** @deprecated use affiliation_summary instead */
export type AffiliationStatus = 'guest' | 'requested' | 'being_checked' | 'almost_ready' | 'active' | 'expired';

/** Denormalized affiliation snapshot written by Cloud Functions to contacts/{id} */
export interface AffiliationSummary {
  has_active: boolean;
  types: string[];
  org_ids: string[];
}

export interface CoachBadgeConfig {
  key: string;
  label: string;
  icon?: string;
  description?: string;
}

export interface BadgeThresholds {
  attendance: { enabled: boolean; first_class: number; dedicated: number; committed: number; centurion: number; veteran: number };
  streak: { enabled: boolean; on_fire: number; unstoppable: number; legendary: number };
  score: { enabled: boolean; rising_star: number; monthly_star: number; superstar: number };
  leaderboard: { enabled: boolean; leader: number; top5: number; hall_of_fame: number };
  explorer: { enabled: boolean; explorer: number };
}

export interface GamificationSettings {
  badge_thresholds?: BadgeThresholds;
  coach_badges?: CoachBadgeConfig[];
}

export interface Contact {
  avatar_url: any;
  id: string;
  email: string;
  /** Set while a self-service deletion is pending. Nothing is destroyed until
   *  the date passes — see packages/shared/src/utils/contactDeletion.ts. */
  deletion_scheduled_for?: { seconds: number } | null;
  firstname?: string;
  lastname?: string;
  phone?: string;
  teamId?: string;
  teamName?: string | null;
  birthdate?: unknown;
  birthplace?: string;
  residence?: ContactResidence | null;
  gender?: string;
  notes?: string;
  /** @deprecated synced from affiliation_summary.has_active */
  membership_status?: AffiliationStatus;
  affiliation_summary?: AffiliationSummary;
  /** Current level per ranking-system id, e.g. `{ hmd: 5, kd: 2 }`. THE field —
   *  it mirrors `Contact.ranks` on the web. */
  ranks?: Record<string, number>;
  /**
   * @deprecated The pre-migration single scalar. The HMD migration DELETES this
   * field (`scripts/migration/transforms/contacts.ts`), so a migrated contact
   * reads `undefined` here — which is exactly how every belt in this app came to
   * render as "NO BELT". Read `ranks` instead; this survives only so a contact
   * who has not been migrated yet still shows something.
   */
  rank?: number;
  weight?: number;
  taxnumber?: string;
  subscription_type_id?: string;
  subscription_recurrence?: string;
  emergencyContact?: {
    name: string;
    phone: string;
  };
  last_seen_at?: any;
  last_login_at?: any;
  current_month_score?: number;
  current_streak?: number;
  max_streak?: number;
  total_sessions_count?: number;
  distinct_activities?: string[];
  times_leader?: number;
  times_top5?: number;
  custom_badges?: string[];
}

// 'page link' to one of the team's public surfaces (mirrors @linyup/shared
// SystemLinkTarget). Set → system link; unset → custom URL link.
export type SystemLinkTarget =
  | 'booking'
  | 'signup'
  | 'shop'
  | 'shop-subscriptions'
  | 'shop-products'
  | 'shop-courses'
  | 'space'
  | 'site';

export interface TeamLink {
  label: string;
  description?: string;
  url?: string;
  target?: SystemLinkTarget;
  showIcon?: boolean;
  iconName?: string;
}

export interface TeamSocialLink {
  platform: string; // instagram, facebook, youtube, whatsapp, website
  url: string;
}

export interface TeamCoach {
  name: string;
}

export interface TeamLegalLinks {
  gtcUrl?: string;
  privacyPolicyUrl?: string;
  regulationUrl?: string;
}

export interface TeamPublicProfile {
  id: string;
  name: string;
  description?: string;
  logo?: string;
  slug?: string;
  links?: TeamLink[];
  socialLinks?: TeamSocialLink[];
  profileImage?: string;
  referralEnabled?: boolean;
  appointmentsEnabled?: boolean;
  legalLinks?: TeamLegalLinks;
  coaches?: TeamCoach[];
}

// Appointment now maps to a Session with activityType === 'appointment'
export interface Appointment {
  id: string;
  teamId: string;
  templateId: string | null;
  providerId: string;
  providerName: string;
  activityName: string;
  description?: string;
  start: Date;
  end: Date;
  max_participants: number;
  /** Bookings holding capacity — the single counter both kinds use (an absent
   *  booking status = pending = holds a seat). */
  bookings_count: number;
  location?: string | null;
  /** Absent on the wire when nobody has booked yet — normalised to 'open' on read.
   *  'pending_payment' is a slot held while its buyer completes checkout; the
   *  member never sees one of their own (holds aren't their bookings yet). */
  status: 'open' | 'full' | 'cancelled' | 'pending_payment';
}

export type AppointmentBookingStatus = 'booked' | 'available' | 'full' | 'cancelled';

export interface AppointmentWithStatus extends Appointment {
  bookingStatus: AppointmentBookingStatus;
}

// ── Appointment availability (browse/book funnel) ──────────────────────────
// Mirrors the `listAvailability` callable's contract
// (packages/functions/src/appointments/window.ts). Availability is the ONLY
// source of bookable times — nothing is pre-generated; a Session is created
// lazily, overlap-safe, at booking time via `bookAppointment`.

/** Who may book an activity — the paid-access axis. Mirrors
 *  @linyup/shared's ActivityAccessTier (mobile has no dependency on that
 *  package, so this is a structural copy — keep in sync). */
export type ActivityAccessTier = 'open' | 'members' | 'subscription';

export interface ActivityAccessRule {
  type: ActivityAccessTier;
  /** For 'subscription': the team subscription_type ids that grant access. */
  subscriptionTypeIds?: string[];
}

export interface AvailabilityDay {
  dayMs: number;
  /** Free start times (epoch ms), keyed by duration in minutes (as a string). */
  slotsByDuration: Record<string, number[]>;
}

/** One bookable length of an appointment offering. Mirrors @linyup/shared's
 *  `ActivityDuration` (structural copy — keep in sync).
 *  `priceAmount` is major units; null/absent = unpriced. Mobile stays on the
 *  free path for now: a priced length the contact isn't covered for is refused
 *  by `bookAppointment` with `payment_required` (no checkout surface here yet). */
export interface AppointmentDuration {
  minutes: number;
  priceAmount?: number | null;
}

export interface AvailabilityActivity {
  activityId: string;
  activityName: string;
  durations: AppointmentDuration[];
  accessRule: ActivityAccessRule;
  location: string | null;
  onlineUrl: string | null;
  days: AvailabilityDay[];
}

export interface AvailabilityCoach {
  providerId: string;
  providerName: string | null;
  activities: AvailabilityActivity[];
}

export interface ReferralInfo {
  code: string;
  referralUrl: string;
}

export interface AuthToken {
  contactId: string;
  token: string;
  expiresAt: number;
  createdAt: number;
}

export interface WeeklyReport {
  id: string;
  iso_week: string;
  sessions_count: number;
}

export type SessionParticipationStatus = 'attended' | 'not attended' | 'booked' | 'book';

export interface SessionPublicProfile {
  id: string;
  activityId?: string;
  activityName?: string;
  teamId: string;
  start: Date;
  end: Date;
  locationName?: string;
  locationAddress?: string;
  locationMapsUrl?: string;
  providerName?: string;
  allowBooking?: boolean;
}

export interface SessionWithStatus extends SessionPublicProfile {
  status: SessionParticipationStatus;
}

export interface LeaderboardEntry {
  contact_id: string
  firstname: string
  lastname: string
  acquisition_stage?: string
  score: number
  rank: number
  streak: number
  max_streak?: number
}

export interface Leaderboard {
  month: string
  entries: LeaderboardEntry[]
  entries_count: number
  updated_at: Date
}

export interface AlertSchedule {
  type: 'sessions_countdown' | 'datetime';
  value: number | Date;
}

export interface ContactAlert {
  id: string;
  message: string;
  schedule: AlertSchedule;
  alert_type?: string;
  show_in_app: boolean;
  created_at: Date;
  archived_at: Date | null;
}

// ─── Coaching contract ───────────────────────────────────────────────────────
// Hand-mirrored from packages/shared/src/types/goal.ts — apps/mobile does not
// depend on @linyup/shared (see the RankingSystem note further down this file:
// wiring the workspace package in needs a Metro/monorepo resolution change of
// its own, not a type fix). Keep these shapes byte-for-byte equivalent to the
// shared source; if they drift, fix it there and re-copy, don't patch here.

export type GoalType = 'goal' | 'task'; // 'goal' = long-term with evaluations; 'task' = boolean homework
export type GoalStatus = 'open' | 'in_progress' | 'achieved' | 'abandoned';
export type GoalCreatedBy = 'coach' | 'student';
export type PerformanceContext = 'self' | '1to1';

export type ProfileKey = 'burnout_risk' | 'overreaching' | 'stuck' | 'coasting' | 'inconsistent' | 'balanced' | 'default';

export interface GoalEvaluation {
  id: string;
  evaluated_at: any; // Firestore Timestamp
  evaluated_by: GoalCreatedBy;
  score: number; // 1-5
  notes?: string | null;
  status_after: GoalStatus;
  edited?: boolean;
}

export interface Goal {
  id: string;
  type: GoalType;
  title: string;
  description?: string | null;
  status: GoalStatus;
  categories: string[]; // dimension keys — see FirestoreService.getCoachingDimensions
  created_by: GoalCreatedBy;
  created_at: any;
  target_date?: any; // Firestore Timestamp or null
  completed_at?: any | null; // set when a task is marked done (status → 'achieved')

  /**
   * The goal this step serves, for `type: 'task'`. Null/absent = unparented,
   * grouped under a VIRTUAL "General" heading (no document backs it). Always
   * null on `type: 'goal'`.
   */
  parent_goal_id?: string | null;

  /** Denormalized from the newest evaluation, written by the `onGoalWrite`
   *  Cloud Function trigger — never set from the client. */
  latest_score?: number | null;
  last_evaluated_at?: any | null;

  /** Stamped by the daily job the first time this goal is observed past its
   *  `target_date` — never set from the client. */
  overdue_at?: any | null;
}

export interface PerformanceIndicator {
  key: string;
  label: string;
}

export interface PerformanceCheckin {
  id: string;
  taken_at: any;
  filled_by: GoalCreatedBy;
  scores: Record<string, number>;
  notes?: string | null;
  context: PerformanceContext;
  /** Absent/null when the team's dimensions are not the canonical five — see
   *  utils/goalContract.ts's `detectPerformanceProfile`. */
  profile_key?: ProfileKey | null;
  primary_lever?: string | null;
  anchor?: string | null;
}


// --- Ranking systems -------------------------------------------------------
// Mirrors RankingSystem/RankLevel in @linyup/shared. Declared here rather than
// imported because apps/mobile does not depend on the shared package (see its
// package.json) - adding that dependency means Metro configuration and is a
// change of its own, not a bug fix.
//
// secondColor is the one field the shared type has no room for: it renders the
// two-tone badge for a split belt. Nothing writes it today - the platform stores
// one colour per level - so it is populated only by the deprecated legacy table.

export interface RankLevel {
  value: number;
  label: string;
  /** Primary colour, or the background behind an emoji. */
  color?: string;
  /** Second colour of a SPLIT level (Orange/Green, Blue/Red). */
  secondColor?: string;
  /** A single emoji standing for the level — a swim school's sea animal, say. */
  emoji?: string;
  /** Uploaded badge artwork. Wins over `emoji` when both are set. */
  imageUrl?: string;
}

export interface RankingSystem {
  id: string;
  name: string;
  levels: RankLevel[];
  is_primary?: boolean;
}
