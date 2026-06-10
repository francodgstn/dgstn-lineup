/**
 * Seed script for the Firebase emulator.
 *
 * Usage (emulators must be running first):
 *   pnpm seed
 *
 * What it creates:
 *   Three plan-tier accounts, each with full data:
 *
 *   coach@linyup.com  / linyup123  →  plan: coach  (trial)
 *   club@linyup.com   / linyup123  →  plan: club   (active)
 *   org@linyup.com    / linyup123  →  plan: organization (active)
 *
 *   Per team:
 *   - 4 group-class activities + 1 coaching activity (type='coaching')
 *   - 36 group-class sessions (past + upcoming) + 6 coaching sessions (open/full mix)
 *   - 1 coach_availability template per team
 *   - 18 contacts, 3 events, 4 group bookings + 2 coaching bookings
 *   - Past-session participants, weekly reports, goals
 *
 *   Club tier only:
 *   - Club Courses plugin installed + 2 courses (published + draft) with
 *     modules and text/audio/video lessons
 */

// emulator env vars must be set BEFORE admin.initializeApp()
process.env.FIREBASE_AUTH_EMULATOR_HOST = 'localhost:9099'
process.env.FIRESTORE_EMULATOR_HOST     = 'localhost:8080'

import admin from 'firebase-admin'

