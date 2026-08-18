'use client'

// The roster's answer to "has this person signed?", for the session detail page
// and the printed day sheet.
//
// ── WHY IT IS A CLIENT READ AND NOT A CALLABLE ──────────────────────────────
// `firestore.rules` gives a team member `get`/`list` on
// `teams/{teamId}/waiver_policy/current` and on `documents/{d}/signers/{id}`,
// with the reasoning stated on both blocks. The no-client-reads discipline
// covers the PUBLIC surfaces, where the reader is a visitor with no membership
// and every answer has to come from a callable — a coach reading their own
// studio's roster is the case the rules were written to allow.
//
// ── THE ONE TRAP, AND IT IS NOT OBVIOUS ─────────────────────────────────────
// A signer row that does not exist — which is the COMMON case, because most
// people have never signed anything — cannot be read with `getDoc`. On a missing
// document `resource` is null in the rules, `resource.data.teamId` errors, and
// the read comes back PERMISSION DENIED rather than "not found". So this hook
// LISTS by document id (`where(documentId(), 'in', …)`), which returns only the
// rows that exist and evaluates the rule against each of them. That form needs
// no index — it is a key-range query — which is why no entry is added to
// firestore.index.json for it.
//
// ── THE COST, STATED ────────────────────────────────────────────────────────
// One policy read, then one query per required waiver per chunk of 30 contacts.
// A roster of twenty people on a team with one waiver is two reads plus twenty
// documents. It is deliberately NOT the shape `rosterContactsQ` takes on the
// session page (fetch the whole active contact list): that is enabled only for
// gated activities, and a waiver chip is wanted on every session.

import { useQuery } from '@tanstack/react-query'
import { collection, doc, documentId, getDoc, getDocs, query, where } from 'firebase/firestore'
import { db } from '@/lib/firebase'
import {
  DOCUMENTS_COLLECTION,
  DOCUMENT_SIGNERS_SUBCOLLECTION,
  TEAMS_COLLECTION,
  WAIVER_POLICY_DOC_ID,
  WAIVER_POLICY_SUBCOLLECTION,
  waiverAcceptanceState,
  waiverAppliesToActivity,
  waiverDoorCheckFor,
  type RequiredWaiverEntry,
  type WaiverAcceptanceState,
  type WaiverDoorCheck,
  type WaiverSignerState,
} from '@linyup/shared'

/** Firestore's `in` operator caps at 30 values. */
const ID_CHUNK = 30

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}

/** The team's required waivers. Cached separately from the signer rows so a page
 *  with several rosters pays for it once. */
export function useWaiverPolicy(teamId: string | null) {
  return useQuery<RequiredWaiverEntry[]>({
    queryKey: ['waiver-policy', teamId],
    enabled: !!teamId,
    staleTime: 60_000,
    queryFn: async () => {
      const snap = await getDoc(
        doc(db, TEAMS_COLLECTION, teamId!, WAIVER_POLICY_SUBCOLLECTION, WAIVER_POLICY_DOC_ID)
      )
      const raw = snap.data()?.required
      return Array.isArray(raw) ? (raw as RequiredWaiverEntry[]) : []
    },
  })
}

/**
 * The WORST state across every waiver that applies, per contact.
 *
 * `undefined` means "we could not tell" and must render NOTHING — the deliberate
 * `=== false` shape the subscription badge on the same page already uses. A
 * roster is read by a coach at a door, and a chip that appears because a read
 * failed is an accusation about somebody standing in front of them.
 */
export type RosterWaiverState = WaiverAcceptanceState | undefined

/**
 * THE DOOR CHECK. The type and the rule both live in `@linyup/shared`
 * (`waiverDoorCheckFor`), because the printed manifest answers the same question
 * from a different source — the booking's own stamp rather than the live signer
 * row — and two copies of one sentence is how a desk comes to be told two
 * different things about one person.
 *
 * What is LOCAL to this hook is only the aggregation across several waivers,
 * below.
 */
export type { WaiverDoorCheck }

