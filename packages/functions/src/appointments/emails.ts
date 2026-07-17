/* eslint-disable no-console */
// Appointment booking emails (confirmation + .ics + coach notification) — moved
// out of window.ts so the Connect webhook can import it without pulling in the
// onCall modules (listAvailability/bookAppointment).
import * as admin from 'firebase-admin'
import { sendEmail } from '../utils/email'
import { systemEmailEnabledFor } from '../utils/systemEmails'
import { to } from '../utils/async'
import type { Lang } from './booking'
import {
  buildAppointmentConfirmationEmail,
  buildAppointmentICalAttachment,
  buildAppointmentProviderNotificationEmail,
} from './templates'

export async function sendAppointmentBookingEmails(p: {
  teamId: string
  teamName: string
  lang: Lang
  activityName: string
  providerId: string | null
  providerName: string
  start: Date
  end: Date
  location: string | null
  onlineUrl: string | null
  cancelUrl: string | null
  bookingId: string
  client: { firstname: string; lastname: string; email: string; phone: string | null }
}): Promise<void> {
  let coachEmail: string | null = null
  let coachFirstname = 'Coach'
  if (p.providerId) {
    const [, coachDoc] = await to(admin.firestore().collection('users').doc(p.providerId).get())
    if (coachDoc?.exists) {
      coachEmail = coachDoc.get('email') || null
      coachFirstname = coachDoc.get('firstname') || 'Coach'
    }
  }

  const confirmationEnabled = await systemEmailEnabledFor(p.teamId, 'booking_confirmation')
  if (confirmationEnabled) {
    try {
      const email = buildAppointmentConfirmationEmail({
        firstname: p.client.firstname,
        teamName: p.teamName,
        slotTitle: p.activityName,
        providerName: p.providerName,
        start: p.start,
        end: p.end,
        location: p.location,
        onlineUrl: p.onlineUrl,
        cancelUrl: p.cancelUrl,
        instructions: null,
        lang: p.lang,
      })
      const ical = buildAppointmentICalAttachment({
        bookingId: p.bookingId,
        slotTitle: p.activityName,
        start: p.start,
        end: p.end,
        location: p.location,
        providerName: p.providerName,
        coachEmail: coachEmail || 'noreply@linyup.com',
        clientName: `${p.client.firstname} ${p.client.lastname}`,
        clientEmail: p.client.email,
      })
      const subjects: Record<Lang, string> = {
        en: `Appointment Confirmed – ${p.activityName}`,
        de: `Termin bestätigt – ${p.activityName}`,
        fr: `Rendez-vous confirmé – ${p.activityName}`,
        it: `Appuntamento confermato – ${p.activityName}`,
      }
      await sendEmail({
        to: p.client.email,
        subject: subjects[p.lang],
        html: email.html,
        text: email.text,
        teamId: p.teamId,
        attachments: [
          { filename: ical.filename, content: ical.content, contentType: ical.contentType },
        ],
      })
    } catch (err) {
      console.error('appointment emails: confirmation email failed', err)
    }
  }

  if (coachEmail) {
    try {
      const notif = buildAppointmentProviderNotificationEmail({
        coachFirstname,
        clientName: `${p.client.firstname} ${p.client.lastname}`,
        clientEmail: p.client.email,
        clientPhone: p.client.phone,
        slotTitle: p.activityName,
        start: p.start,
        end: p.end,
        notes: null,
        lang: p.lang,
      })
      const subjects: Record<Lang, string> = {
        en: `New appointment: ${p.client.firstname} ${p.client.lastname}`,
        de: `Neuer Termin: ${p.client.firstname} ${p.client.lastname}`,
        fr: `Nouveau rendez-vous : ${p.client.firstname} ${p.client.lastname}`,
        it: `Nuovo appuntamento: ${p.client.firstname} ${p.client.lastname}`,
      }
      await sendEmail({
        to: coachEmail,
        subject: subjects[p.lang],
        html: notif.html,
        text: notif.text,
        teamId: p.teamId,
      })
    } catch (err) {
      console.error('appointment emails: coach notification failed', err)
    }
  }
}
