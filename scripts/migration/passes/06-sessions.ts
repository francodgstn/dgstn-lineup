import type { MigrationConfig } from '../config'
import { sourceDb, targetDb } from '../config'
import { BatchWriter } from '../batch-writer'
import { transformSession, transformParticipant, transformBooking } from '../transforms/sessions'

export async function pass06Sessions(
  cfg: MigrationConfig,
  teamIds: string[],
  activityMap: Map<string, { name: string; type: string }>,
): Promise<void> {
  console.log('Pass 6: sessions + participants + bookings')
  const src = sourceDb()
  const tgt = targetDb()

  for (const teamId of teamIds) {
    if (cfg.fromTeam && teamId < cfg.fromTeam) continue
    console.log(`  team ${teamId}`)
    const bw   = new BatchWriter(tgt, cfg.dryRun)
    const snap = await src.collection('sessions').where('teamId', '==', teamId).get()

    for (const d of snap.docs) {
      const tgtRef = tgt.collection('sessions').doc(d.id)
      if (!cfg.dryRun) {
        const existing = await tgtRef.get()
        if (existing.exists) { bw.skip(); continue }
      }
      bw.set(tgtRef, transformSession(d.data() as Record<string, unknown>, activityMap))

      // Participants
      const partSnap = await src.collection('sessions').doc(d.id).collection('participants').get()
      for (const pd of partSnap.docs) {
        const pRef = tgt.collection('sessions').doc(d.id).collection('participants').doc(pd.id)
        if (!cfg.dryRun) {
          const existing = await pRef.get()
          if (existing.exists) { bw.skip(); continue }
        }
        bw.set(pRef, transformParticipant(pd.id, pd.data() as Record<string, unknown>, teamId))
      }

      // Bookings
      const bookSnap = await src.collection('sessions').doc(d.id).collection('bookings').get()
      for (const bd of bookSnap.docs) {
        const bRef = tgt.collection('sessions').doc(d.id).collection('bookings').doc(bd.id)
        if (!cfg.dryRun) {
          const existing = await bRef.get()
          if (existing.exists) { bw.skip(); continue }
        }
        bw.set(bRef, transformBooking(bd.id, bd.data() as Record<string, unknown>, teamId))
      }
    }
    await bw.done()
  }
}
