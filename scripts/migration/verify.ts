import type { Firestore } from 'firebase-admin/firestore'
import type { ReadonlyFirestore } from './config'
import { sourceDb, targetDb } from './config'

interface CountResult { collection: string; src: number; tgt: number; ok: boolean }

async function countCollection(db: ReadonlyFirestore | Firestore, name: string): Promise<number> {
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

  // AN EMPTY SOURCE IS A FAILED RUN, NOT A CLEAN ONE.
  //
  // `ok` is `tgt >= src`, so every row passes trivially when the source returns
  // nothing — and the run then prints "All counts OK" and "Migration complete"
  // having read zero documents. That is not hypothetical: it happens the moment
  // FIRESTORE_EMULATOR_HOST is exported before the script starts, because
  // `initApps` locks in the SOURCE connection while those vars are still unset
  // and an already-set one silently points the source at the emulator too.
  // Losing an hour to a green migration that moved nothing is the cheap version
  // of that mistake; trusting one is the expensive version.
  if (results.every((r) => r.src === 0)) {
    console.error('FAIL: every source collection is EMPTY - the source read nothing,' + ' so this run proved nothing.')
    console.error('      Check the service-account key, and make sure' + ' FIRESTORE_EMULATOR_HOST / FIREBASE_AUTH_EMULATOR_HOST are NOT set in the' + ' environment: --target-emulator sets them itself, after the source' + ' connection is established.')
    process.exitCode = 1
    return
  }

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
