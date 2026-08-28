// Exercises the REAL stampOverdueGoals job against the emulator — not a stand-in.
process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080'
process.env.GCLOUD_PROJECT = 'demo-linyup'
import admin from 'firebase-admin'
admin.initializeApp({ projectId: 'demo-linyup' })
const db = admin.firestore()
const { stampOverdueGoals } = await import('../dist/dailyTasks/stampOverdueGoals.js')

const CONTACT = 'sweep-contact'
const ref = db.collection('contacts').doc(CONTACT)
let pass = 0, fail = 0
const out = []
const check = (n, ok, d = '') => { out.push(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? ' — ' + d : ''}`); ok ? pass++ : fail++ }
const until = async (fn, ms = 15000) => {
  const t0 = Date.now()
  while (Date.now() - t0 < ms) { const v = await fn().catch(() => null); if (v) return v; await new Promise(r => setTimeout(r, 400)) }
  return null
}

await db.recursiveDelete(ref)
await ref.set({ teamId: 'sweep-team', firstname: 'Swee', lastname: 'Per' })

const past = admin.firestore.Timestamp.fromDate(new Date(Date.now() - 86400000 * 2))
const future = admin.firestore.Timestamp.fromDate(new Date(Date.now() + 86400000 * 7))
const goals = ref.collection('goals')
// overdue, never stamped (the field is ABSENT, not null — the trap the header describes)
await goals.doc('overdue').set({ type: 'goal', title: 'Late', status: 'open', categories: [],
  created_by: 'coach', created_at: admin.firestore.FieldValue.serverTimestamp(), target_date: past })
// not yet due
await goals.doc('future').set({ type: 'task', title: 'Later', status: 'open', categories: [],
  created_by: 'coach', created_at: admin.firestore.FieldValue.serverTimestamp(), target_date: future })
// past due but already finished — must not be stamped
await goals.doc('done').set({ type: 'task', title: 'Done', status: 'achieved', categories: [],
  created_by: 'coach', created_at: admin.firestore.FieldValue.serverTimestamp(), target_date: past })
// no target date at all
await goals.doc('nodate').set({ type: 'goal', title: 'Open ended', status: 'in_progress', categories: [],
  created_by: 'coach', created_at: admin.firestore.FieldValue.serverTimestamp() })

await new Promise(r => setTimeout(r, 2500))
const r1 = await stampOverdueGoals()
check('sweep stamps the overdue goal whose overdue_at field is ABSENT (not null)',
  !!(await goals.doc('overdue').get()).data()?.overdue_at, `stamped=${r1.stamped}`)
check('sweep leaves a not-yet-due goal alone', !(await goals.doc('future').get()).data()?.overdue_at)
check('sweep leaves an already-achieved goal alone', !(await goals.doc('done').get()).data()?.overdue_at)
check('sweep leaves a goal with no target_date alone', !(await goals.doc('nodate').get()).data()?.overdue_at)

const counted = await until(async () => {
  const d = (await ref.get()).data(); return d?.coaching_overdue_count === 1 ? d : null
})
check('the stamp wakes trackGoals and the contact counter reaches 1', !!counted,
  counted ? '' : `got ${(await ref.get()).data()?.coaching_overdue_count}`)

const r2 = await stampOverdueGoals()
check('a second sweep is idempotent (stamps nothing already stamped)', r2.stamped === 0, `stamped=${r2.stamped}`)

console.log('\n' + out.join('\n'))
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
