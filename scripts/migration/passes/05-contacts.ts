import type { MigrationConfig } from '../config'
import { sourceDb, targetDb, ORG_ID } from '../config'
import { BatchWriter } from '../batch-writer'
import { transformContact, AFFILIATIONS_OUTPUT_KEY } from '../transforms/contacts'
import { matchSubscriptionType } from '../transforms/subscriptions'

// Affiliation subcollection name (mirrors @linyup/shared CONTACT_AFFILIATIONS_SUBCOLLECTION).
const AFFILIATIONS_SUBCOLLECTION = 'affiliations'
// Affiliation type catalog subcollection (mirrors AFFILIATION_TYPES_SUBCOLLECTION).
const AFFILIATION_TYPES_SUBCOLLECTION = 'affiliation_types'

// Most subcollections keep their name. HMD stored the performance radar data as
// 'training_checkins'; Linyup renamed it to 'performance_checkins', so that one
// reads from the old name and writes to the new.
const CONTACT_SUBCOLLECTIONS: Array<string | { from: string; to: string }> = [
  'subscription_history',
  'goals',
  'monthly_scores',
  'contact_alerts',
  'contact_weekly_reports',
  { from: 'training_checkins', to: 'performance_checkins' },
]

export async function pass05Contacts(
  cfg: MigrationConfig,
  teamIds: string[],
): Promise<void> {
  console.log('Pass 5: contacts + subcollections')
  const src = sourceDb()
  const tgt = targetDb()

  for (const teamId of teamIds) {
    if (cfg.fromTeam && teamId < cfg.fromTeam) continue
    console.log(`  team ${teamId}`)
    const bw   = new BatchWriter(tgt, cfg.dryRun)
    const snap = await src.collection('contacts').where('teamId', '==', teamId).get()

    // Seed a team-local 'club' affiliation type for this team's team-issued
    // (membership_status) affiliations. The org-level 'club' type + org
    // affiliation_statuses are seeded once in pass00Setup. Flag the team so the
    // affiliation axis is enabled. (org_id / organization_ids set in pass02.)
    bw.set(
      tgt.collection('teams').doc(teamId).collection(AFFILIATION_TYPES_SUBCOLLECTION).doc('club'),
      { id: 'club', key: 'club', label: 'Club membership', default_issuer: 'team', active: true, order: 0 },
    )
    bw.merge(tgt.collection('teams').doc(teamId), { affiliations_enabled: true })

    // HEURISTIC subscription matching counters — review these after migration
    // to validate the name-based matching against the real source data.
    let subMatched   = 0
    let subUnmatched = 0

    for (const d of snap.docs) {
      const tgtRef = tgt.collection('contacts').doc(d.id)
      if (!cfg.dryRun) {
        const existing = await tgtRef.get()
        if (existing.exists && !cfg.overwrite) { bw.skip(); continue }
      }

      // Track subscription match rate before transforming (transform logs nothing)
      const srcData = d.data() as Record<string, unknown>
      const srcSubName = srcData.subscription_type_name as string | undefined | null
      if (srcSubName) {
        if (matchSubscriptionType(srcSubName) !== null) { subMatched++ }
        else { subUnmatched++ }
      }

      // Transform the contact. The transform attaches derived affiliation docs
      // under AFFILIATIONS_OUTPUT_KEY (they are not a source subcollection); peel
      // them off and write them into the affiliations subcollection, then persist
      // the contact doc without that reserved key.
      const transformed = transformContact(srcData)
      const affiliations =
        (transformed[AFFILIATIONS_OUTPUT_KEY] as Array<Record<string, unknown>> | undefined) ?? []
      delete transformed[AFFILIATIONS_OUTPUT_KEY]
      bw.set(tgtRef, transformed)

      affiliations.forEach((aff, idx) => {
        const affId = `${d.id}-aff-${idx}`
        const affRef = tgt.collection('contacts').doc(d.id).collection(AFFILIATIONS_SUBCOLLECTION).doc(affId)
        bw.set(affRef, aff)
      })

      // Subcollections
      for (const sub of CONTACT_SUBCOLLECTIONS) {
        const fromName = typeof sub === 'string' ? sub : sub.from
        const toName = typeof sub === 'string' ? sub : sub.to
        const subSnap = await src.collection('contacts').doc(d.id).collection(fromName).get()
        for (const sd of subSnap.docs) {
          const subRef = tgt.collection('contacts').doc(d.id).collection(toName).doc(sd.id)
          if (!cfg.dryRun) {
            const existing = await subRef.get()
            if (existing.exists && !cfg.overwrite) { bw.skip(); continue }
          }
          const data = transformSubcollectionDoc(fromName, sd.id, sd.data() as Record<string, unknown>)
          bw.set(subRef, data)
        }
      }

      // goals/{goalId}/evaluations
      const goalsSnap = await src.collection('contacts').doc(d.id).collection('goals').get()
      for (const gd of goalsSnap.docs) {
        const evSnap = await src.collection('contacts').doc(d.id).collection('goals').doc(gd.id).collection('evaluations').get()
        for (const ev of evSnap.docs) {
          const evRef = tgt.collection('contacts').doc(d.id).collection('goals').doc(gd.id).collection('evaluations').doc(ev.id)
          if (!cfg.dryRun) {
            const existing = await evRef.get()
            if (existing.exists && !cfg.overwrite) { bw.skip(); continue }
          }
          bw.set(evRef, ev.data())
        }
      }
    }

    // Log subscription matching stats for this team (HEURISTIC — needs review)
    const subTotal = subMatched + subUnmatched
    if (subTotal > 0) {
      console.log(
        `    subscription match: ${subMatched}/${subTotal} matched` +
        (subUnmatched > 0 ? ` (${subUnmatched} unmatched — review source names)` : ''),
      )
    }

    await bw.done()
  }
}

function transformSubcollectionDoc(
  sub: string,
  _id: string,
  data: Record<string, unknown>,
): Record<string, unknown> {
  if (sub !== 'contact_alerts') return data

  // contact_alerts: flatten schedule_type/schedule_value from nested schedule object
  const schedule = data.schedule as Record<string, unknown> | undefined
  if (schedule) {
    return {
      ...data,
      schedule_type:  schedule.type,
      schedule_value: schedule.value,
      schedule:       undefined,
    }
  }
  return data
}
