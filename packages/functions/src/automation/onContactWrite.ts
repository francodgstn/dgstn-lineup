// Tier 1 event trigger — fires automation rules in real-time when a contact document
// is created or has key fields updated (acquisition_stage, subscription_type_id).
//
// NOTE: affiliation_changed is no longer fired from here. It is fired from the
// onAffiliationWrite trigger (sync/onAffiliationWrite.ts) which has direct access
// to the affiliation data and fires after the summary has been recomputed.
//
// Trigger path: contacts/{contactId}
// Contacts are top-level with a teamId field — teamId is read from the document.
import { onDocumentWritten } from 'firebase-functions/v2/firestore'
import { ACQUISITION_STAGES } from '@linyup/shared'
import { fireEventRules, type ContactData, type AutomationTriggerType } from '../utils/automationEngine'

const stageRank = (stage: unknown): number =>
  (ACQUISITION_STAGES as readonly string[]).indexOf(stage as string)

function resolveContactTrigger(
  before: FirebaseFirestore.DocumentData | undefined,
  after: FirebaseFirestore.DocumentData | undefined
): AutomationTriggerType | null {
  if (!after) return null // deleted — no automation on delete

  // New document — contact created
  if (!before) return 'contact_created'

  // acquisition stage advanced (trial_booked → trial_attended → joined).
  // Only FORWARD moves fire automation. A backward move is a manual correction
  // (undoing a mistaken promotion) and must not re-trigger outreach rules.
  if (before.acquisition_stage !== after.acquisition_stage) {
    if (stageRank(after.acquisition_stage) > stageRank(before.acquisition_stage)) {
      return 'acquisition_stage_changed'
    }
    // fall through — a correction may still coincide with other relevant changes
  }

  // subscription changed (manual type assignment OR Stripe billing rollup status)
  if (before.subscription_type_id !== after.subscription_type_id) return 'subscription_changed'
  if (before.subscription_status !== after.subscription_status) return 'subscription_changed'

  return null // no relevant change
}

export const onContactWrite = onDocumentWritten(
  'contacts/{contactId}',
  async (event) => {
    const before = event.data?.before?.data()
    const after = event.data?.after?.data()

    const triggerType = resolveContactTrigger(before, after)
    if (!triggerType) return

    const teamId = (after?.teamId || before?.teamId) as string | undefined
    if (!teamId) {
      console.log(`[onContactWrite] contact=${event.params.contactId}: no teamId, skipping`) // eslint-disable-line no-console
      return
    }

    // Skip deleted or archived contacts on update triggers
    if (after && (after.deleted_at || after.archived_at)) return

    const contact: ContactData = {
      id: event.params.contactId,
      ...(after as Omit<ContactData, 'id'>),
    }

    console.log(`[onContactWrite] contact=${event.params.contactId} team=${teamId} trigger=${triggerType}`) // eslint-disable-line no-console

    await fireEventRules(teamId, triggerType, [contact])
  }
)
