// Sync trigger: recomputes Contact.affiliation_summary whenever any affiliation
// doc under contacts/{contactId}/affiliations/{affiliationId} is written/deleted.
// Also fires the 'affiliation_changed' automation trigger.

import { onDocumentWritten } from 'firebase-functions/v2/firestore'
import * as admin from 'firebase-admin'
import { FieldValue } from 'firebase-admin/firestore'
import { to } from '../utils/async'
import { fireEventRules, type ContactData } from '../utils/automationEngine'
import {
  CONTACTS_COLLECTION,
  CONTACT_AFFILIATIONS_SUBCOLLECTION,
  type Affiliation,
  type AffiliationSummary,
} from '@linyup/shared'

export const onAffiliationWrite = onDocumentWritten(
  `${CONTACTS_COLLECTION}/{contactId}/${CONTACT_AFFILIATIONS_SUBCOLLECTION}/{affiliationId}`,
  async (event) => {
    const { contactId } = event.params

    // Determine teamId from the written data (after > before for deletes)
    const afterData = event.data?.after?.data() as Affiliation | undefined
    const beforeData = event.data?.before?.data() as Affiliation | undefined
    const teamId = (afterData?.teamId ?? beforeData?.teamId) as string | undefined

    if (!teamId) {
      console.log(`[onAffiliationWrite] contact=${contactId}: no teamId found, skipping`) // eslint-disable-line no-console
      return
    }

    const db = admin.firestore()

    // ── 1. Recompute affiliation_summary from all current affiliations ─────────
    const [snapErr, affiliationsSnap] = await to(
      db
        .collection(CONTACTS_COLLECTION)
        .doc(contactId)
        .collection(CONTACT_AFFILIATIONS_SUBCOLLECTION)
        .get(),
    )

    if (snapErr) {
      console.error(`[onAffiliationWrite] failed to load affiliations for ${contactId}:`, snapErr) // eslint-disable-line no-console
      return
    }

    const affiliations = (affiliationsSnap?.docs ?? []).map(
      (d) => d.data() as Affiliation,
    )

    const has_active = affiliations.some((a) => a.active === true)
    const types = [
      ...new Set(affiliations.map((a) => a.type_key).filter((k): k is string => Boolean(k))),
    ]
    const org_ids = [
      ...new Set(
        affiliations
          .filter((a) => a.issuer === 'org' && a.org_id)
          .map((a) => a.org_id as string),
      ),
    ]

    const newSummary: AffiliationSummary = { has_active, types, org_ids }

    // Idempotent: only write if the summary actually changed
    const [, contactSnap] = await to(
      db.collection(CONTACTS_COLLECTION).doc(contactId).get(),
    )
    const existing = contactSnap?.data()?.affiliation_summary as AffiliationSummary | undefined

    const summaryChanged =
      !existing ||
      existing.has_active !== newSummary.has_active ||
      JSON.stringify([...newSummary.types].sort()) !==
        JSON.stringify([...(existing.types ?? [])].sort()) ||
      JSON.stringify([...newSummary.org_ids].sort()) !==
        JSON.stringify([...(existing.org_ids ?? [])].sort())

    if (summaryChanged) {
      const [updateErr] = await to(
        db.collection(CONTACTS_COLLECTION).doc(contactId).update({
          affiliation_summary: newSummary,
          updated_at: FieldValue.serverTimestamp(),
        }),
      )
      if (updateErr) {
        console.error(`[onAffiliationWrite] failed to update affiliation_summary for ${contactId}:`, updateErr) // eslint-disable-line no-console
      }
    }

    // ── 2. Fire affiliation_changed automation trigger ─────────────────────────
    const contactData = contactSnap?.data()
    if (!contactData) return

    const contact: ContactData = {
      id: contactId,
      ...(contactData as Omit<ContactData, 'id'>),
      // Ensure the updated summary is reflected in the automation context
      affiliation_summary: newSummary,
    }

    await fireEventRules(teamId, 'affiliation_changed', [contact])
  },
)
