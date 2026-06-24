// Tier 1 event trigger — fires automation rules in real-time when a contact document
// is created or has key fields updated (acquisition_stage, membership_status,
// subscription_type_id).
//
// Trigger path: contacts/{contactId}
// Contacts are top-level with a teamId field — teamId is read from the document.
import { onDocumentWritten } from 'firebase-functions/v2/firestore'
import { fireEventRules, type ContactData, type AutomationTriggerType } from '../utils/automationEngine'

function resolveContactTrigger(
  before: FirebaseFirestore.DocumentData | undefined,
  after: FirebaseFirestore.DocumentData | undefined
): AutomationTriggerType | null {
  if (!after) return null // deleted — no automation on delete

  // New document — contact created
  if (!before) return 'contact_created'

  // acquisition stage advanced (trial_booked → trial_attended → joined)
  if (before.acquisition_stage !== after.acquisition_stage) return 'acquisition_stage_changed'

  // membership_status changed
  if (before.membership_status !== after.membership_status) return 'membership_status_changed'

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
