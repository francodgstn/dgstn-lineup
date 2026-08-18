/* eslint-disable no-console */
// Multi-step booking reminders. A team configures a schedule of steps
// (settings.bookingReminderSteps, e.g. email 168h + email 48h + SMS 24h before
// the session); each step is sent once per booking, tracked in the booking's
// `reminders_sent.{stepId}` map. Teams without authored steps keep the legacy
// single-email behavior (settings.bookingReminderHours, default 24h) — the old
// per-booking `reminderSentAt` flag maps to the synthesized 'legacy' step id,
// so existing bookings never double-send.
//
// Runs HOURLY (bookingRemindersHourly in ./index.ts — no longer part of the
// 02:00 dailyTasks batch): a step is due when the session is at most
// `offsetHours` away and no further than 24h past the offset (a catch-up
// window; the sent marker guarantees once-only). SMS steps additionally respect
// quiet hours (08:00–21:00 Europe/Zurich) — outside them the step defers to the
// next in-window run.
import * as admin from 'firebase-admin'
import { Timestamp, FieldValue } from 'firebase-admin/firestore'
import { to } from '../utils/async'
import { sendEmail } from '../utils/email'
import { isWithinSmsSendingHours, sendSms } from '../utils/sms'
import { buildBookingReminderEmail, buildBookingReminderSms } from '../booking/templates'
import { getHostingUrl } from '../utils/env'
import {
  SESSIONS_COLLECTION,
  TEAMS_COLLECTION,
  ACTIVITIES_COLLECTION,
  TEAM_PLACES_SUBCOLLECTION,
  resolveBookingReminderSteps,
  type BookingReminderStep,
  localizedPublicUrl,
} from '@linyup/shared'

type Lang = 'en' | 'de' | 'fr' | 'it'

// Bounds for authored schedules: offsets are clamped to ≤ 14 days by the
// settings UI; the scan window below derives from the longest offset.
const CATCH_UP_HOURS = 24
const MAX_OFFSET_HOURS = 14 * 24

// Quiet hours now live in utils/sms (the waitlist anchors its claim window to
// the same rule). Re-exported so this module keeps its published surface.
export { isWithinSmsSendingHours }

interface TeamReminderSettings {
  enabled: boolean
  steps: BookingReminderStep[]
  lang: Lang
  name: string
  slug: string | null
}

/** A step is due when the session is within its offset, no more than
 *  CATCH_UP_HOURS past it, and still in the future. Pure — unit-tested. */
export function isStepDue(offsetHours: number, hoursUntilSession: number): boolean {
  return (
    hoursUntilSession > 0 &&
    hoursUntilSession <= offsetHours &&
    hoursUntilSession > offsetHours - CATCH_UP_HOURS
  )
}

/** The marker key holding a step's sent timestamp on the booking doc. */
function sentMarker(booking: FirebaseFirestore.DocumentData, step: BookingReminderStep): boolean {
  if (step.id === 'legacy' && booking.reminderSentAt) return true
  return !!booking.reminders_sent?.[step.id]
}

async function getTeamReminderSettings(
  db: admin.firestore.Firestore,
  teamId: string
): Promise<TeamReminderSettings> {
  const [, teamDoc] = await to(db.collection(TEAMS_COLLECTION).doc(teamId).get())
  if (teamDoc?.exists) {
    const settings = teamDoc.data()?.settings ?? {}
    return {
      enabled: settings.bookingRemindersEnabled !== false,
      steps: resolveBookingReminderSteps(settings).filter(
        (s) => s.offsetHours > 0 && s.offsetHours <= MAX_OFFSET_HOURS
      ),
      lang: (teamDoc.data()?.language as Lang) || 'en',
      name: (teamDoc.data()?.name as string) || 'Our Team',
      slug: (teamDoc.data()?.slug as string) || null,
    }
  }
  return {
    enabled: true,
    steps: resolveBookingReminderSteps({}),
    lang: 'en',
    name: 'Our Team',
    slug: null,
  }
}

