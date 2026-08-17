/**
 * Converge `saas_subscriptions/{entityId}.gateway_data` onto the nested map.
 *
 * ── THE DEFECT ──────────────────────────────────────────────────────────────
 * `set()` takes a dotted key LITERALLY; only `update()` reads it as a field
 * path. The SaaS webhook built a flat object of dotted keys —
 *
 *     update['gateway_data.subscription_id'] = event.subscriptionId
 *     await subRef.set(update, { merge: true })
 *
 * — so every event it wrote stored a TOP-LEVEL FIELD NAMED
 * "gateway_data.subscription_id" and never created the map. Confirmed on live
 * data, not inferred: `saas_subscriptions/hmd`, written from event
 * evt_1U4wq0Gz6xwscm1ePB35od9E, carries
 * `"gateway_data.subscription_id": "sub_1Tl8NiGz6xwscm1esVGryAv2"` as a literal
 * field with no map beside it.
 *
 * Eleven readers wanted the map. Each miss returned `undefined` rather than
 * throwing, which is why it stayed invisible: the billing portal, cancel,
 * reactivate and invoices callables could not find a live studio's
 * subscription; the ops console showed a blank Stripe id; and the webhook's own
 * `last_event_id` idempotency check never matched, so a Stripe retry was
 * processed a second time.
 *
 * ── WHY A SCRIPT, WHEN THE WEBHOOK NOW SELF-HEALS ───────────────────────────
 * It genuinely does — unlike `backfill-subscription-lifecycle.ts`, healing here
 * needs no new information from Stripe, because the values are already ON the
 * document; they are merely under the wrong names. The webhook copies any
 * literal it finds into the nested map and deletes it, so a doc converges on
 * its next event whatever order things deploy in.
 *
 * The gap is WHEN that next event arrives. For an active monthly subscription
 * it is the next invoice — up to a month away, a year on an annual plan — and
 * for a `cancelled` or `past_due` doc there may never be another event at all.
 * Until then the studio's billing portal stays broken. That window is the
 * reason to sweep rather than wait.
 *
 * ── SAFETY ──────────────────────────────────────────────────────────────────
 * Dry-run by default; `--apply` writes. Every write is a pure rename within one
 * document: the nested map is written from values already present, and a
 * literal is deleted only in the same operation that writes its value into the
 * map. A key that exists in BOTH shapes keeps the NESTED value, matching
 * `readGatewayData` — the fixed writer produces the nested one, so it is the
 * current one by definition. Re-running is a no-op.
 *
 * Usage:
 *   pnpm backfill:gateway-data --project demo-linyup            # dry-run (emulator)
 *   pnpm backfill:gateway-data --project linyup-prod --apply
 *   pnpm backfill:gateway-data --project linyup-prod --team hmd --apply
 */
import { parseArgs } from 'node:util'
import * as admin from 'firebase-admin'
import { applicationDefault } from 'firebase-admin/app'
import { FieldValue } from 'firebase-admin/firestore'
import { SAAS_SUBSCRIPTIONS_COLLECTION, legacyGatewayDataFields } from '../packages/shared/src'

const { values } = parseArgs({
  options: {
    project: { type: 'string' },
    team: { type: 'string' },
    apply: { type: 'boolean', default: false },
  },
})

if (!values.project) {
  console.error(
    '❌ --project is required (e.g. --project linyup-staging, or demo-linyup for the emulator)'
  )
  process.exit(1)
}

// Against the emulator there are no credentials to find, and asking for ADC
// there fails for a reason that has nothing to do with the task.
const USING_EMULATOR = !!process.env.FIRESTORE_EMULATOR_HOST
admin.initializeApp(
  USING_EMULATOR
    ? { projectId: values.project }
    : { credential: applicationDefault(), projectId: values.project }
)
const db = admin.firestore()

const stats = { scanned: 0, converged: 0, alreadyNested: 0, conflicts: [] as string[] }

async function run(): Promise<void> {
  console.log(
    `\n🔧 gateway_data shape convergence on '${values.project}'` +
      `${values.team ? ` (doc ${values.team})` : ''} ${values.apply ? '(APPLY)' : '(dry-run)'}\n`
  )

  const snap = await db.collection(SAAS_SUBSCRIPTIONS_COLLECTION).get()

  for (const doc of snap.docs) {
    if (values.team && doc.id !== values.team) continue
    stats.scanned += 1
    const data = doc.data()

    const literals = legacyGatewayDataFields(data)
    if (literals.length === 0) {
      stats.alreadyNested += 1
      continue
    }

    const nested = (data.gateway_data ?? {}) as Record<string, unknown>
    const merged: Record<string, unknown> = { ...nested }
    const write: Record<string, unknown> = {}

    for (const field of literals) {
      const key = field.slice('gateway_data.'.length)
      // The nested value wins — see readGatewayData. Report the disagreement so
      // a genuine divergence is never silently discarded.
      if (key in nested && nested[key] !== data[field]) {
        stats.conflicts.push(
          `${doc.id}.${key}: literal ${JSON.stringify(data[field])} ` +
            `vs nested ${JSON.stringify(nested[key])} — keeping nested`
        )
      } else {
        merged[key] = data[field]
      }
      write[field] = FieldValue.delete()
    }
    write.gateway_data = merged

    const moved = literals.map((f) => f.slice('gateway_data.'.length)).join(', ')
    console.log(`   ${values.apply ? '✔' : 'would move'} ${doc.id}: ${moved}`)
    if (values.apply) await doc.ref.set(write, { merge: true })
    stats.converged += 1
  }

  console.log(
    `\n📊 scanned ${stats.scanned} · ` +
      `${values.apply ? 'converged' : 'would converge'} ${stats.converged} · ` +
      `already nested ${stats.alreadyNested}`
  )
  if (stats.conflicts.length) {
    console.log(`\n⚠ ${stats.conflicts.length} key(s) present in both shapes with different values:`)
    for (const c of stats.conflicts) console.log(`   – ${c}`)
  }
  if (!values.apply && stats.converged > 0) {
    console.log('\nDry run — re-run with --apply to write.')
  }
}

run()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('❌ backfill failed:', err)
    process.exit(1)
  })
