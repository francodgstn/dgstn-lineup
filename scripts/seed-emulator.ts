/**
 * Seed script for the Firebase emulator.
 *
 * Usage (emulators must be running first):
 *   pnpm seed
 *
 * What it creates:
 *   Three plan-tier accounts, each with full data:
 *
 *   coach@lineup.dev  / lineup123  →  plan: coach  (trial)
 *   club@lineup.dev   / lineup123  →  plan: club   (active)
 *   org@lineup.dev    / lineup123  →  plan: organization (active)
 *
 *   Per team:
 *   - 4 activities, 36 sessions (past + upcoming), 18 contacts,
 *     3 events, 4 bookings, past-session participants
 */

// emulator env vars must be set BEFORE admin.initializeApp()
process.env.FIREBASE_AUTH_EMULATOR_HOST = 'localhost:9099'
process.env.FIRESTORE_EMULATOR_HOST     = 'localhost:8080'

import admin from 'firebase-admin'

admin.initializeApp({ projectId: 'demo-lineup' })

const auth = admin.auth()
const db   = admin.firestore()

// ── helpers ───────────────────────────────────────────────────────────────────

const ts = (date: Date) => admin.firestore.Timestamp.fromDate(date)

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
  const week = Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7)
  return `${d.getUTCFullYear()}-W${week.toString().padStart(2, '0')}`
}

function mondayOfWeeksAgo(n: number): Date {
  const d = new Date()
  const day = d.getDay()
  d.setDate(d.getDate() - (day === 0 ? 6 : day - 1) - n * 7)
  d.setHours(0, 0, 0, 0)
  return d
}

async function clearEmulator() {
  await fetch(
    'http://localhost:8080/emulator/v1/projects/demo-lineup/databases/(default)/documents',
    { method: 'DELETE' }
  ).catch(() => {})
  await fetch(
    'http://localhost:9099/emulator/v1/projects/demo-lineup/accounts',
    { method: 'DELETE' }
  ).catch(() => {})
}

// ── per-team seed ─────────────────────────────────────────────────────────────