export async function sendBookingReminders(): Promise<{
  processed: number
  sent: number
  skipped: number
  errors: number
}> {
  console.log('sendBookingReminders task started')

  const db = admin.firestore()
  const now = new Date()
  const smsWindowOpen = isWithinSmsSendingHours(now)

  // Cast a net covering every supported offset; per team we then check the
  // configured steps. (Upper bound = the max authorable offset + catch-up.)
  const windowStart = now
  const windowEnd = new Date(now.getTime() + (MAX_OFFSET_HOURS + CATCH_UP_HOURS) * 60 * 60 * 1000)

  let processed = 0
  let sent = 0
  let skipped = 0
  let errors = 0

  const [sessionsErr, sessionsSnap] = await to(
    db
      .collection(SESSIONS_COLLECTION)
      .where('start', '>=', Timestamp.fromDate(windowStart))
      .where('start', '<', Timestamp.fromDate(windowEnd))
      .get()
  )

  if (sessionsErr) {
    console.error('sendBookingReminders: error fetching sessions:', sessionsErr)
    throw sessionsErr
  }

  console.log(`sendBookingReminders: found ${sessionsSnap!.size} sessions in scan window`)

  // Cache team settings to avoid re-fetching per session
  const teamCache: Record<string, TeamReminderSettings> = {}

  for (const sessionDoc of sessionsSnap!.docs) {
    const sessionId = sessionDoc.id
    const sessionData = sessionDoc.data()
    const teamId = (sessionData.teamId || sessionData.teacher) as string | undefined

    if (!teamId) {
      skipped++
      continue
    }
    // Cancelled sessions (appointment status or exception flag) get no reminders.
    if (sessionData.status === 'cancelled') {
      skipped++
      continue
    }

    if (!teamCache[teamId]) {
      teamCache[teamId] = await getTeamReminderSettings(db, teamId)
    }
    const team = teamCache[teamId]

    if (!team.enabled || team.steps.length === 0) {
      skipped++
      continue
    }

    const hoursUntilSession =
      (sessionData.start.toDate().getTime() - now.getTime()) / (60 * 60 * 1000)
    const dueSteps = team.steps.filter((s) => isStepDue(s.offsetHours, hoursUntilSession))
    if (dueSteps.length === 0) {
      skipped++
      continue
    }

    const [bookingsErr, bookingsSnap] = await to(sessionDoc.ref.collection('bookings').get())
    if (bookingsErr) {
      console.error(
        `sendBookingReminders: error fetching bookings for session ${sessionId}:`,
        bookingsErr
      )
      errors++
      continue
    }

    // Resolve activity name (once per session, only when something might send)
    let activityName = (sessionData.activityName as string) || 'Session'
    if (sessionData.activityId && !sessionData.activityName) {
      const [, activityDoc] = await to(
        db
          .collection(ACTIVITIES_COLLECTION)
          .doc(sessionData.activityId as string)
          .get()
      )
      if (activityDoc?.exists) activityName = (activityDoc.data()?.name as string) || activityName
    }

    // Resolve location details (address for the email body)
    let locationName = (sessionData.location as string) || null
    let locationAddress: string | null = (sessionData.locationAddress as string) || null

    if (locationName && !locationAddress) {
      const [, placesSnap] = await to(
        db
          .collection(TEAMS_COLLECTION)
          .doc(teamId)
          .collection(TEAM_PLACES_SUBCOLLECTION)
          .where('name', '==', locationName)
          .limit(1)
          .get()
      )
      if (placesSnap && !placesSnap.empty) {
        locationAddress = (placesSnap.docs[0].data().address as string) || null
      }
    }

    for (const bookingDoc of bookingsSnap!.docs) {
      const booking = bookingDoc.data()

      // Dead bookings and unpaid drop-in holds get no reminders.
      if (['cancelled', 'rebooked', 'no_show'].includes(booking.status as string)) continue
      if (booking.payment_status === 'required') continue
      // An unclaimed waitlist offer is a seat HELD for someone, not a seat they
      // have — reminding them about a class they have not got would be the
      // studio's own mail contradicting the claim deadline. The claim flips this
      // flag off; until then the offer mail is the only thing that speaks.
      if (booking.waitlist_claim === true) continue

      const pendingSteps = dueSteps.filter((s) => !sentMarker(booking, s))
      if (pendingSteps.length === 0) continue

      const sessionStart = sessionData.start.toDate() as Date
      const sessionEnd = sessionData.end.toDate() as Date
      const bookingToken = (booking.booking_token as string) || null
      // Locale-pinned: the reminder is built in `team.lang`, and the link it
      // carries is the most-clicked route to the cancellation page. Unprefixed,
      // that page picks the READER's browser language instead of the studio's.
      const manageBookingUrl =
        team.slug && bookingToken
          ? localizedPublicUrl(getHostingUrl(), team.lang, team.slug, 'manage-booking', {
              token: bookingToken,
            })
          : null

      for (const step of pendingSteps) {
        processed++
        try {
          if (step.channel === 'email') {
            if (!booking.email) {
              skipped++
              continue
            }
            const { html, text } = buildBookingReminderEmail({
              firstname: (booking.firstname as string) || 'Guest',
              teamName: team.name,
              activityName,
              sessionStart,
              sessionEnd,
              locationName,
              locationAddress,
              manageBookingUrl,
              lang: team.lang,
            })
            const subjects: Record<Lang, string> = {
              en: `Reminder: Your ${activityName} session`,
              de: `Erinnerung: Ihre ${activityName} Sitzung`,
              fr: `Rappel : Votre session ${activityName}`,
              it: `Promemoria: La tua lezione di ${activityName}`,
            }
            await sendEmail({
              to: booking.email as string,
              subject: subjects[team.lang],
              html,
              text,
              teamId,
            })
          } else {
            // SMS step — needs a phone, an opted-in recipient, and the quiet-hours
            // window. Deferrals (window closed) leave the marker unset so the next
            // in-window hourly run retries; hard skips mark as handled below.
            if (!smsWindowOpen) continue
            const phone = (booking.phone as string) || null
            if (!phone) {
              skipped++
              continue
            }
            const outcome = await sendSms({
              to: phone,
              content: buildBookingReminderSms({
                teamName: team.name,
                activityName,
                sessionStart,
                locationName,
                lang: team.lang,
              }),
              teamId,
              tag: 'booking-reminder',
              idempotencyKey: `sms-reminder-${sessionId}-${bookingDoc.id}-${step.id}`,
            })
            if (outcome.skipped && !outcome.providerMessageId) {
              // Disabled/suppressed/bad number — mark the step so we don't retry
              // hourly forever (the idempotency key would dedupe anyway).
              skipped++
            }
          }

          await bookingDoc.ref.update({
            [`reminders_sent.${step.id}`]: FieldValue.serverTimestamp(),
            // Keep the legacy flag in sync for the synthesized single-email step
            // so a settings rollback never double-sends.
            ...(step.id === 'legacy' ? { reminderSentAt: FieldValue.serverTimestamp() } : {}),
          })
          sent++
          console.log(
            `sendBookingReminders: ${step.channel} step '${step.id}' sent for session ${sessionId} booking ${bookingDoc.id}`
          )
        } catch (err) {
          console.error(
            `sendBookingReminders: error on ${step.channel} step for booking ${bookingDoc.id}:`,
            (err as Error).message || err
          )
          errors++
        }
      }
    }
  }

  const result = { processed, sent, skipped, errors }
  console.log('sendBookingReminders task completed:', result)
  return result
}
