import type { MigrationConfig } from '../config'
import { sourceDb, targetDb } from '../config'
import { BatchWriter } from '../batch-writer'
import { transformSession, transformParticipant, transformBooking } from '../transforms/sessions'
import type { QueryDocumentSnapshot } from 'firebase-admin/firestore'

// Sessions in hmd-lineup may use teamId (new) or teacher (legacy) to identify
// the owning team. We fetch both and deduplicate by document ID.
async function fetchTeamSessions(
  teamId: string,
): Promise<Map<string, QueryDocumentSnapshot>> {
  const src = sourceDb()
  const map = new Map<string, QueryDocumentSnapshot>()

  const [byTeamId, byTeacher] = await Promise.all([
    src.collection('sessions').where('teamId',  '==', teamId).get(),
    src.collection('sessions').where('teacher', '==', teamId).get(),
  ])

  for (const d of byTeamId.docs)  map.set(d.id, d)
  for (const d of byTeacher.docs) map.set(d.id, d)   // deduplicates by ID

  return map
}

export async function pass06Sessions(
  cfg: MigrationConfig,
  teamIds: string[],
  activityMap: Map<string, { name: string; type: string }>,
): Promise<void> {
  console.log('Pass 6: sessions + participants + bookings')
  const tgt = targetDb()

  for (const teamId of teamIds) {
    if (cfg.fromTeam && teamId < cfg.fromTeam) continue

    const sessionDocs = await fetchTeamSessions(teamId)
    console.log(`  team ${teamId}: ${sessionDocs.size} sessions`)

    const bw = new BatchWriter(tgt, cfg.dryRun)

    for (const [, d] of sessionDocs) {
      const tgtRef = tgt.collection('sessions').doc(d.id)
      if (!cfg.dryRun) {
        const existing = await tgtRef.get()
        if (existing.exists) { bw.skip(); continue }
      }

      // Ensure teamId is always set (legacy sessions may only have teacher)
      const data = d.data() as Record<string, unknown>
      if (!data.teamId) data.teamId = teamId

      bw.set(tgtRef, transformSession(data, activityMap))

      // Participants
      const partSnap = await sourceDb().collection('sessions').doc(d.id).collection('participants').get()
      for (const pd of partSnap.docs) {
        const pRef = tgt.collection('sessions').doc(d.id).collection('participants').doc(pd.id)
        if (!cfg.dryRun) {
          const existing = await pRef.get()
          if (existing.exists) { bw.skip(); continue }
        }
        bw.set(pRef, transformParticipant(pd.id, pd.data() as Record<string, unknown>, teamId))
      }

      // Bookings
      const bookSnap = await sourceDb().collection('sessions').doc(d.id).collection('bookings').get()
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
