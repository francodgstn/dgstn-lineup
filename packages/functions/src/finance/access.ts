// Finance plugin gate — shared by the export callable and the accounting
// callables/trigger. Journal WRITING is never gated (core infrastructure);
// this gate protects the surfaces the plugin sells: export + accounting.
//
// Gating is by INSTALL STATE, not a PlanFeature flag (repo convention, see
// plan.ts): studio/organization owners install the plugin free, coach pays the
// add-on via activatePluginAddon, free sees an upgrade prompt and can't install.

import * as admin from 'firebase-admin'
import { HttpsError } from 'firebase-functions/v2/https'
import { INSTALLED_PLUGINS_SUBCOLLECTION, TEAMS_COLLECTION } from '@linyup/shared'

export const FINANCE_PLUGIN_ID = 'finance'

/** True when the finance plugin is installed and active for the team. */
export async function isFinancePluginActive(teamId: string): Promise<boolean> {
  const snap = await admin
    .firestore()
    .collection(TEAMS_COLLECTION)
    .doc(teamId)
    .collection(INSTALLED_PLUGINS_SUBCOLLECTION)
    .doc(FINANCE_PLUGIN_ID)
    .get()
  return snap.exists && snap.data()?.status === 'active'
}

/** Callable gate — kiosk pattern (failed-precondition, not permission-denied,
 * so the client can distinguish "install the plugin" from "not allowed"). */
export async function assertFinancePluginActive(teamId: string): Promise<void> {
  if (!(await isFinancePluginActive(teamId))) {
    throw new HttpsError('failed-precondition', 'The Finance plugin is not enabled for this team.')
  }
}
