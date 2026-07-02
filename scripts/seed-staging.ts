/**
 * Seed script for the **linyup-staging** Firebase project.
 *
 * Auth: uses gcloud Application Default Credentials (ADC). No service-account
 * JSON is required — run `gcloud auth application-default login` once if ADC is
 * not already active. The active ADC identity needs Editor (or Firebase Admin +
 * Datastore + Identity Toolkit Admin) on the project.
 *
 * Usage:
 *   pnpm seed:staging
 *
 * The script is idempotent: every document uses a deterministic ID and is
 * written with set(), so re-running overwrites rather than duplicating. To start
 * from a clean slate, run `pnpm reset:staging` first.
 *
 * ──────────────────────────────────────────────────────────────────────────────
 * What it creates — three SaaS plan tiers, all major features covered:
 *
 *   coach@linyup.com   / linyup123  →  plan: coach        (trial)
 *   studio@linyup.com    / linyup123  →  plan: studio       (active, 2 coaches)
 *   org@linyup.com     / linyup123  →  plan: organization (active, org admin)
 *
 *   Coach team:  Samurai Fight Academy        — 15 contacts
 *   Studio team: Iron Circle Gym              — 30 contacts, gamification, automations
 *   Org:         Titan Martial Arts Assoc.    — 2 member teams:
 *                  · Titan Combat Sports       — 20 contacts (owned by org admin)
 *                  · Titan Striking Lab        — 18 contacts (owned by 2nd coach)
 *
 *   Per team (where the plan allows the feature):
 *   - activities (group classes + 1 coaching) + public_profile
 *   - coach_availability template + generated coaching sessions (open/full mix)
 *   - subscription types (2-6 per team, internal + aggregator)
 *   - sessions: 4 past weeks + 4 upcoming weeks, with attendance + bookings
 *   - contacts with: identity, membership status, subscription, rank, notes,
 *     gamification (score, streak, badges, monthly_scores), alerts, goals/tasks
 *   - subscription_history, contact_weekly_reports, contact_alerts (show_in_app)
 *   - team activity_log
 *   - alert_presets + outreach_templates + automation_rules + automation_logs (studio+)
 *   - events + invitations + attendees
 *   - saas_subscriptions (mirrors what the Stripe webhook would write)
 *
 *   Auth users:
 *   - one coach (owner) per team + a second coach for studio / org-team-b
 *   - one student per team — uid `contact:{teamId}:{contactId}` with custom
 *     claims { contactId, teamId, sessionExpires } matching generateAuthToken().
 */

import admin from 'firebase-admin'
import { applicationDefault } from 'firebase-admin/app'
import {
  CONTACT_AFFILIATIONS_SUBCOLLECTION,
  AFFILIATION_TYPES_SUBCOLLECTION,
  ORG_AFFILIATION_STATUSES_SUBCOLLECTION,
  DEFAULT_ORG_AFFILIATION_STATUSES,
  orgAffiliationTypes,
  teamAffiliationTypes,
  buildAffiliationDoc,
  buildAffiliationSummary,
  statusCountsAsActive,
} from './lib/affiliations'
import {
  buildStorefrontPageLinks,
  buildBasicPageLinks,
  seedStoreProducts,
  seedStoreWebsite,
  seedStoreCourses,
} from './lib/storefront'
import { memberCapsFor, COACH_DEFAULT_CAPABILITIES } from './lib/roles'

const PROJECT_ID = 'linyup-staging'

admin.initializeApp({ credential: applicationDefault(), projectId: PROJECT_ID })

const auth = admin.auth()
const db = admin.firestore()
db.settings({ ignoreUndefinedProperties: true })

const STUDENT_SESSION_MS = 30 * 24 * 60 * 60 * 1000 // matches generateAuthToken

// ── helpers ───────────────────────────────────────────────────────────────────

const ts = (date: Date) => admin.firestore.Timestamp.fromDate(date)
const now = () => new Date()

function daysFromNow(n: number) {
  const d = new Date()
  d.setDate(d.getDate() + n)
  return d
}

function hoursOffset(base: Date, hours: number) {
  return new Date(base.getTime() + hours * 3_600_000)
}

function isoWeekLabel(date: Date): string {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()))
  const dayNum = d.getUTCDay() || 7
  d.setUTCDate(d.getUTCDate() + 4 - dayNum)
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1))
  const week = Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7)
  return `${d.getUTCFullYear()}-W${week.toString().padStart(2, '0')}`
}

function mondayOfWeeksAgo(n: number): Date {
  const d = new Date()
  const day = d.getDay()
  d.setDate(d.getDate() - (day === 0 ? 6 : day - 1) - n * 7)
  d.setHours(0, 0, 0, 0)
  return d
}

