// `trackWaiverAcceptances` — the acceptance ledger, seen from the PERSON's side.
//
// ── WHY A TRIGGER, AND NOT A LINE IN EVERY RAIL ─────────────────────────────
// A signature can be written by any of the rails in `waivers/gate.ts`'s census
// (the free booking commit, the paid checkouts, the waitlist claim), by signup,
// by Space, or by a manager's revocation. Adding a `logActivity` call to each
// would be one edit per rail, one omission per new rail, and — on the free rails
// — a non-transactional write bolted onto a seat transaction, where a mail-shaped
// failure could take the seat with it.
//
// The `acceptances` subcollection is APPEND-ONLY and its ids are derived, so a
// created row is exactly one event, once, for every rail there is or will be.
// That makes this trigger the ONE writer of the two consent events, in the same
// shape `trackBookings` writes the booking ones.
//
// It is NOT part of the gate census: it puts nobody in a room, refuses nothing,
// and writes no ledger row. It reads one and describes it.
//
// ── WHAT IT WRITES, AND WHAT IT DELIBERATELY DOES NOT ───────────────────────
// The feed answers "what happened to this person". So: which document, which
// version, how it was signed and — on a revocation — the reason a manager typed,
// because that is the only part of a withdrawal that explains itself years later.
// The evidence itself (the IP, the user agent, the body hash, the frozen text)
// stays in the ledger and in the export; copying it into a browsable feed would
// duplicate a legal record into a place nothing verifies.

import { onDocumentCreated } from 'firebase-functions/v2/firestore'
import { DOCUMENTS_COLLECTION, type WaiverAcceptanceEvent } from '@linyup/shared'
import { to } from '../utils/async'
import { logActivity } from '../utils/users'

export const trackWaiverAcceptances = onDocumentCreated(
  `${DOCUMENTS_COLLECTION}/{documentId}/acceptances/{acceptanceId}`,
  async (event) => {
    const data = event.data?.data() as WaiverAcceptanceEvent | undefined
    if (!data) return
    const teamId = data.teamId
    // A row with no tenant cannot be filed anywhere; the ledger verifier is where
    // that is reported, not here.
    if (!teamId || !data.contactId) return

    const revoked = data.kind === 'revoked'
    const subject = (data.subject_name || '').trim() || 'This contact'
    const description = revoked
      ? `${subject}'s signature was withdrawn${data.revoked_reason ? ` — ${data.revoked_reason}` : ''}.`
      : `${subject} accepted a document (version ${data.version}).`

    const [err] = await to(
      logActivity(teamId, {
        event: revoked ? 'waiver_revoked' : 'waiver_accepted',
        created_at: data.created_at ?? data.accepted_at,
        parameters: {
          description,
          document_id: data.documentId,
          version: data.version,
          // WHERE the tick came from — a booking form, the signup wizard, Space,
          // the kiosk. A studio asking "when did they sign this" is usually
          // really asking "how".
          source: data.source,
          // A SELF-DECLARATION and never anything more; see
          // WaiverAcceptanceEvent.signer_role.
          signer_role: data.signer_role,
          signer_name: data.signer_name,
          ...(revoked ? { revoked_reason: data.revoked_reason ?? null } : {}),
        },
        refs: { contact: data.contactId, user: teamId },
      })
    )
    // Loud, and swallowed: a feed row that failed to write must never be able to
    // fail the write that produced the signature.
    if (err) {
      console.error(
        `[waivers] activity log for acceptance ${event.params.acceptanceId} failed:`,
        err
      )
    }
  }
)
