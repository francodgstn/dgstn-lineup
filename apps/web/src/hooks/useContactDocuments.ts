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
//
// ── THE TWO DIRECTIONS, AND WHY THEY SHARE THIS FILE ────────────────────────
// One person against every document (`useContactDocumentRows`, the tab) and one
// document against every person (`useConsentLedgers`, what the `consent` filter
// dimension reads) are the same fact asked from opposite ends. They share
// `useAskedDocuments` — the ONE derivation of "what does this studio ask for,
// and what is each document's supersession floor" — so the tab and the filter
// can never disagree about which documents exist or about what counts as valid.

import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { collection, documentId, getDocs, query, where } from 'firebase/firestore'
import { db } from '@/lib/firebase'
import {
  DOCUMENTS_COLLECTION,
  DOCUMENT_SIGNERS_SUBCOLLECTION,
  waiverAcceptanceState,
  type ConsentLedger,
  type DocumentKind,
  type WaiverAcceptanceState,
  type WaiverSignerState,
} from '@linyup/shared'
import { useDocuments, useSignupDocumentIds } from '@/plugins/documents/hooks'
import { useWaiverPolicy } from '@/hooks/useWaiverStates'

/** One document this studio asks for, from either surface. */
export interface AskedDocument {
  documentId: string
  title: string
  kind: DocumentKind | null
  atSignup: boolean
  /** In `waiver_policy/current` — the set that REFUSES, and the only set the
   *  member's Space can present and sign. */
  requiredBeforeBooking: boolean
  /** The floor a signature must meet. The policy entry's where there is one; the
   *  document's own otherwise (a `require_resign` publish moves it on every
   *  kind, so a signup-consent document has one too). */
  minValidVersion: number
}

/**
 * THE union — "what does this studio ask anybody to accept?" — extracted so the
 * contact tab, the contacts filter and the ask-to-sign dialogs all read one list.
 * Two surfaces, one shopping list; a second derivation of it is how the tab and
 * the filter would start disagreeing about which documents exist.
 */
export function useAskedDocuments(teamId: string | null): {
  documents: AskedDocument[]
  loading: boolean
} {
  const documentsQ = useDocuments(teamId)
  const signupQ = useSignupDocumentIds(teamId)
  const policyQ = useWaiverPolicy(teamId)

  const documents = useMemo(() => {
    const all = documentsQ.data ?? []
    const signupIds = signupQ.data ?? []
    const policy = policyQ.data ?? []
    const ids = [...new Set([...signupIds, ...policy.map((e) => e.documentId)])].sort()
    return ids.map<AskedDocument>((id) => {
      const entry = policy.find((e) => e.documentId === id) ?? null
      const document = all.find((d) => d.id === id) ?? null
      return {
        documentId: id,
        title: document?.title ?? entry?.title ?? id,
        kind: document?.kind ?? null,
        atSignup: signupIds.includes(id),
        requiredBeforeBooking: !!entry,
        minValidVersion: entry?.min_valid_version ?? document?.min_valid_version ?? 0,
      }
    })
  }, [documentsQ.data, signupQ.data, policyQ.data])

  return {
    documents,
    loading: documentsQ.isLoading || signupQ.isLoading || policyQ.isLoading,
  }
}

/**
 * The signature ledgers the `consent` filter dimension reads — ONE query per
 * DOCUMENT, never one per contact.
 *
 * "Has this contact signed X" is a row at `documents/{X}/signers/{contactId}`,
 * so asking it per contact would be a read per row of the contacts list. This
 * loads each named document's whole ledger once, and the same map then answers
 * every contact in the list, every dynamic-group count and every preview. The
 * cost is bounded by how many people signed that document — not by how many
 * contacts are being filtered.
 *
 * A document whose ledger has not arrived is simply ABSENT from the map, and
 * `matchesFilter` matches nobody for an absent document: an empty list is the
 * visible failure, a full one would be the silent wrong answer.
 */
export function useConsentLedgers(
  teamId: string | null,
  documentIds: string[]
): { ledgers: Record<string, ConsentLedger>; loading: boolean } {
  const { documents, loading: askedLoading } = useAskedDocuments(teamId)
  const key = documentIds.join(',')
  // THE FLOORS ARE PART OF THE KEY, not an afterthought read inside the query.
  // They arrive with the policy, which loads independently — a ledger cached
  // against a floor of 0 because the policy had not landed yet would report every
  // superseded signature as valid, which is the one direction this must never be
  // wrong in.
  const floors = documentIds
    .map((id) => documents.find((d) => d.documentId === id)?.minValidVersion ?? 0)
    .join(',')

  const q = useQuery<Record<string, ConsentLedger>>({
    queryKey: ['consent-ledgers', teamId, key, floors],
    enabled: !!teamId && documentIds.length > 0 && !askedLoading,
    staleTime: 30_000,
    queryFn: async () => {
      const out: Record<string, ConsentLedger> = {}
      for (const id of documentIds) {
        const snap = await getDocs(
          query(
            collection(db, DOCUMENTS_COLLECTION, id, DOCUMENT_SIGNERS_SUBCOLLECTION),
            where('teamId', '==', teamId!)
          )
        )
        const signers: ConsentLedger['signers'] = {}
        for (const d of snap.docs) {
          const row = d.data() as WaiverSignerState
          signers[d.id] = {
            accepted_version: row.accepted_version,
            accepted_at: row.accepted_at,
            valid_until: row.valid_until ?? null,
            status: row.status,
          }
        }
        out[id] = {
          minValidVersion:
            documents.find((doc) => doc.documentId === id)?.minValidVersion ?? 0,
          signers,
        }
      }
      return out
    },
  })

  return {
    ledgers: q.data ?? {},
    loading: documentIds.length > 0 && (askedLoading || q.isLoading),
  }
}

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
  // The union and the floors come from `useAskedDocuments` — ONE derivation, so
  // the tab, the contacts filter and the ask-to-sign dialogs can never disagree
  // about which documents exist or which version supersedes a signature.
  const { documents: asked, loading: askedLoading } = useAskedDocuments(teamId)

  const rowsQ = useQuery<ContactDocumentRow[]>({
    queryKey: [
      'contact-documents',
      teamId,
      contactId,
      asked.map((d) => `${d.documentId}:${d.minValidVersion}`).join(','),
    ],
    enabled: !!teamId && !!contactId && !askedLoading && asked.length > 0,
    staleTime: 30_000,
    queryFn: async () => {
      const nowMs = Date.now()
      const out: ContactDocumentRow[] = []
      for (const doc of asked) {
        const snap = await getDocs(
          query(
            collection(db, DOCUMENTS_COLLECTION, doc.documentId, DOCUMENT_SIGNERS_SUBCOLLECTION),
            where(documentId(), 'in', [contactId!])
          )
        )
        const signer = snap.docs[0] ? (snap.docs[0].data() as WaiverSignerState) : null
        out.push({
          documentId: doc.documentId,
          title: doc.title,
          kind: doc.kind,
          atSignup: doc.atSignup,
          requiredBeforeBooking: doc.requiredBeforeBooking,
          signer,
          state: waiverAcceptanceState(
            { min_valid_version: doc.minValidVersion },
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
    loading: askedLoading || rowsQ.isLoading,
    refetch: rowsQ.refetch,
  }
}
