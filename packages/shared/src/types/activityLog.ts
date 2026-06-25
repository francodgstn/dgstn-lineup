import type { Timestamp } from './common'

export type ActivityEventType =
  | 'contact_add'
  | 'contact_archive'
  | 'contact_unarchive'
  | 'contact_delete'
  | 'contact_type_change'
  | 'acquisition_stage_change'
  | 'acquisition_stage_correction'
  | 'rank_change'
  | 'subscription_change'
  | 'session_participant_add'
  | 'session_participant_delete'
  | 'booking_created'
  | 'booking_confirmed'
  | 'booking_cancelled'
  | 'booking_rebooked'
  | 'contact_login'
  | 'outreach_email_sent'
  | 'contact_anonymized'

export interface ActivityLogEntry {
  id: string
  event: ActivityEventType
  created_at: Timestamp
  parameters: {
    description: string
    [key: string]: unknown
  }
  refs: {
    contact?: string
    session?: string
    user: string  // teamId
  }
}

// Future analytics stream — NOT stored in Firestore long-term.
// Ship to Mixpanel / PostHog / Amplitude when a platform is chosen.
export interface AnalyticsEvent {
  name: string
  properties: Record<string, string | number | boolean | null>
}
