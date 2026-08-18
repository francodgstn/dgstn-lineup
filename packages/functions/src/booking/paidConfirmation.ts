/* eslint-disable no-console */
/**
 * THE RECEIPT FOR A PAID CLASS BOOKING — and it is ALWAYS ON.
 *
 * NOT behind `systemEmailEnabledFor('booking_confirmation')`, and that asymmetry
 * IS THE DESIGN — do not tidy the two into one flag.
 *
 *   • A FREE booking's confirmation is a COURTESY. A studio may reasonably send
 *     its own from the automations engine instead, so `booking_confirmation`
 *     stays a switch for it (booking/index.ts, booking/waitlist/claim.ts).
 *   • A PAID booking's confirmation is the RECEIPT, and it is the only thing
 *     that carries the manage-booking link and the invitation into the member
 *     area. Switch it off and there is no email at all: the buyer cannot see
 *     what they bought, cannot cancel it, and never learns the portal exists.
 *     Stripe's own receipt names a charge, not a class — no what, no when, no
 *     where, no cancellation terms.
 *
 * That is the same test `booking/waitlist/notify.ts` applies to the offer and
 * join mails: always on, because switching it off does not quieten the feature,
 * it breaks it — a studio that disabled this would be stranding people rather
 * than quietening a mail. (UX-76, Franco's call 2026-08-17.)
 *
 * IDEMPOTENT, through the `mail_sends` ledger. Its two callers are both
 * re-entrant: the Connect webhook is redelivered by Stripe, and the gift-card
 * full-cover branch can be retried by a client. `tenderRef` — the PaymentIntent
 * id, or the gift-card hold key — keys the send to the ONE payment it is the
 * receipt for, so a redelivery is deduped while a genuinely second purchase of
 * the same seat (which the callers refund) would key differently.
 *
 * NOTHING HERE THROWS. The seat is paid for and confirmed before this is called;
 * a mail provider outage must not turn that into a webhook failure Stripe
 * retries, which would re-run the confirm logic instead of just the mail.
 */
import * as admin from 'firebase-admin'
import type { Timestamp } from 'firebase-admin/firestore'
import {
  ACTIVITIES_COLLECTION,
  SESSIONS_COLLECTION,
  TEAMS_COLLECTION,
  localizedPublicUrl,
} from '@linyup/shared'
import { sendEmail } from '../utils/email'
import { getHostingUrl } from '../utils/env'
import { getTeamContactEmail } from '../mail/senderConfig'
import { buildClassBookingConfirmationMail } from './templates'

type Lang = 'en' | 'de' | 'fr' | 'it'
const isLang = (v: unknown): v is Lang => v === 'en' || v === 'de' || v === 'fr' || v === 'it'

export interface PaidBookingConfirmationParams {
  teamId: string
  sessionId: string
  contactId: string
  /** The tender this receipt belongs to: a Stripe PaymentIntent id, or the
   *  gift-card hold key on the full-cover rail. Keys the `mail_sends` ledger. */
  tenderRef: string
  /** What was actually charged, in MAJOR units. Read off the Stripe session (or
   *  the gift-card drawdown) by the caller — never recomputed here. Absent ⇒ the
   *  receipt names the class but no amount. */
  paid?: { amount: number; currency: string } | null
  recipient: { firstname: string; lastname: string; email: string }
}

export async function sendPaidBookingConfirmation(
  p: PaidBookingConfirmationParams
): Promise<void> {
  const { teamId, sessionId, contactId, recipient } = p
  if (!recipient.email) {
    console.error(
      `[booking] paid booking on session ${sessionId} (contact ${contactId}) has no email address — no receipt sent`
    )
    return
  }

  try {
    const db = admin.firestore()
    const [teamSnap, sessionSnap, bookingSnap] = await Promise.all([
      db.collection(TEAMS_COLLECTION).doc(teamId).get(),
      db.collection(SESSIONS_COLLECTION).doc(sessionId).get(),
      db.collection(SESSIONS_COLLECTION).doc(sessionId).collection('bookings').doc(contactId).get(),
    ])
    const team = teamSnap.data()
    const session = sessionSnap.data()
    const booking = bookingSnap.data()
    const start = session?.start as Timestamp | undefined
    if (!team || !session || !start) {
      console.error(
        `[booking] cannot build the paid confirmation for session ${sessionId} — team or session missing`
      )
      return
    }

    const lang: Lang = isLang(team.language) ? team.language : 'en'
    const teamSettings = (team.settings as Record<string, unknown> | undefined) ?? {}
    const slug = (team.slug as string | undefined) ?? null

    // The what — denormalised on the session, with the activity read as the
    // fallback and as the source of the two studio-authored blocks (the same
    // activity-override-??-team-default pair `bookSession` resolves, so the paid
    // receipt carries the cancellation terms the free one does).
    let activityName = (session.activityName as string) || ''
    let instructions: string | null = null
    let cancellationPolicy: string | null = null
    if (session.activityId) {
      const actSnap = await db
        .collection(ACTIVITIES_COLLECTION)
        .doc(session.activityId as string)
        .get()
      const activity = actSnap.data()
      if (activity) {
        activityName = activityName || (activity.name as string) || ''
        instructions = (activity.confirmationInstructions as string)?.trim() || null
        cancellationPolicy = (activity.cancellationPolicy as string)?.trim() || null
      }
    }
    activityName = activityName || 'Class'
    instructions =
      instructions || (teamSettings.bookingConfirmationInstructions as string)?.trim() || null
    cancellationPolicy =
      cancellationPolicy || (teamSettings.bookingCancellationPolicy as string)?.trim() || null

    const bookingToken = (booking?.booking_token as string | undefined) ?? null
    const end = session.end as Timestamp | undefined
    const mail = buildClassBookingConfirmationMail({
      firstname: recipient.firstname,
      teamName: (team.name as string) || 'Our Team',
      activityName,
      sessionStart: start.toDate(),
      sessionEnd: end ? end.toDate() : start.toDate(),
      locationName: (session.location as string) || null,
      // Locale-pinned (`lang` is the studio's language, which this whole mail
      // is written in): an unprefixed link opens in the READER's browser
      // language, which is how a German confirmation handed out an English
      // cancellation page. See localizedPublicUrl in @linyup/shared.
      manageBookingUrl:
        slug && bookingToken
          ? localizedPublicUrl(getHostingUrl(), lang, slug, 'manage-booking', {
              token: bookingToken,
            })
          : null,
      spaceUrl: slug ? localizedPublicUrl(getHostingUrl(), lang, slug, 'space') : null,
      instructions,
      cancellationPolicy,
      reference: (booking?.booking_reference as string | undefined) ?? null,
      paid: p.paid ?? null,
      lang,
      bookingId: `${sessionId}-${contactId}`,
      attendeeName: `${recipient.firstname} ${recipient.lastname}`.trim(),
      attendeeEmail: recipient.email,
      organizerEmail: await getTeamContactEmail(teamId, team as Record<string, unknown>),
    })

    await sendEmail({
      to: recipient.email,
      subject: mail.subject,
      html: mail.html,
      text: mail.text,
      attachments: mail.attachments,
      teamId,
      tags: ['booking-confirmation-paid'],
      idempotencyKey: `paid-booking-${sessionId}-${contactId}-${p.tenderRef}`,
    })
  } catch (err) {
    console.error(
      `[booking] paid booking receipt failed (session=${sessionId} contact=${contactId}):`,
      err
    )
  }
}
