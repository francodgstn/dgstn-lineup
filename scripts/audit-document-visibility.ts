/**
 * READ-ONLY. Lists, per team, every document that a studio believes is public
 * but which no visitor can currently see — published + isPublic + not archived,
 * with no `public_profile` mirror.
 *
 * ── WHY THIS EXISTS ─────────────────────────────────────────────────────────
 * De-gating Documents removes the plugin install that used to gate the surface.
 * The warning everybody expects is "those teams' pages will flip live" — and the
 * mechanism is the INVERSE of that phrasing, which is what changes the work:
 * `syncDocumentPublicProfile` is an onDocumentWritten trigger and nothing writes
 * those documents, so removing the gate does NOT re-create their mirrors. The
 * practical outcome is that documents the studio believes are published stay
 * INVISIBLE until something touches each one.
 *
 * A backfill is therefore required — and THAT BACKFILL IS EXACTLY WHAT MAKES
 * PREVIOUSLY-DARK CONTENT GO LIVE. Which is why it is a separate, opt-in script
 * (scripts/backfill-document-mirrors.ts) and why this one, which decides nothing,
 * runs first.
 *
 * The sharp population is a team that PUBLISHED, was downgraded, and had its
 * mirrors torn down by the old plugin-deactivation trigger. A naive backfill
 * re-publishes content they may believe retired, and the teardown left no marker,
 * so this audit CANNOT always distinguish "never had a mirror" from "had one,
 * deleted by a downgrade". It prints the plan and the retired install's status
 * beside every team precisely so a human can tell the difference; opt-in per team
 * is the only honest posture.
 *
 * Auth: gcloud Application Default Credentials (ADC), like the other scripts.
 * Against the emulator, set FIRESTORE_EMULATOR_HOST and use the demo project.
 *
 * Usage:
 *   tsx scripts/audit-document-visibility.ts --project linyup-staging [--team t1]
 */

import { parseArgs } from 'node:util'
import admin from 'firebase-admin'
import { applicationDefault } from 'firebase-admin/app'
import {
  DOCUMENTS_COLLECTION,
  INSTALLED_PLUGINS_SUBCOLLECTION,
  TEAMS_COLLECTION,
  publicPagesIndexable,
  type SaasPlan,
} from '@linyup/shared'

const { values } = parseArgs({
  options: {
    project: { type: 'string' },
    team: { type: 'string' },
  },
})

if (!values.project) {
  console.error('❌ --project is required (e.g. --project linyup-staging, or demo-linyup for the emulator)')
  process.exit(1)
}

admin.initializeApp({ credential: applicationDefault(), projectId: values.project })
const db = admin.firestore()

interface DarkDoc {
  documentId: string
  title: string
  slug: string
  kind: string
}

interface TeamRow {
  teamId: string
  name: string
  plan: SaasPlan
  planStatus: string
  /** The status of the RETIRED installed_plugins/documents doc, if any. The only
   *  hint available for "was this team torn down by a downgrade". */
  legacyInstall: string
  indexable: boolean
  dark: DarkDoc[]
  live: number
}

async function main() {
  console.log(
    `\n🔍 Document visibility audit on '${values.project}'${values.team ? ` (team ${values.team})` : ''} — READ ONLY\n`
  )

  let q: FirebaseFirestore.Query = db
    .collection(DOCUMENTS_COLLECTION)
    .where('status', '==', 'published')
  if (values.team) q = q.where('teamId', '==', values.team)
  const snap = await q.get()

  const byTeam = new Map<string, TeamRow>()

  for (const doc of snap.docs) {
    const d = doc.data()
    if (d.isPublic !== true || d.archived_at != null) continue

    const teamId = d.teamId as string
    if (!byTeam.has(teamId)) {
      const [teamSnap, installSnap] = await Promise.all([
        db.collection(TEAMS_COLLECTION).doc(teamId).get(),
        db
          .collection(TEAMS_COLLECTION)
          .doc(teamId)
          .collection(INSTALLED_PLUGINS_SUBCOLLECTION)
          .doc('documents')
          .get(),
      ])
      const t = teamSnap.data() ?? {}
      byTeam.set(teamId, {
        teamId,
        name: (t.name as string) ?? '?',
        plan: ((t.plan as SaasPlan) ?? 'free') as SaasPlan,
        planStatus: (t.plan_status as string) ?? 'trial',
        legacyInstall: installSnap.exists ? ((installSnap.data()?.status as string) ?? '?') : 'never',
        indexable: publicPagesIndexable({
          plan: t.plan as SaasPlan | undefined,
          plan_status: t.plan_status as string | undefined,
        }),
        dark: [],
        live: 0,
      })
    }
    const row = byTeam.get(teamId)!

    const mirror = await doc.ref.collection('public_profile').doc(doc.id).get()
    if (mirror.exists) {
      row.live += 1
    } else {
      row.dark.push({
        documentId: doc.id,
        title: (d.title as string) ?? '?',
        slug: (d.slug as string) ?? '?',
        kind: (d.kind as string) ?? 'other',
      })
    }
  }

  const rows = [...byTeam.values()].filter((r) => r.dark.length > 0)
  if (rows.length === 0) {
    console.log('✅ Every published + public document has a mirror. Nothing would flip live.\n')
    return
  }

  console.log('These documents would become visible if the mirror backfill were run for their team:\n')
  for (const r of rows) {
    const suspectTeardown = r.legacyInstall !== 'never' && r.legacyInstall !== 'active'
    console.log(
      `  ${r.teamId}  ${r.name}  [plan ${r.plan}/${r.planStatus}]  ` +
        `legacy install: ${r.legacyInstall}${suspectTeardown ? '  ⚠ likely torn down by a downgrade' : ''}`
    )
    console.log(
      `     ${r.live} already live · ${r.dark.length} dark · public pages ` +
        `${r.indexable ? 'INDEXABLE' : 'noindex'}`
    )
    for (const d of r.dark) {
      console.log(`     · ${d.kind.padEnd(11)} ${d.slug.padEnd(28)} ${d.title}`)
    }
    console.log('')
  }

  console.log(
    `📊 ${rows.length} teams have dark public documents.\n` +
      '   Review the ⚠ rows with a human before backfilling them: a team that was\n' +
      '   downgraded had its mirrors deleted, and may believe that content retired.\n' +
      '   Then: tsx scripts/backfill-document-mirrors.ts --project … --team <id> --apply\n'
  )
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
