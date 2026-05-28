// Ported from hmd-lineup/functions/src/previewAutomationRule/index.js
// Dry-run preview: returns the list of contacts that would be targeted if the
// given rule ran right now. Does NOT send emails or create alerts.
// Requires club+ plan.
import * as admin from 'firebase-admin'
import { onCall, HttpsError } from 'firebase-functions/v2/https'
import { to } from '../utils/async'
import { isTeamMember } from '../utils/teams'
import { requirePlan } from '../utils/plan'
import { normalizeRule, evaluateContactConditions, type ContactData } from '../utils/automationEngine'

interface MatchedContact {
  id: string
  firstname: string
  lastname: string
  email: string
  contact_type: string | null
  session_id?: string
}

export const previewAutomationRule = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'User must be authenticated.')
  }

  const { teamId, ruleId } = request.data as { teamId?: string; ruleId?: string }

  if (!teamId || !ruleId) {
    throw new HttpsError('invalid-argument', 'teamId and ruleId are required.')
  }

  const [memberErr, isMember] = await to(isTeamMember(request.auth.uid, teamId))
  if (memberErr || !isMember) {
    throw new HttpsError('permission-denied', 'You are not a member of this team.')
  }

  await requirePlan(teamId, 'club')

  const db = admin.firestore()

  const [ruleErr, ruleDoc] = await to(
    db.collection('teams').doc(teamId).collection('automation_rules').doc(ruleId).get()
  )
  if (ruleErr || !ruleDoc || !ruleDoc.exists) {
    throw new HttpsError('not-found', 'Automation rule not found.')
  }

  const rule = normalizeRule(ruleId, ruleDoc.data() as Record<string, unknown>)
  const now = new Date()
  const matched: MatchedContact[] = []

  const hasBookingCondition = rule.conditions.some((c) => c.type === 'portal_booking_no_show')

  if (hasBookingCondition) {
    // Preview for booking-based rules: find matching no_show portal bookings in the delay window
    const bookingCond = rule.conditions.find((c) => c.type === 'portal_booking_no_show') as
      | { type: 'portal_booking_no_show'; delay_days?: number; delay_hours?: number }
      | undefined
    const delayDays = bookingCond?.delay_days || Math.round(((bookingCond?.delay_hours || 24)) / 24) || 1
    const delayHours = delayDays * 24
    const windowEnd = new Date(now.getTime() - (delayHours - 12) * 3600000)
    const windowStart = new Date(now.getTime() - (delayHours + 36) * 3600000)

    const [sessErr, sessSnap] = await to(
      db
        .collection('sessions')
        .where('teamId', '==', teamId)
        .where('end', '>=', admin.firestore.Timestamp.fromDate(windowStart))
        .where('end', '<', admin.firestore.Timestamp.fromDate(windowEnd))
        .get()
    )
    if (sessErr) throw new HttpsError('internal', sessErr.message)

    const [legacySessErr, legacySessSnap] = await to(
      db
        .collection('sessions')
        .where('teacher', '==', teamId)
        .where('end', '>=', admin.firestore.Timestamp.fromDate(windowStart))
        .where('end', '<', admin.firestore.Timestamp.fromDate(windowEnd))
        .get()
    )
    const seenSessionIds = new Set(sessSnap!.docs.map((d) => d.id))
    const allSessionDocs = [...sessSnap!.docs]
    if (!legacySessErr && legacySessSnap) {
      for (const doc of legacySessSnap.docs) {
        if (!seenSessionIds.has(doc.id)) allSessionDocs.push(doc)
      }
    }

    for (const sessionDoc of allSessionDocs) {
      const [bookErr, bookSnap] = await to(
        sessionDoc.ref.collection('bookings')
          .where('fromPortal', '==', true)
          .where('status', '==', 'no_show')
          .get()
      )
      if (bookErr) continue

      for (const bookingDoc of bookSnap!.docs) {
        if (bookingDoc.data().noShowOutreachSentAt) continue

        const booking = bookingDoc.data()
        let contact: ContactData = {
          id: '',
          firstname: booking.firstname || '',
          lastname: booking.lastname || '',
          email: booking.email || '',
          total_sessions_count: 0,
        }
        const contactId: string = booking.contactId || booking.contact || ''
        if (contactId) {
          const [cErr, cDoc] = await to(db.collection('contacts').doc(contactId).get())
          if (!cErr && cDoc && cDoc.exists) {
            contact = { id: contactId, ...(cDoc.data() as Omit<ContactData, 'id'>) }
          }
        }

        if (!contact.email || contact.email_unsubscribed) continue
        if (!evaluateContactConditions(rule.conditions, contact, now)) continue

        matched.push({
          id: contactId || bookingDoc.id,
          firstname: contact.firstname || '',
          lastname: contact.lastname || '',
          email: contact.email || '',
          contact_type: (contact.type as string) || null,
          session_id: sessionDoc.id,
        })
      }
    }
  } else {
    // Preview for contact-based rules: dry-run via runRule
    // Load all contacts first so we can build the matched list
    const contacts: ContactData[] = []
    const [contactsErr, contactsSnap] = await to(
      db.collection('contacts').where('teamId', '==', teamId).get()
    )
    const [legacyErr, legacySnap] = await to(
      db.collection('contacts').where('teacher', '==', teamId).get()
    )
    const seenIds = new Set<string>()
    if (!contactsErr && contactsSnap) {
      for (const doc of contactsSnap.docs) {
        seenIds.add(doc.id)
        contacts.push({ id: doc.id, ...(doc.data() as Omit<ContactData, 'id'>) })
      }
    }
    if (!legacyErr && legacySnap) {
      for (const doc of legacySnap.docs) {
        if (!seenIds.has(doc.id)) {
          contacts.push({ id: doc.id, ...(doc.data() as Omit<ContactData, 'id'>) })
        }
      }
    }

    // Evaluate conditions directly (no runRule to avoid loading templates)
    for (const contact of contacts) {
      if (contact.deleted_at || contact.archived_at) continue
      if (!contact.email || contact.email_unsubscribed) continue
      if (!evaluateContactConditions(rule.conditions, contact, now)) continue

      matched.push({
        id: contact.id,
        firstname: contact.firstname || '',
        lastname: contact.lastname || '',
        email: contact.email || '',
        contact_type: (contact.type as string) || null,
      })
    }
  }

  console.log(`[previewAutomationRule] rule=${ruleId} team=${teamId} matched=${matched.length}`) // eslint-disable-line no-console

  return { contacts: matched, count: matched.length }
})
