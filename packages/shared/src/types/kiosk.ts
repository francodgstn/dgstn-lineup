// ─────────────────────────────────────────────────────────────────────────────
// Kiosk mode plugin — a fixed, public, low-chrome page for a studio's entrance
// tablet: schedule, now/next class, the team check-in QR, walk-in registration,
// and a standby media slideshow. Layout/structure is FIXED (not a builder); the
// studio only flips features on/off + minimal config.
//
//   • PRIVATE config → installed_plugins/kiosk.config  (KioskConfig)
//   • PUBLIC subset  → teams/{teamId}/public_profile.kiosk  (KioskPublicConfig)
//                      denormalized by syncTeamPublicProfile, MINUS the PIN.
// ─────────────────────────────────────────────────────────────────────────────

export type KioskScheduleView = 'week' | 'list'

export interface KioskMediaItem {
  url: string
  type: 'image' | 'video'
}

export interface KioskFeatures {
  /** Schedule calendar (week/list of upcoming bookable sessions). */
  schedule: boolean
  /** "Ongoing / next class" widget. */
  nowNext: boolean
  /** Display the team check-in QR (clients scan it with their phone). */
  checkinQr: boolean
  /** Walk-in registration (a newcomer signs up on the spot). */
  walkIn: boolean
  /** Fullscreen photo/video slideshow after an idle timeout. */
  standby: boolean
}

export interface KioskStandbyConfig {
  /** Idle seconds before the standby slideshow takes over. */
  idleSeconds: number
  media: KioskMediaItem[]
}

/** PIN gate (device pairing). The `pin` is PRIVATE — shown in the admin panel and
 *  verified server-side by the unlockKiosk callable, but NEVER denormalized to the
 *  world-readable public_profile. `epoch` is a revocation counter (rotate / sign-out
 *  all bumps it, invalidating already-paired devices). */
export interface KioskLockConfig {
  enabled: boolean
  pin?: string
  epoch: number
}

/** PRIVATE config — installed_plugins/kiosk.config (team-member read/owner write). */
export interface KioskConfig {
  title?: string
  features: KioskFeatures
  scheduleView: KioskScheduleView
  /** Optional: limit walk-in booking to these activity ids (empty ⇒ all). */
  walkInActivityIds?: string[]
  standby: KioskStandbyConfig
  lock: KioskLockConfig
}

/** The lock subset that IS safe to expose publicly — never the PIN. */
export interface KioskPublicLock {
  enabled: boolean
  epoch: number
}

/** PUBLIC subset — teams/{teamId}/public_profile.kiosk. No PIN. */
export interface KioskPublicConfig {
  title?: string
  features: KioskFeatures
  scheduleView: KioskScheduleView
  walkInActivityIds?: string[]
  standby: KioskStandbyConfig
  lock: KioskPublicLock
}

/** Config a freshly-installed kiosk starts from. */
export const DEFAULT_KIOSK_CONFIG: KioskConfig = {
  features: { schedule: true, nowNext: true, checkinQr: true, walkIn: true, standby: false },
  scheduleView: 'week',
  standby: { idleSeconds: 90, media: [] },
  lock: { enabled: false, epoch: 0 },
}

/** Strip the private PIN when denormalizing KioskConfig → public_profile. */
export function toKioskPublicConfig(c: KioskConfig): KioskPublicConfig {
  return {
    title: c.title,
    features: c.features,
    scheduleView: c.scheduleView,
    walkInActivityIds: c.walkInActivityIds,
    standby: c.standby,
    lock: { enabled: c.lock.enabled, epoch: c.lock.epoch },
  }
}