admin.initializeApp({ projectId: 'demo-linyup' })

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
    'http://localhost:8080/emulator/v1/projects/demo-linyup/databases/(default)/documents',
    { method: 'DELETE' }
  ).catch(() => {})
  await fetch(
    'http://localhost:9099/emulator/v1/projects/demo-linyup/accounts',
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

  // Ranking systems — Training Level for coach, BJJ Belt for club/org
  const rankingSystemDefs = plan === 'coach'
    ? [{
        id: 'training-level',
        name: 'Training Level',
        is_primary: true,
        levels: [
          { value: 0, label: 'Beginner',     color: '#6b7280' },
          { value: 1, label: 'Intermediate', color: '#2563eb' },
          { value: 2, label: 'Advanced',     color: '#7c3aed' },
          { value: 3, label: 'Expert',       color: '#dc2626' },
        ],
      }]
    : [{
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

  // Rank system ID used as key in contact.ranks map
  const rankSystemId = plan === 'coach' ? 'training-level' : 'bjj-belt'

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

  // Per-contact subscription assignment (index → config)
  // Active students get a subscription type linked to them
  const subMonthly  = `${teamId}-sub-monthly`
  const subAnnual   = `${teamId}-sub-annual`
  const subDropin   = `${teamId}-sub-dropin`
  const subFitpass  = `${teamId}-sub-fitpass`
  const subSportpass= `${teamId}-sub-sportpass`
  type SubAssign = { subId: string; subName: string; recurrence: string | null }
  const contactSubRank: Record<number, SubAssign> = {
    0:  { subId: subMonthly,   subName: 'Monthly Membership', recurrence: 'monthly'  },
    1:  { subId: subMonthly,   subName: 'Monthly Membership', recurrence: 'monthly'  },
    2:  { subId: subAnnual,    subName: 'Annual Membership',  recurrence: 'annual'   },
    3:  { subId: subMonthly,   subName: 'Monthly Membership', recurrence: 'monthly'  },
    4:  { subId: subMonthly,   subName: 'Monthly Membership', recurrence: 'monthly'  },
    5:  { subId: subDropin,    subName: 'Drop-in',            recurrence: null       },
    6:  { subId: plan !== 'coach' ? subFitpass  : subMonthly,
          subName: plan !== 'coach' ? 'FitPass Partner' : 'Monthly Membership',
          recurrence: plan !== 'coach' ? null : 'monthly' },
    10: { subId: subMonthly,   subName: 'Monthly Membership', recurrence: 'monthly'  },
    11: { subId: subAnnual,    subName: 'Annual Membership',  recurrence: 'annual'   },
    16: { subId: subAnnual,    subName: 'Annual Membership',  recurrence: 'annual'   },
    17: { subId: plan !== 'coach' ? subSportpass : subMonthly,
          subName: plan !== 'coach' ? 'SportPass' : 'Monthly Membership',
          recurrence: null },
  }

  // Per-contact rank assignment — keyed by contact index.
  // Covers all students (active, almost_ready, expired); trials & external have no rank.
  // coach → Training Level (0 Beginner … 3 Expert, inferred from session count)
  // club/org → BJJ Belt (0 White … 4 Black)
  const contactRankMap: Record<number, number> = plan === 'coach'
    ? { 0: 2, 1: 2, 2: 3, 3: 1, 4: 2, 5: 0, 6: 2, 7: 0, 8: 0, 9: 1, 10: 1, 11: 2, 16: 3, 17: 1 }
    : { 0: 1, 1: 1, 2: 2, 3: 0, 4: 1, 5: 0, 6: 1, 7: 0, 8: 0, 9: 1, 10: 0, 11: 1, 16: 2, 17: 1 }

  // Auth user
  await auth.createUser({ uid, email, password: 'linyup123', displayName, emailVerified: true })

  // Team doc
  const trialEndsAt = plan === 'coach' ? ts(daysFromNow(14)) : undefined
  await db.collection('teams').doc(teamId).set({
    name:        teamName,
    description: `${teamName} — managed with Linyup.`,
    slug:        teamSlug,
    sport_type:  'Martial arts',
    createdBy:   uid,
    created:     ts(daysFromNow(-120)),
    plan,
    plan_status: planStatus,
    ...(trialEndsAt ? { trial_ends_at: trialEndsAt } : {}),
    ranking_systems: rankingSystemDefs,
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
      description:       `${teamName} — managed with Linyup.`,
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
      showBranding: false, // paid plans carry no "Powered by Linyup" badge
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
    { id: `${teamId}-act-bjj`,     name: 'Brazilian Jiu-Jitsu', slug: 'bjj',           color: accentColor,  level: 'all',          isFreeTrial: true,  type: 'group_class' as const },
    { id: `${teamId}-act-mma`,     name: 'MMA',                  slug: 'mma',           color: '#dc2626',    level: 'intermediate', isFreeTrial: false, type: 'group_class' as const },
    { id: `${teamId}-act-kickbox`, name: 'Kickboxing',           slug: 'kickboxing',    color: '#ea580c',    level: 'all',          isFreeTrial: true,  type: 'group_class' as const },
    { id: `${teamId}-act-yoga`,    name: 'Yoga & Mobility',      slug: 'yoga-mobility', color: '#059669',    level: 'all',          isFreeTrial: true,  type: 'group_class' as const },
  ]
  for (const a of activities) {
    await db.collection('activities').doc(a.id).set({ ...a, teamId, isActive: true, created_at: ts(daysFromNow(-100)) })
    await db.collection('activities').doc(a.id)
      .collection('public_profile').doc(a.id).set({
        type: 'activity', teamId, name: a.name, slug: a.slug, color: a.color,
        image_url: null, isFreeTrial: a.isFreeTrial, level: a.level,
      })
  }

  // ── coaching activity ────────────────────────────────────────────────────────
  const coachingActId   = `${teamId}-act-coaching`
  const coachingActName = plan === 'coach' ? 'Personal Training' : '1-on-1 Coaching'
  await db.collection('activities').doc(coachingActId).set({
    teamId,
    name:       coachingActName,
    slug:       '1on1-coaching',
    color:      accentColor,
    type:       'coaching',
    coachId:    uid,
    coachName:  displayName,
    level:      'all',
    isFreeTrial: true,
    isActive:   true,
    created_at: ts(daysFromNow(-90)),
  })
  await db.collection('activities').doc(coachingActId)
    .collection('public_profile').doc(coachingActId).set({
      type: 'activity', teamId,
      name: coachingActName, slug: '1on1-coaching', color: accentColor,
      image_url: null, isFreeTrial: true, level: 'all',
    })

  // ── coach availability template ──────────────────────────────────────────────
  const coachingTemplateId = `${teamId}-tpl-coaching`
  await db.collection('coach_availability').doc(coachingTemplateId).set({
    teamId,
    coachId:          uid,
    coachName:        displayName,
    activityId:       coachingActId,
    title:            coachingActName,
    description:      'One-on-one coaching session.',
    duration_minutes: 60,
    max_participants: 1,
    isFreeTrial:      true,
    location:         'Dojo A',
    onlineUrl:        null,
    status:           'active',
    recurrence: {
      type:     'weekly',
      days:     [1, 3],    // Mon + Wed
      time:     '08:00',
      timezone: 'Europe/Zurich',
    },
    window_days: 30,
    created_at: ts(daysFromNow(-30)),
  })

  // ── coaching sessions (generated as if onCoachAvailabilityWritten ran) ───────
  // Mix of open and full slots to represent a realistic schedule.
  const coachingSlotDefs = [
    { dayOffset: 1,  hour: 8,  bookings: 0 },  // open
    { dayOffset: 3,  hour: 8,  bookings: 1 },  // full (1/1)
    { dayOffset: 8,  hour: 8,  bookings: 0 },  // open
    { dayOffset: 10, hour: 8,  bookings: 1 },  // full
    { dayOffset: 15, hour: 8,  bookings: 0 },  // open
    { dayOffset: 17, hour: 8,  bookings: 0 },  // open
  ]
  // First active contact will be the pre-booked student (Luca Ferrari)
  const bookedContact = {
    id:        `${teamId}-contact-000`,
    firstname: 'Luca',
    lastname:  'Ferrari',
    email:     `luca.ferrari.${teamId}@email.com`,
  }

  for (let i = 0; i < coachingSlotDefs.length; i++) {
    const slotDef = coachingSlotDefs[i]
    const base = daysFromNow(slotDef.dayOffset)
    base.setHours(slotDef.hour, 0, 0, 0)
    const end = hoursOffset(base, 1)
    const sid = `${teamId}-coaching-session-${i}`
    const isFull = slotDef.bookings >= 1
    const status = isFull ? 'full' : 'open'

    await db.collection('sessions').doc(sid).set({
      teamId,
      activityType:     'coaching',
      activityId:       coachingActId,
      activityName:     coachingActName,
      templateId:       coachingTemplateId,
      coachId:          uid,
      coachName:        displayName,
      isFreeTrial:      true,
      start:            ts(base),
      end:              ts(end),
      duration_minutes: 60,
      max_participants: 1,
      bookings_count:   slotDef.bookings,
      location:         'Dojo A',
      onlineUrl:        null,
      allowBooking:     true,
      status,
      created_at:       ts(daysFromNow(-7)),
    })

    // Public profile — enables unauthenticated portal access
    await db.collection('sessions').doc(sid)
      .collection('public_profile').doc(sid).set({
        type:             'coaching_session',
        teamId,
        activityType:     'coaching',
        activityName:     coachingActName,
        coachId:          uid,
        coachName:        displayName,
        templateId:       coachingTemplateId,
        start:            ts(base),
        end:              ts(end),
        duration_minutes: 60,
        location:         'Dojo A',
        onlineUrl:        null,
        max_participants: 1,
        bookings_count:   slotDef.bookings,
        isFreeTrial:      true,
        status,
        allowBooking:     true,
      })

    // Booking doc for full slots — use session-scoped ID so the same contact
    // booked into multiple sessions doesn't produce duplicate keys in collectionGroup queries
    if (isFull) {
      await db.collection('sessions').doc(sid)
        .collection('bookings').doc(`${sid}-booking`).set({
          teamId,
          contactId:      bookedContact.id,
          session:        sid,
          email:          bookedContact.email,
          firstname:      bookedContact.firstname,
          lastname:       bookedContact.lastname,
          status:         'confirmed',
          joinedAt:       ts(daysFromNow(-2)),
          booking_token:  `tok-coaching-${teamId}-${i}`,
          is_new_contact: false,
        })
    }
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
    const subAssign  = contactSubRank[i] ?? null
    const rankValue  = contactRankMap[i] ?? null
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
      ...(rankValue != null ? { ranks: { [rankSystemId]: rankValue } } : {}),
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
  const sessionBookingCounts = new Map<string, { bookings_count: number; trial_bookings_count: number }>()
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
    const cur = sessionBookingCounts.get(sessionId) ?? { bookings_count: 0, trial_bookings_count: 0 }
    cur.bookings_count++
    cur.trial_bookings_count++ // all seeded bookings are is_new_contact: true
    sessionBookingCounts.set(sessionId, cur)
  }
  for (const [sessionId, counts] of sessionBookingCounts) {
    await db.collection('sessions').doc(sessionId).update(counts)
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
    {
      title: 'Regional BJJ Tournament',
      type: 'competition', startOffset: 45, durationH: 8, fee: 25,
      location: 'Sports Arena Geneva',
      description: 'Annual regional championship — open to white and blue belts. Gi and No-Gi divisions available.',
    },
    {
      title: 'Summer MMA Camp',
      type: 'camp', startOffset: 60, durationH: 72, fee: 180,
      location: 'High Performance Training Center',
      description: '3-day intensive camp with guest instructors. All skill levels welcome. Accommodation included.',
    },
    {
      title: 'Nutrition Workshop',
      type: 'seminar', startOffset: 14, durationH: 3, fee: 0,
      location: 'Team HQ — Conference Room',
      description: 'Practical guide to sports nutrition and recovery for martial artists. Free for all members.',
    },
  ]
  const eventIds: string[] = []
  for (let i = 0; i < eventDefs.length; i++) {
    const e = eventDefs[i]
    const eventId = `${teamId}-event-${i}`
    eventIds.push(eventId)
    await db.collection('events').doc(eventId).set({
      teamId,
      title: e.title, type: e.type, fee: e.fee, description: e.description,
      location: e.location,
      start:  ts(daysFromNow(e.startOffset)),
      end:    ts(hoursOffset(daysFromNow(e.startOffset), e.durationH)),
      status: 'open',
      participants_count: 0,
      attendees_count: 0,
      invitations_sent_count: 0,
      deleted_at: null,
      createdBy: uid,
      created_at: ts(daysFromNow(-10)),
    })
  }

  // Event invitations & attendees
  // Realistic: a subset of contacts are invited per event, with varied RSVP status.
  // Token format is deterministic so dev/test links work predictably.
  const inviteSlices = [12, 8, 10]          // how many contacts to invite per event
  // Status distribution per position j: 0-2 responded, 3-4 declined, 5-7 opened, rest sent
  function inviteStatusForIdx(j: number): 'responded' | 'declined' | 'opened' | 'sent' {
    if (j < 3) return 'responded'
    if (j < 5) return 'declined'
    if (j < 8) return 'opened'
    return 'sent'
  }

  for (let ei = 0; ei < eventIds.length; ei++) {
    const eventId   = eventIds[ei]
    const maxInvite = inviteSlices[ei]
    let sentCount  = 0
    let attendeeCount = 0

    // Pick contacts that have an email (all 18 do) — vary starting index per event
    const startIdx = ei * 3
    const inviteIndices = Array.from({ length: maxInvite }, (_, k) => (startIdx + k) % contactSeeds.length)

    for (let j = 0; j < inviteIndices.length; j++) {
      const cidx = inviteIndices[j]
      const c = contactSeeds[cidx]
      if (!c.email) continue

      const contactId = `${teamId}-contact-${cidx.toString().padStart(3, '0')}`
      const status    = inviteStatusForIdx(j)
      // Deterministic token — 64-char hex-like string for test links
      const token     = `seed${teamId}ev${ei}c${cidx}`.padEnd(32, '0').repeat(2).slice(0, 64)
      const link      = `http://localhost:3000/portal/event-invitation?token=${token}`
      const hasOpened = ['opened', 'responded', 'declined'].includes(status)
      const hasRsvp   = ['responded', 'declined'].includes(status)

      await db.collection('events').doc(eventId)
        .collection('invitations').doc(contactId).set({
          contactId,
          firstname:    c.firstname,
          lastname:     c.lastname,
          email:        c.email,
          status,
          token,
          link,
          eventId,
          sentBy:       uid,
          sentAt:       ts(daysFromNow(-7)),
          firstOpenedAt: hasOpened ? ts(daysFromNow(-5)) : null,
          lastOpenedAt:  hasOpened ? ts(daysFromNow(-3)) : null,
          respondedAt:   hasRsvp   ? ts(daysFromNow(-2)) : null,
        })
      sentCount++

      if (status === 'responded') {
        attendeeCount++
        await db.collection('events').doc(eventId)
          .collection('attendees').doc(contactId).set({
            contactId,
            firstname:   c.firstname,
            lastname:    c.lastname,
            email:       c.email,
            notes:       j === 0 ? 'Really looking forward to this!' : null,
            respondedAt: ts(daysFromNow(-2)),
          })
      }
    }

    // Update event-level counters
    await db.collection('events').doc(eventId).update({
      invitations_sent_count:  sentCount,
      attendees_count:         attendeeCount,
      last_invitation_sent_at: ts(daysFromNow(-7)),
    })
  }

  // ── saas_subscriptions ────────────────────────────────────────────────────
  // Mirrors the state the Stripe webhook would write after a real payment.
  // gateway_type: null = manually managed (no real Stripe customer yet in dev).
  const now = ts(new Date())
  if (plan === 'coach') {
    await db.collection('saas_subscriptions').doc(teamId).set({
      teamId,
      plan:                  'coach',
      status:                'trial',
      trial_ends_at:         ts(daysFromNow(14)),
      current_period_start:  null,
      current_period_end:    null,
      cancel_at_period_end:  false,
      gateway_type:          null,
      gateway_data:          null,
      created_at:            now,
      updated_at:            now,
    })
  } else {
    const periodStart = ts(daysFromNow(-30))
    const periodEnd   = ts(daysFromNow(1))   // renews tomorrow
    await db.collection('saas_subscriptions').doc(teamId).set({
      teamId,
      plan,
      status:                'active',
      trial_ends_at:         null,
      current_period_start:  periodStart,
      current_period_end:    periodEnd,
      cancel_at_period_end:  false,
      gateway_type:          null,   // null = manually managed / pre-configured
      gateway_data:          null,
      created_at:            ts(daysFromNow(-120)),
      updated_at:            now,
    })
  }

  // ── club courses (Club Courses LMS plugin) ─────────────────────────────────
  // Only the club-tier account showcases the plugin (courses is a club+ feature).
  if (plan === 'club') {
    await seedCourses(teamId, uid)
  }
}

// ── club courses seed ───────────────────────────────────────────────────────────

async function seedCourses(teamId: string, uid: string) {
  // Install the Club Courses plugin for this team so it appears in the sidebar.
  await db.collection('teams').doc(teamId)
    .collection('installed_plugins').doc('club-courses').set({
      pluginId:    'club-courses',
      teamId,
      installedAt: ts(daysFromNow(-20)),
      installedBy: uid,
      status:      'active',
      config:      {},
    })

  type LessonSeed = {
    title: string
    type: 'text' | 'audio' | 'video'
    body?: string
    mediaSource?: 'youtube' | 'vimeo' | 'url' | 'upload'
    mediaUrl?: string
    durationSeconds?: number
    attachments?: { name: string; url: string; size?: number; contentType?: string }[]
  }
  type ModuleSeed = { title: string; summary?: string; lessons: LessonSeed[] }
  type CourseSeed = {
    title: string
    summary: string
    status: 'draft' | 'published'
    accessType: 'free' | 'members'
    modules: ModuleSeed[]
  }

  const courseSeeds: CourseSeed[] = [
    {
      title:      'BJJ Fundamentals',
      summary:    'A beginner-friendly path through the core positions, escapes and submissions of Brazilian Jiu-Jitsu.',
      status:     'published',
      accessType: 'members',
      modules: [
        {
          title:   'Getting Started',
          summary: 'Orientation and your first day on the mats.',
          lessons: [
            {
              title: 'Welcome & how this course works',
              type:  'text',
              body:  '<h2>Welcome</h2><p>This course takes you from your very first class to a confident understanding of the fundamentals.</p><p><strong>What you will need</strong></p><ul><li>A gi (or rashguard for no-gi classes)</li><li>A water bottle</li><li>An open mind</li></ul><p>Work through the modules in order — each one builds on the last.</p>',
            },
            {
              title:           'Mat etiquette & safety',
              type:            'video',
              mediaSource:     'youtube',
              mediaUrl:        'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
              durationSeconds: 420,
            },
          ],
        },
        {
          title:   'Core Positions',
          summary: 'Guard, mount, side control and the positional hierarchy.',
          lessons: [
            {
              title:           'Understanding the guard',
              type:            'video',
              mediaSource:     'youtube',
              mediaUrl:        'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
              durationSeconds: 600,
            },
            {
              title:           'Escaping side control',
              type:            'video',
              mediaSource:     'vimeo',
              mediaUrl:        'https://vimeo.com/76979871',
              durationSeconds: 540,
            },
            {
              title: 'Positional hierarchy cheat sheet',
              type:  'text',
              body:  '<h3>Positional hierarchy</h3><p>From worst to best for you:</p><ol><li>Mounted / back taken (escape!)</li><li>Side control bottom</li><li>Guard (neutral)</li><li>Side control top</li><li>Mount</li><li>Back control (best)</li></ol><p>Always fight to improve your position before hunting for a submission.</p>',
              attachments: [
                { name: 'positional-hierarchy.pdf', url: 'https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf', size: 13264, contentType: 'application/pdf' },
              ],
            },
          ],
        },
      ],
    },
    {
      title:      'Strength & Conditioning for Fighters',
      summary:    'Build the engine: mobility, strength and recovery routines tailored for grapplers and strikers.',
      status:     'draft',
      accessType: 'members',
      modules: [
        {
          title:   'Mobility Foundations',
          lessons: [
            {
              title:           'Daily mobility flow (guided audio)',
              type:            'audio',
              mediaSource:     'url',
              mediaUrl:        'https://download.samplelib.com/mp3/sample-12s.mp3',
              durationSeconds: 720,
            },
            {
              title: 'Warm-up principles',
              type:  'text',
              body:  '<h3>Warm-up principles</h3><p>A good warm-up raises your core temperature, primes your nervous system and reduces injury risk.</p><ul><li>3–5 min easy movement</li><li>Joint circles (ankles, hips, shoulders, neck)</li><li>Sport-specific drills at increasing intensity</li></ul><p>Never roll or spar cold.</p>',
            },
          ],
        },
      ],
    },
  ]

  for (let ci = 0; ci < courseSeeds.length; ci++) {
    const cs       = courseSeeds[ci]
    const courseId = `${teamId}-course-${ci}`
    const slug     = cs.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')
    const lessonCount = cs.modules.reduce((n, m) => n + m.lessons.length, 0)

    await db.collection('courses').doc(courseId).set({
      scope:       'team',
      teamId,
      title:       cs.title,
      slug:        `${slug}-${ci}`,
      summary:     cs.summary,
      status:      cs.status,
      accessRule:  { type: cs.accessType },
      moduleCount: cs.modules.length,
      lessonCount,
      order:       ci,
      created_at:  ts(daysFromNow(-18 + ci)),
      updated_at:  ts(daysFromNow(-2)),
      createdBy:   uid,
      archived_at: null,
    })

    for (let mi = 0; mi < cs.modules.length; mi++) {
      const m        = cs.modules[mi]
      const moduleId = `${courseId}-module-${mi}`
      await db.collection('courses').doc(courseId)
        .collection('modules').doc(moduleId).set({
          courseId, teamId,
          title:      m.title,
          ...(m.summary ? { summary: m.summary } : {}),
          order:      mi,
          created_at: ts(daysFromNow(-18 + ci)),
          updated_at: ts(daysFromNow(-2)),
        })

      for (let li = 0; li < m.lessons.length; li++) {
        const l        = m.lessons[li]
        const lessonId = `${moduleId}-lesson-${li}`
        await db.collection('courses').doc(courseId)
          .collection('lessons').doc(lessonId).set({
            courseId, moduleId, teamId,
            title: l.title,
            type:  l.type,
            order: li,
            ...(l.body            !== undefined ? { body: l.body }                       : {}),
            ...(l.mediaSource     !== undefined ? { mediaSource: l.mediaSource }         : {}),
            ...(l.mediaUrl        !== undefined ? { mediaUrl: l.mediaUrl }               : {}),
            ...(l.durationSeconds !== undefined ? { durationSeconds: l.durationSeconds } : {}),
            ...(l.attachments     !== undefined ? { attachments: l.attachments }         : {}),
            created_at: ts(daysFromNow(-18 + ci)),
            updated_at: ts(daysFromNow(-2)),
          })
      }
    }
  }
}

// ── org seed ──────────────────────────────────────────────────────────────────

async function seedOrg() {
  const ORG_ID    = 'seed-org'
  const ORG_ADMIN = 'seed-org-uid'   // Rafael Torres (also owns seed-team-org)
  const CLUB_A    = 'seed-team-club' // Iron Circle Gym (Anna Schmidt)
  const CLUB_B    = 'seed-team-org'  // Titan Combat Sports (Rafael Torres)

  const now        = ts(new Date())
  const periodStart = ts(daysFromNow(-30))
  const periodEnd   = ts(daysFromNow(1))

  // BJJ Belt ranking system — shared across all clubs in this org
  const bjjBelt = [{
    id:         'bjj-belt',
    name:       'BJJ Belt',
    is_primary: true,
    levels: [
      { value: 0, label: 'White Belt',  color: '#e5e7eb' },
      { value: 1, label: 'Blue Belt',   color: '#1d4ed8' },
      { value: 2, label: 'Purple Belt', color: '#7e22ce' },
      { value: 3, label: 'Brown Belt',  color: '#78350f' },
      { value: 4, label: 'Black Belt',  color: '#111827' },
    ],
  }]

  // ── Organization document ─────────────────────────────────────────────────
  await db.collection('organizations').doc(ORG_ID).set({
    name:            'Titan Martial Arts Association',
    slug:            'titan-martial-arts',
    description:     'The Titan organization — managing Iron Circle Gym and Titan Combat Sports.',
    plan:            'organization',
    plan_status:     'active',
    ranking_systems: bjjBelt,
    created:         ts(daysFromNow(-180)),
    createdBy:       ORG_ADMIN,
  })

  // ── Org admin member ──────────────────────────────────────────────────────
  await db.collection('organizations').doc(ORG_ID)
    .collection('org_members').doc(ORG_ADMIN).set({
      userId:  ORG_ADMIN,
      orgId:   ORG_ID,
      role:    'org_admin',
      joined:  now,
      addedBy: ORG_ADMIN,
    })

  // Record orgId on the admin's user profile so the sidebar finds it without collectionGroup
  await db.collection('users').doc(ORG_ADMIN).update({
    orgIds: [ORG_ID],
  })

  // ── Org teams ─────────────────────────────────────────────────────────────
  for (const teamId of [CLUB_A, CLUB_B]) {
    await db.collection('organizations').doc(ORG_ID)
      .collection('org_teams').doc(teamId).set({
        teamId,
        orgId:   ORG_ID,
        status:  'active',
        joined:  now,
        addedBy: ORG_ADMIN,
      })

    // Link team to org; clear team-level ranking_systems (org provides them)
    await db.collection('teams').doc(teamId).update({
      org_id:          ORG_ID,
      ranking_systems: [],  // delegated to org
    })
  }

  // ── SaaS subscription for the org ────────────────────────────────────────
  await db.collection('saas_subscriptions').doc(ORG_ID).set({
    entity_type:          'org',
    entity_id:            ORG_ID,
    teamId:               ORG_ID, // backwards-compat field
    plan:                 'organization',
    status:               'active',
    trial_ends_at:        null,
    current_period_start: periodStart,
    current_period_end:   periodEnd,
    cancel_at_period_end: false,
    gateway_type:         null,
    gateway_data:         null,
    created_at:           ts(daysFromNow(-180)),
    updated_at:           now,
  })

  // ── Org-wide event ────────────────────────────────────────────────────────
  await db.collection('events').add({
    orgId:       ORG_ID,
    teamId:      null,
    scope:       'org',
    title:       'Titan Open Championship 2026',
    type:        'competition',
    start:       ts(daysFromNow(45)),
    end:         ts(daysFromNow(46)),
    location:    'Geneva Sports Arena',
    description: 'Annual open championship — all Titan clubs are invited to participate.',
    status:      'open',
    deleted_at:  null,
    createdBy:   ORG_ADMIN,
    created_at:  now,
  })
}

// ── free-plan team ────────────────────────────────────────────────────────────
// Minimal tenant pinned EXACTLY at the Free plan's 10-contact hard cap, to
// exercise: blocked manual adds, portal "Powered by Linyup" badge, locked
// member invites, and fully upgrade-locked plugins.

async function seedFreeTeam() {
  const uid      = 'seed-free-uid'
  const teamId   = 'seed-team-free'
  const teamSlug = 'sunrise-yoga-studio'
  const teamName = 'Sunrise Yoga Studio'

  await auth.createUser({ uid, email: 'free@linyup.com', password: 'linyup123', displayName: 'Luca Bianchi', emailVerified: true })

  await db.collection('teams').doc(teamId).set({
    name:        teamName,
    description: `${teamName} — managed with Linyup.`,
    slug:        teamSlug,
    sport_type:  'Yoga',
    createdBy:   uid,
    created:     ts(daysFromNow(-60)),
    plan:        'free',
    plan_status: 'active',
    // Mimics a lapsed trial → drives the FreeDowngradeBanner in the web app.
    downgraded_from_trial_at: ts(daysFromNow(-5)),
    portalTheme:       'light',
    portalAccentColor: '#0d9488',
    portalBackground:  { type: 'solid', color: '#ffffff' },
    links: [
      { label: 'Book a Free Trial', isBookingLink: true, isMembershipLink: false, showInPortal: true, iconName: 'CalendarPlus', url: null },
    ],
    socialLinks: [{ platform: 'instagram', url: `https://instagram.com/${teamSlug}` }],
  })

  await db.collection('teams').doc(teamId)
    .collection('public_profile').doc(teamId).set({
      type:              'team',
      name:              teamName,
      description:       `${teamName} — managed with Linyup.`,
      slug:              teamSlug,
      sport_type:        'Yoga',
      profileImage:      null,
      heroImage:         null,
      portalTheme:       'light',
      portalAccentColor: '#0d9488',
      portalBackground:  { type: 'solid', color: '#ffffff' },
      socialLinks:       [{ platform: 'instagram', url: `https://instagram.com/${teamSlug}` }],
      links: [
        { label: 'Book a Free Trial', isBookingLink: true, isMembershipLink: false, showInPortal: true, iconName: 'CalendarPlus', url: null },
      ],
      bookingSettings: { flowType: 'activity-first', windowMonths: 2, showPhone: true, ctaUrl: null, ctaLabel: null },
      showBranding: true, // Free plan → "Powered by Linyup" badge on the portal
      updated_at: ts(new Date()),
    })

  await db.collection('teams').doc(teamId)
    .collection('team_members').doc(uid).set({
      teamId, userId: uid, role: 'owner', email: 'free@linyup.com', joined: ts(daysFromNow(-60)),
    })

  await db.collection('users').doc(uid).set({
    email: 'free@linyup.com', displayName: 'Luca Bianchi', firstname: 'Luca', lastname: 'Bianchi',
    currentTeam: teamId,
    created_at:  ts(daysFromNow(-60)),
  })

  // One bookable activity so the public portal flow works
  const actId = `${teamId}-act-yoga`
  await db.collection('activities').doc(actId).set({
    id: actId, teamId, name: 'Vinyasa Flow', slug: 'vinyasa-flow', color: '#0d9488',
    isFreeTrial: true, level: 'all', isActive: true, created_at: ts(daysFromNow(-60)),
  })
  await db.collection('activities').doc(actId)
    .collection('public_profile').doc(actId).set({
      type: 'activity', teamId, name: 'Vinyasa Flow', slug: 'vinyasa-flow', color: '#0d9488',
      image_url: null, isFreeTrial: true, level: 'all',
    })

  // Exactly 10 active contacts — at the hard cap
  const freeContacts = [
    { firstname: 'Mia',    lastname: 'Keller',  gender: 'F' },
    { firstname: 'Jonas',  lastname: 'Frei',    gender: 'M' },
    { firstname: 'Lea',    lastname: 'Steiner', gender: 'F' },
    { firstname: 'Noah',   lastname: 'Brunner', gender: 'M' },
    { firstname: 'Elena',  lastname: 'Marti',   gender: 'F' },
    { firstname: 'Tim',    lastname: 'Graf',    gender: 'M' },
    { firstname: 'Sofia',  lastname: 'Arnold',  gender: 'F' },
    { firstname: 'Luca',   lastname: 'Wyss',    gender: 'M' },
    { firstname: 'Anna',   lastname: 'Roth',    gender: 'F' },
    { firstname: 'Felix',  lastname: 'Baumann', gender: 'M' },
  ]
  for (let i = 0; i < freeContacts.length; i++) {
    const c = freeContacts[i]
    await db.collection('contacts').doc(`${teamId}-contact-${i.toString().padStart(3, '0')}`).set({
      teamId, ...c,
      email: `${c.firstname.toLowerCase()}.${c.lastname.toLowerCase()}.${teamId}@email.com`,
      type: 'student',
      membership_status: 'active',
      membership_active: true,
      total_sessions: 5 + i,
      last_session_at: ts(daysFromNow(-(i + 1))),
      created_at: ts(daysFromNow(-50 + i)),
      deleted_at: null, archived_at: null,
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
      email:       'coach@linyup.com',
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
      email:       'club@linyup.com',
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
      email:       'org@linyup.com',
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

  console.log('\n🧘  Seeding free account (free@linyup.com)…')
  await seedFreeTeam()

  console.log('\n🏢  Seeding organization (Titan Martial Arts Association)…')
  await seedOrg()

  console.log('\n✅ Emulator seeded successfully!\n')
  console.log('   ┌─────────────────────┬──────────────────────┬──────────────┬────────────┐')
  console.log('   │ Plan                │ Email                │ Password     │ Status     │')
  console.log('   ├─────────────────────┼──────────────────────┼──────────────┼────────────┤')
  console.log('   │ free (at cap 10/10) │ free@linyup.com      │ linyup123    │ active     │')
  console.log('   │ coach               │ coach@linyup.com     │ linyup123    │ trial      │')
  console.log('   │ club (in org)       │ club@linyup.com      │ linyup123    │ active     │')
  console.log('   │ org admin           │ org@linyup.com       │ linyup123    │ active     │')
  console.log('   └─────────────────────┴──────────────────────┴──────────────┴────────────┘\n')
  console.log('   Organization: Titan Martial Arts Association (org@linyup.com is org admin)')
  console.log('   Clubs in org: Iron Circle Gym + Titan Combat Sports\n')
  console.log('   Club Courses: 2 courses seeded for club@linyup.com → /plugins/club-courses\n')
  console.log('   Portals:')
  for (const a of accounts) {
    console.log(`   ${a.plan.padEnd(16)} →  http://localhost:3000/portal/${a.teamSlug}`)
  }
  console.log(`   ${'free'.padEnd(16)} →  http://localhost:3000/portal/sunrise-yoga-studio  (shows "Powered by Linyup")`)
  console.log('')
}

main().catch((err) => {
  console.error('❌ Seed failed:', err)
  process.exit(1)
})
