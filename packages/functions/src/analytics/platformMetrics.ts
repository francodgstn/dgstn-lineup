import { onSchedule } from 'firebase-functions/v2/scheduler'
import * as admin from 'firebase-admin'
import { FieldValue } from 'firebase-admin/firestore'
import { to } from '../utils/async'
import {
  computePlatformMetrics,
  platformMetricsToDoc,
  type AccountMetricInput,
  type SaasSubscription,
  PLATFORM_METRICS_COLLECTION,
  SAAS_SUBSCRIPTIONS_COLLECTION,
  TEAMS_COLLECTION,
  ORGANIZATIONS_COLLECTION,
  CONTACTS_COLLECTION,
} from '@linyup/shared'

// Canonical "active contact" definition (matches getActiveContacts): a contact
// whose deleted_at and archived_at are both null. count() keeps this cheap.
async function countActiveContacts(
  db: admin.firestore.Firestore,
  teamId: string,
): Promise<number> {
  const [err, snap] = await to(
    db
      .collection(CONTACTS_COLLECTION)
      .where('teamId', '==', teamId)
      .where('deleted_at', '==', null)
      .where('archived_at', '==', null)
      .count()
      .get(),
  )
  if (err || !snap) return 0
  return snap.data().count
}

// Date key in the business timezone (Europe/Zurich). en-CA → YYYY-MM-DD.
function dateKey(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Zurich' }).format(new Date())
}

// ─── capturePlatformMetrics ─────────────────────────────────────────────────
// Daily snapshot of platform-wide operator metrics → platform_metrics/{date}.
// Idempotent: re-running a given day overwrites that day's doc. Gauges (status
// mix, MRR, active counts) can't be reconstructed after the fact, so this is the
// only way to build a trend series — hence the daily cron.
export const capturePlatformMetrics = onSchedule(
  { schedule: 'every day 00:15', timeZone: 'Europe/Zurich', timeoutSeconds: 300, memory: '512MiB' },
  async () => {
    const db = admin.firestore()
    const nowMs = Date.now()
    const date = dateKey()

    const [teamsErr, teamsSnap] = await to(db.collection(TEAMS_COLLECTION).get())
    const [orgsErr, orgsSnap] = await to(db.collection(ORGANIZATIONS_COLLECTION).get())
    const [subsErr, subsSnap] = await to(db.collection(SAAS_SUBSCRIPTIONS_COLLECTION).get())
    if (teamsErr || orgsErr || subsErr || !teamsSnap || !orgsSnap || !subsSnap) {
      console.error('capturePlatformMetrics: read failed', { teamsErr, orgsErr, subsErr })
      return
    }

    const subs = new Map<string, SaasSubscription>()
    for (const doc of subsSnap.docs) {
      const sub = doc.data() as SaasSubscription
      subs.set(sub.entity_id ?? doc.id, sub)
    }

    const inputs: AccountMetricInput[] = []

    // Active-contact counts per team, in parallel.
    const teamIds = teamsSnap.docs.map((d) => d.id)
    const counts = await Promise.all(teamIds.map((id) => countActiveContacts(db, id)))
    const contactCount = new Map<string, number>()
    teamIds.forEach((id, i) => contactCount.set(id, counts[i] ?? 0))

    for (const doc of teamsSnap.docs) {
      const team = doc.data()
      // Internal teams (e.g. the prod smoke-test studio) never count toward
      // platform metrics. Filtered in memory — `flags.internal` is a nested field
      // (no top-level boolean to query on) and all teams are already loaded.
      if (team.flags?.internal === true) continue
      const sub = subs.get(doc.id)
      inputs.push({
        type: 'team',
        plan: sub?.plan ?? team.plan ?? null,
        status: sub?.status ?? team.plan_status ?? null,
        createdMs: team.created?.toMillis?.() ?? 0,
        trialEndsAtMs: sub?.trial_ends_at?.toMillis?.() ?? team.trial_ends_at?.toMillis?.() ?? null,
        contactCount: contactCount.get(doc.id) ?? 0,
      })
    }

    for (const doc of orgsSnap.docs) {
      const org = doc.data()
      const sub = subs.get(doc.id)
      inputs.push({
        type: 'org',
        plan: sub?.plan ?? org.plan ?? 'organization',
        status: sub?.status ?? org.plan_status ?? null,
        createdMs: org.created?.toMillis?.() ?? 0,
        trialEndsAtMs: sub?.trial_ends_at?.toMillis?.() ?? null,
        contactCount: null,
      })
    }

    const metrics = computePlatformMetrics(inputs, nowMs)
    const docData = platformMetricsToDoc(date, metrics)

    const [writeErr] = await to(
      db
        .collection(PLATFORM_METRICS_COLLECTION)
        .doc(date)
        .set({ ...docData, captured_at: FieldValue.serverTimestamp() }, { merge: true }),
    )
    if (writeErr) {
      console.error('capturePlatformMetrics: write failed', writeErr)
      return
    }
    console.log(`capturePlatformMetrics: wrote ${date} (${metrics.accounts.total} accounts)`)
  },
)
