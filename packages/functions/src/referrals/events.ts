// ─── Referral automation events — THE ONE PLACE THAT FIRES THEM ──────────────
//
// The referrals plugin CONTRIBUTES two automation triggers
// (`apps/web/src/plugins/referrals/manifest.ts`), and the automations builder
// mounts every trigger an installed plugin declares. Until UX-87 nothing fired
// either of them: a studio on `studio`/`organization` could install the plugin
// (`status: 'available'`), build a rule on "a friend was referred", and wait
// forever — no error, no log, nothing to notice.
//
// The census — every site that fires a referrals trigger:
//   • `plugin:referrals:referral_created`  — booking/index.ts, right after the
//     `createReferral` write on a referred trial booking.
//   • `plugin:referrals:referral_rewarded` — referrals/index.ts, in
//     `confirmReferral`'s `mark_rewarded` transition.
// Add to this list; do not copy it. The referral lifecycle has exactly two
// other transitions (`friend_signed_up`, `pending_reward`) and neither is a
// declared trigger — mount one in the manifest before firing it here.
//
// THE SUBJECT IS THE REFERRER, always. Both events are things that happened
// *for* the person who shared the code, and the actions a studio hangs off them
// (send a thank-you, assign a tag, grant a reward) act on them, not on the
// friend who booked. The friend is reachable from the payload
// (`{{payload.referred_contact_id}}`) but is never the contact a rule runs
// against — an action targeting the wrong person is the failure that looks like
// it worked.
//
// Non-fatal by construction: every entry point already treats referral
// bookkeeping as best-effort, and an automation that cannot run must never cost
// somebody their seat or block a manager's status change.

import * as admin from 'firebase-admin'
import { fireEventRules, type ContactData } from '../utils/automationEngine'
import { to } from '../utils/async'

/** Load the referrer as an automation subject. Null when the contact is gone,
 *  archived/deleted, or has moved to another team — an automation must never
 *  run for somebody who is no longer this tenant's contact. */
async function loadSubject(teamId: string, contactId: string): Promise<ContactData | null> {
  const [err, snap] = await to(admin.firestore().collection('contacts').doc(contactId).get())
  if (err || !snap || !snap.exists) return null
  const data = snap.data() as Omit<ContactData, 'id'>
  if ((data as Record<string, unknown>).teamId !== teamId) return null
  if (data.deleted_at || data.archived_at) return null
  return { id: contactId, ...data }
}

async function fireReferralEvent(
  trigger: 'plugin:referrals:referral_created' | 'plugin:referrals:referral_rewarded',
  params: {
    teamId: string
    referrerContactId: string
    referredContactId: string
    referralId: string
    /** Only on `referral_rewarded` — what the studio recorded as the reward. */
    reward?: { reward_type: string; reward_amount: number } | null
  }
): Promise<void> {
  try {
    const subject = await loadSubject(params.teamId, params.referrerContactId)
    if (!subject) return
    await fireEventRules(params.teamId, trigger, [subject], {
      payload: {
        referral_id: params.referralId,
        referrer_contact_id: params.referrerContactId,
        referred_contact_id: params.referredContactId,
        ...(params.reward
          ? {
              reward_type: params.reward.reward_type,
              reward_amount: params.reward.reward_amount,
            }
          : {}),
      },
    })
  } catch (err) {
    console.error(`[referrals] ${trigger} automation fire failed (${params.referralId}):`, err) // eslint-disable-line no-console
  }
}

/** A friend booked with somebody's referral code and the referral row was created. */
export async function fireReferralCreated(params: {
  teamId: string
  referrerContactId: string
  referredContactId: string
  referralId: string
}): Promise<void> {
  await fireReferralEvent('plugin:referrals:referral_created', params)
}

/** A manager marked a referral rewarded (`confirmReferral` → 'rewarded'). */
export async function fireReferralRewarded(params: {
  teamId: string
  referrerContactId: string
  referredContactId: string
  referralId: string
  reward: { reward_type: string; reward_amount: number } | null
}): Promise<void> {
  await fireReferralEvent('plugin:referrals:referral_rewarded', params)
}