async function seedTeam(opts: {
  uid:        string
  email:      string
  displayName: string
  teamId:     string
  teamName:   string
  teamSlug:   string
  plan:       'coach' | 'club' | 'organization'
  planStatus: 'trial' | 'active'
  accentColor: string
}) {
  const { uid, email, displayName, teamId, teamName, teamSlug, plan, planStatus, accentColor } = opts

  // ── plan-tier config ─────────────────────────────────────────────────────────

  // Subscription types — vary by plan
  const subscriptionTypeDefs = plan === 'coach'
    ? [
        { id: `${teamId}-sub-monthly`,  name: 'Monthly Membership', description: 'Unlimited classes, billed monthly.',       source: 'internal', price: 95,  active: true },
        { id: `${teamId}-sub-10class`,  name: '10-Class Pack',      description: 'Pre-paid block of 10 sessions.',            source: 'internal', price: 180, active: true },
        { id: `${teamId}-sub-dropin`,   name: 'Drop-in',            description: 'Pay per session, no commitment.',           source: 'internal', price: 25,  active: true },
      ]
    : plan === 'club'
    ? [
        { id: `${teamId}-sub-monthly`,  name: 'Monthly Membership', description: 'Unlimited classes, billed monthly.',       source: 'internal', price: 110, active: true  },
        { id: `${teamId}-sub-quarterly`,name: 'Quarterly Plan',     description: '3-month commitment, 10% discount.',        source: 'internal', price: 300, active: true  },
        { id: `${teamId}-sub-annual`,   name: 'Annual Membership',  description: 'Best value — 2 months free.',              source: 'internal', price: 990, active: true  },
        { id: `${teamId}-sub-dropin`,   name: 'Drop-in',            description: 'Pay per session, no commitment.',           source: 'internal', price: 30,  active: true  },
        { id: `${teamId}-sub-fitpass`,  name: 'FitPass Partner',    description: 'Access via FitPass aggregator network.',   source: 'aggregator', price: null, active: true },
        { id: `${teamId}-sub-sportpass`,name: 'SportPass',          description: 'Access via SportPass membership card.',    source: 'aggregator', price: null, active: true },
      ]
    : [
        { id: `${teamId}-sub-monthly`,  name: 'Monthly Membership', description: 'Unlimited classes, billed monthly.',       source: 'internal', price: 120, active: true },
        { id: `${teamId}-sub-quarterly`,name: 'Quarterly Plan',     description: '3-month commitment, 10% discount.',        source: 'internal', price: 330, active: true },
        { id: `${teamId}-sub-annual`,   name: 'Annual Membership',  description: 'Best value — 2 months free.',              source: 'internal', price: 1100, active: true },
        { id: `${teamId}-sub-youth`,    name: 'Youth Plan (U18)',   description: 'Under-18 discounted monthly rate.',         source: 'internal', price: 80,  active: true },
        { id: `${teamId}-sub-dropin`,   name: 'Drop-in',            description: 'Pay per session, no commitment.',           source: 'internal', price: 35,  active: true },
      ]

  // Ranking systems — BJJ belt system for club/org, none for coach
  const rankingSystemDefs = plan !== 'coach'
    ? [{
        id: 'bjj-belt',
        name: 'BJJ Belt',
        is_primary: true,
        levels: [
          { value: 0, label: 'White Belt',  color: '#e5e7eb' },
          { value: 1, label: 'Blue Belt',   color: '#1d4ed8' },
          { value: 2, label: 'Purple Belt', color: '#7e22ce' },
          { value: 3, label: 'Brown Belt',  color: '#78350f' },
          { value: 4, label: 'Black Belt',  color: '#111827' },
        ],
      }]
    : []

  // Gamification — enabled for club/org, disabled for coach
  const gamificationSettings = plan === 'coach'
    ? { enabled: false, default_base_score: 10, streak_min_sessions: 2, monthly_cap: 200, time_multipliers: [] }
    : plan === 'club'
    ? {
        enabled: true,
        default_base_score: 10,
        streak_min_sessions: 2,
        monthly_cap: 200,
        time_multipliers: [
          { day: 1, start_hour: 6, end_hour: 9, multiplier: 1.5 },
          { day: 3, start_hour: 6, end_hour: 9, multiplier: 1.5 },
          { day: 6, start_hour: 7, end_hour: 10, multiplier: 1.3 },
        ],
      }
    : {
        enabled: true,
        default_base_score: 10,
        streak_min_sessions: 2,
        monthly_cap: 300,
        time_multipliers: [
          { day: 1, start_hour: 6, end_hour: 9, multiplier: 1.5 },
          { day: 3, start_hour: 6, end_hour: 9, multiplier: 1.5 },
          { day: 5, start_hour: 6, end_hour: 9, multiplier: 1.5 },
          { day: 6, start_hour: 7, end_hour: 10, multiplier: 1.3 },
        ],
      }

  // Per-contact subscription + rank assignment (index → config)
  // Active students get a subscription; ranks only for club/org
  const subMonthly  = `${teamId}-sub-monthly`
  const subAnnual   = `${teamId}-sub-annual`
  const subDropin   = `${teamId}-sub-dropin`
  const subFitpass  = `${teamId}-sub-fitpass`
  const subSportpass= `${teamId}-sub-sportpass`
  type SubAssign = { subId: string; subName: string; recurrence: string | null; rank: number | null }
  const contactSubRank: Record<number, SubAssign> = {
    0:  { subId: subMonthly,   subName: 'Monthly Membership', recurrence: 'monthly',  rank: plan !== 'coach' ? 1 : null },
    1:  { subId: subMonthly,   subName: 'Monthly Membership', recurrence: 'monthly',  rank: plan !== 'coach' ? 1 : null },
    2:  { subId: subAnnual,    subName: 'Annual Membership',  recurrence: 'annual',   rank: plan !== 'coach' ? 2 : null },
    3:  { subId: subMonthly,   subName: 'Monthly Membership', recurrence: 'monthly',  rank: plan !== 'coach' ? 0 : null },
    4:  { subId: subMonthly,   subName: 'Monthly Membership', recurrence: 'monthly',  rank: plan !== 'coach' ? 1 : null },
    5:  { subId: subDropin,    subName: 'Drop-in',            recurrence: null,        rank: plan !== 'coach' ? 0 : null },
    6:  { subId: plan !== 'coach' ? subFitpass : subMonthly,
          subName: plan !== 'coach' ? 'FitPass Partner' : 'Monthly Membership',
          recurrence: plan !== 'coach' ? null : 'monthly',
          rank: plan !== 'coach' ? 1 : null },
    10: { subId: subMonthly,   subName: 'Monthly Membership', recurrence: 'monthly',  rank: plan !== 'coach' ? 0 : null },
    11: { subId: subAnnual,    subName: 'Annual Membership',  recurrence: 'annual',   rank: plan !== 'coach' ? 1 : null },
    16: { subId: subAnnual,    subName: 'Annual Membership',  recurrence: 'annual',   rank: plan !== 'coach' ? 2 : null },
    17: { subId: plan !== 'coach' ? subSportpass : subMonthly,
          subName: plan !== 'coach' ? 'SportPass' : 'Monthly Membership',
          recurrence: null,
          rank: plan !== 'coach' ? 1 : null },
  }

  // Auth user
  await auth.createUser({ uid, email, password: 'lineup123', displayName, emailVerified: true })

  // Team doc
  const trialEndsAt = plan === 'coach' ? ts(daysFromNow(14)) : undefined
  await db.collection('teams').doc(teamId).set({
    name:        teamName,
    description: `${teamName} — managed with Lineup.`,
    slug:        teamSlug,
    sport_type:  'Martial arts',
    createdBy:   uid,
    created:     ts(daysFromNow(-120)),
    plan,
    plan_status: planStatus,
    ...(trialEndsAt ? { trial_ends_at: trialEndsAt } : {}),
    ...(rankingSystemDefs.length ? { ranking_systems: rankingSystemDefs } : {}),
    settings: { gamification: gamificationSettings },
    portalTheme:       'light',
    portalAccentColor: accentColor,
    portalBackground:  { type: 'solid', color: '#ffffff' },
    links: [
      { label: 'Book a Free Trial', isBookingLink: true, isMembershipLink: false, showInPortal: true, iconName: 'CalendarPlus', url: null },
      { label: 'Join as Member',    isBookingLink: false, isMembershipLink: true,  showInPortal: true, iconName: 'UserCheck',    url: null },
    ],
    socialLinks: [
      { platform: 'instagram', url: `https://instagram.com/${teamSlug}` },
    ],
  })

  // Public profile
  await db.collection('teams').doc(teamId)
    .collection('public_profile').doc(teamId).set({
      type:              'team',
      name:              teamName,
      description:       `${teamName} — managed with Lineup.`,
      slug:              teamSlug,
      sport_type:        'Martial arts',
      profileImage:      null,
      heroImage:         null,
      portalTheme:       'light',
      portalAccentColor: accentColor,
      portalBackground:  { type: 'solid', color: '#ffffff' },
      socialLinks:       [{ platform: 'instagram', url: `https://instagram.com/${teamSlug}` }],
      links: [
        { label: 'Book a Free Trial', isBookingLink: true,  isMembershipLink: false, showInPortal: true, iconName: 'CalendarPlus', url: null },
        { label: 'Join as Member',    isBookingLink: false, isMembershipLink: true,  showInPortal: true, iconName: 'UserCheck',    url: null },
      ],
      bookingSettings: {
        flowType: 'activity-first',
        windowMonths: 2,
        showPhone: true,
        ctaUrl: null,
        ctaLabel: null,
      },
      membershipRequiredFields: null,
      membershipOptionalFields: null,
      updated_at: ts(new Date()),
    })

  // Team member
  await db.collection('teams').doc(teamId)
    .collection('team_members').doc(uid).set({
      teamId, userId: uid, role: 'owner', email, joined: ts(daysFromNow(-120)),
    })

  // User profile
  const [firstname, lastname] = displayName.split(' ')
  await db.collection('users').doc(uid).set({
    email, displayName, firstname, lastname,
    currentTeam: teamId,
    created_at:  ts(daysFromNow(-120)),
  })

  // ── activities ──────────────────────────────────────────────────────────────
  const activities = [
    { id: `${teamId}-act-bjj`,     name: 'Brazilian Jiu-Jitsu', slug: 'bjj',           color: accentColor,  level: 'all',          isFreeTrial: true  },
    { id: `${teamId}-act-mma`,     name: 'MMA',                  slug: 'mma',           color: '#dc2626',    level: 'intermediate', isFreeTrial: false },
    { id: `${teamId}-act-kickbox`, name: 'Kickboxing',           slug: 'kickboxing',    color: '#ea580c',    level: 'all',          isFreeTrial: true  },
    { id: `${teamId}-act-yoga`,    name: 'Yoga & Mobility',      slug: 'yoga-mobility', color: '#059669',    level: 'all',          isFreeTrial: true  },
  ]
  for (const a of activities) {
    await db.collection('activities').doc(a.id).set({ ...a, teamId, isActive: true, created_at: ts(daysFromNow(-100)) })
    await db.collection('activities').doc(a.id)
      .collection('public_profile').doc(a.id).set({
        type: 'activity', teamId, name: a.name, slug: a.slug, color: a.color,
        image_url: null, isFreeTrial: a.isFreeTrial, level: a.level,
      })
  }

  // ── subscription types ──────────────────────────────────────────────────────
  for (const st of subscriptionTypeDefs) {
    await db.collection('teams').doc(teamId)
      .collection('subscription_types').doc(st.id).set({
        name:        st.name,
        description: st.description,
        source:      st.source,
        active:      st.active,
        ...(st.price != null ? { price: st.price } : {}),
        teamId,
        created_at: ts(daysFromNow(-60)),
      })
  }

  // ── sessions ────────────────────────────────────────────────────────────────
  type SessionDef = {
    dayOffset: number; actId: string; actName: string; hour: number
    duration: number; location: string; allowBooking: boolean
    instructor?: string; locationAddress?: string
  }
  const sessionDefs: SessionDef[] = []

  for (let week = -4; week <= -1; week++) {
    for (const [dayOff, actId, actName, hour, dur, loc, instr] of [
      [1, `${teamId}-act-bjj`,     'Brazilian Jiu-Jitsu', 18, 1.5, 'Dojo A',    'Marco Silva'],
      [3, `${teamId}-act-kickbox`, 'Kickboxing',          19, 1,   'Dojo B',    'Elena Rossi'],
      [5, `${teamId}-act-bjj`,     'Brazilian Jiu-Jitsu', 7,  1,   'Dojo A',    'Marco Silva'],
      [6, `${teamId}-act-mma`,     'MMA',                 10, 2,   'Main Hall', null],
    ] as const) {
      sessionDefs.push({
        dayOffset: week * 7 + Number(dayOff), actId, actName,
        hour: Number(hour), duration: Number(dur), location: String(loc),
        allowBooking: false,
        instructor: instr ?? undefined,
        locationAddress: '123 Fighter St',
      })
    }
  }
  for (let week = 0; week <= 3; week++) {
    for (const [dayOff, actId, actName, hour, dur, loc, ab, instr] of [
      [1, `${teamId}-act-bjj`,     'Brazilian Jiu-Jitsu', 18, 1.5, 'Dojo A',    true,  'Marco Silva'],
      [2, `${teamId}-act-yoga`,    'Yoga & Mobility',     9,  1,   'Studio',    true,  'Aiko Tanaka'],
      [3, `${teamId}-act-kickbox`, 'Kickboxing',          19, 1,   'Dojo B',    true,  'Elena Rossi'],
      [5, `${teamId}-act-bjj`,     'Brazilian Jiu-Jitsu', 7,  1,   'Dojo A',    true,  'Marco Silva'],
      [6, `${teamId}-act-mma`,     'MMA',                 10, 2,   'Main Hall', true,  null],
      [0, `${teamId}-act-yoga`,    'Yoga & Mobility',     10, 1.5, 'Studio',    false, 'Aiko Tanaka'],
    ] as const) {
      sessionDefs.push({
        dayOffset: week * 7 + Number(dayOff), actId, actName,
        hour: Number(hour), duration: Number(dur), location: String(loc),
        allowBooking: Boolean(ab),
        instructor: (instr as string | null) ?? undefined,
        locationAddress: '123 Fighter St',
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
    const id  = `${teamId}-session-${i.toString().padStart(3, '0')}`
    sessionIds.push(id)

    // Resolve activity metadata for public_profile
    const act = activities.find((a) => a.id === s.actId)

    await db.collection('sessions').doc(id).set({
      teamId, activityId: s.actId, activityName: s.actName,
      start: ts(base), end: ts(end), location: s.location,
      instructor: s.instructor ?? null,
      locationAddress: s.locationAddress ?? null,
      allowBooking: s.allowBooking, participants_count: 0,
      created_at: ts(daysFromNow(-100)), createdBy: uid,
    })
    if (s.allowBooking) {
      await db.collection('sessions').doc(id)
        .collection('public_profile').doc(id).set({
          type: 'session', teamId, activityId: s.actId, activityName: s.actName,
          activityColor: act?.color ?? null,
          activitySlug: act?.slug ?? null,
          activityIsFreeTrial: act?.isFreeTrial ?? false,
          activityLevel: act?.level ?? null,
          activityImage: null,
          start: ts(base), end: ts(end), location: s.location,
          instructorName: s.instructor ?? null,
          locationAddress: s.locationAddress ?? null,
          locationMapsUrl: null,
          capacity: null, participants_count: 0, allowBooking: true, slug: null,
        })
    }
  }

  // ── contacts ─────────────────────────────────────────────────────────────────
  const contactSeeds = [
    { firstname: 'Luca',      lastname: 'Ferrari',   email: `luca.ferrari.${teamId}@email.com`,   type: 'student',  status: 'active',       gender: 'M', totalSessions: 48, birthdate: new Date('1992-03-14'), birthplace: 'Milan'       },
    { firstname: 'Sofia',     lastname: 'Bianchi',   email: `sofia.bianchi.${teamId}@email.com`,  type: 'student',  status: 'active',       gender: 'F', totalSessions: 32, birthdate: new Date('1995-07-22'), birthplace: 'Rome'        },
    { firstname: 'Alex',      lastname: 'Müller',    email: `alex.mueller.${teamId}@email.com`,   type: 'student',  status: 'active',       gender: 'M', totalSessions: 67, birthdate: new Date('1988-11-05'), birthplace: 'Zurich'      },
    { firstname: 'Chiara',    lastname: 'Romano',    email: `chiara.romano.${teamId}@email.com`,  type: 'student',  status: 'active',       gender: 'F', totalSessions: 21, birthdate: new Date('1999-01-30'), birthplace: 'Naples'      },
    { firstname: 'Matteo',    lastname: 'Esposito',  email: `matteo.espo.${teamId}@email.com`,    type: 'student',  status: 'active',       gender: 'M', totalSessions: 55, birthdate: new Date('1990-09-18'), birthplace: 'Turin'       },
    { firstname: 'Emma',      lastname: 'Schneider', email: `emma.schneid.${teamId}@email.com`,   type: 'student',  status: 'active',       gender: 'F', totalSessions: 14, birthdate: new Date('2001-04-11'), birthplace: 'Bern'        },
    { firstname: 'David',     lastname: 'Costa',     email: `david.costa.${teamId}@email.com`,    type: 'student',  status: 'active',       gender: 'M', totalSessions: 39, birthdate: new Date('1993-06-27'), birthplace: 'Lisbon'      },
    { firstname: 'Julia',     lastname: 'Weber',     email: `julia.weber.${teamId}@email.com`,    type: 'student',  status: 'almost_ready', gender: 'F', totalSessions: 8,  birthdate: new Date('2000-12-03'), birthplace: 'Basel'       },
    { firstname: 'Marco',     lastname: 'Conti',     email: `marco.conti.${teamId}@email.com`,    type: 'student',  status: 'almost_ready', gender: 'M', totalSessions: 6,  birthdate: new Date('1997-08-15'), birthplace: 'Florence'    },
    { firstname: 'Sara',      lastname: 'Ricci',     email: `sara.ricci.${teamId}@email.com`,     type: 'student',  status: 'expired',      gender: 'F', totalSessions: 28, birthdate: new Date('1994-02-09'), birthplace: 'Bologna'     },
    { firstname: 'Tobias',    lastname: 'Huber',     email: `tobias.huber.${teamId}@email.com`,   type: 'student',  status: 'active',       gender: 'M', totalSessions: 19, birthdate: new Date('1996-05-21'), birthplace: 'Geneva'      },
    { firstname: 'Nina',      lastname: 'Moreau',    email: `nina.moreau.${teamId}@email.com`,    type: 'student',  status: 'active',       gender: 'F', totalSessions: 44, birthdate: new Date('1991-10-08'), birthplace: 'Paris'       },
    { firstname: 'Lorenzo',   lastname: 'De Luca',   email: `lorenzo.dl.${teamId}@email.com`,     type: 'trial',    status: 'requested',    gender: 'M', totalSessions: 1,  birthdate: new Date('2003-07-19'), birthplace: 'Palermo'     },
    { firstname: 'Amélie',    lastname: 'Dupont',    email: `amelie.dupont.${teamId}@email.com`,  type: 'trial',    status: 'requested',    gender: 'F', totalSessions: 0,  birthdate: null,                   birthplace: null          },
    { firstname: 'Kevin',     lastname: 'Nguyen',    email: `kevin.nguyen.${teamId}@email.com`,   type: 'trial',    status: 'under_review', gender: 'M', totalSessions: 2,  birthdate: new Date('1998-03-25'), birthplace: 'Lyon'        },
    { firstname: 'Hannah',    lastname: 'Fischer',   email: `hannah.fisch.${teamId}@email.com`,   type: 'external', status: 'guest',        gender: 'F', totalSessions: 0,  birthdate: null,                   birthplace: null          },
    { firstname: 'Radu',      lastname: 'Ionescu',   email: `radu.ionescu.${teamId}@email.com`,   type: 'student',  status: 'active',       gender: 'M', totalSessions: 77, birthdate: new Date('1987-12-31'), birthplace: 'Bucharest'   },
    { firstname: 'Valentina', lastname: 'Greco',     email: `val.greco.${teamId}@email.com`,      type: 'student',  status: 'active',       gender: 'F', totalSessions: 29, birthdate: new Date('1993-09-14'), birthplace: 'Catania'     },
  ]

  for (let i = 0; i < contactSeeds.length; i++) {
    const c = contactSeeds[i]
    const id = `${teamId}-contact-${i.toString().padStart(3, '0')}`
    const subAssign = contactSubRank[i] ?? null
    const primaryRank = subAssign?.rank != null && rankingSystemDefs.length > 0
      ? { 'bjj-belt': subAssign.rank }
      : {}
    await db.collection('contacts').doc(id).set({
      teamId, ...c,
      birthdate:         c.birthdate ? ts(c.birthdate) : null,
      membership_status: c.status,
      membership_active: c.status === 'active',
      total_sessions:    c.totalSessions,
      last_session_at:   c.totalSessions > 0 ? ts(daysFromNow(-Math.floor(Math.random() * 14))) : null,
      current_month_score: Math.floor(Math.random() * 120),
      current_streak:      Math.floor(Math.random() * 8),
      created_at: ts(daysFromNow(-Math.floor(Math.random() * 90) - 10)),
      deleted_at: null, archived_at: null,
      ...(subAssign ? {
        subscription_type_id:    subAssign.subId,
        subscription_type_name:  subAssign.subName,
        subscription_recurrence: subAssign.recurrence,
      } : {}),
      ...(Object.keys(primaryRank).length ? { ranks: primaryRank } : {}),
    })
  }

  // ── subscription history ───────────────────────────────────────────────────
  for (let i = 0; i < contactSeeds.length; i++) {
    const subAssign = contactSubRank[i] ?? null
    if (!subAssign) continue
    const contactId  = `${teamId}-contact-${i.toString().padStart(3, '0')}`
    const startedAt  = daysFromNow(-Math.floor(Math.random() * 90) - 30)
    // Closed previous entry for some contacts (realistic history)
    if (i < 4) {
      const prevStartedAt = daysFromNow(-Math.floor(Math.random() * 120) - 90)
      const prevEndedAt   = new Date(startedAt.getTime() - 1)
      await db.collection('contacts').doc(contactId)
        .collection('subscription_history').doc(`${contactId}-sub-prev`).set({
          subscription_type_id:   subAssign.subId,
          subscription_type_name: subAssign.subName,
          recurrence:             subAssign.recurrence,
          start_date:             ts(prevStartedAt),
          end_date:               ts(prevEndedAt),
          created_at:             ts(prevStartedAt),
        })
    }
    // Current open entry
    await db.collection('contacts').doc(contactId)
      .collection('subscription_history').doc(`${contactId}-sub-current`).set({
        subscription_type_id:   subAssign.subId,
        subscription_type_name: subAssign.subName,
        recurrence:             subAssign.recurrence,
        start_date:             ts(startedAt),
        end_date:               null,    // open — currently active
        created_at:             ts(startedAt),
      })
  }

  // Past-session participants
  const studentContactIds = Array.from({ length: 12 }, (_, i) =>
    `${teamId}-contact-${i.toString().padStart(3, '0')}`
  )
  for (let i = 0; i < pastCount; i++) {
    const sid = sessionIds[i]
    if (!sid) continue
    const count    = 3 + (i * 7 + 3) % 7
    const attending = studentContactIds.filter((_, ci) => ((ci + i * 3) % 12) < count)
    for (const contactId of attending) {
      const cIdx = studentContactIds.indexOf(contactId)
      const cs   = contactSeeds[cIdx]
      await db.collection('sessions').doc(sid)
        .collection('participants').doc(contactId).set({
          contactId, session: sid,
          firstname: cs.firstname, lastname: cs.lastname,
          fullname:  `${cs.lastname} ${cs.firstname}`,
          joinedAt:  ts(daysFromNow(sessionDefs[i].dayOffset)),
          checkedInBy: 'seed',
        })
    }
    await db.collection('sessions').doc(sid).update({ participants_count: attending.length })
  }

  // Bookings
  const bookingContacts = contactSeeds.slice(12, 16)
  for (let i = 0; i < bookingContacts.length; i++) {
    const b         = bookingContacts[i]
    const sessionId = sessionIds[pastCount + (i < 2 ? 1 : 3)]
    if (!sessionId) continue
    await db.collection('sessions').doc(sessionId)
      .collection('bookings').doc(`${teamId}-booking-${i}`).set({
        teamId,
        contact:        `${teamId}-contact-${(12 + i).toString().padStart(3, '0')}`,
        session:        sessionId,
        email:          b.email,
        firstname:      b.firstname,
        lastname:       b.lastname,
        phone:          '',
        is_new_contact: true,
        joinedAt:       ts(daysFromNow(-2)),
        status:         'pending',
        booking_token:  `tok-${teamId}-${i}`,
      })
  }

  // ── weekly reports (feeds the trend chart in the contact header) ────────────
  for (let i = 0; i < contactSeeds.length; i++) {
    const c = contactSeeds[i]
    if (c.totalSessions === 0) continue
    const contactId = `${teamId}-contact-${i.toString().padStart(3, '0')}`
    const maxPerWeek = Math.min(3, Math.ceil(c.totalSessions / 16))
    for (let w = 7; w >= 0; w--) {
      const monday = mondayOfWeeksAgo(w)
      const label  = isoWeekLabel(monday)
      // Most active contacts attend most weeks; less active ones skip more
      const attendChance = Math.min(0.9, c.totalSessions / 30)
      const count = Math.random() < attendChance
        ? 1 + Math.floor(Math.random() * maxPerWeek)
        : 0
      await db.collection('contacts').doc(contactId)
        .collection('contact_weekly_reports').doc(label).set({
          iso_week:       label,
          sessions_count: count,
          generated_at:   ts(monday),
        })
    }
  }

  // ── goals & tasks (coaching data) ────────────────────────────────────────────
  const goalDefs = [
    { title: 'Improve guard passing',         description: 'Work on pressure passing and leg weave.',         categories: ['technique', 'physical'] },
    { title: 'Compete at next tournament',     description: 'Enter the regional open and go for gold.',       categories: ['attitude', 'mental']    },
    { title: 'Build consistent training habit', description: 'Train at least 3 × per week for 8 weeks.',      categories: ['attendance', 'attitude'] },
    { title: 'Develop rear-naked choke finish', description: 'Clean finish from back control.',               categories: ['technique']              },
    { title: 'Improve cardio base',            description: 'Finish hard rounds without gassing in minute 3.', categories: ['physical', 'mental']    },
  ]
  const taskDefs = [
    'Watch 3 guard-passing breakdown videos',
    'Practice solo drills 10 min/day this week',
    'Stretch routine every morning (5 days)',
    'Review competition weight-cut plan',
    'Write post-training notes for each session',
  ]

  for (let i = 0; i < contactSeeds.length; i++) {
    const c = contactSeeds[i]
    if (c.type !== 'student' || c.totalSessions < 5) continue
    const contactId = `${teamId}-contact-${i.toString().padStart(3, '0')}`

    // 1–2 long-term goals
    const numGoals = i < 4 ? 2 : 1
    for (let g = 0; g < numGoals; g++) {
      const def    = goalDefs[(i + g) % goalDefs.length]
      const goalId = `${contactId}-goal-${g}`
      const status = (i < 3 && g === 0) ? 'in_progress' : 'open'
      await db.collection('contacts').doc(contactId)
        .collection('goals').doc(goalId).set({
          type:         'goal',
          title:        def.title,
          description:  def.description,
          status,
          categories:   def.categories,
          created_by:   'coach',
          created_at:   ts(daysFromNow(-28)),
          target_date:  ts(daysFromNow(60)),
          completed_at: null,
        })

      if (status === 'in_progress') {
        for (let e = 0; e < 2; e++) {
          await db.collection('contacts').doc(contactId)
            .collection('goals').doc(goalId)
            .collection('evaluations').doc(`${goalId}-eval-${e}`).set({
              evaluated_at: ts(daysFromNow(-14 + e * 7)),
              evaluated_by: 'coach',
              score:        3 + e,
              notes:        e === 0 ? 'Good start — needs more drilling time.' : 'Visible improvement over last session.',
              status_after: 'in_progress',
              edited:       false,
            })
        }
      }
    }

    // 1 task (some already completed)
    const taskId   = `${contactId}-task-0`
    const taskDone = i % 3 === 0
    await db.collection('contacts').doc(contactId)
      .collection('goals').doc(taskId).set({
        type:         'task',
        title:        taskDefs[i % taskDefs.length],
        description:  null,
        status:       taskDone ? 'achieved' : 'open',
        categories:   [],
        created_by:   'coach',
        created_at:   ts(daysFromNow(-7)),
        target_date:  ts(daysFromNow(7)),
        completed_at: taskDone ? ts(daysFromNow(-2)) : null,
      })
  }

  // Events
  const eventDefs = [
    { title: 'Regional BJJ Tournament', type: 'competition', startOffset: 45, durationH: 8,  fee: 25,  description: 'Annual regional championship — open to white and blue belts.' },
    { title: 'Summer MMA Camp',          type: 'camp',        startOffset: 60, durationH: 72, fee: 180, description: '3-day intensive camp with guest instructors.' },
    { title: 'Nutrition Workshop',        type: 'seminar',     startOffset: 14, durationH: 3,  fee: 0,   description: 'Practical guide to nutrition and recovery.' },
  ]
  for (let i = 0; i < eventDefs.length; i++) {
    const e = eventDefs[i]
    await db.collection('events').doc(`${teamId}-event-${i}`).set({
      teamId,
      title: e.title, type: e.type, fee: e.fee, description: e.description,
      start: ts(daysFromNow(e.startOffset)),
      end:   ts(hoursOffset(daysFromNow(e.startOffset), e.durationH)),
      status: 'open', createdBy: uid, created_at: ts(daysFromNow(-10)),
    })
  }
}

// ── main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log('🗑  Clearing emulator data…')
  await clearEmulator()

  const accounts = [
    {
      uid:         'seed-coach-uid',
      email:       'coach@lineup.dev',
      displayName: 'Marco Rossi',
      teamId:      'seed-team-coach',
      teamName:    'Samurai Fight Academy',
      teamSlug:    'samurai-fight-academy',
      plan:        'coach'  as const,
      planStatus:  'trial'  as const,
      accentColor: '#7c3aed',
    },
    {
      uid:         'seed-club-uid',
      email:       'club@lineup.dev',
      displayName: 'Anna Schmidt',
      teamId:      'seed-team-club',
      teamName:    'Iron Circle Gym',
      teamSlug:    'iron-circle-gym',
      plan:        'club'   as const,
      planStatus:  'active' as const,
      accentColor: '#dc2626',
    },
    {
      uid:         'seed-org-uid',
      email:       'org@lineup.dev',
      displayName: 'Rafael Torres',
      teamId:      'seed-team-org',
      teamName:    'Titan Combat Sports',
      teamSlug:    'titan-combat-sports',
      plan:        'organization' as const,
      planStatus:  'active'       as const,
      accentColor: '#0284c7',
    },
  ]

  for (const account of accounts) {
    console.log(`\n🏟  Seeding ${account.plan} account (${account.email})…`)
    await seedTeam(account)
  }

  console.log('\n✅ Emulator seeded successfully!\n')
  console.log('   ┌─────────────────────┬──────────────────────┬──────────────┬────────────┐')
  console.log('   │ Plan                │ Email                │ Password     │ Status     │')
  console.log('   ├─────────────────────┼──────────────────────┼──────────────┼────────────┤')
  console.log('   │ coach               │ coach@lineup.dev     │ lineup123    │ trial      │')
  console.log('   │ club                │ club@lineup.dev      │ lineup123    │ active     │')
  console.log('   │ organization        │ org@lineup.dev       │ lineup123    │ active     │')
  console.log('   └─────────────────────┴──────────────────────┴──────────────┴────────────┘\n')
  console.log('   Portals:')
  for (const a of accounts) {
    console.log(`   ${a.plan.padEnd(16)} →  http://localhost:3000/portal/${a.teamSlug}`)
  }
  console.log('')
}

main().catch((err) => {
  console.error('❌ Seed failed:', err)
  process.exit(1)
})
