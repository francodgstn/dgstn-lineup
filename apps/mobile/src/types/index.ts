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

export type GoalStatus = 'open' | 'in_progress' | 'achieved' | 'abandoned';
export type GoalCreatedBy = 'coach' | 'student';
export type PerformanceContext = 'self' | '1to1';

export type ProfileKey = 'burnout_risk' | 'overreaching' | 'stuck' | 'coasting' | 'inconsistent' | 'balanced' | 'default';

export interface GoalEvaluation {
  id: string;
  evaluated_at: any; // Firestore Timestamp
  evaluated_by: 'coach' | 'student';
  score: number; // 1-5
  notes?: string | null;
  status_after: GoalStatus;
  edited?: boolean;
}

export interface Goal {
  id: string;
  title: string;
  description?: string | null;
  status: GoalStatus;
  categories: string[]; // team-configurable tags, zero or more
  created_by: GoalCreatedBy;
  created_at: any;
  target_date?: any; // Firestore Timestamp or null
}

export interface PerformanceIndicator {
  key: string;
  label: string;
  icon?: string;
}

export interface PerformanceCheckin {
  id: string;
  taken_at: any;
  filled_by: 'coach' | 'student';
  scores: Record<string, number>;
  notes?: string | null;
  context: PerformanceContext;
  profile_key?: ProfileKey;
  primary_lever?: string;
  anchor?: string;
}
