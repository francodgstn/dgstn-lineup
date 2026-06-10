/**
 * Demo playground configuration for the public `/try` page.
 *
 * These accounts are seeded by `scripts/seed-sandbox.ts` into the `linyup-sandbox`
 * project (or the local emulator). Keep this list in sync with `SECTOR_PROFILES`
 * in that script — same login local-parts, team names and sectors.
 *
 * The demo password is intentionally public — these are throwaway demo tenants
 * with no real data, and the whole point of `/try` is one-click access.
 */

export const DEMO_PASSWORD = 'linyup123'

/** Demo mode gates the `/try` page + the login-page demo link. Set only in the
 *  sandbox env (apphosting.sandbox.yaml) and local `.env.local`. */
export function isDemoMode(): boolean {
  return process.env.NEXT_PUBLIC_DEMO_MODE === 'true'
}

export type DemoSector = 'sport' | 'wellness'

export interface DemoAccount {
  key: string          // login local-part: <key>@linyup.com
  email: string
  teamName: string
  sector: DemoSector
  sportType: string
  blurb: string
  accent: string       // matches the seeded portalAccentColor
}

export const DEMO_ACCOUNTS: DemoAccount[] = [
  // ── sport ──────────────────────────────────────────────────────────────────
  {
    key: 'grappling', email: 'grappling@linyup.com',
    teamName: 'Ronin Grappling Academy', sector: 'sport', sportType: 'Martial arts',
    blurb: 'A BJJ & no-gi gym with belt ranks, tournaments and packed mat schedules.',
    accent: '#dc2626',
  },
  {
    key: 'crossfit', email: 'crossfit@linyup.com',
    teamName: 'Forge CrossFit', sector: 'sport', sportType: 'CrossFit / Fitness',
    blurb: 'A functional-fitness box with WODs, performance levels and throwdowns.',
    accent: '#0f172a',
  },
  {
    key: 'tennis', email: 'tennis@linyup.com',
    teamName: 'Baseline Tennis Academy', sector: 'sport', sportType: 'Tennis',
    blurb: 'Group clinics, junior development and rating bands across the courts.',
    accent: '#16a34a',
  },
  // ── wellness ─────────────────────────────────────────────────────────────────
  {
    key: 'yoga', email: 'yoga@linyup.com',
    teamName: 'Lotus Yoga Studio', sector: 'wellness', sportType: 'Yoga / Pilates',
    blurb: 'Vinyasa, Yin and meditation with class packs, retreats and workshops.',
    accent: '#9333ea',
  },
  {
    key: 'pilates', email: 'pilates@linyup.com',
    teamName: 'Core Pilates Studio', sector: 'wellness', sportType: 'Yoga / Pilates',
    blurb: 'Reformer and mat classes with progression levels and small-group flows.',
    accent: '#0d9488',
  },
  {
    key: 'dance', email: 'dance@linyup.com',
    teamName: 'Rhythm Dance Studio', sector: 'wellness', sportType: 'Dance',
    blurb: 'Ballet, contemporary and hip-hop with grades, terms and a spring showcase.',
    accent: '#db2777',
  },
]
