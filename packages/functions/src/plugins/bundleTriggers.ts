// Bundle reconciliation triggers — one per install path.
//
// `retry: true` is safe and wanted here: `reconcileBundle` is a pure function of
// current state with an empty-diff early return, so a retry can only converge.
// Deliberately NOT folded into `onInstalledPluginStatusChange`, which carries a
// non-idempotent activation hook and must stay `retry: false`.
//
// THE ORG TRIGGER IS NEW. Organisations had no `installed_plugins` trigger at
// all — `orgs/lifecycle.ts` hand-calls its teardown to work around the absence.
// This one owns bundle reconciliation ONLY. Org website teardown stays where it
// is: that path is documented as resumable-not-atomic, and moving a step of it
// into an eventually-consistent trigger would let a half-run lapse leave a
// public site up.
import { onDocumentWritten } from 'firebase-functions/v2/firestore'
import { reconcileBundle } from './bundleReconcile'

export const onTeamBundleInstallChange = onDocumentWritten(
  { document: 'teams/{teamId}/installed_plugins/{pluginId}', retry: true },
  async (event) => {
    await reconcileBundle({ kind: 'team', teamId: event.params.teamId }, event.params.pluginId)
  },
)

export const onOrgBundleInstallChange = onDocumentWritten(
  { document: 'organizations/{orgId}/installed_plugins/{pluginId}', retry: true },
  async (event) => {
    await reconcileBundle({ kind: 'org', orgId: event.params.orgId }, event.params.pluginId)
  },
)
