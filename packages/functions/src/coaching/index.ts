/* eslint-disable no-console */
import * as admin from 'firebase-admin'
import { Timestamp, FieldValue } from 'firebase-admin/firestore'
import { HttpsError, onCall } from 'firebase-functions/v2/https'
import { onSchedule } from 'firebase-functions/v2/scheduler'
import { onDocumentWritten } from 'firebase-functions/v2/firestore'

// Email templates are still used by bookSession when activityType === 'coaching'
// They are exported so booking/index.ts can import them.
export {
  buildCoachingConfirmationEmail,
  buildCoachingICalAttachment,
  buildCoachNotificationEmail,
  buildCoachingCancellationEmail,
} from './templates'

const TIMEZONE = 'Europe/Zurich'
const GENERATION_WINDOW_DAYS = 28

// ─── timezone helper ──────────────────────────────────────────────────────────

function getDatePartsInTz(date: Date): { year: number; month: number; day: number; dayOfWeek: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: TIMEZONE, year: 'numeric', month: 'numeric', day: 'numeric', weekday: 'narrow',
  }).formatToParts(date)
  const get = (type: string) => parseInt(parts.find((p) => p.type === type)!.value, 10)
  const [y, m, d] = [get('year'), get('month'), get('day')]
  const localNoon = new Date(Date.UTC(y, m - 1, d, 12, 0, 0))
  return { year: y, month: m, day: d, dayOfWeek: localNoon.getUTCDay() }
}

function localTimeToUtc(year: number, month: number, day: number, hour: number, minute: number): Date {
  const utcGuess = new Date(Date.UTC(year, month - 1, day, hour, minute, 0))
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: TIMEZONE, year: 'numeric', month: 'numeric', day: 'numeric',
    hour: 'numeric', minute: 'numeric', second: 'numeric', hourCycle: 'h23',
  })
  const p = Object.fromEntries(formatter.formatToParts(utcGuess).map(({ type, value }) => [type, parseInt(value, 10)]))
  const diffMs = Date.UTC(year, month - 1, day, hour, minute, 0)
    - Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second)
  return new Date(utcGuess.getTime() + diffMs)
}

// ─── slot occurrence generator ────────────────────────────────────────────────

interface AvailabilityDoc {
  teamId: string
  coachId: string
  coachName: string
  title: string
  description?: string | null
  isFreeTrial?: boolean
  status: 'active' | 'paused' | 'archived'
  duration_minutes: number
  max_participants: number
  location?: string | null
  onlineUrl?: string | null
  recurrence: {
    daysOfWeek: number[]
    time: string
    startDate: Timestamp
    endDate?: Timestamp | null
  }
}

function generateOccurrences(
  template: AvailabilityDoc,
  from: Date,
  to: Date,
): { start: Date; end: Date }[] {
  const [hour, minute] = template.recurrence.time.split(':').map(Number)
  const validFrom = template.recurrence.startDate.toDate()
  const validUntil = template.recurrence.endDate?.toDate() ?? null

  const results: { start: Date; end: Date }[] = []
  const cursor = new Date(Math.max(from.getTime(), validFrom.getTime()))
  cursor.setUTCHours(0, 0, 0, 0)

  while (cursor <= to) {
    if (validUntil && cursor > validUntil) break
    const { year, month, day, dayOfWeek } = getDatePartsInTz(cursor)
    if (template.recurrence.daysOfWeek.includes(dayOfWeek)) {
      const start = localTimeToUtc(year, month, day, hour, minute)
      if (start > new Date()) {
        const end = new Date(start.getTime() + template.duration_minutes * 60_000)
        results.push({ start, end })
      }
    }
    cursor.setUTCDate(cursor.getUTCDate() + 1)
  }

  return results
}

// ─── core generation logic ────────────────────────────────────────────────────
// Coaching sessions are written to the `sessions` collection with activityType='coaching'.
// They are publicly exposed via sessions/{id}/public_profile (synced by syncSessionPublicProfile).
// Booking is handled by bookSession; cancellation by cancelBooking.

