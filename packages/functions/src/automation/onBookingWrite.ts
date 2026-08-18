// Tier 1 event trigger — fires automation rules in real-time when a booking
// status changes to 'confirmed' or 'no_show'.
//
// Trigger path: sessions/{sessionId}/bookings/{bookingId}
// Bookings store teamId directly so no session lookup is needed.
// Contact data is loaded from the contacts collection for condition evaluation.
import { onDocumentWritten } from 'firebase-functions/v2/firestore'
import * as admin from 'firebase-admin'
import { to } from '../utils/async'
import { fireEventRules, type ContactData, type AutomationTriggerType } from '../utils/automationEngine'
import { processNoShowStrike } from '../booking/policyFees'

function resolveBookingTrigger(
  before: FirebaseFirestore.DocumentData | undefined,
  after: FirebaseFirestore.DocumentData | undefined
): AutomationTriggerType | null {
  if (!after) return null // deleted

  const prevStatus = before?.status as string | undefined
  const nextStatus = after.status as string | undefined

  if (nextStatus === 'confirmed' && prevStatus !== 'confirmed') return 'booking_confirmed'
  if (nextStatus === 'no_show' && prevStatus !== 'no_show') return 'booking_no_show'
  if (nextStatus === 'cancelled' && prevStatus !== 'cancelled') return 'booking_cancelled'

  return null
}

export const onBookingWrite = onDocumentWritten(
  'sessions/{sessionId}/bookings/{bookingId}',
  async (event) => {
    const before = event.data?.before?.data()
    const after = event.data?.after?.data()

    const triggerType = resolveBookingTrigger(before, after)
    if (!triggerType) return

    const bookingData = after || before
    const teamId = bookingData?.teamId as string | undefined
    if (!teamId) {
      console.log(`[onBookingWrite] booking=${event.params.bookingId}: no teamId, skipping`) // eslint-disable-line no-console
      return
    }

    // Load the contact for this booking
    const contactId = (bookingData?.contact || bookingData?.contactId) as string | undefined
    if (!contactId) {
      console.log(`[onBookingWrite] booking=${event.params.bookingId}: no contactId, skipping`) // eslint-disable-line no-console
      return
    }

    // No-show policy (E5): the strike counter is independent of automations —
    // best-effort, never let a policy failure break the automation dispatch below.
    if (triggerType === 'booking_no_show') {
      try {
        await processNoShowStrike({
          teamId,
          contactId,
          sessionId: event.params.sessionId,
          bookingId: event.params.bookingId,
        })
      } catch (err) {
        console.error(`[onBookingWrite] no-show strike processing failed (booking=${event.params.bookingId}):`, err) // eslint-disable-line no-console
      }
    }

    const [contactErr, contactDoc] = await to(
      admin.firestore().collection('contacts').doc(contactId).get()
    )
    if (contactErr || !contactDoc || !contactDoc.exists) {
      console.log(`[onBookingWrite] contact=${contactId} not found, skipping`) // eslint-disable-line no-console
      return
    }

    const contact: ContactData = {
      id: contactId,
      ...(contactDoc.data() as Omit<ContactData, 'id'>),
    }

    console.log(`[onBookingWrite] booking=${event.params.bookingId} team=${teamId} trigger=${triggerType} contact=${contactId}`) // eslint-disable-line no-console

    // event.id is the CloudEvent id of this write — stable across a duplicate
    // delivery, and the occurrence half of a delayed rule's dedup key.
    await fireEventRules(teamId, triggerType, [contact], { eventId: event.id })
  }
)
