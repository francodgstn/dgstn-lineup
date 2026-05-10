/**
 * Seed script for the Firebase emulator.
 *
 * Usage (emulators must be running first):
 *   pnpm seed
 *
 * What it creates:
 *   - 1 coach account  →  coach@lineup.dev / lineup123
 *   - 1 team           →  "Samurai Fight Academy"  (slug: samurai-fight-academy)
 *   - 4 activities     →  BJJ, MMA, Kickboxing, Yoga
 *   - 20 sessions      →  mix of past / upcoming
 *   - 18 contacts      →  mix of active, trial, guest, archived
 *   - 3 events         →  competition, camp, seminar
 *   - 4 bookings       →  attached to upcoming sessions
 */

// ── emulator env vars must be set BEFORE admin.initializeApp() ───────────────
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
  // Clear Firestore via emulator REST endpoint
  await fetch(
    'http://localhost:8080/emulator/v1/projects/demo-lineup/databases/(default)/documents',
    { method: 'DELETE' }
  ).catch(() => {/* already empty */})

  // Clear Auth via emulator REST endpoint
  await fetch(
    'http://localhost:9099/emulator/v1/projects/demo-lineup/accounts',
    { method: 'DELETE' }
  ).catch(() => {/* already empty */})
}

// ── main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log('🗑  Clearing emulator data…')
  await clearEmulator()

  // ── 1. Auth user ───────────────────────────────────────────────────────────
  console.log('👤 Creating coach user…')
  const coachEmail = 'coach@lineup.dev'
  const coachUid = 'seed-coach-uid'

  await auth.createUser({
    uid:           coachUid,
    email:         coachEmail,
    password:      'lineup123',
    displayName:   'Marco Rossi',
    emailVerified: true,
  })

  // ── 2. Team ────────────────────────────────────────────────────────────────
  console.log('🏟  Creating team…')
  const teamId = 'seed-team-id'
  const teamSlug = 'samurai-fight-academy'

  await db.collection('teams').doc(teamId).set({
    name:        'Samurai Fight Academy',
    description: 'A premier martial arts school offering BJJ, MMA, Kickboxing, and Yoga classes for all levels.',
    slug:        teamSlug,
    sport_type:  'Martial arts',
    createdBy:   coachUid,
    created_at:  ts(daysFromNow(-120)),
    portalTheme:       'light',
    portalAccentColor: '#7c3aed',
    portalBackground:  { type: 'solid', color: '#ffffff' },
    links: [
      {
        label:           'Book a Free Trial',
        description:     'Try your first class — no commitment',
        isBookingLink:   true,
        isMembershipLink: false,
        showInPortal:    true,
        iconName:        'CalendarPlus',
      },
      {
        label:            'Join as Member',
        description:      'Start your membership today',
        isBookingLink:    false,
        isMembershipLink: true,
        showInPortal:     true,
        iconName:         'UserCheck',
      },
    ],
    socialLinks: [
      { platform: 'instagram', url: 'https://instagram.com/samurai.fight' },
      { platform: 'facebook',  url: 'https://facebook.com/samuraifight' },
    ],
  })

  // Public profile — queried by the portal without auth
  await db.collection('teams').doc(teamId)
    .collection('public_profile').doc(teamId).set({
      type:              'team',
      name:              'Samurai Fight Academy',
      description:       'A premier martial arts school offering BJJ, MMA, Kickboxing, and Yoga classes for all levels.',
      slug:              teamSlug,
      sport_type:        'Martial arts',
      profileImage:      null,
      heroImage:         null,
      portalTheme:       'light',
      portalAccentColor: '#7c3aed',
      portalBackground:  { type: 'solid', color: '#ffffff' },
      socialLinks: [
        { platform: 'instagram', url: 'https://instagram.com/samurai.fight' },
        { platform: 'facebook',  url: 'https://facebook.com/samuraifight' },
      ],
      links: [
        {
          label:            'Book a Free Trial',
          description:      'Try your first class — no commitment',
          isBookingLink:    true,
          isMembershipLink: false,
          showInPortal:     true,
          iconName:         'CalendarPlus',
          url:              null,
        },
        {
          label:            'Join as Member',
          description:      'Start your membership today',
          isBookingLink:    false,
          isMembershipLink: true,
          showInPortal:     true,
          iconName:         'UserCheck',
          url:              null,
        },
      ],
      membershipRequiredFields: null,
      membershipOptionalFields: null,
      updated_at: ts(new Date()),
    })

  // Team membership for coach
  await db.collection('teams').doc(teamId)
    .collection('team_members').doc(coachUid).set({
      teamId,
      userId: coachUid,
      role:   'owner',
      email:  coachEmail,
      joined_at: ts(daysFromNow(-120)),
    })

  // User profile
  await db.collection('users').doc(coachUid).set({
    email:       coachEmail,
    displayName: 'Marco Rossi',
    firstname:   'Marco',
    lastname:    'Rossi',
    currentTeam: teamId,
    created_at:  ts(daysFromNow(-120)),
  })

  // ── 3. Activities ──────────────────────────────────────────────────────────
  console.log('🎯 Creating activities…')

  const activities = [
    {
      id:          'act-bjj',
      name:        'Brazilian Jiu-Jitsu',
      slug:        'bjj',
      description: 'Ground-based grappling focused on submissions and positional control.',
      color:       '#7c3aed',
      level:       'all',
      isFreeTrial: true,
      isActive:    true,
    },
    {
      id:       'act-mma',
      name:     'MMA',
      slug:     'mma',
      description: 'Mixed martial arts combining striking and grappling disciplines.',
      color:    '#dc2626',
      level:    'intermediate',
      isFreeTrial: false,
      isActive: true,
    },
    {
      id:       'act-kickbox',
      name:     'Kickboxing',
      slug:     'kickboxing',
      description: 'Stand-up combat sport using punches and kicks.',
      color:    '#ea580c',
      level:    'all',
      isFreeTrial: true,
      isActive: true,
    },
    {
      id:       'act-yoga',
      name:     'Yoga & Mobility',
      slug:     'yoga-mobility',
      description: 'Flexibility and recovery sessions for all athletes.',
      color:    '#059669',
      level:    'all',
      isFreeTrial: true,
      isActive: true,
    },
  ]

  for (const a of activities) {
    await db.collection('activities').doc(a.id).set({ ...a, teamId, created_at: ts(daysFromNow(-100)) })
    // Public profile — used by portal session list to show activity details
    if (a.isActive) {
      await db.collection('activities').doc(a.id)
        .collection('public_profile').doc(a.id).set({
          type:        'activity',
          teamId,
          name:        a.name,
          description: a.description,
          slug:        a.slug,
          color:       a.color,
          image_url:   null,
          isFreeTrial: a.isFreeTrial,
          level:       a.level,
        })
    }
  }

  // ── 4. Sessions ────────────────────────────────────────────────────────────
  console.log('📅 Creating sessions…')

  // Recurring pattern: Mon/Wed/Fri BJJ, Tue/Thu Kickboxing, Sat MMA, Sun Yoga
  const sessionDefs: Array<{ dayOffset: number; actId: string; actName: string; hour: number; duration: number; location: string; allowBooking: boolean }> = []

  // Past sessions (−28 to −1 days, Mon/Wed/Fri/Sat)
  for (let week = -4; week <= -1; week++) {
    for (const [dayOff, actId, actName, hour, dur, loc, allowBooking] of [
      [1,  'act-bjj',      'Brazilian Jiu-Jitsu', 18, 1.5, 'Dojo A',   false],
      [3,  'act-kickbox',  'Kickboxing',          19, 1,   'Dojo B',   false],
      [5,  'act-bjj',      'Brazilian Jiu-Jitsu', 7,  1,   'Dojo A',   false],
      [6,  'act-mma',      'MMA',                 10, 2,   'Main Hall', false],
    ] as const) {
      sessionDefs.push({ dayOffset: week * 7 + Number(dayOff), actId, actName, hour: Number(hour), duration: Number(dur), location: String(loc), allowBooking: Boolean(allowBooking) })
    }
  }

  // Upcoming sessions (+1 to +28 days)
  for (let week = 0; week <= 3; week++) {
    for (const [dayOff, actId, actName, hour, dur, loc, allowBooking] of [
      [1,  'act-bjj',      'Brazilian Jiu-Jitsu', 18, 1.5, 'Dojo A',    true],
      [2,  'act-yoga',     'Yoga & Mobility',     9,  1,   'Studio',    true],
      [3,  'act-kickbox',  'Kickboxing',          19, 1,   'Dojo B',    true],
      [5,  'act-bjj',      'Brazilian Jiu-Jitsu', 7,  1,   'Dojo A',    true],
      [6,  'act-mma',      'MMA',                 10, 2,   'Main Hall', true],
      [0,  'act-yoga',     'Yoga & Mobility',     10, 1.5, 'Studio',    false],
    ] as const) {
      sessionDefs.push({ dayOffset: week * 7 + Number(dayOff), actId, actName, hour: Number(hour), duration: Number(dur), location: String(loc), allowBooking: Boolean(allowBooking) })
    }
  }

  const pastCount = 4 * 4 // 4 weeks × 4 sessions/week
  const sessionIds: string[] = []
  for (let i = 0; i < sessionDefs.length; i++) {
    const s = sessionDefs[i]
    const base  = daysFromNow(s.dayOffset)
    base.setHours(s.hour, 0, 0, 0)
    const end   = hoursOffset(base, s.duration)
    const id    = `seed-session-${i.toString().padStart(3, '0')}`
    sessionIds.push(id)
    await db.collection('sessions').doc(id).set({
      teamId,
      activityId:        s.actId,
      activityName:      s.actName,
      start:             ts(base),
      end:               ts(end),
      location:          s.location,
      allowBooking:      s.allowBooking,
      participants_count: 0,
      created_at:        ts(daysFromNow(-100)),
      createdBy:         coachUid,
    })
    // Public profile — only for bookable upcoming sessions
    if (s.allowBooking) {
      await db.collection('sessions').doc(id)
        .collection('public_profile').doc(id).set({
          type:              'session',
          teamId,
          activityId:        s.actId,
          activityName:      s.actName,
          activityColor:     null,
          start:             ts(base),
          end:               ts(end),
          location:          s.location,
          capacity:          null,
          participants_count: 0,
          allowBooking:      true,
          slug:              null,
        })
    }
  }

  // ── 5. Contacts ────────────────────────────────────────────────────────────
  console.log('👥 Creating contacts…')

  const contactSeeds = [
    { firstname: 'Luca',      lastname: 'Ferrari',    email: 'luca.ferrari@email.com',    type: 'student',  status: 'active',   gender: 'M', totalSessions: 48 },
    { firstname: 'Sofia',     lastname: 'Bianchi',    email: 'sofia.bianchi@email.com',   type: 'student',  status: 'active',   gender: 'F', totalSessions: 32 },
    { firstname: 'Alex',      lastname: 'Müller',     email: 'alex.mueller@email.com',    type: 'student',  status: 'active',   gender: 'M', totalSessions: 67 },
    { firstname: 'Chiara',    lastname: 'Romano',     email: 'chiara.romano@email.com',   type: 'student',  status: 'active',   gender: 'F', totalSessions: 21 },
    { firstname: 'Matteo',    lastname: 'Esposito',   email: 'matteo.espo@email.com',     type: 'student',  status: 'active',   gender: 'M', totalSessions: 55 },
    { firstname: 'Emma',      lastname: 'Schneider',  email: 'emma.schneid@email.com',    type: 'student',  status: 'active',   gender: 'F', totalSessions: 14 },
    { firstname: 'David',     lastname: 'Costa',      email: 'david.costa@email.com',     type: 'student',  status: 'active',   gender: 'M', totalSessions: 39 },
    { firstname: 'Julia',     lastname: 'Weber',      email: 'julia.weber@email.com',     type: 'student',  status: 'almost_ready', gender: 'F', totalSessions: 8 },
    { firstname: 'Marco',     lastname: 'Conti',      email: 'marco.conti@email.com',     type: 'student',  status: 'almost_ready', gender: 'M', totalSessions: 6 },
    { firstname: 'Sara',      lastname: 'Ricci',      email: 'sara.ricci@email.com',      type: 'student',  status: 'expired',  gender: 'F', totalSessions: 28 },
    { firstname: 'Tobias',    lastname: 'Huber',      email: 'tobias.huber@email.com',    type: 'student',  status: 'active',   gender: 'M', totalSessions: 19 },
    { firstname: 'Nina',      lastname: 'Moreau',     email: 'nina.moreau@email.com',     type: 'student',  status: 'active',   gender: 'F', totalSessions: 44 },
    { firstname: 'Lorenzo',   lastname: 'De Luca',    email: 'lorenzo.dl@email.com',      type: 'trial',    status: 'requested', gender: 'M', totalSessions: 1 },
    { firstname: 'Amélie',    lastname: 'Dupont',     email: 'amelie.dupont@email.com',   type: 'trial',    status: 'requested', gender: 'F', totalSessions: 0 },
    { firstname: 'Kevin',     lastname: 'Nguyen',     email: 'kevin.nguyen@email.com',    type: 'trial',    status: 'under_review', gender: 'M', totalSessions: 2 },
    { firstname: 'Hannah',    lastname: 'Fischer',    email: 'hannah.fisch@email.com',    type: 'external', status: 'guest',    gender: 'F', totalSessions: 0 },
    { firstname: 'Radu',      lastname: 'Ionescu',    email: 'radu.ionescu@email.com',    type: 'student',  status: 'active',   gender: 'M', totalSessions: 77 },
    { firstname: 'Valentina', lastname: 'Greco',      email: 'val.greco@email.com',       type: 'student',  status: 'active',   gender: 'F', totalSessions: 29 },
  ]

  for (let i = 0; i < contactSeeds.length; i++) {
    const c = contactSeeds[i]
    const id = `seed-contact-${i.toString().padStart(3, '0')}`
    await db.collection('contacts').doc(id).set({
      teamId,
      ...c,
      membership_status:  c.status,
      membership_active:  c.status === 'active',
      total_sessions:     c.totalSessions,
      last_session_at:    c.totalSessions > 0 ? ts(daysFromNow(-Math.floor(Math.random() * 14))) : null,
      current_month_score: Math.floor(Math.random() * 120),
      current_streak:     Math.floor(Math.random() * 8),
      created_at:         ts(daysFromNow(-Math.floor(Math.random() * 90) - 10)),
      deleted_at:         null,
      archived_at:        null,
    })
  }

  // ── 5b. Participants for past sessions ────────────────────────────────────
  console.log('✅ Creating past-session participants…')

  // Active student contact IDs (indices 0–11 in contactSeeds)
  const studentContactIds = Array.from({ length: 12 }, (_, i) =>
    `seed-contact-${i.toString().padStart(3, '0')}`
  )

  // For each past session pick a deterministic-ish subset of students
  for (let i = 0; i < pastCount; i++) {
    const sid = sessionIds[i]
    if (!sid) continue
    // Vary attendance: 3–9 students, seeded by session index to be consistent
    const count = 3 + (i * 7 + 3) % 7
    // Rotate which students show up each session
    const attending = studentContactIds.filter((_, ci) => ((ci + i * 3) % 12) < count)
    for (const contactId of attending) {
      const cIdx = studentContactIds.indexOf(contactId)
      const cs = contactSeeds[cIdx]
      await db.collection('sessions').doc(sid)
        .collection('participants').doc(contactId).set({
          contact:     contactId,
          session:     sid,
          firstname:   cs.firstname,
          lastname:    cs.lastname,
          fullname:    `${cs.lastname} ${cs.firstname}`,
          checkedInAt: ts(daysFromNow(sessionDefs[i].dayOffset)),
          checkedInBy: 'seed',
        })
    }
    await db.collection('sessions').doc(sid).update({ participants_count: attending.length })
  }

  // ── 6. Bookings ────────────────────────────────────────────────────────────
  console.log('📋 Creating bookings…')

  // Attach bookings to a couple of upcoming sessions
  const bookingData = [
    { firstname: 'Lorenzo',  lastname: 'De Luca',  email: 'lorenzo.dl@email.com',    phone: '+41791234567', sessionIdx: 1 },
    { firstname: 'Amélie',   lastname: 'Dupont',   email: 'amelie.dupont@email.com', phone: '+41797654321', sessionIdx: 1 },
    { firstname: 'Kevin',    lastname: 'Nguyen',   email: 'kevin.nguyen@email.com',  phone: '+41798887766', sessionIdx: 3 },
    { firstname: 'Hannah',   lastname: 'Fischer',  email: 'hannah.fisch@email.com',  phone: '',             sessionIdx: 3 },
  ]

  // sessionIdx here = index within the upcoming batch (first upcoming session = pastCount + offset)
  for (let i = 0; i < bookingData.length; i++) {
    const b = bookingData[i]
    const sessionId = sessionIds[pastCount + b.sessionIdx]
    if (!sessionId) continue
    await db.collection('sessions').doc(sessionId)
      .collection('bookings').doc(`seed-booking-${i}`).set({
        teamId,
        contact:        `seed-contact-${(12 + i).toString().padStart(3, '0')}`,
        session:        sessionId,
        email:          b.email,
        firstname:      b.firstname,
        lastname:       b.lastname,
        phone:          b.phone,
        is_new_contact: true,
        joinedAt:       ts(daysFromNow(-2)),
        status:         'pending',
        booking_token:  `tok-seed-${i}`,
      })
  }

  // ── 7. Events ─────────────────────────────────────────────────────────────
  console.log('🏆 Creating events…')

  const events = [
    {
      id:    'seed-event-001',
      title: 'Regional BJJ Tournament',
      type:  'competition',
      start: ts(daysFromNow(45)),
      end:   ts(hoursOffset(daysFromNow(45), 8)),
      location:    'Sports Centre, Lugano',
      description: 'Annual regional BJJ championship — open to white and blue belts.',
      fee:    25,
      status: 'open',
    },
    {
      id:    'seed-event-002',
      title: 'Summer MMA Camp',
      type:  'camp',
      start: ts(daysFromNow(60)),
      end:   ts(hoursOffset(daysFromNow(63), 18)),
      location:    'Outdoor Training Ground',
      description: '3-day intensive MMA camp with guest instructors.',
      fee:    180,
      status: 'open',
    },
    {
      id:    'seed-event-003',
      title: 'Nutrition & Recovery Workshop',
      type:  'seminar',
      start: ts(daysFromNow(14)),
      end:   ts(hoursOffset(daysFromNow(14), 3)),
      location:    'Academy Classroom',
      description: 'Practical guide to nutrition and recovery for combat athletes.',
      fee:    0,
      status: 'open',
    },
  ]

  for (const e of events) {
    const { id, ...data } = e
    await db.collection('events').doc(id).set({ ...data, teamId, createdBy: coachUid, created_at: ts(daysFromNow(-10)) })
  }

  // ── Done ───────────────────────────────────────────────────────────────────
  console.log('')
  console.log('✅ Emulator seeded successfully!')
  console.log('')
  console.log('   Login credentials:')
  console.log(`   Email    →  ${coachEmail}`)
  console.log('   Password →  lineup123')
  console.log('')
  console.log(`   Portal   →  http://localhost:3000/portal/${teamSlug}`)
  console.log('')
}

main().catch((err) => {
  console.error('❌ Seed failed:', err)
  process.exit(1)
})
