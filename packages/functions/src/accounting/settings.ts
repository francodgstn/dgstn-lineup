/* eslint-disable no-console */
// setChartTemplate — switch the chart-of-accounts template. Allowed ONLY while
// the ledger is empty: switching numbering mid-ledger is an accounting
// migration, not a toggle. Deletes the seeded system accounts of the old
// template (custom accounts are kept) and re-seeds the new one.

import { HttpsError, onCall } from 'firebase-functions/v2/https'
import { CHART_TEMPLATES, type ChartTemplateId } from '@linyup/shared'
import * as admin from 'firebase-admin'
import { TEAMS_COLLECTION } from '@linyup/shared'
import { assertOwner } from '../connect/access'
import { assertFinancePluginActive } from '../finance/access'
import { accountingSettingsRef, accountsCollection, loadAccountingSettings, seedAccounts } from './seed'
import { entriesCollection } from './store'

export const setChartTemplate = onCall(async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Authentication required')
  const data = request.data as { teamId?: string; template?: string }
  if (!data?.teamId) throw new HttpsError('invalid-argument', 'teamId is required')
  const template = data.template as ChartTemplateId
  if (!template || !(template in CHART_TEMPLATES)) {
    throw new HttpsError('invalid-argument', 'Unknown chart template')
  }
  const teamId = data.teamId

  await assertOwner(request.auth.uid, teamId)
  await assertFinancePluginActive(teamId)
  const settings = await loadAccountingSettings(teamId)
  if (!settings) throw new HttpsError('failed-precondition', 'Accounting is not initialized for this team.')
  if (settings.chart_template === template) return { template }

  const anyEntry = await entriesCollection(teamId).limit(1).get()
  if (!anyEntry.empty) {
    throw new HttpsError(
      'failed-precondition',
      'The chart template is locked once entries exist — renumbering mid-ledger is a migration.'
    )
  }

  // Remove the old template's system accounts (custom accounts stay).
  const systemAccounts = await accountsCollection(teamId).where('system', '==', true).get()
  const batch = admin.firestore().batch()
  for (const doc of systemAccounts.docs) batch.delete(doc.ref)
  await batch.commit()

  const teamSnap = await admin.firestore().collection(TEAMS_COLLECTION).doc(teamId).get()
  await accountingSettingsRef(teamId).set(
    { chart_template: template, mapping: CHART_TEMPLATES[template].mapping },
    { merge: true }
  )
  await seedAccounts(teamId, template, teamSnap.data()?.language as string | undefined)
  console.log(`[accounting] template switched to ${template} team=${teamId}`)
  return { template }
})
