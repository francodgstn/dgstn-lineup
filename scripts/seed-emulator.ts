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

  // ── sessions ────────────────────────────────────────────────────────────────
  type SessionDef = { dayOffset: number; actId: string; actName: string; hour: number; duration: number; location: string; allowBooking: boolean }
  const sessionDefs: SessionDef[] = []

  for (let week = -4; week <= -1; week++) {
    for (const [dayOff, actId, actName, hour, dur, loc] of [
      [1, `${teamId}-act-bjj`,     'Brazilian Jiu-Jitsu', 18, 1.5, 'Dojo A'],
      [3, `${teamId}-act-kickbox`, 'Kickboxing',          19, 1,   'Dojo B'],
      [5, `${teamId}-act-bjj`,     'Brazilian Jiu-Jitsu', 7,  1,   'Dojo A'],
      [6, `${teamId}-act-mma`,     'MMA',                 10, 2,   'Main Hall'],
    ] as const) {
      sessionDefs.push({ dayOffset: week * 7 + Number(dayOff), actId, actName, hour: Number(hour), duration: Number(dur), location: String(loc), allowBooking: false })
    }
  }
  for (let week = 0; week <= 3; week++) {
    for (const [dayOff, actId, actName, hour, dur, loc, ab] of [
      [1, `${teamId}-act-bjj`,     'Brazilian Jiu-Jitsu', 18, 1.5, 'Dojo A',    true],
      [2, `${teamId}-act-yoga`,    'Yoga & Mobility',     9,  1,   'Studio',    true],
      [3, `${teamId}-act-kickbox`, 'Kickboxing',          19, 1,   'Dojo B',    true],
      [5, `${teamId}-act-bjj`,     'Brazilian Jiu-Jitsu', 7,  1,   'Dojo A',    true],
      [6, `${teamId}-act-mma`,     'MMA',                 10, 2,   'Main Hall', true],
      [0, `${teamId}-act-yoga`,    'Yoga & Mobility',     10, 1.5, 'Studio',    false],
    ] as const) {
      sessionDefs.push({ dayOffset: week * 7 + Number(dayOff), actId, actName, hour: Number(hour), duration: Number(dur), location: String(loc), allowBooking: Boolean(ab) })
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
    await db.collection('sessions').doc(id).set({
      teamId, activityId: s.actId, activityName: s.actName,
      start: ts(base), end: ts(end), location: s.location,
      allowBooking: s.allowBooking, participants_count: 0,
      created_at: ts(daysFromNow(-100)), createdBy: uid,
    })
    if (s.allowBooking) {
      await db.collection('sessions').doc(id)
        .collection('public_profile').doc(id).set({
          type: 'session', teamId, activityId: s.actId, activityName: s.actName,
          activityColor: null, start: ts(base), end: ts(end), location: s.location,
          capacity: null, participants_count: 0, allowBooking: true, slug: null,
        })
    }
  }

  // ── contacts ─────────────────────────────────────────────────────────────────
  const contactSeeds = [
    { firstname: 'Luca',      lastname: 'Ferrari',   email: `luca.ferrari.${teamId}@email.com`,   type: 'student',  status: 'active',       gender: 'M', totalSessions: 48 },
    { firstname: 'Sofia',     lastname: 'Bianchi',   email: `sofia.bianchi.${teamId}@email.com`,  type: 'student',  status: 'active',       gender: 'F', totalSessions: 32 },
    { firstname: 'Alex',      lastname: 'Müller',    email: `alex.mueller.${teamId}@email.com`,   type: 'student',  status: 'active',       gender: 'M', totalSessions: 67 },
    { firstname: 'Chiara',    lastname: 'Romano',    email: `chiara.romano.${teamId}@email.com`,  type: 'student',  status: 'active',       gender: 'F', totalSessions: 21 },
    { firstname: 'Matteo',    lastname: 'Esposito',  email: `matteo.espo.${teamId}@email.com`,    type: 'student',  status: 'active',       gender: 'M', totalSessions: 55 },
    { firstname: 'Emma',      lastname: 'Schneider', email: `emma.schneid.${teamId}@email.com`,   type: 'student',  status: 'active',       gender: 'F', totalSessions: 14 },
    { firstname: 'David',     lastname: 'Costa',     email: `david.costa.${teamId}@email.com`,    type: 'student',  status: 'active',       gender: 'M', totalSessions: 39 },
    { firstname: 'Julia',     lastname: 'Weber',     email: `julia.weber.${teamId}@email.com`,    type: 'student',  status: 'almost_ready', gender: 'F', totalSessions: 8  },
    { firstname: 'Marco',     lastname: 'Conti',     email: `marco.conti.${teamId}@email.com`,    type: 'student',  status: 'almost_ready', gender: 'M', totalSessions: 6  },
    { firstname: 'Sara',      lastname: 'Ricci',     email: `sara.ricci.${teamId}@email.com`,     type: 'student',  status: 'expired',      gender: 'F', totalSessions: 28 },
    { firstname: 'Tobias',    lastname: 'Huber',     email: `tobias.huber.${teamId}@email.com`,   type: 'student',  status: 'active',       gender: 'M', totalSessions: 19 },
    { firstname: 'Nina',      lastname: 'Moreau',    email: `nina.moreau.${teamId}@email.com`,    type: 'student',  status: 'active',       gender: 'F', totalSessions: 44 },
    { firstname: 'Lorenzo',   lastname: 'De Luca',   email: `lorenzo.dl.${teamId}@email.com`,     type: 'trial',    status: 'requested',    gender: 'M', totalSessions: 1  },
    { firstname: 'Amélie',    lastname: 'Dupont',    email: `amelie.dupont.${teamId}@email.com`,  type: 'trial',    status: 'requested',    gender: 'F', totalSessions: 0  },
    { firstname: 'Kevin',     lastname: 'Nguyen',    email: `kevin.nguyen.${teamId}@email.com`,   type: 'trial',    status: 'under_review', gender: 'M', totalSessions: 2  },
    { firstname: 'Hannah',    lastname: 'Fischer',   email: `hannah.fisch.${teamId}@email.com`,   type: 'external', status: 'guest',        gender: 'F', totalSessions: 0  },
    { firstname: 'Radu',      lastname: 'Ionescu',   email: `radu.ionescu.${teamId}@email.com`,   type: 'student',  status: 'active',       gender: 'M', totalSessions: 77 },
    { firstname: 'Valentina', lastname: 'Greco',     email: `val.greco.${teamId}@email.com`,      type: 'student',  status: 'active',       gender: 'F', totalSessions: 29 },
  ]

  for (let i = 0; i < contactSeeds.length; i++) {
    const c = contactSeeds[i]
    const id = `${teamId}-contact-${i.toString().padStart(3, '0')}`
    await db.collection('contacts').doc(id).set({
      teamId, ...c,
      membership_status: c.status,
      membership_active: c.status === 'active',
      total_sessions:    c.totalSessions,
      last_session_at:   c.totalSessions > 0 ? ts(daysFromNow(-Math.floor(Math.random() * 14))) : null,
      current_month_score: Math.floor(Math.random() * 120),
      current_streak:      Math.floor(Math.random() * 8),
      created_at: ts(daysFromNow(-Math.floor(Math.random() * 90) - 10)),
      deleted_at: null, archived_at: null,
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
