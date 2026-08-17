'use client'

// "What has this person been asked to accept, and did they?" — the person-shaped
// half of consent, for the contact record's Documents tab.
//
// ── WHY IT IS A UNION AND NOT THE WAIVER POLICY ─────────────────────────────
// A studio asks for documents on TWO surfaces and they are not peers:
//
//   • Shown at signup (`settings/documents.signupDocumentIds`) RECORDS a tick
//     and never refuses anyone — `packages/functions/src/waivers/signup.ts`
//     says it outright: "Signup is not attendance."
//   • Required before booking (`waiver_policy/current`) REFUSES: every rail in
//     `waivers/gate.ts`'s census turns a person away without it.
//
// Both write the SAME ledger — `recordSignupConsent` calls the same
// `recordWaiverEvents` every booking rail does — so a signup acceptance has
// always existed as a real signer row. It was simply never listed anywhere: the
// only reader keyed off the waiver policy, so a team that requires nothing
// showed nothing, and a signup-only document showed nothing even when it did.
// This hook reads the UNION of the two sets, which is the honest answer to the
// question the tab asks.
//
// ── THE SIGNER-ROW TRAP ─────────────────────────────────────────────────────
// A signer row that does not exist — the COMMON case — cannot be read with
// `getDoc`: on a missing document `resource` is null in the rules,
// `resource.data.teamId` errors, and the read comes back PERMISSION DENIED
// rather than not-found. So this LISTS by document id (a key-range query, no
// index needed), exactly as `useWaiverStates` does. The full reasoning lives in
// that module's header; do not switch either of them to `getDoc`.

import { useQuery } from '@tanstack/react-query'
import { collection, documentId, getDocs, query, where } from 'firebase/firestore'
import { db } from '@/lib/firebase'
import {
  DOCUMENTS_COLLECTION,
  DOCUMENT_SIGNERS_SUBCOLLECTION,
  waiverAcceptanceState,
  type DocumentKind,
  type WaiverAcceptanceState,
  type WaiverSignerState,
} from '@linyup/shared'
import { useDocuments, useSignupDocumentIds } from '@/plugins/documents/hooks'
import { useWaiverPolicy } from '@/hooks/useWaiverStates'

export interface ContactDocumentRow {
  documentId: string
  title: string
  kind: DocumentKind | null
  /** In the team's signup-consent list. RECORDS; never refuses. */
  atSignup: boolean
  /** In the team's waiver policy. REFUSES every applicable booking. */
  requiredBeforeBooking: boolean
  signer: WaiverSignerState | null
  state: WaiverAcceptanceState
}

/**
 * Every document this studio asks for — at signup, before booking, or both —
 * with this person's state on each.
 *
 * `rows` is empty only when the studio asks for nothing at all, which the caller
 * renders as an empty state rather than as nothing: a screen that disappears
 * teaches a manager the feature is broken, and this one has a remedy to point at.
 */
export function useContactDocumentRows(teamId: string | null, contactId: string | null) {
  const documentsQ = useDocuments(teamId)
  const signupQ = useSignupDocumentIds(teamId)
  const policyQ = useWaiverPolicy(teamId)

  const documents = documentsQ.data ?? []
  const signupIds = signupQ.data ?? []
  const policy = policyQ.data ?? []

  // Stable, deduplicated, signup-first so the key is order-independent.
  const asked = [...new Set([...signupIds, ...policy.map((e) => e.documentId)])].sort()

  const rowsQ = useQuery<ContactDocumentRow[]>({
    queryKey: ['contact-documents', teamId, contactId, asked.join(',')],
    enabled: !!teamId && !!contactId && asked.length > 0,
    staleTime: 30_000,
    queryFn: async () => {
      const nowMs = Date.now()
      const out: ContactDocumentRow[] = []
      for (const id of asked) {
        const entry = policy.find((e) => e.documentId === id) ?? null
        const document = documents.find((d) => d.id === id) ?? null
        const snap = await getDocs(
          query(
            collection(db, DOCUMENTS_COLLECTION, id, DOCUMENT_SIGNERS_SUBCOLLECTION),
            where(documentId(), 'in', [contactId!])
          )
        )
        const signer = snap.docs[0] ? (snap.docs[0].data() as WaiverSignerState) : null
        // The policy entry's floor wins where there is one — it is what the gate
        // itself compares against. A signup-only document has no entry, so its
        // own `min_valid_version` (moved by a `require_resign` publish, on every
        // kind) is the floor.
        const minValidVersion = entry?.min_valid_version ?? document?.min_valid_version ?? 0
        out.push({
          documentId: id,
          title: document?.title ?? entry?.title ?? id,
          kind: document?.kind ?? null,
          atSignup: signupIds.includes(id),
          requiredBeforeBooking: !!entry,
          signer,
          state: waiverAcceptanceState(
            { min_valid_version: minValidVersion },
            signer
              ? {
                  accepted_version: signer.accepted_version,
                  accepted_at: signer.accepted_at,
                  valid_until: signer.valid_until ?? null,
                  status: signer.status,
                }
              : null,
            nowMs
          ),
        })
      }
      return out
    },
  })

  return {
    rows: rowsQ.data ?? [],
    /** Does the studio ask for anything at all? Drives the empty state, never a
     *  `return null`. */
    asksForAnything: asked.length > 0,
    loading:
      documentsQ.isLoading || signupQ.isLoading || policyQ.isLoading || rowsQ.isLoading,
    refetch: rowsQ.refetch,
  }
}
