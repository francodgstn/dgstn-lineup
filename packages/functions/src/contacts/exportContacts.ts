/* eslint-disable no-console */
// exportContacts — the studio's own contact book, as a CSV it can take away.
//
// WHY IT EXISTS AND WHY IT IS NOT OPTIONAL. The DPA commits us to returning the
// Customer's data on request. Finance had an export; contacts did not, so a
// studio leaving could not self-serve the one dataset that is unambiguously
// theirs. That is a promise the code did not keep, and this is the code.
//
// SHAPED ON `finance/exportReport.ts` deliberately — same inline-CSV response,
// same byte guard, same filename convention — because a second export that
// behaves differently is a second thing to learn.
//
// WHO. `assertManager`, not any team member. A coach's data access is
// own-scoped (capabilities.ts), and the whole roster in one file is exactly what
// that scoping exists to prevent; an export is not a back door around it.
//
// THE SIZE GUARD REFUSES, IT DOES NOT TRUNCATE. A silently short export is
// worse than none: the studio believes it has its data and finds out otherwise
// after the account is gone. The refusal names the row count so support knows
// what it is dealing with.

import * as admin from 'firebase-admin'
import { HttpsError, onCall } from 'firebase-functions/v2/https'
import {
  CONTACTS_COLLECTION,
  CONTACT_GROUPS_SUBCOLLECTION,
  TEAMS_COLLECTION,
  toContactsCsv,
  type ContactCsvCustomField,
} from '@linyup/shared'
import { assertManager } from '../connect/access'

const MAX_CSV_BYTES = 8 * 1024 * 1024

export const exportContacts = onCall(async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Authentication required')

  const data = (request.data ?? {}) as { teamId?: string; includeArchived?: boolean }
  const teamId = typeof data.teamId === 'string' ? data.teamId.trim() : ''
  if (!teamId) throw new HttpsError('invalid-argument', 'teamId is required')

  await assertManager(request.auth.uid, teamId)

  const db = admin.firestore()

  // Archived people are INCLUDED by default. An export is a portability
  // artefact, and a studio that archived someone still holds their record —
  // omitting them by default would quietly return less than we hold.
  const includeArchived = data.includeArchived !== false

  const [contactsSnap, teamSnap, groupsSnap] = await Promise.all([
    db.collection(CONTACTS_COLLECTION).where('teamId', '==', teamId).get(),
    db.collection(TEAMS_COLLECTION).doc(teamId).get(),
    db
      .collection(TEAMS_COLLECTION)
      .doc(teamId)
      .collection(CONTACT_GROUPS_SUBCOLLECTION)
      .get()
      // Group names are a nicety; losing them must not lose the export. Falls
      // back to ids, which `toContactsCsv` handles.
      .catch(() => null),
  ])

  // Filtered in memory rather than in the query: `deleted_at`/`anonymized_at`
  // are absent on most documents, and an inequality drops documents where the
  // field is absent — i.e. it would exclude nearly everyone. The same trap the
  // booking-reference and partner-app work hit.
  const rows = contactsSnap.docs
    .map((d) => ({ id: d.id, ...d.data() }) as Record<string, unknown>)
    .filter((c) => !c.anonymized_at && !c.deleted_at)
    .filter((c) => includeArchived || !c.archived_at)
    .sort((a, b) => {
      const l = String(a.lastname ?? '').localeCompare(String(b.lastname ?? ''))
      return l !== 0 ? l : String(a.firstname ?? '').localeCompare(String(b.firstname ?? ''))
    })

  const customFields = ((teamSnap.data()?.custom_field_definitions ?? []) as ContactCsvCustomField[])
    .filter((f) => f && typeof f.id === 'string')
    .map((f) => ({ id: f.id, label: typeof f.label === 'string' && f.label ? f.label : f.id }))

  const groupNames = new Map<string, string>()
  for (const g of groupsSnap?.docs ?? []) {
    const name = g.data()?.name
    if (typeof name === 'string' && name) groupNames.set(g.id, name)
  }

  const csv = toContactsCsv(rows, { customFields, groupNames })
  if (Buffer.byteLength(csv, 'utf8') > MAX_CSV_BYTES) {
    throw new HttpsError(
      'resource-exhausted',
      `Export too large (${rows.length} contacts) — contact support for a bulk export.`
    )
  }

  console.log(`[contacts] export team=${teamId} rows=${rows.length} archived=${includeArchived}`)
  return {
    filename: `linyup-contacts-${teamId}-${new Date().toISOString().slice(0, 10)}.csv`,
    csv,
    rowCount: rows.length,
  }
})
