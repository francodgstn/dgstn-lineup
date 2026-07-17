import type { Timestamp } from './common'

// In-app feedback system (lead sandbox / beta feedback loop).
//
// Users of the tenant dashboard submit feedback docs (quick likert rating
// and/or free text, optionally scoped to app areas, with auto-attached page
// context and an optional screenshot). Ops can additionally push "prompt
// questions" that appear in the widget; users answer or mute them.
//
// Write posture:
// - feedback/{id}: client CREATE with strict rules validation; read/update
//   only via Admin SDK (operator console).
// - feedback_prompts/{id}: readable by any signed-in user; written only by
//   the operator console (Admin SDK).
// - The global on/off switch lives (flat, prefixed) on app_settings/public;
//   the notification config on app_settings/global_settings (private).

export type FeedbackType = 'general' | 'prompt_answer'
export type FeedbackStatus = 'new' | 'reviewed' | 'archived'

export const FEEDBACK_MESSAGE_MAX_LENGTH = 5000

/** App areas a feedback entry can be tagged with. Empty selection = general. */
export const FEEDBACK_SCOPES = [
  'scheduling',
  'bookings',
  'contacts',
  'payments',
  'automations',
  'offer',
  'public_pages',
  'settings',
  'other',
] as const
export type FeedbackScope = (typeof FEEDBACK_SCOPES)[number]

/** Auto-captured page context attached to every submission. */
export interface FeedbackContext {
  path: string
  title: string
  viewport: string // e.g. "1440x900"
  user_agent: string
  locale: string
}

/** feedback/{id} — one submission (general feedback or a prompt answer). */
export interface FeedbackDoc {
  type: FeedbackType
  /** 1–5 likert. Rules require rating OR message. */
  rating?: number
  message?: string
  /** Selected app areas; empty = general feedback. */
  scopes: FeedbackScope[]
  /** Set when type === 'prompt_answer'. */
  prompt_id?: string
  context: FeedbackContext
  team_id: string
  team_name: string
  plan: string
  created_by: string
  created_by_email: string
  created_at: Timestamp
  /** Storage path (feedback/{uid}/{uuid}.png) when a screenshot was attached. */
  screenshot_path?: string
  /** Rules force 'new' on create; ops mutates via Admin SDK. */
  status: FeedbackStatus
  reviewed_at?: Timestamp | null
  reviewed_by?: string | null
}

export type FeedbackPromptStatus = 'draft' | 'active' | 'closed'

/** feedback_prompts/{id} — an ops-authored question pushed to app users. */
export interface FeedbackPrompt {
  question: string
  description?: string | null
  /** Which answer inputs the prompt offers (at least one must be true). */
  allow_rating: boolean
  allow_text: boolean
  status: FeedbackPromptStatus
  created_at: Timestamp
  created_by: string // operator email
  activated_at?: Timestamp | null
  closed_at?: Timestamp | null
  /** Incremented by the onFeedbackCreated trigger for prompt answers. */
  answer_count?: number
}

/**
 * Feedback fields living (flat, prefixed) on the world-readable
 * app_settings/public doc — the global widget on/off switch.
 */
export interface FeedbackPublicSettings {
  feedback_enabled?: boolean
  feedback_updated_at?: Timestamp
  feedback_updated_by?: string | null
}

/**
 * Feedback notification config living (flat, prefixed) on the PRIVATE
 * app_settings/global_settings doc. Read fresh by the onFeedbackCreated
 * trigger — never through the module-cached getAppSettings().
 */
export interface FeedbackNotifySettings {
  feedback_notify_enabled?: boolean
  feedback_notify_emails?: string[]
}

/**
 * Per-user prompt state, stored at users/{uid}.feedback (merge-writes, same
 * pattern as OnboardingState) so it syncs across devices.
 */
export interface UserFeedbackState {
  mutedPrompts?: string[]
  answeredPrompts?: string[]
}