async function generateSlotsForTemplate(
  templateId: string,
  template: AvailabilityDoc,
): Promise<{ created: number; skipped: number }> {
  const db = admin.firestore()
  const now = new Date()
  const windowEnd = new Date(now.getTime() + GENERATION_WINDOW_DAYS * 24 * 60 * 60_000)
  const occurrences = generateOccurrences(template, now, windowEnd)

  let created = 0
  let skipped = 0

  for (const occ of occurrences) {
    const startTs = Timestamp.fromDate(occ.start)
    // Dedup: check sessions collection for existing coaching session from this template+start
    const existing = await db.collection('sessions')
      .where('templateId', '==', templateId)
      .where('start', '==', startTs)
      .limit(1)
      .get()

    if (!existing.empty) { skipped++; continue }

    await db.collection('sessions').add({
      teamId: template.teamId,
      templateId,
      activityType: 'coaching',
      activityName: template.title,
      coachId: template.coachId,
      coachName: template.coachName,
      isFreeTrial: template.isFreeTrial !== false,
      start: startTs,
      end: Timestamp.fromDate(occ.end),
      duration_minutes: template.duration_minutes,
      max_participants: template.max_participants,
      bookings_count: 0,
      location: template.location ?? null,
      onlineUrl: template.onlineUrl ?? null,
      allowBooking: true,
      status: 'open',
      created_at: FieldValue.serverTimestamp(),
    })
    created++
  }

  return { created, skipped }
}

async function runGenerationForTeam(teamId: string): Promise<{ created: number; skipped: number }> {
  const db = admin.firestore()
  const snap = await db.collection('coach_availability')
    .where('teamId', '==', teamId)
    .where('status', '==', 'active')
    .get()

  let created = 0
  let skipped = 0
  for (const doc of snap.docs) {
    const result = await generateSlotsForTemplate(doc.id, doc.data() as AvailabilityDoc)
    created += result.created
    skipped += result.skipped
  }
  return { created, skipped }
}

async function runGenerationAll(): Promise<{ created: number; skipped: number }> {
  const db = admin.firestore()
  const snap = await db.collection('coach_availability').where('status', '==', 'active').get()

  let created = 0
  let skipped = 0
  for (const doc of snap.docs) {
    const result = await generateSlotsForTemplate(doc.id, doc.data() as AvailabilityDoc)
    created += result.created
    skipped += result.skipped
  }
  return { created, skipped }
}

// ─── generateCoachSlotsScheduled ─────────────────────────────────────────────

export const generateCoachSlotsScheduled = onSchedule(
  { schedule: '0 2 * * *', timeZone: TIMEZONE },
  async () => {
    const result = await runGenerationAll()
    console.log(`generateCoachSlots (scheduled): created=${result.created} skipped=${result.skipped}`)
  },
)

// ─── generateCoachSlots (callable) ───────────────────────────────────────────

export const generateCoachSlots = onCall(async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Authentication required')

  const { teamId } = request.data as { teamId?: string }
  if (!teamId) throw new HttpsError('invalid-argument', 'teamId is required')

  const memberDoc = await admin.firestore()
    .collection('teams').doc(teamId)
    .collection('team_members').doc(request.auth.uid)
    .get()
  if (!memberDoc.exists) throw new HttpsError('permission-denied', 'Not a team member')

  const result = await runGenerationForTeam(teamId)
  console.log(`generateCoachSlots (manual) teamId=${teamId}: created=${result.created} skipped=${result.skipped}`)
  return result
})

// ─── onCoachAvailabilityWritten — auto-generate sessions on template save ─────

export const onCoachAvailabilityWritten = onDocumentWritten(
  'coach_availability/{templateId}',
  async (event) => {
    const after = event.data?.after
    if (!after?.exists) return  // deleted — nothing to generate
    const template = after.data() as AvailabilityDoc
    if (template.status !== 'active') return  // paused or archived
    try {
      const result = await generateSlotsForTemplate(event.params.templateId, template)
      console.log(`onCoachAvailabilityWritten templateId=${event.params.templateId}: created=${result.created} skipped=${result.skipped}`)
    } catch (err) {
      console.error('onCoachAvailabilityWritten: slot generation failed', err)
    }
  },
)
