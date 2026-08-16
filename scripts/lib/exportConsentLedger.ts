// EXPORT BEFORE TEARDOWN — the gate Franco adopted as Q13.
//
// ── THE PROBLEM IT CLOSES ───────────────────────────────────────────────────
// `TENANT_DATA_COLLECTIONS` sweeps `documents` by `teamId`, and every per-team
// teardown uses `recursiveDelete`. So deleting a team destroys the acceptance
// events, the immutable version snapshots and the signer rows along with it —
// every signature that team ever collected — and until this file there was no
// export step anywhere on the teardown path.
//
// "Production teardown is a separate operation" was the earlier answer, and it
// is true and is not an answer: a liability release is the ONE artefact a studio
// needs AFTER the relationship ends, and the window over which it is needed is
// measured in years rather than in account lifetime.
//
// ── WHY IT IS A FILE ON DISK AND NOT A CALLABLE ─────────────────────────────
// The callable (`exportContactConsentHistory`) answers for ONE contact and needs
// somebody signed in. A teardown runs from a terminal, against a tenant that is
// about to stop existing, and the thing worth keeping is the whole ledger — so
// this reads it directly through the Admin SDK and writes one JSON file per
// team. It is deliberately raw rather than rendered: an archive is read by
// whoever asks in three years, and the fewest assumptions about what they will
// want is the safest shape.
//
// ── THE GATE, AND ITS ONE ESCAPE HATCH ──────────────────────────────────────
// A teardown REFUSES when the export fails. That is the point of a gate. The
// escape hatch is `--no-consent-export`, which has to be typed: a caller who
// genuinely means "this tenant never had a signature and I know it" can say so,
// and the flag appears in the console record of what was run.

import * as fs from 'node:fs'
import * as path from 'node:path'
import type { Firestore } from 'firebase-admin/firestore'

export interface ConsentExportResult {
  teamId: string
  documents: number
  versions: number
  acceptances: number
  signers: number
  file: string | null
}

/**
 * Read every waiver-shaped artefact belonging to one team and write it to disk.
 *
 * Returns `file: null` when the team carries NOTHING — no documents at all. That
 * is the ordinary case for a sandbox playground, and writing an empty file for
 * it would train whoever runs this to ignore the output.
 */
export async function exportConsentLedger(
  db: Firestore,
  teamId: string,
  outDir: string
): Promise<ConsentExportResult> {
  const documentsSnap = await db.collection('documents').where('teamId', '==', teamId).get()

  const result: ConsentExportResult = {
    teamId,
    documents: documentsSnap.size,
    versions: 0,
    acceptances: 0,
    signers: 0,
    file: null,
  }
  if (documentsSnap.empty) return result

  const policySnap = await db
    .collection('teams')
    .doc(teamId)
    .collection('waiver_policy')
    .doc('current')
    .get()

  const documents = []
  for (const doc of documentsSnap.docs) {
    // The subcollections that make a signature mean something: the frozen TEXT
    // (an acceptance stores only its hash, so without the versions the events
    // are fingerprints of nothing), the append-only EVENTS, the current-state
    // SIGNER rows, and the declared-but-unwritten NOTICE rows.
    const [versions, acceptances, signers, notices] = await Promise.all([
      doc.ref.collection('versions').get(),
      doc.ref.collection('acceptances').get(),
      doc.ref.collection('signers').get(),
      doc.ref.collection('notices').get(),
    ])
    result.versions += versions.size
    result.acceptances += acceptances.size
    result.signers += signers.size

    documents.push({
      id: doc.id,
      document: doc.data(),
      versions: versions.docs.map((d) => ({ id: d.id, ...d.data() })),
      acceptances: acceptances.docs.map((d) => ({ id: d.id, ...d.data() })),
      signers: signers.docs.map((d) => ({ id: d.id, ...d.data() })),
      notices: notices.docs.map((d) => ({ id: d.id, ...d.data() })),
    })
  }

  // Nothing was ever signed here. Say so and write no file — see above.
  if (result.acceptances === 0 && result.versions === 0) return result

  fs.mkdirSync(outDir, { recursive: true })
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const file = path.join(outDir, `consent-ledger-${teamId}-${stamp}.json`)
  fs.writeFileSync(
    file,
    JSON.stringify(
      {
        exported_at: new Date().toISOString(),
        teamId,
        waiver_policy: policySnap.data() ?? null,
        documents,
      },
      null,
      2
    ) + '\n'
  )
  result.file = file
  return result
}

/**
 * The GATE itself: export every named team's ledger, print what was written, and
 * throw if any of it failed.
 *
 * Callers pass `skip: true` for `--no-consent-export`, which is echoed rather
 * than silently honoured — the console output of a destructive run is its only
 * record.
 */
export async function requireConsentExport(
  db: Firestore,
  teamIds: string[],
  outDir: string,
  opts: { skip?: boolean } = {}
): Promise<void> {
  if (opts.skip) {
    console.log('\n⚠  --no-consent-export: the acceptance ledger will be DESTROYED unexported.')
    return
  }
  if (teamIds.length === 0) return

  console.log('\n0/…  Exporting consent ledgers before anything is deleted…')
  let wrote = 0
  for (const teamId of teamIds) {
    let res: ConsentExportResult
    try {
      res = await exportConsentLedger(db, teamId, outDir)
    } catch (err) {
      // REFUSE. A teardown that proceeds past a failed export is the exact
      // outcome this gate exists to prevent, and "it probably had nothing" is a
      // guess about the one artefact a departing studio most needs.
      console.error(`\n❌ Could not export the consent ledger for '${teamId}': ${(err as Error).message}`)
      console.error('   Nothing has been deleted. Fix the export, or re-run with --no-consent-export')
      console.error('   if you are certain this tenant holds no signatures.\n')
      throw err
    }
    if (res.file) {
      wrote += 1
      console.log(
        `   · ${teamId}: ${res.acceptances} acceptances, ${res.versions} versions → ${res.file}`
      )
    } else {
      console.log(`   · ${teamId}: nothing signed, no file written`)
    }
  }
  console.log(`   ${wrote} ledger file(s) written.`)
}
