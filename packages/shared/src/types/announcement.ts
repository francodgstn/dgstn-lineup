import type { Timestamp } from './common'

// Platform announcement bar — an OPS-controlled top banner shown across the web
// app (e.g. "this is a demo, data resets periodically" on the sandbox env).
// Stored on the world-readable app_settings/public doc so the web client can read
// it without auth (it must show on public routes too). Set from the OPS admin
// console. Deliberately minimal: text + on/off + a basic style preset.

export type AnnouncementStyle = 'info' | 'warning' | 'success'

/** Soft limit for the announcement text — a UI hint, not hard-enforced. */
export const ANNOUNCEMENT_MAX_LENGTH = 160

/**
 * Announcement fields live (flat, prefixed) on the existing app_settings/public
 * doc alongside other public platform config, so one cheap read covers them.
 */
export interface PlatformAnnouncement {
  announcement_enabled?: boolean
  announcement_text?: string | null
  announcement_style?: AnnouncementStyle
  announcement_updated_at?: Timestamp
  announcement_updated_by?: string | null
}
