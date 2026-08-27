// End-to-end verification of the coaching triggers against the emulator.
// Writes real documents, waits for the triggers to land, asserts the denormalized
// state. Nothing here mocks anything.
process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080'
import admin from 'firebase-admin'

admin.initializeApp({ projectId: 'demo-linyup' })
const db = admin.firestore()

const TEAM = 'verif-team'
const CONTACT = 'verif-contact'
let pass = 0, fail = 0
const results = []

function check(name, ok, detail = '') {
  results.push(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`)
  ok ? pass++ : fail++
}

// Poll until predicate holds or timeout — triggers are async.
async function until(label, fn, ms = 15000) {
  const t0 = Date.now()
  let last
  while (Date.now() - t0 < ms) {
    try { last = await fn(); if (last) return last } catch (e) { last = e.message }
    await new Promise(r => setTimeout(r, 400))
  }
  return null
}

const contactRef = db.collection('contacts').doc(CONTACT)
const goals = () => contactRef.collection('goals')

async function reset() {
  await db.recursiveDelete(contactRef)
  await contactRef.set({ teamId: TEAM, firstname: 'Vera', lastname: 'Ifier', created_at: admin.firestore.FieldValue.serverTimestamp() })
}

async function main() {
  await reset()

  // ── 1. counters on goal create ────────────────────────────────────────────
  const g1 = goals().doc('goal1')
  await g1.set({ type: 'goal', title: 'Win a match', status: 'open', categories: ['effort'],
    created_by: 'coach', created_at: admin.firestore.FieldValue.serverTimestamp(), parent_goal_id: null })
  let c = await until('open count', async () => {
    const d = (await contactRef.get()).data()
    return d?.coaching_open_count === 1 ? d : null
  })
  check('trackGoals sets coaching_open_count on create', !!c, c ? '' : 'never reached 1')

  // ── 2. latest_score denorm from an evaluation ─────────────────────────────
  await g1.collection('evaluations').doc('e1').set({
    evaluated_at: admin.firestore.Timestamp.fromDate(new Date(Date.now() - 60000)),
    evaluated_by: 'coach', score: 3, notes: 'first', status_after: 'in_progress' })
  await g1.collection('evaluations').doc('e2').set({
    evaluated_at: admin.firestore.Timestamp.now(),
    evaluated_by: 'coach', score: 5, notes: 'second', status_after: 'in_progress' })
  const gd = await until('latest_score', async () => {
    const d = (await g1.get()).data()
    return d?.latest_score === 5 ? d : null
  })
  check('trackGoalEvaluations denormalizes newest score', !!gd, gd ? '' : 'latest_score never became 5')
  check('trackGoalEvaluations sets last_evaluated_at', !!gd?.last_evaluated_at)

  // newest-wins after deleting the newest — must fall BACK to the older one
  await g1.collection('evaluations').doc('e2').delete()
  const reverted = await until('revert', async () => {
    const d = (await g1.get()).data()
    return d?.latest_score === 3 ? d : null
  })
  check('deleting newest evaluation reverts latest_score to the prior one', !!reverted,
    reverted ? '' : 'stayed at 5 — re-derivation on delete is broken')

  // ── 3. check-in denorm ────────────────────────────────────────────────────
  await contactRef.collection('performance_checkins').doc('c1').set({
    taken_at: admin.firestore.Timestamp.now(), filled_by: 'student', context: 'self',
    scores: { consistency: 4, effort: 2, focus: 3, recharge: 5, sense_of_progress: 3 },
    profile_key: 'default', primary_lever: 'effort', anchor: 'recharge' })
  const ci = await until('last_checkin_at', async () => {
    const d = (await contactRef.get()).data()
    return d?.last_checkin_at ? d : null
  })
  check('trackPerformanceCheckins sets last_checkin_at', !!ci)

  // ── 4. alerts_count — the reason that never fired ─────────────────────────
  await contactRef.collection('contact_alerts').doc('a1').set({
    schedule_type: 'datetime', schedule_value: admin.firestore.Timestamp.now(),
    message: 'call them', created_at: admin.firestore.FieldValue.serverTimestamp() })
  const al = await until('alerts_count', async () => {
    const d = (await contactRef.get()).data()
    return d?.alerts_count === 1 ? d : null
  })
  check('trackContactAlerts sets alerts_count', !!al, al ? '' : 'stayed unset')

  await contactRef.collection('contact_alerts').doc('a1').update({ archived_at: admin.firestore.Timestamp.now() })
  const al0 = await until('alerts_count back to 0', async () => {
    const d = (await contactRef.get()).data()
    return d?.alerts_count === 0 ? d : null
  })
  check('archiving an alert decrements alerts_count', !!al0, al0 ? '' : 'archived alert still counted')

  // ── 5. steps + overdue counters ───────────────────────────────────────────
  const s1 = goals().doc('step1')
  await s1.set({ type: 'task', title: 'Stretch 3x', status: 'open', categories: [],
    created_by: 'coach', created_at: admin.firestore.FieldValue.serverTimestamp(),
    parent_goal_id: 'goal1',
    target_date: admin.firestore.Timestamp.fromDate(new Date(Date.now() - 86400000 * 3)) })
  const two = await until('open count 2', async () => {
    const d = (await contactRef.get()).data()
    return d?.coaching_open_count === 2 ? d : null
  })
  check('a step counts toward coaching_open_count', !!two, two ? '' : `got ${(await contactRef.get()).data()?.coaching_open_count}`)

  // stamping overdue_at must wake trackGoals and raise the overdue counter
  await s1.update({ overdue_at: admin.firestore.Timestamp.now() })
  const od = await until('overdue count', async () => {
    const d = (await contactRef.get()).data()
    return d?.coaching_overdue_count === 1 ? d : null
  })
  check('overdue_at wakes trackGoals and raises coaching_overdue_count', !!od,
    od ? '' : `got ${(await contactRef.get()).data()?.coaching_overdue_count}`)

  // completing it must clear both the overdue stamp and the counters
  await s1.update({ status: 'achieved', completed_at: admin.firestore.Timestamp.now() })
  const cleared = await until('cleared', async () => {
    const cd = (await contactRef.get()).data()
    const sd = (await s1.get()).data()
    return cd?.coaching_overdue_count === 0 && cd?.coaching_open_count === 1 && !sd?.overdue_at ? { cd, sd } : null
  })
  check('completing an overdue step clears overdue_at and both counters', !!cleared,
    cleared ? '' : JSON.stringify({ c: (await contactRef.get()).data()?.coaching_overdue_count, s: !!(await s1.get()).data()?.overdue_at }))

  // ── 6. teardownGoal — the cascade + the unparenting ───────────────────────
  const before = (await g1.collection('evaluations').get()).size
  await g1.delete()
  const gone = await until('evaluations gone', async () => {
    const snap = await g1.collection('evaluations').get()
    return snap.empty ? true : null
  })
  check('deleting a goal deletes its evaluations', !!gone, gone ? `had ${before}` : 'evaluations survived the parent')

  const unparented = await until('step unparented', async () => {
    const d = (await s1.get()).data()
    return d && d.parent_goal_id === null ? d : null
  })
  check('deleting a goal unparents its steps rather than destroying them', !!unparented,
    unparented ? '' : `parent_goal_id = ${(await s1.get()).data()?.parent_goal_id}`)
  const stepAlive = (await s1.get()).exists
  check('the step itself survives its parent goal', stepAlive)

  console.log('\n' + results.join('\n'))
  console.log(`\n${pass} passed, ${fail} failed`)
  process.exit(fail ? 1 : 0)
}

main().catch(e => { console.error('HARNESS ERROR', e); process.exit(2) })