function monthLabel(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

function monthsAgo(n: number): Date {
  const d = new Date()
  d.setMonth(d.getMonth() - n)
  return d
}

// Deterministic pseudo-random in [0,1) from a string seed — keeps reruns stable.
function seededRand(seed: string): number {
  let h = 2166136261
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return ((h >>> 0) % 100000) / 100000
}

// Marketing-channel sources (excludes 'walk_in' — that's an entry, not a channel,
// and 'import', reserved for migrated contacts).
const SEED_SOURCES = ['website', 'referral', 'social', 'event', 'other'] as const

// Pick a deterministic marketing source for a seeded contact.
function pickSource(seed: string): (typeof SEED_SOURCES)[number] {
  return SEED_SOURCES[Math.floor(seededRand(seed + 'src') * SEED_SOURCES.length)]
}

// Derive the acquisition-axis fields written to a contact doc from the authoring
// `type` + whether the contact has attended. The old `type` field is NOT returned —
// it must not be written to the doc.
//   student  → joined / entry 'signup'  / converted_at
//   external → joined / entry 'import'  + 'external' tag (added at the call site)
//   trial    → trial_attended (attended) | trial_booked (no-show), entry 'booking'
function acquisitionFieldsFor(opts: {
  type: 'student' | 'trial' | 'external'
  hasAttended: boolean
  milestoneTs: admin.firestore.Timestamp
  seed: string
}): Record<string, unknown> {
  const { type, hasAttended, milestoneTs, seed } = opts
  const out: Record<string, unknown> = {
    acquisition_stage_updated_at: milestoneTs,
    source: pickSource(seed),
  }
  if (type === 'student') {
    out.acquisition_stage = 'joined'
    out.entry = 'signup'
    out.converted_at = milestoneTs
  } else if (type === 'external') {
    out.acquisition_stage = 'joined'
    out.entry = 'import'
    out.converted_at = milestoneTs
  } else {
    out.entry = 'booking'
    if (hasAttended) {
      out.acquisition_stage = 'trial_attended'
      out.trial_attended_at = milestoneTs
    } else {
      out.acquisition_stage = 'trial_booked'
      out.lead_acknowledged = false
    }
  }
  return out
}

// ── contact pool ────────────────────────────────────────────────────────────
// 32 entries, ordered so any prefix (15 / 18 / 20 / 30) yields a realistic mix
// of active students, trials, almost-ready leads, expired and external contacts.

type SubKind = 'monthly' | 'quarterly' | 'annual' | 'dropin' | 'aggregator' | null

interface PoolEntry {
  firstname: string
  lastname: string
  gender: 'M' | 'F'
  birthYear: number | null
  birthplace: string | null
  type: 'student' | 'trial' | 'external'
  status: 'active' | 'almost_ready' | 'under_review' | 'expired' | 'requested' | 'guest'
  totalSessions: number
  sub: SubKind
}

const CONTACT_POOL: PoolEntry[] = [
  {
    firstname: 'Luca',
    lastname: 'Ferrari',
    gender: 'M',
    birthYear: 1992,
    birthplace: 'Milan',
    type: 'student',
    status: 'active',
    totalSessions: 142,
    sub: 'monthly',
  },
  {
    firstname: 'Sofia',
    lastname: 'Bianchi',
    gender: 'F',
    birthYear: 1995,
    birthplace: 'Rome',
    type: 'student',
    status: 'active',
    totalSessions: 88,
    sub: 'annual',
  },
  {
    firstname: 'Alex',
    lastname: 'Müller',
    gender: 'M',
    birthYear: 1988,
    birthplace: 'Zurich',
    type: 'student',
    status: 'active',
    totalSessions: 210,
    sub: 'monthly',
  },
  {
    firstname: 'Chiara',
    lastname: 'Romano',
    gender: 'F',
    birthYear: 1999,
    birthplace: 'Naples',
    type: 'student',
    status: 'active',
    totalSessions: 34,
    sub: 'monthly',
  },
  {
    firstname: 'Matteo',
    lastname: 'Esposito',
    gender: 'M',
    birthYear: 1990,
    birthplace: 'Turin',
    type: 'student',
    status: 'active',
    totalSessions: 121,
    sub: 'annual',
  },
  {
    firstname: 'Julia',
    lastname: 'Weber',
    gender: 'F',
    birthYear: 2000,
    birthplace: 'Basel',
    type: 'student',
    status: 'almost_ready',
    totalSessions: 7,
    sub: 'dropin',
  },
  {
    firstname: 'David',
    lastname: 'Costa',
    gender: 'M',
    birthYear: 1993,
    birthplace: 'Lisbon',
    type: 'student',
    status: 'active',
    totalSessions: 56,
    sub: 'aggregator',
  },
  {
    firstname: 'Lorenzo',
    lastname: 'De Luca',
    gender: 'M',
    birthYear: 2003,
    birthplace: 'Palermo',
    type: 'trial',
    status: 'requested',
    totalSessions: 1,
    sub: null,
  },
  {
    firstname: 'Sara',
    lastname: 'Ricci',
    gender: 'F',
    birthYear: 1994,
    birthplace: 'Bologna',
    type: 'student',
    status: 'expired',
    totalSessions: 41,
    sub: null,
  },
  {
    firstname: 'Hannah',
    lastname: 'Fischer',
    gender: 'F',
    birthYear: 1997,
    birthplace: 'Bern',
    type: 'external',
    status: 'guest',
    totalSessions: 0,
    sub: null,
  },
  {
    firstname: 'Emma',
    lastname: 'Schneider',
    gender: 'F',
    birthYear: 2001,
    birthplace: 'Geneva',
    type: 'student',
    status: 'active',
    totalSessions: 29,
    sub: 'monthly',
  },
  {
    firstname: 'Radu',
    lastname: 'Ionescu',
    gender: 'M',
    birthYear: 1987,
    birthplace: 'Bucharest',
    type: 'student',
    status: 'active',
    totalSessions: 175,
    sub: 'annual',
  },
  {
    firstname: 'Nina',
    lastname: 'Moreau',
    gender: 'F',
    birthYear: 1991,
    birthplace: 'Paris',
    type: 'student',
    status: 'active',
    totalSessions: 96,
    sub: 'monthly',
  },
  {
    firstname: 'Kevin',
    lastname: 'Nguyen',
    gender: 'M',
    birthYear: 1998,
    birthplace: 'Lyon',
    type: 'trial',
    status: 'under_review',
    totalSessions: 2,
    sub: null,
  },
  {
    firstname: 'Tobias',
    lastname: 'Huber',
    gender: 'M',
    birthYear: 1996,
    birthplace: 'Lucerne',
    type: 'student',
    status: 'active',
    totalSessions: 48,
    sub: 'monthly',
  },
  {
    firstname: 'Valentina',
    lastname: 'Greco',
    gender: 'F',
    birthYear: 1993,
    birthplace: 'Catania',
    type: 'student',
    status: 'active',
    totalSessions: 63,
    sub: 'quarterly',
  },
  {
    firstname: 'Marco',
    lastname: 'Conti',
    gender: 'M',
    birthYear: 1997,
    birthplace: 'Florence',
    type: 'student',
    status: 'almost_ready',
    totalSessions: 5,
    sub: 'dropin',
  },
  {
    firstname: 'Amélie',
    lastname: 'Dupont',
    gender: 'F',
    birthYear: 2002,
    birthplace: 'Geneva',
    type: 'trial',
    status: 'requested',
    totalSessions: 0,
    sub: null,
  },
  {
    firstname: 'Jonas',
    lastname: 'Keller',
    gender: 'M',
    birthYear: 1989,
    birthplace: 'Zurich',
    type: 'student',
    status: 'active',
    totalSessions: 134,
    sub: 'annual',
  },
  {
    firstname: 'Léa',
    lastname: 'Martin',
    gender: 'F',
    birthYear: 1996,
    birthplace: 'Geneva',
    type: 'student',
    status: 'active',
    totalSessions: 72,
    sub: 'monthly',
  },
  {
    firstname: 'Andrei',
    lastname: 'Popescu',
    gender: 'M',
    birthYear: 1992,
    birthplace: 'Cluj',
    type: 'student',
    status: 'expired',
    totalSessions: 38,
    sub: null,
  },
  {
    firstname: 'Giulia',
    lastname: 'Marino',
    gender: 'F',
    birthYear: 2000,
    birthplace: 'Genoa',
    type: 'student',
    status: 'active',
    totalSessions: 24,
    sub: 'monthly',
  },
  {
    firstname: 'Felix',
    lastname: 'Wagner',
    gender: 'M',
    birthYear: 1985,
    birthplace: 'Basel',
    type: 'student',
    status: 'active',
    totalSessions: 188,
    sub: 'aggregator',
  },
  {
    firstname: 'Camille',
    lastname: 'Girard',
    gender: 'F',
    birthYear: 1999,
    birthplace: 'Lausanne',
    type: 'trial',
    status: 'requested',
    totalSessions: 1,
    sub: null,
  },
  {
    firstname: 'Stefan',
    lastname: 'Brunner',
    gender: 'M',
    birthYear: 1994,
    birthplace: 'St. Gallen',
    type: 'student',
    status: 'active',
    totalSessions: 81,
    sub: 'monthly',
  },
  {
    firstname: 'Aisha',
    lastname: 'Diallo',
    gender: 'F',
    birthYear: 1998,
    birthplace: 'Geneva',
    type: 'student',
    status: 'active',
    totalSessions: 52,
    sub: 'quarterly',
  },
  {
    firstname: 'Paolo',
    lastname: 'Russo',
    gender: 'M',
    birthYear: 1991,
    birthplace: 'Bari',
    type: 'student',
    status: 'almost_ready',
    totalSessions: 8,
    sub: 'dropin',
  },
  {
    firstname: 'Marie',
    lastname: 'Lefebvre',
    gender: 'F',
    birthYear: 1995,
    birthplace: 'Neuchâtel',
    type: 'student',
    status: 'active',
    totalSessions: 110,
    sub: 'annual',
  },
  {
    firstname: 'Dragan',
    lastname: 'Petrović',
    gender: 'M',
    birthYear: 1990,
    birthplace: 'Belgrade',
    type: 'student',
    status: 'active',
    totalSessions: 67,
    sub: 'monthly',
  },
  {
    firstname: 'Yuki',
    lastname: 'Tanaka',
    gender: 'F',
    birthYear: 1997,
    birthplace: 'Zurich',
    type: 'student',
    status: 'active',
    totalSessions: 45,
    sub: 'monthly',
  },
  {
    firstname: 'Thomas',
    lastname: 'Meier',
    gender: 'M',
    birthYear: 1986,
    birthplace: 'Winterthur',
    type: 'external',
    status: 'guest',
    totalSessions: 0,
    sub: null,
  },
  {
    firstname: 'Elena',
    lastname: 'Novak',
    gender: 'F',
    birthYear: 2001,
    birthplace: 'Ljubljana',
    type: 'student',
    status: 'active',
    totalSessions: 19,
    sub: 'monthly',
  },
]

// Badge catalogue — assigned by attendance milestones / behaviour.
function badgesFor(totalSessions: number, streak: number, seed: string): string[] {
  const out: string[] = []
  if (totalSessions >= 50) out.push('50_sessions')
  if (totalSessions >= 100) out.push('100_sessions')
  if (totalSessions >= 200) out.push('200_sessions')
  if (streak >= 4) out.push('streak_master')
  if (seededRand(seed + 'eb') > 0.6) out.push('early_bird')
  if (seededRand(seed + 'wr') > 0.75) out.push('weekend_warrior')
  return out
}

// ── per-team seed ─────────────────────────────────────────────────────────────

interface TeamSeed {
  uid: string
  email: string
  displayName: string
  teamId: string
  teamName: string
  teamSlug: string
  plan: 'coach' | 'studio' | 'organization'
  planStatus: 'trial' | 'active'
  accentColor: string
  tagline: string // portal home description (public_profile.description)
  portalGradient: string // BIO_LINK_GRADIENTS key (apps/web/src/lib/bioLink.ts)
  contactCount: number
  orgId?: string // set when the team is an org member team
  extraCoaches?: { uid: string; displayName: string; email: string }[]
}

async function seedTeam(opts: TeamSeed) {
  const {
    uid,
    email,
    displayName,
    teamId,
    teamName,
    teamSlug,
    plan,
    planStatus,
    accentColor,
    tagline,
    portalGradient,
    contactCount,
    orgId,
    extraCoaches = [],
  } = opts

  const automationsEnabled = plan !== 'coach'
  const gamificationEnabled = plan !== 'coach'

  // ── affiliation config ───────────────────────────────────────────────────────
  // Studio/Org teams enable the affiliation axis. Org-member teams issue at the
  // ORG level (federation licence + club); standalone studios issue a team-local
  // club membership. Coach plan stays single-surface (no axis).
  const affiliationsEnabled = plan === 'studio' || plan === 'organization'
  const affiliationTypeDefs = affiliationsEnabled
    ? orgId
      ? orgAffiliationTypes(orgId)
      : teamAffiliationTypes()
    : []
  const clubAffiliationType = affiliationTypeDefs.find((t) => t.key === 'club') ?? null

  // ── subscription types ──────────────────────────────────────────────────────
  const subscriptionTypeDefs =
    plan === 'coach'
      ? [
          {
            id: `${teamId}-sub-monthly`,
            name: 'Monthly Membership',
            description: 'Unlimited classes, billed monthly.',
            source: 'internal',
            price: 95,
            active: true,
          },
          {
            id: `${teamId}-sub-10class`,
            name: '10-Class Pack',
            description: 'Pre-paid block of 10 sessions.',
            source: 'internal',
            price: 180,
            active: true,
          },
          {
            id: `${teamId}-sub-dropin`,
            name: 'Drop-in',
            description: 'Pay per session, no commitment.',
            source: 'internal',
            price: 25,
            active: true,
          },
        ]
      : [
          {
            id: `${teamId}-sub-monthly`,
            name: 'Monthly Membership',
            description: 'Unlimited classes, billed monthly.',
            source: 'internal',
            price: 110,
            active: true,
          },
          {
            id: `${teamId}-sub-quarterly`,
            name: 'Quarterly Plan',
            description: '3-month commitment, 10% discount.',
            source: 'internal',
            price: 300,
            active: true,
          },
          {
            id: `${teamId}-sub-annual`,
            name: 'Annual Membership',
            description: 'Best value — 2 months free.',
            source: 'internal',
            price: 990,
            active: true,
          },
          {
            id: `${teamId}-sub-dropin`,
            name: 'Drop-in',
            description: 'Pay per session, no commitment.',
            source: 'internal',
            price: 30,
            active: true,
          },
          {
            id: `${teamId}-sub-fitpass`,
            name: 'FitPass Partner',
            description: 'Access via FitPass aggregator network.',
            source: 'aggregator',
            price: null,
            active: true,
          },
        ]
  const availableSubIds = new Set(subscriptionTypeDefs.map((s) => s.id))

  // Map a pool SubKind → concrete subscription type for this team.
  function resolveSub(
    kind: SubKind
  ): { id: string; name: string; recurrence: string | null } | null {
    if (!kind) return null
    const pick = (id: string, name: string, recurrence: string | null) =>
      availableSubIds.has(id)
        ? { id, name, recurrence }
        : { id: `${teamId}-sub-monthly`, name: 'Monthly Membership', recurrence: 'monthly' }
    switch (kind) {
      case 'monthly':
        return pick(`${teamId}-sub-monthly`, 'Monthly Membership', 'monthly')
      case 'quarterly':
        return pick(`${teamId}-sub-quarterly`, 'Quarterly Plan', 'quarterly')
      case 'annual':
        return pick(`${teamId}-sub-annual`, 'Annual Membership', 'annual')
      case 'dropin':
        return pick(`${teamId}-sub-dropin`, 'Drop-in', null)
      case 'aggregator':
        return pick(`${teamId}-sub-fitpass`, 'FitPass Partner', null)
    }
  }

  // ── ranking system ───────────────────────────────────────────────────────────
  const rankingSystemDefs =
    plan === 'coach'
      ? [
          {
            id: 'training-level',
            name: 'Training Level',
            is_primary: true,
            levels: [
              { value: 0, label: 'Beginner', color: '#6b7280' },
              { value: 1, label: 'Intermediate', color: '#2563eb' },
              { value: 2, label: 'Advanced', color: '#7c3aed' },
              { value: 3, label: 'Expert', color: '#dc2626' },
            ],
          },
        ]
      : [
          {
            id: 'bjj-belt',
            name: 'BJJ Belt',
            is_primary: true,
            levels: [
              { value: 0, label: 'White Belt', color: '#e5e7eb' },
              { value: 1, label: 'Blue Belt', color: '#1d4ed8' },
              { value: 2, label: 'Purple Belt', color: '#7e22ce' },
              { value: 3, label: 'Brown Belt', color: '#78350f' },
              { value: 4, label: 'Black Belt', color: '#111827' },
            ],
          },
        ]
  const rankSystemId = plan === 'coach' ? 'training-level' : 'bjj-belt'

  function rankFor(entry: PoolEntry): number | null {
    if (entry.type !== 'student') return null
    const s = entry.totalSessions
    if (plan === 'coach') return s < 10 ? 0 : s < 40 ? 1 : s < 90 ? 2 : 3
    return s < 15 ? 0 : s < 40 ? 1 : s < 80 ? 2 : s < 140 ? 3 : 4
  }

  // ── gamification settings ─────────────────────────────────────────────────────
  const gamificationSettings = gamificationEnabled
    ? {
        enabled: true,
        default_base_score: 10,
        streak_min_sessions: 2,
        monthly_cap: plan === 'organization' ? 300 : 200,
        time_multipliers: [
          { day: 1, start_hour: 6, end_hour: 9, multiplier: 1.5 },
          { day: 3, start_hour: 6, end_hour: 9, multiplier: 1.5 },
          { day: 6, start_hour: 7, end_hour: 10, multiplier: 1.3 },
        ],
      }
    : {
        enabled: false,
        default_base_score: 10,
        streak_min_sessions: 2,
        monthly_cap: 200,
        time_multipliers: [],
      }

  // ── auth users (owner + extra coaches) ────────────────────────────────────────
  await upsertAuthUser({ uid, email, displayName, password: 'linyup123' })
  for (const c of extraCoaches) {
    await upsertAuthUser({
      uid: c.uid,
      email: c.email,
      displayName: c.displayName,
      password: 'linyup123',
    })
  }

  // ── team doc ──────────────────────────────────────────────────────────────────
  const trialEndsAt = plan === 'coach' ? ts(daysFromNow(14)) : undefined
  const teamLanguage = 'en'
  // Coach plan can't install the storefront plugins (studio+ only), so it gets the
  // lighter link set; studio/org teams surface the full storefront.
  const portalLinks = plan === 'coach' ? buildBasicPageLinks() : buildStorefrontPageLinks()
  const bioLinkBackground = { type: 'gradient', color: portalGradient }
  await db
    .collection('teams')
    .doc(teamId)
    .set({
      name: teamName,
      description: tagline,
      slug: teamSlug,
      sport_type: 'Martial arts',
      language: teamLanguage,
      createdBy: uid,
      created: ts(daysFromNow(-220)),
      plan,
      plan_status: planStatus,
      ...(trialEndsAt ? { trial_ends_at: trialEndsAt } : {}),
      ...(affiliationsEnabled ? { affiliations_enabled: true } : {}),
      ...(orgId
        ? { org_id: orgId, organization_ids: [orgId], ranking_systems: [] }
        : { ranking_systems: rankingSystemDefs }),
      settings: { gamification: gamificationSettings, teamEmail: email },
      bioLinkTheme: 'light',
      bioLinkAccentColor: accentColor,
      bioLinkBackground,
      links: portalLinks,
      socialLinks: [{ platform: 'instagram', url: `https://instagram.com/${teamSlug}` }],
    })

  await db
    .collection('teams')
    .doc(teamId)
    .collection('public_profile')
    .doc(teamId)
    .set({
      type: 'team',
      name: teamName,
      description: tagline,
      slug: teamSlug,
      sport_type: 'Martial arts',
      profileImage: null,
      heroImage: null,
      bioLinkTheme: 'light',
      bioLinkAccentColor: accentColor,
      bioLinkBackground,
      socialLinks: [{ platform: 'instagram', url: `https://instagram.com/${teamSlug}` }],
      links: portalLinks,
      bookingSettings: {
        flowType: 'activity-first',
        windowMonths: 2,
        showPhone: true,
        ctaUrl: null,
        ctaLabel: null,
        showActivityDescription: true,
      },
      membershipRequiredFields: null,
      membershipOptionalFields: null,
      updated_at: ts(now()),
    })

  // ── team members (owner + extra coaches) ──────────────────────────────────────
  await db
    .collection('teams')
    .doc(teamId)
    .collection('team_members')
    .doc(uid)
    .set({
      teamId,
      userId: uid,
      role: 'owner',
      email,
      ...memberCapsFor('owner'),
      joined: ts(daysFromNow(-220)),
    })
  const [ownerFirst, ownerLast] = displayName.split(' ')
  await db
    .collection('users')
    .doc(uid)
    .set(
      {
        email,
        displayName,
        firstname: ownerFirst,
        lastname: ownerLast ?? '',
        currentTeam: teamId,
        created_at: ts(daysFromNow(-220)),
      },
      { merge: true }
    )

  for (const c of extraCoaches) {
    await db
      .collection('teams')
      .doc(teamId)
      .collection('team_members')
      .doc(c.uid)
      .set({
        teamId,
        userId: c.uid,
        // Extra staff are seeded as the own-scoped Coach role (they manage their own
        // contacts + schedule) so staging demonstrates the granular-roles feature.
        role: 'coach',
        email: c.email,
        ...memberCapsFor('coach'),
        joined: ts(daysFromNow(-150)),
        addedBy: uid,
      })
    const [cf, cl] = c.displayName.split(' ')
    await db
      .collection('users')
      .doc(c.uid)
      .set(
        {
          email: c.email,
          displayName: c.displayName,
          firstname: cf,
          lastname: cl ?? '',
          currentTeam: teamId,
          created_at: ts(daysFromNow(-150)),
        },
        { merge: true }
      )
  }

  // ── affiliation type catalog ──────────────────────────────────────────────────
  // Org-member teams write the ORG catalog (idempotent set); standalone studios
  // write a team-local 'club' type.
  for (const at of affiliationTypeDefs) {
    const parent = orgId
      ? db.collection('organizations').doc(orgId)
      : db.collection('teams').doc(teamId)
    await parent.collection(AFFILIATION_TYPES_SUBCOLLECTION).doc(at.id).set(at)
  }

  // ── activities (group classes + coaching) ─────────────────────────────────────
  const activities = [
    {
      id: `${teamId}-act-bjj`,
      name: 'Brazilian Jiu-Jitsu',
      slug: 'bjj',
      color: accentColor,
      level: 'all',
      isFreeTrial: true,
      type: 'group_class' as const,
      base_score: 12,
      description:
        'Gi grappling from fundamentals to advanced — positions, escapes and submissions.',
    },
    {
      id: `${teamId}-act-mma`,
      name: 'MMA',
      slug: 'mma',
      color: '#dc2626',
      level: 'intermediate',
      isFreeTrial: false,
      type: 'group_class' as const,
      base_score: 15,
      description: 'Striking-to-grappling transitions and cage craft for experienced athletes.',
    },
    {
      id: `${teamId}-act-kickbox`,
      name: 'Kickboxing',
      slug: 'kickboxing',
      color: '#ea580c',
      level: 'all',
      isFreeTrial: true,
      type: 'group_class' as const,
      base_score: 10,
      description: 'Pad work, combinations and conditioning — a serious workout for every level.',
    },
    {
      id: `${teamId}-act-yoga`,
      name: 'Yoga & Mobility',
      slug: 'yoga-mobility',
      color: '#059669',
      level: 'all',
      isFreeTrial: true,
      type: 'group_class' as const,
      base_score: 8,
      description: 'Recovery-focused mobility and breath work to keep you on the mats.',
    },
  ]
  for (const a of activities) {
    await db
      .collection('activities')
      .doc(a.id)
      .set({ ...a, teamId, isActive: true, created_at: ts(daysFromNow(-200)) })
    await db.collection('activities').doc(a.id).collection('public_profile').doc(a.id).set({
      type: 'activity',
      teamId,
      name: a.name,
      slug: a.slug,
      color: a.color,
      description: a.description,
      image_url: null,
      isFreeTrial: a.isFreeTrial,
      level: a.level,
    })
  }

  const coachingActId = `${teamId}-act-coaching`
  const coachingActName = plan === 'coach' ? 'Personal Training' : '1-on-1 Coaching'
  const coachingActDescription =
    'One-on-one session tailored to your goals — technique, strategy and conditioning.'
  await db
    .collection('activities')
    .doc(coachingActId)
    .set({
      teamId,
      name: coachingActName,
      slug: '1on1-coaching',
      color: accentColor,
      description: coachingActDescription,
      type: 'coaching',
      coachId: uid,
      coachName: displayName,
      level: 'all',
      isFreeTrial: true,
      isActive: true,
      created_at: ts(daysFromNow(-180)),
    })
  await db
    .collection('activities')
    .doc(coachingActId)
    .collection('public_profile')
    .doc(coachingActId)
    .set({
      type: 'activity',
      teamId,
      name: coachingActName,
      slug: '1on1-coaching',
      color: accentColor,
      description: coachingActDescription,
      image_url: null,
      isFreeTrial: true,
      level: 'all',
    })

  // ── coach availability template + coaching sessions ───────────────────────────
  const coachingTemplateId = `${teamId}-tpl-coaching`
  await db
    .collection('coach_availability')
    .doc(coachingTemplateId)
    .set({
      teamId,
      coachId: uid,
      coachName: displayName,
      activityId: coachingActId,
      title: coachingActName,
      description: 'One-on-one coaching session.',
      duration_minutes: 60,
      max_participants: 1,
      isFreeTrial: true,
      location: 'Dojo A',
      onlineUrl: null,
      status: 'active',
      recurrence: { type: 'weekly', days: [1, 3], time: '08:00', timezone: 'Europe/Zurich' },
      window_days: 30,
      created_at: ts(daysFromNow(-40)),
    })

  const coachingSlotDefs = [
    { dayOffset: 1, hour: 8, bookings: 0 },
    { dayOffset: 3, hour: 8, bookings: 1 },
    { dayOffset: 8, hour: 8, bookings: 0 },
    { dayOffset: 10, hour: 8, bookings: 1 },
    { dayOffset: 15, hour: 8, bookings: 0 },
    { dayOffset: 17, hour: 8, bookings: 0 },
  ]
  const bookedContact = {
    id: `${teamId}-contact-000`,
    firstname: CONTACT_POOL[0].firstname,
    lastname: CONTACT_POOL[0].lastname,
    email: `${slugEmail(CONTACT_POOL[0])}.${teamId}@example.com`,
  }
  for (let i = 0; i < coachingSlotDefs.length; i++) {
    const slotDef = coachingSlotDefs[i]
    const base = daysFromNow(slotDef.dayOffset)
    base.setHours(slotDef.hour, 0, 0, 0)
    const end = hoursOffset(base, 1)
    const sid = `${teamId}-coaching-session-${i}`
    const isFull = slotDef.bookings >= 1
    const status = isFull ? 'full' : 'open'

    await db
      .collection('sessions')
      .doc(sid)
      .set({
        teamId,
        activityType: 'coaching',
        activityId: coachingActId,
        activityName: coachingActName,
        templateId: coachingTemplateId,
        coachId: uid,
        coachName: displayName,
        isFreeTrial: true,
        start: ts(base),
        end: ts(end),
        duration_minutes: 60,
        max_participants: 1,
        bookings_count: slotDef.bookings,
        location: 'Dojo A',
        onlineUrl: null,
        allowBooking: true,
        status,
        created_at: ts(daysFromNow(-7)),
      })
    await db
      .collection('sessions')
      .doc(sid)
      .collection('public_profile')
      .doc(sid)
      .set({
        type: 'coaching_session',
        teamId,
        activityType: 'coaching',
        activityName: coachingActName,
        coachId: uid,
        coachName: displayName,
        templateId: coachingTemplateId,
        start: ts(base),
        end: ts(end),
        duration_minutes: 60,
        location: 'Dojo A',
        onlineUrl: null,
        max_participants: 1,
        bookings_count: slotDef.bookings,
        isFreeTrial: true,
        status,
        allowBooking: true,
      })
    if (isFull) {
      await db
        .collection('sessions')
        .doc(sid)
        .collection('bookings')
        .doc(`${sid}-booking`)
        .set({
          teamId,
          contactId: bookedContact.id,
          session: sid,
          email: bookedContact.email,
          firstname: bookedContact.firstname,
          lastname: bookedContact.lastname,
          status: 'confirmed',
          joinedAt: ts(daysFromNow(-2)),
          booking_token: `tok-coaching-${teamId}-${i}`,
          is_new_contact: false,
        })
    }
  }

  // ── subscription types ────────────────────────────────────────────────────────
  for (const st of subscriptionTypeDefs) {
    await db
      .collection('teams')
      .doc(teamId)
      .collection('subscription_types')
      .doc(st.id)
      .set({
        name: st.name,
        description: st.description,
        source: st.source,
        active: st.active,
        ...(st.price != null ? { price: st.price } : {}),
        teamId,
        created_at: ts(daysFromNow(-120)),
      })
  }

  // ── group sessions (4 past weeks + 4 upcoming weeks) ──────────────────────────
  type SessionDef = {
    dayOffset: number
    actId: string
    actName: string
    hour: number
    duration: number
    location: string
    allowBooking: boolean
    instructor?: string
  }
  const sessionDefs: SessionDef[] = []
  const instructors = extraCoaches.length
    ? [displayName, extraCoaches[0].displayName]
    : [displayName, 'Elena Rossi']

  for (let week = -4; week <= -1; week++) {
    for (const [dayOff, actId, actName, hour, dur, loc, instr] of [
      [1, `${teamId}-act-bjj`, 'Brazilian Jiu-Jitsu', 18, 1.5, 'Dojo A', instructors[0]],
      [3, `${teamId}-act-kickbox`, 'Kickboxing', 19, 1, 'Dojo B', instructors[1]],
      [5, `${teamId}-act-bjj`, 'Brazilian Jiu-Jitsu', 7, 1, 'Dojo A', instructors[0]],
      [6, `${teamId}-act-mma`, 'MMA', 10, 2, 'Main Hall', instructors[1]],
    ] as const) {
      sessionDefs.push({
        dayOffset: week * 7 + Number(dayOff),
        actId: String(actId),
        actName: String(actName),
        hour: Number(hour),
        duration: Number(dur),
        location: String(loc),
        allowBooking: false,
        instructor: String(instr),
      })
    }
  }
  for (let week = 0; week <= 3; week++) {
    for (const [dayOff, actId, actName, hour, dur, loc, ab, instr] of [
      [1, `${teamId}-act-bjj`, 'Brazilian Jiu-Jitsu', 18, 1.5, 'Dojo A', true, instructors[0]],
      [2, `${teamId}-act-yoga`, 'Yoga & Mobility', 9, 1, 'Studio', true, 'Aiko Tanaka'],
      [3, `${teamId}-act-kickbox`, 'Kickboxing', 19, 1, 'Dojo B', true, instructors[1]],
      [5, `${teamId}-act-bjj`, 'Brazilian Jiu-Jitsu', 7, 1, 'Dojo A', true, instructors[0]],
      [6, `${teamId}-act-mma`, 'MMA', 10, 2, 'Main Hall', true, instructors[1]],
      [0, `${teamId}-act-yoga`, 'Yoga & Mobility', 10, 1.5, 'Studio', false, 'Aiko Tanaka'],
    ] as const) {
      sessionDefs.push({
        dayOffset: week * 7 + Number(dayOff),
        actId: String(actId),
        actName: String(actName),
        hour: Number(hour),
        duration: Number(dur),
        location: String(loc),
        allowBooking: Boolean(ab),
        instructor: String(instr),
      })
    }
  }

  const pastCount = 4 * 4
  const sessionIds: string[] = []
  for (let i = 0; i < sessionDefs.length; i++) {
    const s = sessionDefs[i]
    const base = daysFromNow(s.dayOffset)
    base.setHours(s.hour, 0, 0, 0)
    const end = hoursOffset(base, s.duration)
    const id = `${teamId}-session-${i.toString().padStart(3, '0')}`
    sessionIds.push(id)
    const act = activities.find((a) => a.id === s.actId)

    await db
      .collection('sessions')
      .doc(id)
      .set({
        teamId,
        activityId: s.actId,
        activityName: s.actName,
        start: ts(base),
        end: ts(end),
        location: s.location,
        instructor: s.instructor ?? null,
        locationAddress: '123 Fighter St',
        allowBooking: s.allowBooking,
        participants_count: 0,
        created_at: ts(daysFromNow(-200)),
        createdBy: uid,
      })
    if (s.allowBooking) {
      await db
        .collection('sessions')
        .doc(id)
        .collection('public_profile')
        .doc(id)
        .set({
          type: 'session',
          teamId,
          activityId: s.actId,
          activityName: s.actName,
          activityColor: act?.color ?? null,
          activitySlug: act?.slug ?? null,
          activityIsFreeTrial: act?.isFreeTrial ?? false,
          activityLevel: act?.level ?? null,
          activityImage: null,
          start: ts(base),
          end: ts(end),
          location: s.location,
          instructorName: s.instructor ?? null,
          locationAddress: '123 Fighter St',
          locationMapsUrl: null,
          capacity: null,
          participants_count: 0,
          allowBooking: true,
          slug: null,
        })
    }
  }

  // ── contacts ───────────────────────────────────────────────────────────────────
  const pool = CONTACT_POOL.slice(0, contactCount)
  const contactIds: string[] = []
  for (let i = 0; i < pool.length; i++) {
    const c = pool[i]
    const id = `${teamId}-contact-${i.toString().padStart(3, '0')}`
    contactIds.push(id)
    const seed = `${teamId}-${i}`
    const sub = resolveSub(c.sub)
    const rank = rankFor(c)
    const streak = c.totalSessions > 0 ? Math.floor(seededRand(seed + 'st') * 6) : 0
    const maxStreak = Math.max(streak, Math.floor(seededRand(seed + 'ms') * 10))
    const monthScore =
      gamificationEnabled && c.totalSessions > 0 ? Math.floor(seededRand(seed + 'sc') * 140) : 0
    const birthdate = c.birthYear
      ? new Date(
          c.birthYear,
          Math.floor(seededRand(seed + 'mo') * 12),
          1 + Math.floor(seededRand(seed + 'dy') * 27)
        )
      : null

    const createdTs = ts(daysFromNow(-Math.floor(seededRand(seed + 'cr') * 200) - 10))
    const acquisition = acquisitionFieldsFor({
      type: c.type,
      hasAttended: c.totalSessions > 0,
      milestoneTs: createdTs,
      seed,
    })
    // Tags: 'external' replaces the old external status; keep the existing
    // win-back / lead labels alongside it.
    const baseTags = c.status === 'expired' ? ['win-back'] : c.type === 'trial' ? ['lead'] : []
    const tags = c.type === 'external' ? [...baseTags, 'external'] : baseTags

    // ── affiliation (replaces the old membership_* / org_membership_* fields) ──
    // Issuer 'org' for org-member teams (carries org_id), else 'team'. External
    // and guest contacts hold no affiliation. `active` is denormalized from status.
    const writeAffiliation =
      affiliationsEnabled &&
      clubAffiliationType !== null &&
      c.type !== 'external' &&
      c.status !== 'guest'
    const affiliationDoc = writeAffiliation
      ? buildAffiliationDoc({
          teamId,
          type: clubAffiliationType!,
          statusId: c.status,
          orgId,
          // No expiration in seed data — derive a plausible validity window.
          validUntil: statusCountsAsActive(c.status)
            ? ts(daysFromNow(300))
            : c.status === 'expired'
              ? ts(daysFromNow(-20))
              : undefined,
          validFrom: ts(daysFromNow(-200)),
          createdAt: createdTs,
          createdBy: 'seed',
        })
      : null

    await db
      .collection('contacts')
      .doc(id)
      .set({
        teamId,
        firstname: c.firstname,
        lastname: c.lastname,
        email: `${slugEmail(c)}.${teamId}@example.com`,
        phone: `+417${(60000000 + Math.floor(seededRand(seed + 'ph') * 9999999)).toString().slice(0, 8)}`,
        gender: c.gender,
        birthplace: c.birthplace,
        birthdate: birthdate ? ts(birthdate) : null,
        total_sessions: c.totalSessions,
        last_session_at:
          c.totalSessions > 0 ? ts(daysFromNow(-Math.floor(seededRand(seed + 'ls') * 14))) : null,
        notes:
          c.type === 'student' && c.totalSessions > 20
            ? `Consistent attendance. Focus areas noted after recent gradings.`
            : c.type === 'trial'
              ? `Came in via the website trial form — follow up after first class.`
              : '',
        created_at: createdTs,
        deleted_at: null,
        archived_at: null,
        ...acquisition,
        // Best-effort affiliation summary (the trigger recomputes this live).
        ...(affiliationDoc
          ? { affiliation_summary: buildAffiliationSummary([affiliationDoc as { active: boolean; type_key?: string; org_id?: string }]) }
          : {}),
        ...(gamificationEnabled
          ? {
              current_month_score: monthScore,
              current_streak: streak,
              max_streak: maxStreak,
              times_leader: Math.floor(seededRand(seed + 'tl') * 3),
              times_top5: Math.floor(seededRand(seed + 't5') * 6),
              distinct_activities: ['bjj', 'kickboxing'].slice(
                0,
                1 + Math.floor(seededRand(seed + 'da') * 2)
              ),
              custom_badges: badgesFor(c.totalSessions, maxStreak, seed),
            }
          : {}),
        ...(sub
          ? {
              subscription_type_id: sub.id,
              subscription_type_name: sub.name,
              subscription_recurrence: sub.recurrence,
              subscription_type_updated_at: ts(daysFromNow(-30)),
            }
          : {}),
        ...(rank != null ? { ranks: { [rankSystemId]: rank } } : {}),
        tags,
      })

    if (affiliationDoc) {
      await db
        .collection('contacts')
        .doc(id)
        .collection(CONTACT_AFFILIATIONS_SUBCOLLECTION)
        .doc(`${id}-aff-club`)
        .set(affiliationDoc)
    }

    // subscription history
    if (sub) {
      const startedAt = daysFromNow(-Math.floor(seededRand(seed + 'sh') * 90) - 30)
      if (i % 4 === 0) {
        const prevStartedAt = daysFromNow(-Math.floor(seededRand(seed + 'ph2') * 120) - 90)
        await db
          .collection('contacts')
          .doc(id)
          .collection('subscription_history')
          .doc(`${id}-sub-prev`)
          .set({
            subscription_type_id: sub.id,
            subscription_type_name: sub.name,
            recurrence: sub.recurrence,
            start_date: ts(prevStartedAt),
            end_date: ts(new Date(startedAt.getTime() - 1)),
            created_at: ts(prevStartedAt),
          })
      }
      await db
        .collection('contacts')
        .doc(id)
        .collection('subscription_history')
        .doc(`${id}-sub-current`)
        .set({
          subscription_type_id: sub.id,
          subscription_type_name: sub.name,
          recurrence: sub.recurrence,
          start_date: ts(startedAt),
          end_date: null,
          created_at: ts(startedAt),
        })
    }

    // monthly scores (gamification) — last 4 months for active students
    if (gamificationEnabled && c.totalSessions > 0) {
      for (let m = 0; m < 4; m++) {
        const md = monthsAgo(m)
        const label = monthLabel(md)
        const sessions = Math.floor(seededRand(seed + 'mscount' + m) * 12)
        const totalPoints = sessions * (10 + Math.floor(seededRand(seed + 'mp' + m) * 6))
        await db
          .collection('contacts')
          .doc(id)
          .collection('monthly_scores')
          .doc(`${id}-${label}`)
          .set({
            month: label,
            team_id: teamId,
            total_points: totalPoints,
            final_score: Math.min(totalPoints, gamificationSettings.monthly_cap),
            sessions_count: sessions,
            updated_at: ts(md),
          })
      }
    }

    // weekly reports
    if (c.totalSessions > 0) {
      const maxPerWeek = Math.min(3, Math.ceil(c.totalSessions / 40) + 1)
      for (let w = 7; w >= 0; w--) {
        const monday = mondayOfWeeksAgo(w)
        const label = isoWeekLabel(monday)
        const attendChance = Math.min(0.9, c.totalSessions / 60)
        const count =
          seededRand(seed + 'wk' + w) < attendChance
            ? 1 + Math.floor(seededRand(seed + 'wc' + w) * maxPerWeek)
            : 0
        await db
          .collection('contacts')
          .doc(id)
          .collection('contact_weekly_reports')
          .doc(label)
          .set({
            iso_week: label,
            sessions_count: count,
            generated_at: ts(monday),
          })
      }
    }
  }

  // ── contact alerts (show_in_app) — a few per team ─────────────────────────────
  const alertTargets = contactIds.slice(0, Math.min(4, contactIds.length))
  const alertDefs = [
    {
      schedule_type: 'sessions_countdown' as const,
      schedule_value: 10,
      message: 'Belt grading approaching — review curriculum.',
      show_in_app: true,
    },
    {
      schedule_type: 'datetime' as const,
      schedule_value: ts(daysFromNow(7)),
      message: 'Membership renewal due this week.',
      show_in_app: true,
    },
    {
      schedule_type: 'sessions_countdown' as const,
      schedule_value: 50,
      message: '50-session milestone — celebrate in class!',
      show_in_app: false,
    },
  ]
  for (let i = 0; i < alertTargets.length; i++) {
    const def = alertDefs[i % alertDefs.length]
    await db
      .collection('contacts')
      .doc(alertTargets[i])
      .collection('contact_alerts')
      .doc(`${alertTargets[i]}-alert-0`)
      .set({
        teamId,
        schedule_type: def.schedule_type,
        schedule_value: def.schedule_value,
        message: def.message,
        show_in_app: def.show_in_app,
        archived_at: null,
        created_at: ts(daysFromNow(-3)),
      })
  }

  // ── goals & tasks ──────────────────────────────────────────────────────────────
  const goalDefs = [
    {
      title: 'Improve guard passing',
      description: 'Work on pressure passing and leg weave.',
      categories: ['technique', 'physical'],
    },
    {
      title: 'Compete at next tournament',
      description: 'Enter the regional open and go for gold.',
      categories: ['attitude', 'mental'],
    },
    {
      title: 'Build consistent training habit',
      description: 'Train at least 3× per week for 8 weeks.',
      categories: ['attendance', 'attitude'],
    },
    {
      title: 'Develop rear-naked choke finish',
      description: 'Clean finish from back control.',
      categories: ['technique'],
    },
    {
      title: 'Improve cardio base',
      description: 'Finish hard rounds without gassing in minute 3.',
      categories: ['physical', 'mental'],
    },
  ]
  const taskDefs = [
    'Watch 3 guard-passing breakdown videos',
    'Practice solo drills 10 min/day this week',
    'Stretch routine every morning (5 days)',
    'Review competition weight-cut plan',
    'Write post-training notes for each session',
  ]
  for (let i = 0; i < pool.length; i++) {
    const c = pool[i]
    if (c.type !== 'student' || c.totalSessions < 5) continue
    const id = contactIds[i]
    const numGoals = i < 4 ? 2 : 1
    for (let g = 0; g < numGoals; g++) {
      const def = goalDefs[(i + g) % goalDefs.length]
      const goalId = `${id}-goal-${g}`
      const status = i < 3 && g === 0 ? 'in_progress' : 'open'
      await db
        .collection('contacts')
        .doc(id)
        .collection('goals')
        .doc(goalId)
        .set({
          type: 'goal',
          title: def.title,
          description: def.description,
          status,
          categories: def.categories,
          created_by: 'coach',
          created_at: ts(daysFromNow(-28)),
          target_date: ts(daysFromNow(60)),
          completed_at: null,
        })
      if (status === 'in_progress') {
        for (let e = 0; e < 2; e++) {
          await db
            .collection('contacts')
            .doc(id)
            .collection('goals')
            .doc(goalId)
            .collection('evaluations')
            .doc(`${goalId}-eval-${e}`)
            .set({
              evaluated_at: ts(daysFromNow(-14 + e * 7)),
              evaluated_by: 'coach',
              score: 3 + e,
              notes:
                e === 0
                  ? 'Good start — needs more drilling time.'
                  : 'Visible improvement over last session.',
              status_after: 'in_progress',
              edited: false,
            })
        }
      }
    }
    const taskId = `${id}-task-0`
    const taskDone = i % 3 === 0
    await db
      .collection('contacts')
      .doc(id)
      .collection('goals')
      .doc(taskId)
      .set({
        type: 'task',
        title: taskDefs[i % taskDefs.length],
        description: null,
        status: taskDone ? 'achieved' : 'open',
        categories: [],
        created_by: 'coach',
        created_at: ts(daysFromNow(-7)),
        target_date: ts(daysFromNow(7)),
        completed_at: taskDone ? ts(daysFromNow(-2)) : null,
      })
  }

  // ── past-session participants + bookings ──────────────────────────────────────
  const studentIdxs = pool
    .map((c, i) => ({ c, i }))
    .filter((x) => x.c.type === 'student')
    .map((x) => x.i)
  for (let i = 0; i < pastCount; i++) {
    const sid = sessionIds[i]
    if (!sid) continue
    const target = 4 + ((i * 3) % 6)
    const attending = studentIdxs
      .filter((idx, k) => (k + i) % studentIdxs.length < target)
      .slice(0, target)
    for (const idx of attending) {
      const cs = pool[idx]
      const contactId = contactIds[idx]
      await db
        .collection('sessions')
        .doc(sid)
        .collection('participants')
        .doc(contactId)
        .set({
          contactId,
          session: sid,
          firstname: cs.firstname,
          lastname: cs.lastname,
          fullname: `${cs.lastname} ${cs.firstname}`,
          joinedAt: ts(daysFromNow(sessionDefs[i].dayOffset)),
          checkedInBy: 'seed',
        })
    }
    await db.collection('sessions').doc(sid).update({ participants_count: attending.length })
  }

  // upcoming-session bookings from trial/external contacts
  const bookingIdxs = pool
    .map((c, i) => ({ c, i }))
    .filter((x) => x.c.type !== 'student')
    .map((x) => x.i)
    .slice(0, 4)
  const sessionBookingCounts = new Map<
    string,
    { bookings_count: number; trial_bookings_count: number }
  >()
  for (let i = 0; i < bookingIdxs.length; i++) {
    const idx = bookingIdxs[i]
    const b = pool[idx]
    const sessionId = sessionIds[pastCount + (i < 2 ? 1 : 3)]
    if (!sessionId) continue
    await db
      .collection('sessions')
      .doc(sessionId)
      .collection('bookings')
      .doc(`${teamId}-booking-${i}`)
      .set({
        teamId,
        contact: contactIds[idx],
        session: sessionId,
        email: `${slugEmail(b)}.${teamId}@example.com`,
        firstname: b.firstname,
        lastname: b.lastname,
        phone: '',
        is_new_contact: true,
        fromBioLink: true,
        joinedAt: ts(daysFromNow(-2)),
        status: 'pending',
        booking_token: `tok-${teamId}-${i}`,
      })
    const cur = sessionBookingCounts.get(sessionId) ?? {
      bookings_count: 0,
      trial_bookings_count: 0,
    }
    cur.bookings_count++
    cur.trial_bookings_count++
    sessionBookingCounts.set(sessionId, cur)
  }
  for (const [sessionId, counts] of sessionBookingCounts) {
    await db.collection('sessions').doc(sessionId).update(counts)
  }

  // ── team activity log ─────────────────────────────────────────────────────────
  const logEntries = [
    {
      event: 'contact_add',
      desc: `New trial contact ${pool[bookingIdxs[0]]?.firstname ?? 'lead'} added from portal.`,
      contact: contactIds[bookingIdxs[0]],
    },
    {
      event: 'session_participant_add',
      desc: `${pool[0].firstname} ${pool[0].lastname} checked into BJJ.`,
      contact: contactIds[0],
    },
    {
      event: 'rank_change',
      desc: `${pool[2].firstname} ${pool[2].lastname} promoted.`,
      contact: contactIds[2],
    },
    {
      event: 'subscription_change',
      desc: `${pool[1].firstname} ${pool[1].lastname} switched to Annual Membership.`,
      contact: contactIds[1],
    },
    {
      event: 'booking_confirmed',
      desc: `Trial booking confirmed for an upcoming session.`,
      contact: contactIds[bookingIdxs[0]],
    },
  ]
  for (let i = 0; i < logEntries.length; i++) {
    const e = logEntries[i]
    if (!e.contact) continue
    await db
      .collection('teams')
      .doc(teamId)
      .collection('activity_log')
      .doc(`${teamId}-log-${i}`)
      .set({
        event: e.event,
        created_at: ts(daysFromNow(-i - 1)),
        parameters: { description: e.desc },
        refs: { contact: e.contact, user: teamId },
      })
  }

  // ── automations (studio+ only): templates, alert presets, rules, logs ──────────
  if (automationsEnabled) {
    await seedAutomations(teamId, teamLanguage)
  }

  // ── events ───────────────────────────────────────────────────────────────────
  const eventDefs = [
    {
      title: 'Regional BJJ Tournament',
      type: 'competition',
      startOffset: 45,
      durationH: 8,
      fee: 25,
      location: 'Sports Arena Geneva',
      description:
        'Annual regional championship — open to white and blue belts. Gi and No-Gi divisions.',
    },
    {
      title: 'Summer MMA Camp',
      type: 'camp',
      startOffset: 60,
      durationH: 72,
      fee: 180,
      location: 'High Performance Training Center',
      description: '3-day intensive camp with guest instructors. All levels welcome.',
    },
    {
      title: 'Nutrition Workshop',
      type: 'seminar',
      startOffset: 14,
      durationH: 3,
      fee: 0,
      location: 'Team HQ — Conference Room',
      description: 'Practical guide to sports nutrition and recovery. Free for all members.',
    },
  ]
  for (let ei = 0; ei < eventDefs.length; ei++) {
    const e = eventDefs[ei]
    const eventId = `${teamId}-event-${ei}`
    const maxInvite = [
      Math.min(12, contactCount),
      Math.min(8, contactCount),
      Math.min(10, contactCount),
    ][ei]
    let sentCount = 0,
      attendeeCount = 0
    const startIdx = ei * 3

    await db
      .collection('events')
      .doc(eventId)
      .set({
        teamId,
        title: e.title,
        type: e.type,
        fee: e.fee,
        description: e.description,
        location: e.location,
        start: ts(daysFromNow(e.startOffset)),
        end: ts(hoursOffset(daysFromNow(e.startOffset), e.durationH)),
        status: 'open',
        participants_count: 0,
        attendees_count: 0,
        invitations_sent_count: 0,
        deleted_at: null,
        createdBy: uid,
        created_at: ts(daysFromNow(-10)),
      })

    for (let j = 0; j < maxInvite; j++) {
      const cidx = (startIdx + j) % pool.length
      const c = pool[cidx]
      const contactId = contactIds[cidx]
      const status = j < 3 ? 'responded' : j < 5 ? 'declined' : j < 8 ? 'opened' : 'sent'
      const token = `seed${teamId}ev${ei}c${cidx}`.padEnd(32, '0').repeat(2).slice(0, 64)
      const hasOpened = ['opened', 'responded', 'declined'].includes(status)
      const hasRsvp = ['responded', 'declined'].includes(status)

      await db
        .collection('events')
        .doc(eventId)
        .collection('invitations')
        .doc(contactId)
        .set({
          contactId,
          firstname: c.firstname,
          lastname: c.lastname,
          email: `${slugEmail(c)}.${teamId}@example.com`,
          status,
          token,
          link: `https://linyup.com/public/event-invitation?token=${token}`,
          eventId,
          sentBy: uid,
          sentAt: ts(daysFromNow(-7)),
          firstOpenedAt: hasOpened ? ts(daysFromNow(-5)) : null,
          lastOpenedAt: hasOpened ? ts(daysFromNow(-3)) : null,
          respondedAt: hasRsvp ? ts(daysFromNow(-2)) : null,
        })
      sentCount++
      if (status === 'responded') {
        attendeeCount++
        await db
          .collection('events')
          .doc(eventId)
          .collection('attendees')
          .doc(contactId)
          .set({
            contactId,
            firstname: c.firstname,
            lastname: c.lastname,
            email: `${slugEmail(c)}.${teamId}@example.com`,
            notes: j === 0 ? 'Really looking forward to this!' : null,
            respondedAt: ts(daysFromNow(-2)),
          })
      }
    }
    await db
      .collection('events')
      .doc(eventId)
      .update({
        invitations_sent_count: sentCount,
        attendees_count: attendeeCount,
        last_invitation_sent_at: ts(daysFromNow(-7)),
      })
  }

  // ── saas_subscriptions ────────────────────────────────────────────────────────
  const nowTs = ts(now())
  if (plan === 'coach') {
    await db
      .collection('saas_subscriptions')
      .doc(teamId)
      .set({
        teamId,
        plan: 'coach',
        status: 'trial',
        trial_ends_at: ts(daysFromNow(14)),
        current_period_start: null,
        current_period_end: null,
        cancel_at_period_end: false,
        gateway_type: null,
        gateway_data: null,
        created_at: nowTs,
        updated_at: nowTs,
      })
  } else if (!orgId) {
    await db
      .collection('saas_subscriptions')
      .doc(teamId)
      .set({
        teamId,
        plan,
        status: 'active',
        trial_ends_at: null,
        current_period_start: ts(daysFromNow(-30)),
        current_period_end: ts(daysFromNow(1)),
        cancel_at_period_end: false,
        gateway_type: null,
        gateway_data: null,
        created_at: ts(daysFromNow(-220)),
        updated_at: nowTs,
      })
  }
  // org member teams are billed through the org subscription (handled in seedOrg)

  // ── student auth user (custom-token identity matching generateAuthToken) ──────
  const studentIdx = studentIdxs.find((i) => pool[i].status === 'active') ?? 0
  const studentContactId = contactIds[studentIdx]
  const studentUid = `contact:${teamId}:${studentContactId}`
  const sessionExpires = Date.now() + STUDENT_SESSION_MS
  await upsertAuthUser({
    uid: studentUid,
    email: `${slugEmail(pool[studentIdx])}.${teamId}@example.com`,
    displayName: `${pool[studentIdx].firstname} ${pool[studentIdx].lastname}`,
    password: 'linyup123',
    claims: {
      contactId: studentContactId,
      teamId,
      sessionExpires,
      email: `${slugEmail(pool[studentIdx])}.${teamId}@example.com`,
    },
  })
  await db
    .collection('auth_tokens')
    .doc(`${teamId}-seed-student`)
    .set({
      contactId: studentContactId,
      teamId,
      createdBy: uid,
      sessionExpires,
      created_at: ts(now()),
    })

  // ── storefront (studio+ only — products/website/online-courses are minPlan studio) ──
  // Gives studio/organization teams a complete public storefront: a Products shop
  // tab, a published website, free + sellable courses, and the full bio-link set.
  if (plan === 'studio' || plan === 'organization') {
    const storefront = {
      teamId,
      uid,
      teamName,
      teamSlug,
      accentColor,
      description: tagline,
      primaryActivity: activities[0]?.name ?? 'Training',
      email,
      currency: 'CHF',
      installedDaysAgo: 120,
    }
    await seedStoreProducts(storefront)
    await seedStoreWebsite(storefront)
    await seedStoreCourses(storefront, { includeFree: true })
  }

  // ── coach role demo: give the first extra coach an own book (assigned contacts +
  // sessions) + a default role_config, so staging exercises the Coach role. ──
  if (extraCoaches.length) {
    const coachUid = extraCoaches[0].uid
    await db
      .collection('teams')
      .doc(teamId)
      .collection('role_config')
      .doc('coach')
      .set({
        role: 'coach',
        capabilities: COACH_DEFAULT_CAPABILITIES,
        updatedBy: uid,
        updated_at: ts(daysFromNow(-150)),
      })
    const coachContacts = await db.collection('contacts').where('teamId', '==', teamId).limit(6).get()
    for (const c of coachContacts.docs) await c.ref.update({ assigned_coach_ids: [coachUid] })
    const coachSessions = await db.collection('sessions').where('teamId', '==', teamId).limit(3).get()
    for (const s of coachSessions.docs)
      await s.ref.update({ coachId: coachUid, instructorId: coachUid, coachName: extraCoaches[0].displayName })
  }

  console.log(
    `   ✓ ${teamName} (${plan}) — ${contactCount} contacts, ${sessionDefs.length} sessions`
  )
}

// ── automations seed (templates + presets + rules + logs) ─────────────────────

async function seedAutomations(teamId: string, language: string) {
  const teamRef = db.collection('teams').doc(teamId)

  // outreach templates
  const templates = [
    {
      id: `${teamId}-tmpl-welcome`,
      system_key: `lib_trial_welcome:${language}`,
      name: 'Welcome to your first class',
      body_mode: 'markdown',
      language,
      active: true,
      subject: 'Welcome to {{teamName}}, {{firstname}}!',
      body: 'Hi {{firstname}},\n\nWe are so excited to welcome you to **{{teamName}}** for your first class! Come a few minutes early, wear comfortable clothes, and bring water.\n\nSee you on the mats!\n\nThe {{teamName}} team',
    },
    {
      id: `${teamId}-tmpl-winback`,
      system_key: `lib_winback:${language}`,
      name: 'We miss you',
      body_mode: 'markdown',
      language,
      active: true,
      subject: '{{firstname}}, we miss you at {{teamName}}',
      body: 'Hi {{firstname}},\n\nIt has been a while since your last session. We would love to see you back on the mats. Reply to this email and we will help you find a class that fits your schedule.\n\nThe {{teamName}} team',
    },
  ]
  for (const t of templates) {
    await teamRef
      .collection('outreach_templates')
      .doc(t.id)
      .set({
        name: t.name,
        subject: t.subject,
        body: t.body,
        body_mode: t.body_mode,
        language: t.language,
        active: t.active,
        system_key: t.system_key,
        created_at: ts(daysFromNow(-60)),
      })
  }

  // alert presets
  const presets = [
    {
      id: `${teamId}-preset-grading`,
      name: 'Belt grading reminder',
      description: 'Fires 10 sessions before next grading window.',
      schedule_type: 'sessions_countdown',
      schedule_value: 10,
      message: 'Belt grading is coming up — review the curriculum.',
      show_in_app: true,
    },
    {
      id: `${teamId}-preset-renewal`,
      name: 'Membership renewal',
      description: 'One-off reminder on a chosen date.',
      schedule_type: 'datetime',
      schedule_value: null,
      message: 'Membership renewal is due — confirm payment details.',
      show_in_app: true,
    },
  ]
  for (const p of presets) {
    await teamRef
      .collection('alert_presets')
      .doc(p.id)
      .set({
        name: p.name,
        description: p.description,
        schedule_type: p.schedule_type,
        schedule_value: p.schedule_value,
        message: p.message,
        show_in_app: p.show_in_app,
        created_at: ts(daysFromNow(-60)),
      })
  }

  // automation rules
  const rules = [
    {
      id: `${teamId}-rule-welcome`,
      name: 'Welcome new trial',
      active: true,
      system_key: 'lib_trial_welcome',
      trigger: { type: 'contact_created' },
      conditions: [{ type: 'contact_type', value: 'trial' }],
      actions: [{ type: 'send_email', templateId: `${teamId}-tmpl-welcome` }],
    },
    {
      id: `${teamId}-rule-winback`,
      name: 'Win back inactive students',
      active: true,
      system_key: 'lib_winback',
      trigger: { type: 'schedule_daily' },
      conditions: [
        { type: 'contact_type', value: 'student' },
        { type: 'inactivity_days', value: 30 },
      ],
      actions: [
        { type: 'send_email', templateId: `${teamId}-tmpl-winback` },
        { type: 'assign_tag', tag: 'win-back' },
      ],
    },
    {
      id: `${teamId}-rule-milestone`,
      name: 'Celebrate 50-session milestone',
      active: false,
      system_key: 'lib_milestone_50',
      trigger: { type: 'session_ended' },
      conditions: [{ type: 'sessions_attended_exactly', value: 50 }],
      actions: [
        { type: 'create_alert', presetId: `${teamId}-preset-grading` },
        { type: 'log_activity', message: '{{firstname}} reached 50 sessions 🎉' },
      ],
    },
  ]
  for (const r of rules) {
    await teamRef
      .collection('automation_rules')
      .doc(r.id)
      .set({
        name: r.name,
        active: r.active,
        trigger: r.trigger,
        conditions: r.conditions,
        actions: r.actions,
        system_key: r.system_key,
        created_at: ts(daysFromNow(-60)),
        updated_at: ts(daysFromNow(-5)),
      })
  }

  // automation logs (recent runs)
  const logs = [
    {
      id: `${teamId}-alog-0`,
      rule_id: `${teamId}-rule-welcome`,
      rule_name: 'Welcome new trial',
      trigger_type: 'contact_created',
      trigger_tier: 'event',
      contacts_matched: 1,
      actions_executed: 1,
      actions_failed: 0,
      days: 1,
    },
    {
      id: `${teamId}-alog-1`,
      rule_id: `${teamId}-rule-winback`,
      rule_name: 'Win back inactive students',
      trigger_type: 'schedule_daily',
      trigger_tier: 'scheduled',
      contacts_matched: 3,
      actions_executed: 6,
      actions_failed: 0,
      days: 2,
    },
  ]
  for (const l of logs) {
    await teamRef
      .collection('automation_logs')
      .doc(l.id)
      .set({
        rule_id: l.rule_id,
        rule_name: l.rule_name,
        triggered_at: ts(daysFromNow(-l.days)),
        trigger_type: l.trigger_type,
        trigger_tier: l.trigger_tier,
        contacts_matched: l.contacts_matched,
        actions_executed: l.actions_executed,
        actions_failed: l.actions_failed,
      })
  }
}

// ── org seed ──────────────────────────────────────────────────────────────────

async function seedOrg(opts: {
  orgId: string
  orgName: string
  orgSlug: string
  adminUid: string
  teamIds: string[]
}) {
  const { orgId, orgName, orgSlug, adminUid, teamIds } = opts
  const nowTs = ts(now())

  const bjjBelt = [
    {
      id: 'bjj-belt',
      name: 'BJJ Belt',
      is_primary: true,
      levels: [
        { value: 0, label: 'White Belt', color: '#e5e7eb' },
        { value: 1, label: 'Blue Belt', color: '#1d4ed8' },
        { value: 2, label: 'Purple Belt', color: '#7e22ce' },
        { value: 3, label: 'Brown Belt', color: '#78350f' },
        { value: 4, label: 'Black Belt', color: '#111827' },
      ],
    },
  ]

  await db
    .collection('organizations')
    .doc(orgId)
    .set({
      name: orgName,
      slug: orgSlug,
      description: `${orgName} — multi-team organization managed with Linyup.`,
      plan: 'organization',
      plan_status: 'active',
      ranking_systems: bjjBelt,
      created: ts(daysFromNow(-260)),
      createdBy: adminUid,
    })

  // Org membership statuses (reused as affiliation statuses for org-issued affiliations).
  for (const st of DEFAULT_ORG_AFFILIATION_STATUSES) {
    await db
      .collection('organizations')
      .doc(orgId)
      .collection(ORG_AFFILIATION_STATUSES_SUBCOLLECTION)
      .doc(st.id)
      .set(st)
  }

  await db.collection('organizations').doc(orgId).collection('org_members').doc(adminUid).set({
    userId: adminUid,
    orgId,
    role: 'org_admin',
    joined: nowTs,
    addedBy: adminUid,
  })
  await db
    .collection('users')
    .doc(adminUid)
    .set({ orgIds: [orgId] }, { merge: true })

  for (const teamId of teamIds) {
    await db.collection('organizations').doc(orgId).collection('org_teams').doc(teamId).set({
      teamId,
      orgId,
      status: 'active',
      joined: nowTs,
      addedBy: adminUid,
    })
    // ensure the org admin is a manager of every member team they don't already own
    const memberRef = db.collection('teams').doc(teamId).collection('team_members').doc(adminUid)
    const existing = await memberRef.get()
    if (!existing.exists) {
      await memberRef.set({
        userId: adminUid,
        teamId,
        role: 'manager',
        ...memberCapsFor('manager'),
        joined: nowTs,
        addedBy: 'seed',
      })
    }
  }

  await db
    .collection('saas_subscriptions')
    .doc(orgId)
    .set({
      entity_type: 'org',
      entity_id: orgId,
      teamId: orgId,
      plan: 'organization',
      status: 'active',
      trial_ends_at: null,
      current_period_start: ts(daysFromNow(-30)),
      current_period_end: ts(daysFromNow(1)),
      cancel_at_period_end: false,
      gateway_type: null,
      gateway_data: null,
      created_at: ts(daysFromNow(-260)),
      updated_at: nowTs,
    })

  // org-wide event
  await db
    .collection('events')
    .doc(`${orgId}-event-open`)
    .set({
      orgId,
      teamId: null,
      scope: 'org',
      title: 'Titan Open Championship 2026',
      type: 'competition',
      start: ts(daysFromNow(45)),
      end: ts(daysFromNow(46)),
      location: 'Geneva Sports Arena',
      description: 'Annual open championship — all Titan clubs are invited to participate.',
      status: 'open',
      deleted_at: null,
      createdBy: adminUid,
      created_at: nowTs,
    })

  console.log(`   ✓ ${orgName} — ${teamIds.length} member teams`)
}

// ── auth helper (idempotent create-or-update) ─────────────────────────────────

async function upsertAuthUser(opts: {
  uid: string
  email: string
  displayName: string
  password: string
  claims?: Record<string, unknown>
}) {
  const { uid, email, displayName, password, claims } = opts
  try {
    await auth.createUser({ uid, email, password, displayName, emailVerified: true })
  } catch (e: unknown) {
    const code = (e as { code?: string }).code
    if (code === 'auth/uid-already-exists' || code === 'auth/email-already-exists') {
      await auth
        .updateUser(uid, { email, password, displayName, emailVerified: true })
        .catch(() => {})
    } else {
      throw e
    }
  }
  if (claims) await auth.setCustomUserClaims(uid, claims)
}

function slugEmail(c: PoolEntry): string {
  return `${c.firstname}.${c.lastname}`
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // strip combining diacritics
    .replace(/[^a-z]+/g, '.')
    .replace(/\.+/g, '.')
    .replace(/^\.|\.$/g, '')
}

// ── enable email/password sign-in provider ─────────────────────────────────────
// A freshly-initialized Firebase project has the email/password provider disabled.
// The Admin SDK can create users but the client SDK cannot sign them in until the
// provider is enabled. We patch it via the Identity Platform v2 REST API using the
// same ADC credential the Admin SDK is already using.

async function enableEmailPasswordSignIn() {
  const credential = admin.app().options.credential!
  const token = await (
    credential as { getAccessToken(): Promise<{ access_token: string }> }
  ).getAccessToken()
  const url =
    `https://identitytoolkit.googleapis.com/v2/projects/${PROJECT_ID}/config` +
    `?updateMask=signIn.email.enabled,signIn.email.passwordRequired`
  const res = await fetch(url, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${token.access_token}`,
      'Content-Type': 'application/json',
      'X-Goog-User-Project': PROJECT_ID,
    },
    body: JSON.stringify({ signIn: { email: { enabled: true, passwordRequired: true } } }),
  })
  if (!res.ok) {
    throw new Error(`Failed to enable email/password sign-in: ${res.status} ${await res.text()}`)
  }
  console.log('   ✓ Email/password sign-in enabled')
}

// ── main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`\n🌱 Seeding Firebase project: ${PROJECT_ID}\n`)

  await enableEmailPasswordSignIn()

  // 1. Coach plan — solo coach
  await seedTeam({
    uid: 'seed-coach-uid',
    email: 'coach@linyup.com',
    displayName: 'Marco Rossi',
    teamId: 'seed-team-coach',
    teamName: 'Samurai Fight Academy',
    teamSlug: 'samurai-fight-academy',
    plan: 'coach',
    planStatus: 'trial',
    accentColor: '#7c3aed',
    contactCount: 15,
    tagline:
      'Traditional martial arts with a modern edge — disciplined training for body and mind.',
    portalGradient: 'night',
  })

  // 2. Studio plan — team with 2 coaches
  await seedTeam({
    uid: 'seed-studio-uid',
    email: 'studio@linyup.com',
    displayName: 'Anna Schmidt',
    teamId: 'seed-team-studio',
    teamName: 'Iron Circle Gym',
    teamSlug: 'iron-circle-gym',
    plan: 'studio',
    planStatus: 'active',
    accentColor: '#dc2626',
    contactCount: 30,
    tagline: 'Forge your fight game — BJJ, MMA and kickboxing under one roof, all levels welcome.',
    portalGradient: 'warm',
    extraCoaches: [
      {
        uid: 'seed-studio-coach2-uid',
        displayName: 'Marco Silva',
        email: 'marco.silva@ironcircle.example.com',
      },
    ],
  })

  // 3. Organisation — org admin + 2 member teams
  await seedTeam({
    uid: 'seed-org-uid',
    email: 'org@linyup.com',
    displayName: 'Rafael Torres',
    teamId: 'seed-org-team-a',
    teamName: 'Titan Combat Sports',
    teamSlug: 'titan-combat-sports',
    plan: 'organization',
    planStatus: 'active',
    accentColor: '#0284c7',
    contactCount: 20,
    tagline: 'The Titan flagship — competition-grade grappling and MMA coaching for every level.',
    portalGradient: 'royal',
    orgId: 'seed-org',
  })
  await seedTeam({
    uid: 'seed-org-coachb-uid',
    email: 'coach.b@titan.example.com',
    displayName: 'Diego Fernández',
    teamId: 'seed-org-team-b',
    teamName: 'Titan Striking Lab',
    teamSlug: 'titan-striking-lab',
    plan: 'organization',
    planStatus: 'active',
    accentColor: '#0d9488',
    contactCount: 18,
    tagline: 'Precision striking — kickboxing technique, pad work and fight-camp conditioning.',
    portalGradient: 'ocean',
    orgId: 'seed-org',
  })
  await seedOrg({
    orgId: 'seed-org',
    orgName: 'Titan Martial Arts Association',
    orgSlug: 'titan-martial-arts',
    adminUid: 'seed-org-uid',
    teamIds: ['seed-org-team-a', 'seed-org-team-b'],
  })

  console.log('\n✅ Staging seeded successfully!\n')
  console.log('   ┌──────────────────────┬──────────────────────┬────────────┬──────────┐')
  console.log('   │ Plan                 │ Email                │ Password   │ Status   │')
  console.log('   ├──────────────────────┼──────────────────────┼────────────┼──────────┤')
  console.log('   │ coach                │ coach@linyup.com     │ linyup123  │ trial    │')
  console.log('   │ studio (2 coaches)   │ studio@linyup.com    │ linyup123  │ active   │')
  console.log('   │ org admin            │ org@linyup.com       │ linyup123  │ active   │')
  console.log('   └──────────────────────┴──────────────────────┴────────────┴──────────┘\n')
  console.log('   Organization: Titan Martial Arts Association (org@linyup.com)')
  console.log('   Member teams: Titan Combat Sports + Titan Striking Lab')
  console.log('   Student logins use custom tokens (uid contact:{teamId}:{contactId}).\n')
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('❌ Seed failed:', err)
    process.exit(1)
  })
