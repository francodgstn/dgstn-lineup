// Admin callable — manually grant lesson credits to a contact (the counterpart
// of a Stripe pack purchase, for cash/bank-transfer sales or goodwill make-up
// lessons). Writes a CreditGrant under contacts/{id}/credit_grants — the ONLY
// client-reachable way to create one, since Firestore rules deny direct writes
// (credits_used must never be client-mutable). The onCreditGrantWrite sync
// recomputes Contact.credit_summary.
import * as admin from 'firebase-admin'
import { FieldValue, Timestamp } from 'firebase-admin/firestore'
import { onCall, HttpsError } from 'firebase-functions/v2/https'
import { isTeamMember } from '../utils/teams'
import {
  CONTACTS_COLLECTION,
  CONTACT_CREDIT_GRANTS_SUBCOLLECTION,
  TEAMS_COLLECTION,
  type SubscriptionPrice,
} from '@linyup/shared'

export const grantCredits = onCall(async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Sign in required.')

  const data = request.data as {
    contactId?: string
    subscriptionTypeId?: string
    priceId?: string
    // Explicit override for a custom grant (no priceId): 1..100 credits.
    credits?: number
    // Validity in months from now (defaults to the price's included_months).
    validityMonths?: number
  }
  if (!data?.contactId || !data?.subscriptionTypeId) {
    throw new HttpsError('invalid-argument', 'contactId and subscriptionTypeId are required.')
  }

  const db = admin.firestore()
  const contactSnap = await db.collection(CONTACTS_COLLECTION).doc(data.contactId).get()
  if (!contactSnap.exists) throw new HttpsError('not-found', 'Contact not found.')
  const teamId = (contactSnap.data()?.teamId ?? contactSnap.data()?.teacher) as string | undefined
  if (!teamId) throw new HttpsError('failed-precondition', 'Contact is not associated with a team.')

  if (!(await isTeamMember(request.auth.uid, teamId))) {
    throw new HttpsError('permission-denied', 'You do not have permission for this contact.')
  }

  const typeSnap = await db
    .collection(TEAMS_COLLECTION)
    .doc(teamId)
    .collection('subscription_types')
    .doc(data.subscriptionTypeId)
    .get()
  if (!typeSnap.exists) throw new HttpsError('not-found', 'Subscription type not found.')
  const typeName = (typeSnap.data()?.name as string) ?? null
  const prices = (typeSnap.data()?.prices as SubscriptionPrice[] | undefined) ?? []
  const price = data.priceId ? prices.find((p) => p.id === data.priceId) : undefined
  if (data.priceId && !price) throw new HttpsError('not-found', 'Price not found on this type.')

  const credits = data.credits ?? price?.credits ?? 0
  if (!Number.isInteger(credits) || credits < 1 || credits > 100) {
    throw new HttpsError('invalid-argument', 'credits must be an integer between 1 and 100.')
  }
  const months = data.validityMonths ?? price?.included_months ?? 0
  let expiresAt: Timestamp | null = null
  if (months > 0) {
    const d = new Date()
    d.setMonth(d.getMonth() + months)
    expiresAt = Timestamp.fromDate(d)
  }

  const grantRef = db
    .collection(CONTACTS_COLLECTION)
    .doc(data.contactId)
    .collection(CONTACT_CREDIT_GRANTS_SUBCOLLECTION)
    .doc()
  await grantRef.set({
    teamId,
    subscription_type_id: data.subscriptionTypeId,
    subscription_type_name: typeName,
    price_id: data.priceId ?? null,
    credits_total: credits,
    credits_used: 0,
    expires_at: expiresAt,
    source: 'manual',
    created_at: FieldValue.serverTimestamp(),
    created_by: request.auth.uid,
  })

  return { success: true, grantId: grantRef.id, credits, expiresAt: expiresAt?.toMillis() ?? null }
})
