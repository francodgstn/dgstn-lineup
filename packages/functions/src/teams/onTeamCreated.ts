// Provisions system-default automation rules for every NEW team. Currently one:
// the 'lib_trial_cleanup' rule (archive never-attended trial bookings after N
// days), shipped ACTIVE — lead hygiene most studios never think about; anyone who
// cares can pause/edit it in the Automations UI like any other rule. The rule
// literal lives in @linyup/shared (automationDefaults.ts) and is also offered in
// the web automation library for manual (re)install on existing teams.
import { onDocumentCreated } from 'firebase-functions/v2/firestore'
import { FieldValue } from 'firebase-admin/firestore'
import { TRIAL_CLEANUP_RULE, TRIAL_CLEANUP_RULE_KEY } from '@linyup/shared'

export const onTeamCreated = onDocumentCreated('teams/{teamId}', async (event) => {
  const snap = event.data
  if (!snap) return
  // Fixed doc id (= the system_key) so this converges with a seed writing the same
  // rule: whichever runs first wins, the other is a harmless no-op — never a
  // duplicate, regardless of order. Idempotent on event retries too.
  const ref = snap.ref.collection('automation_rules').doc(TRIAL_CLEANUP_RULE_KEY)
  if ((await ref.get()).exists) return

  await ref.set({
    name: TRIAL_CLEANUP_RULE.name,
    system_key: TRIAL_CLEANUP_RULE.system_key,
    // Default-ON (unlike manual library installs, which are review-first inactive).
    active: true,
    trigger: TRIAL_CLEANUP_RULE.trigger,
    conditions: TRIAL_CLEANUP_RULE.conditions,
    actions: TRIAL_CLEANUP_RULE.actions,
    created_at: FieldValue.serverTimestamp(),
  })
  console.log(`[onTeamCreated] installed default '${TRIAL_CLEANUP_RULE_KEY}' rule for team ${event.params.teamId}`) // eslint-disable-line no-console
})
