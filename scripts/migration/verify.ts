import type { Firestore } from 'firebase-admin/firestore'
import { sourceDb, targetDb } from './config'

interface CountResult { collection: string; src: number; tgt: number; ok: boolean }

async function countCollection(db: Firestore, name: string): Promise<number> {
  const snap = await db.collection(name).count().get()
  return snap.data().count
}

export async function verify(teamIds: string[]): Promise<void> {
  console.log('\n=== Verification ===')
  const src = sourceDb()
  const tgt = targetDb()

  const top = ['users', 'teams', 'activities', 'session_series', 'contacts', 'sessions', 'events', 'referrals']
  const results: CountResult[] = []

  for (const col of top) {
    const s = await countCollection(src, col)
    const t = await countCollection(tgt, col)
    results.push({ collection: col, src: s, tgt: t, ok: t >= s })
  }

  console.table(results)
  const failed = results.filter((r) => !r.ok)
  if (failed.length) {
    console.warn(`WARN: ${failed.length} collection(s) have fewer docs in target than source`)
  } else {
    console.log('All counts OK')
  }

  // Spot-check: 3 contacts per team
  for (const teamId of teamIds.slice(0, 3)) {
    const snap = await src.collection('contacts').where('teamId', '==', teamId).limit(3).get()
    for (const d of snap.docs) {
      const tgtDoc   = await tgt.collection('contacts').doc(d.id).get()
      const goalsSnap = await tgt.collection('contacts').doc(d.id).collection('goals').get()
      const histSnap  = await tgt.collection('contacts').doc(d.id).collection('subscription_history').get()
      console.log(
        `  contact ${d.id} (team ${teamId}):`,
        tgtDoc.exists ? 'exists' : 'MISSING',
        `goals=${goalsSnap.size}`,
        `sub_history=${histSnap.size}`,
      )
    }
  }
}
