import * as admin from 'firebase-admin'
import { Timestamp, FieldValue } from 'firebase-admin/firestore'
import { to } from '../utils/async'
import { sendEmail } from '../utils/email'
import { buildBookingReminderEmail } from '../booking/templates'
import { getHostingUrl } from '../utils/env'
import {
  SESSIONS_COLLECTION,
  TEAMS_COLLECTION,
  ACTIVITIES_COLLECTION,
  TEAM_PLACES_SUBCOLLECTION,
} from '@linyup/shared'

type Lang = 'en' | 'de' | 'fr' | 'it'

interface TeamReminderSettings {
  enabled: boolean
  hours: number
  lang: Lang
  name: string
  slug: string | null
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
      hours: (settings.bookingReminderHours as number) || 24,
      lang: (teamDoc.data()?.language as Lang) || 'en',
      name: (teamDoc.data()?.name as string) || 'Our Team',
      slug: (teamDoc.data()?.slug as string) || null,
    }
  }
  return { enabled: true, hours: 24, lang: 'en', name: 'Our Team', slug: null }
}

export async function sendBookingReminders(): Promise<{
  processed: number
  sent: number
  skipped: number
  errors: number
}> {
  console.log('sendBookingReminders task started') // eslint-disable-line no-console

  const db = admin.firestore()
  const now = new Date()

  // Cast a wide net covering all supported reminder windows (1–3 days).
  // Per-session we then verify the team's configured bookingReminderHours.
  const windowStart = new Date(now.getTime() + 12 * 60 * 60 * 1000)
  const windowEnd = new Date(now.getTime() + 84 * 60 * 60 * 1000)

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
    console.error('sendBookingReminders: error fetching sessions:', sessionsErr) // eslint-disable-line no-console
    throw sessionsErr
  }

  console.log(`sendBookingReminders: found ${sessionsSnap!.size} sessions in reminder window`) // eslint-disable-line no-console

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

    if (!teamCache[teamId]) {
      teamCache[teamId] = await getTeamReminderSettings(db, teamId)
    }
    const team = teamCache[teamId]

    if (!team.enabled) {
      console.log(
        `sendBookingReminders: reminders disabled for team ${teamId}, skipping session ${sessionId}`
      ) // eslint-disable-line no-console
      skipped++
      continue
    }

    // Check if this session falls within the team's configured reminder window (±12h tolerance)
    const hoursUntilSession =
      (sessionData.start.toDate().getTime() - now.getTime()) / (60 * 60 * 1000)
    if (hoursUntilSession < team.hours - 12 || hoursUntilSession >= team.hours + 12) {
      skipped++
      continue
    }

    const [bookingsErr, bookingsSnap] = await to(sessionDoc.ref.collection('bookings').get())
    if (bookingsErr) {
      console.error(
        `sendBookingReminders: error fetching bookings for session ${sessionId}:`,
        bookingsErr
      ) // eslint-disable-line no-console
      errors++
      continue
    }

    const bookingsToRemind = bookingsSnap!.docs.filter((doc) => !doc.data().reminderSentAt)
    if (bookingsToRemind.length === 0) continue

    // Resolve activity name
    let activityName = 'Session'
    if (sessionData.activityId) {
      const [, activityDoc] = await to(
        db
          .collection(ACTIVITIES_COLLECTION)
          .doc(sessionData.activityId as string)
          .get()
      )
      if (activityDoc?.exists) activityName = (activityDoc.data()?.name as string) || activityName
    }

    // Resolve location details
    let locationName = (sessionData.location as string) || null
    let locationAddress: string | null = null

    if (locationName) {
      const [, placesSnap] = await to(
        db
          .collection(TEAMS_COLLECTION)
          .doc(teamId)
          .collection(TEAM_PLACES_SUBCOLLECTION)
          .where('label', '==', locationName)
          .limit(1)
          .get()
      )
      if (placesSnap && !placesSnap.empty) {
        locationAddress = (placesSnap.docs[0].data().address as string) || null
      }
    }

    for (const bookingDoc of bookingsToRemind) {
      processed++
      const booking = bookingDoc.data()

      if (!booking.email) {
        skipped++
        continue
      }

      try {
        const sessionStart = sessionData.start.toDate() as Date
        const sessionEnd = sessionData.end.toDate() as Date

        const bookingToken = (booking.booking_token as string) || null
        const manageBookingUrl =
          team.slug && bookingToken
            ? `${getHostingUrl()}/public/bio-link/${team.slug}/manage-booking?token=${bookingToken}`
            : null

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
          en: `Reminder: Your ${activityName} session tomorrow`,
          de: `Erinnerung: Ihre ${activityName} Sitzung morgen`,
          fr: `Rappel : Votre session ${activityName} demain`,
          it: `Promemoria: La tua lezione di ${activityName} è domani`,
        }

        await sendEmail({ to: booking.email as string, subject: subjects[team.lang], html, text })
        await bookingDoc.ref.update({ reminderSentAt: FieldValue.serverTimestamp() })

        sent++
        console.log(
          `sendBookingReminders: reminder sent to ${booking.email} for session ${sessionId}`
        ) // eslint-disable-line no-console
      } catch (err) {
        console.error(
          `sendBookingReminders: error sending to ${booking.email}:`,
          (err as Error).message || err
        ) // eslint-disable-line no-console
        errors++
      }
    }
  }

  const result = { processed, sent, skipped, errors }
  console.log('sendBookingReminders task completed:', result) // eslint-disable-line no-console
  return result
}