export interface WaiverRosterAnswer {
  /** Does this team require anything at all? False ⇒ nothing is read and no chip
   *  is ever rendered. */
  active: boolean
  /** contactId → worst applicable state. Missing key ⇒ unknown ⇒ render nothing. */
  states: Map<string, WaiverAcceptanceState>
  /** contactId → the door check, when there is one. Missing key ⇒ nothing to
   *  check ⇒ render nothing. */
  checks: Map<string, WaiverDoorCheck>
  loading: boolean
}

/** The order the chip cares about: anything worse than `valid` is worth a chip,
 *  and a revocation must never be reported as merely stale. */
const SEVERITY: Record<WaiverAcceptanceState, number> = {
  valid: 0,
  none: 2,
  expired: 2,
  superseded: 2,
  revoked: 3,
}

// THE PER-CONTACT BREAKDOWN LIVES ELSEWHERE, DELIBERATELY.
// The roster collapses to the WORST state because a chip has room for one word.
// The contact record is the opposite case, and it is also a WIDER question: it
// asks about every document the studio asks for — the signup-consent list as
// well as the waiver policy — so keying it off this policy alone answered the
// wrong question and rendered nothing for a team that requires nothing. It is
// `useContactDocumentRows` in `hooks/useContactDocuments.ts`, which carries the
// same list-don't-get form as the queries below and says why.

export function useWaiverRoster(
  teamId: string | null,
  contactIds: string[],
  /** The activity these people are booked onto, for an `activities`-scoped
   *  waiver. Null on the day sheet, where several sessions share one lookup —
   *  see `useWaiverRosterMulti`. */
  activityId: string | null
): WaiverRosterAnswer {
  const policyQ = useWaiverPolicy(teamId)
  const policy = policyQ.data ?? []
  const applicable = policy.filter((e) => waiverAppliesToActivity(e.scope, activityId))
  const ids = [...new Set(contactIds.filter(Boolean))].sort()

  const signersQ = useQuery<{
    worst: Map<string, WaiverAcceptanceState>
    checks: Map<string, WaiverDoorCheck>
  }>({
    queryKey: ['waiver-signers', teamId, applicable.map((e) => e.documentId).join(','), ids.join(',')],
    enabled: !!teamId && applicable.length > 0 && ids.length > 0,
    staleTime: 30_000,
    queryFn: async () => {
      const nowMs = Date.now()
      const worst = new Map<string, WaiverAcceptanceState>()
      const checks = new Map<string, WaiverDoorCheck>()
      for (const entry of applicable) {
        const rows = new Map<string, WaiverSignerState>()
        for (const part of chunk(ids, ID_CHUNK)) {
          const snap = await getDocs(
            query(
              collection(db, DOCUMENTS_COLLECTION, entry.documentId, DOCUMENT_SIGNERS_SUBCOLLECTION),
              where(documentId(), 'in', part)
            )
          )
          for (const d of snap.docs) rows.set(d.id, d.data() as WaiverSignerState)
        }
        for (const contactId of ids) {
          const row = rows.get(contactId) ?? null
          const state = waiverAcceptanceState(
            { min_valid_version: entry.min_valid_version },
            row
              ? {
                  accepted_version: row.accepted_version,
                  accepted_at: row.accepted_at,
                  valid_until: row.valid_until ?? null,
                  status: row.status,
                }
              : null,
            nowMs
          )
          const current = worst.get(contactId)
          if (!current || SEVERITY[state] > SEVERITY[current]) worst.set(contactId, state)

          // THE DOOR CHECK. Read off the row that EXISTS, never inferred from
          // its absence: a person with no signature at all already gets the
          // state chip above, and adding a second one would say the same thing
          // twice. The per-waiver rule is `waiverDoorCheckFor` in
          // @linyup/shared; what happens here is only the aggregation ACROSS
          // waivers, where a declared guardian on any one of them outranks a
          // plain check on another.
          if (!row) continue
          const check = waiverDoorCheckFor({
            signerRole: row.signer_role,
            mayIncludeMinors: entry.mayIncludeMinors,
          })
          if (check && checks.get(contactId) !== 'guardian') checks.set(contactId, check)
        }
      }
      return { worst, checks }
    },
  })

  return {
    active: applicable.length > 0,
    states: signersQ.data?.worst ?? new Map(),
    checks: signersQ.data?.checks ?? new Map(),
    loading: policyQ.isLoading || signersQ.isLoading,
  }
}
