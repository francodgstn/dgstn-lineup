/**
 * Firestore onUpdate trigger for contacts.
 * When subscription_type_id changes, closes the current open history entry
 * (end_date == null) and creates a new one for the incoming subscription.
 * Also writes a team-level transition event for cross-contact analytics.
 */
import { onDocumentUpdated } from 'firebase-functions/v2/firestore'
import * as admin from 'firebase-admin'
import { Timestamp } from 'firebase-admin/firestore'
import {
  CONTACTS_COLLECTION,
  TEAMS_COLLECTION,
  CONTACT_SUBSCRIPTION_HISTORY_SUBCOLLECTION,
  SUBSCRIPTION_TRANSITIONS_SUBCOLLECTION,
  SUBSCRIPTION_TYPES_SUBCOLLECTION,
} from '@lineup/shared'


export const onContactSubscriptionChange = onDocumentUpdated(
  `${CONTACTS_COLLECTION}/{contactId}`,
  async (event) => {
    const before = event.data!.before.data()
    const after = event.data!.after.data()

    if (before.subscription_type_id === after.subscription_type_id) return

    const { contactId } = event.params
    const teamId = after.teamId as string | undefined
    const newTypeId = (after.subscription_type_id as string | undefined) || null
    const newRecurrence = (after.subscription_recurrence as string | undefined) || null

    console.log(
      `onContactSubscriptionChange: contact ${contactId} subscription changed`,
      before.subscription_type_id,
      '→',
      newTypeId
    )

    const db = admin.firestore()
    const historyRef = db
      .collection(CONTACTS_COLLECTION)
      .doc(contactId)
      .collection(CONTACT_SUBSCRIPTION_HISTORY_SUBCOLLECTION)

    const now = Timestamp.now()

    // Close any currently open history entry
    const openSnap = await historyRef.where('end_date', '==', null).get()
    const batch = db.batch()
    openSnap.docs.forEach((d) => {
      batch.update(d.ref, { end_date: now, updated_at: now })
    })

    // Resolve subscription type names for denormalisation
    const fromTypeId = (before.subscription_type_id as string | undefined) || null
    let fromTypeName: string | null = fromTypeId
    let newTypeName: string = newTypeId ?? ''

    const lookups: Promise<void>[] = []
    if (newTypeId && teamId) {
      lookups.push(
        db
          .collection(TEAMS_COLLECTION)
          .doc(teamId)
          .collection(SUBSCRIPTION_TYPES_SUBCOLLECTION)
          .doc(newTypeId)
          .get()
          .then((d) => {
            if (d.exists) newTypeName = (d.data()?.name as string) || newTypeId
          })
          .catch((err) => console.warn('Could not resolve new subscription type name:', err.message))
      )
    }
    if (fromTypeId && teamId) {
      lookups.push(
        db
          .collection(TEAMS_COLLECTION)
          .doc(teamId)
          .collection(SUBSCRIPTION_TYPES_SUBCOLLECTION)
          .doc(fromTypeId)
          .get()
          .then((d) => {
            if (d.exists) fromTypeName = (d.data()?.name as string) || fromTypeId
          })
          .catch(() => {})
      )
    }
    await Promise.all(lookups)

    const terminationReason =
      openSnap.docs.length > 0
        ? (openSnap.docs[0].data().termination_reason as string | null) ?? null
        : null

    // Create a new history entry if a subscription was set (not cleared)
    if (newTypeId) {
      const newEntryRef = historyRef.doc()
      batch.set(newEntryRef, {
        subscription_type_id: newTypeId,
        subscription_type_name: newTypeName,
        recurrence: newRecurrence,
        start_date: now,
        end_date: null,
        termination_reason: null,
        notes: null,
        created_at: now,
        updated_at: now,
      })
    }

    // Write team-level transition event for cross-contact analytics
    if (teamId) {
      const transitionRef = db
        .collection(TEAMS_COLLECTION)
        .doc(teamId)
        .collection(SUBSCRIPTION_TRANSITIONS_SUBCOLLECTION)
        .doc()
      batch.set(transitionRef, {
        contact_id: contactId,
        from_subscription_type_id: fromTypeId,
        from_subscription_type_name: fromTypeName,
        to_subscription_type_id: newTypeId,
        to_subscription_type_name: newTypeName,
        recurrence: newRecurrence,
        changed_at: now,
        termination_reason: terminationReason,
        team_id: teamId,
      })
    }

    await batch.commit()
  }
)
