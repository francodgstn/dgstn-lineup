import type { MigrationConfig } from '../config'
import { sourceDb, targetDb } from '../config'
import { BatchWriter } from '../batch-writer'
import { transformContact } from '../transforms/contacts'

const CONTACT_SUBCOLLECTIONS = [
  'subscription_history',
  'goals',
  'monthly_scores',
  'contact_alerts',
  'contact_weekly_reports',
  'training_checkins',
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

    for (const d of snap.docs) {
      const tgtRef = tgt.collection('contacts').doc(d.id)
      if (!cfg.dryRun) {
        const existing = await tgtRef.get()
        if (existing.exists) { bw.skip(); continue }
      }
      bw.set(tgtRef, transformContact(d.data() as Record<string, unknown>))

      // Subcollections
      for (const sub of CONTACT_SUBCOLLECTIONS) {
        const subSnap = await src.collection('contacts').doc(d.id).collection(sub).get()
        for (const sd of subSnap.docs) {
          const subRef = tgt.collection('contacts').doc(d.id).collection(sub).doc(sd.id)
          if (!cfg.dryRun) {
            const existing = await subRef.get()
            if (existing.exists) { bw.skip(); continue }
          }
          const data = transformSubcollectionDoc(sub, sd.id, sd.data() as Record<string, unknown>)
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
            if (existing.exists) { bw.skip(); continue }
          }
          bw.set(evRef, ev.data())
        }
      }
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
