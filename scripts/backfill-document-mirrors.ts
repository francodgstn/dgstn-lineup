/**
 * Re-creates the `documents/{id}/public_profile/{id}` mirror for a team's
 * published + public documents, and nudges the team so its Documents surface
 * flag recomputes.
 *
 * ── OPT-IN PER TEAM, DELIBERATELY ───────────────────────────────────────────
 * Unlike scripts/backfill-document-versions.ts — which is a deploy precondition
 * because it changes nothing a visitor can see — THIS SCRIPT PUBLISHES CONTENT.
 * The sharp case is a team that trialed, published documents, lapsed to Free and
 * had every mirror deleted by the plugin-deactivation teardown: running this for
 * them re-publishes pages they may believe retired, and the teardown left no
 * marker that would let a script tell the difference.
 *
 * So: `--team` is REQUIRED, `--apply` is required to write, and writing against
 * a cloud project asks for a typed confirmation — the discipline `sandbox:reset`
 * and `lead --reset` already use. Run scripts/audit-document-visibility.ts first;
 * it names exactly the set that would go live and flags the suspected teardowns.
 *
 * ── WHY THIS DOES NOT JUST "TOUCH" THE DOCUMENTS ────────────────────────────
 * A no-op write would fire `syncDocumentPublicProfile` and produce the same
 * mirror. It would also bump `updated_at` on somebody's legal text for no reason,
 * and it depends on the trigger being deployed — which on the sandbox it may not
 * be. This writes the same summary the trigger writes, from the same frozen
 * version snapshot, so the two agree byte for byte.
 *
 * Auth: gcloud Application Default Credentials (ADC).
 *
 * Usage:
 *   tsx scripts/backfill-document-mirrors.ts --project linyup-staging --team t1 [--apply] [--yes]
 */

import { createInterface } from 'node:readline/promises'
import { parseArgs } from 'node:util'
import admin from 'firebase-admin'
import { applicationDefault } from 'firebase-admin/app'
import { FieldValue } from 'firebase-admin/firestore'
import {
  DOCUMENTS_COLLECTION,
  DOCUMENT_VERSIONS_SUBCOLLECTION,
  MAX_WAIVER_BODY_CHARS,
  TEAMS_COLLECTION,
  documentVersionId,
} from '@linyup/shared'
// Same deliberate cross-package import as the version backfill: the mirror's
// bytes must match what the trigger produces, so the sanitizer is SHARED rather
// than copied.
import { sanitizeRichHtml, safeExternalUrl } from '../packages/functions/src/utils/sanitizeHtml'

const { values } = parseArgs({
  options: {
    project: { type: 'string' },
    team: { type: 'string' },
    apply: { type: 'boolean', default: false },
    yes: { type: 'boolean', default: false },
  },
})

if (!values.project) {
  console.error('❌ --project is required')
  process.exit(1)
}
if (!values.team) {
  console.error(
    '❌ --team is required. This script publishes content, so it is opt-in per team —\n' +
      '   run scripts/audit-document-visibility.ts first to see what would go live.'
  )
  process.exit(1)
}

admin.initializeApp({ credential: applicationDefault(), projectId: values.project })
const db = admin.firestore()

const isEmulator = !!process.env.FIRESTORE_EMULATOR_HOST

async function main() {
  console.log(
    `\n📢 Document mirror backfill on '${values.project}' for team ${values.team} ${
      values.apply ? '(APPLY)' : '(dry-run)'
    }\n`
  )

  const snap = await db
    .collection(DOCUMENTS_COLLECTION)
    .where('teamId', '==', values.team)
    .where('status', '==', 'published')
    .get()

  const targets: FirebaseFirestore.QueryDocumentSnapshot[] = []
  for (const doc of snap.docs) {
    const d = doc.data()
    if (d.isPublic !== true || d.archived_at != null) continue
    const mirror = await doc.ref.collection('public_profile').doc(doc.id).get()
    if (mirror.exists) continue
    targets.push(doc)
  }

  if (targets.length === 0) {
    console.log('✅ Nothing to do — every published + public document already has a mirror.\n')
    return
  }

  console.log('Would publish:')
  for (const doc of targets) {
    console.log(`   · ${doc.data().slug}  ${doc.data().title}`)
  }
  console.log('')

  if (!values.apply) {
    console.log('   Re-run with --apply to write.\n')
    return
  }

  if (!values.yes && !isEmulator) {
    const rl = createInterface({ input: process.stdin, output: process.stdout })
    const answer = await rl.question(
      `This makes ${targets.length} document(s) publicly visible. Type '${values.team}' to confirm: `
    )
    rl.close()
    if (answer.trim() !== values.team) {
      console.error('❌ Confirmation did not match — aborted. Nothing was published.\n')
      process.exit(1)
    }
  }

  for (const doc of targets) {
    const d = doc.data()
    const isRich = d.source === 'rich_text'
    const currentVersion = typeof d.current_version === 'number' ? d.current_version : null

    const profile: Record<string, unknown> = {
      type: 'document',
      teamId: d.teamId,
      slug: d.slug,
      title: d.title || '',
      kind: d.kind || 'other',
      source: d.source,
      summary: d.summary || '',
      version: currentVersion,
      updated_at: d.updated_at ?? FieldValue.serverTimestamp(),
    }

    const versionSnap =
      currentVersion != null
        ? await doc.ref
            .collection(DOCUMENT_VERSIONS_SUBCOLLECTION)
            .doc(documentVersionId(currentVersion))
            .get()
        : null
    const frozen = versionSnap?.exists ? versionSnap.data()! : null
    if (frozen) profile.bodyHash = (frozen.bodyHash as string) ?? null

    if (isRich) {
      profile.bodyHtml = frozen
        ? ((frozen.bodyHtml as string) ?? '')
        : sanitizeRichHtml(typeof d.body === 'string' ? d.body.slice(0, MAX_WAIVER_BODY_CHARS) : '')
    } else {
      const url = (frozen?.externalUrl as string | undefined) ?? safeExternalUrl(d.externalUrl)
      if (url) profile.externalUrl = url
    }

    await doc.ref.collection('public_profile').doc(doc.id).set(profile)
    console.log(`   ✔ ${d.slug}`)
  }

  // The surface flag is computed from the existence of a MIRROR, and that probe
  // lives in a trigger on the TEAM document — so the flag stays false until the
  // team is nudged. One decision, one moment: the content and the surface go live
  // together rather than drifting apart.
  await db
    .collection(TEAMS_COLLECTION)
    .doc(values.team!)
    .set({ surfaces_updated_at: FieldValue.serverTimestamp() }, { merge: true })

  console.log(`\n📊 published ${targets.length} mirror(s) and nudged the team's surface recompute.\n`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
