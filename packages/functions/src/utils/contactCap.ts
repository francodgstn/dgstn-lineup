// Contact-cap checks — shared by the Connect webhook's contact auto-creation and
// the login-first shop registration (loginContactWithCode). The cap counts
// CONFIRMED active contacts only: provisional contacts (shop registrations that
// haven't paid yet — see Contact.provisional) are excluded so an abuser can't
// fill a team's allowance by registering and abandoning; they purge after 7 days.
import * as admin from 'firebase-admin'
import { CONTACTS_COLLECTION, PLAN_PRICING, planHasHardContactCap, type SaasPlan } from '@linyup/shared'

/** Active (non-archived, non-deleted) contact count for a team. */
export async function activeContactCount(teamId: string): Promise<number> {
  const agg = await admin
    .firestore()
    .collection(CONTACTS_COLLECTION)
    .where('teamId', '==', teamId)
    .where('deleted_at', '==', null)
    .where('archived_at', '==', null)
    .count()
    .get()
  return agg.data().count
}

/** Active contacts that are still provisional (registered via shop, never paid). */
async function activeProvisionalCount(teamId: string): Promise<number> {
  const agg = await admin
    .firestore()
    .collection(CONTACTS_COLLECTION)
    .where('teamId', '==', teamId)
    .where('provisional', '==', true)
    .where('deleted_at', '==', null)
    .where('archived_at', '==', null)
    .count()
    .get()
  return agg.data().count
}

/**
 * Pure cap decision: may one more contact be added, given the plan and the team's
 * CONFIRMED active count (active minus provisional)? Paid plans are soft-capped
 * (always true); the Free plan blocks at its included-contacts limit.
 */
export function underHardContactCap(plan: SaasPlan, confirmedActiveCount: number): boolean {
  if (!planHasHardContactCap(plan)) return true
  const cap = PLAN_PRICING[plan].includedContacts
  if (cap == null) return true
  return confirmedActiveCount < cap
}

/**
 * Whether the team may add one more contact under its plan's HARD cap, measured
 * against CONFIRMED actives (provisional shop registrations don't consume
 * allowance). Skips the count reads entirely on soft-capped plans.
 */
export async function canCreateContact(teamId: string, plan: SaasPlan): Promise<boolean> {
  if (!planHasHardContactCap(plan)) return true
  const [active, provisional] = await Promise.all([
    activeContactCount(teamId),
    activeProvisionalCount(teamId),
  ])
  return underHardContactCap(plan, active - provisional)
}
