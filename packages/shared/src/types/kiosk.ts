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

// 'calendar' = weekly time-grid planner; 'list' = simple stacked per-day rows.
// (Formerly 'week', a chip grid — replaced by the calendar.)
export type KioskScheduleView = 'calendar' | 'list'

// Kiosk appearance: force light/dark, or follow the device's system setting.
export type KioskTheme = 'light' | 'dark' | 'auto'

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
  theme: KioskTheme
  features: KioskFeatures
  scheduleView: KioskScheduleView
  /** Optional: limit walk-in booking to these GROUP-CLASS activity ids (empty ⇒ all). */
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
  theme: KioskTheme
  features: KioskFeatures
  scheduleView: KioskScheduleView
  walkInActivityIds?: string[]
  standby: KioskStandbyConfig
  lock: KioskPublicLock
}

/** Config a freshly-installed kiosk starts from. */
export const DEFAULT_KIOSK_CONFIG: KioskConfig = {
  theme: 'auto',
  features: { schedule: true, nowNext: true, checkinQr: true, walkIn: true, standby: false },
  scheduleView: 'calendar',
  standby: { idleSeconds: 90, media: [] },
  lock: { enabled: false, epoch: 0 },
}

/** Coerce a stored (possibly empty or partial) config into a complete
 *  KioskConfig by filling every field from DEFAULT_KIOSK_CONFIG. Freshly
 *  installed plugins persist `config: {}`, and older saved configs may be
 *  missing newly-added fields — normalizing keeps toKioskPublicConfig (and the
 *  admin UI) crash-safe and lets an incomplete config self-heal on the next
 *  denormalization. */
export function normalizeKioskConfig(config: Partial<KioskConfig> | undefined | null): KioskConfig {
  const c = config ?? {}
  return {
    ...DEFAULT_KIOSK_CONFIG,
    ...c,
    features: { ...DEFAULT_KIOSK_CONFIG.features, ...c.features },
    standby: { ...DEFAULT_KIOSK_CONFIG.standby, ...c.standby },
    lock: { ...DEFAULT_KIOSK_CONFIG.lock, ...c.lock },
  }
}

/** Strip the private PIN when denormalizing KioskConfig → public_profile.
 *  Pass output of normalizeKioskConfig — never a raw stored config, which may be
 *  empty/partial and would crash on the field reads below. Optional fields
 *  (title, walkInActivityIds) are omitted when unset rather than written as
 *  `undefined`, which the Firestore SDK rejects unless ignoreUndefinedProperties
 *  is on (it isn't in the seed scripts). */
export function toKioskPublicConfig(c: KioskConfig): KioskPublicConfig {
  const pub: KioskPublicConfig = {
    theme: c.theme,
    features: c.features,
    scheduleView: c.scheduleView,
    standby: c.standby,
    lock: { enabled: c.lock.enabled, epoch: c.lock.epoch },
  }
  if (c.title !== undefined) pub.title = c.title
  if (c.walkInActivityIds !== undefined) pub.walkInActivityIds = c.walkInActivityIds
  return pub
}
