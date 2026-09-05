'use client'

// Asset register — Firestore CRUD for what a studio OWNS.
//
// Its own plugin (`asset-register`), not a finance feature: the register is
// OPERATIONAL truth — what we own, how many, where, in what condition — and
// `docs/finance-accrual.md` already states the boundary it now follows,
// "operational plugins own operational truth; the finance plugin owns every
// ledger posting". Equipment was the one exception to that rule; it no longer
// is. Finance DEPENDS on this plugin (manifest `requires`) because the
// statement of assets is an accounting artifact and the future depreciation
// postings read these records — the same relationship finance already has with
// subscriptions, credit packs and gift cards.
//
// Client writes, gated by rules (owner + manager). No callables: nothing posts
// to the ledger from here. The accrual phase routes writes through callables
// before any posting depends on these fields.

import { useQuery } from '@tanstack/react-query'
import {
  Timestamp,
  collection,
  deleteDoc,
  doc,
  getDocs,
  serverTimestamp,
  setDoc,
} from 'firebase/firestore'
import { db } from '@/lib/firebase'
import {
  ASSET_REGISTER_SUBCOLLECTION,
  TEAMS_COLLECTION,
  type Asset,
  type AssetCategory,
  type AssetDisposalKind,
} from '@linyup/shared'


export function useAssets(teamId: string | null) {
  return useQuery<Asset[]>({
    queryKey: ['asset-register', teamId],
    enabled: !!teamId,
    queryFn: async () => {
      const snap = await getDocs(
        collection(db, TEAMS_COLLECTION, teamId!, ASSET_REGISTER_SUBCOLLECTION)
      )
      return snap.docs
        .map((d) => ({ ...(d.data() as Asset), id: d.id }))
        .sort(
          (a, b) =>
            // Active first, then newest acquisitions first.
            (a.status === 'disposed' ? 1 : 0) - (b.status === 'disposed' ? 1 : 0) ||
            (b.acquired_at?.toMillis?.() ?? 0) - (a.acquired_at?.toMillis?.() ?? 0)
        )
    },
  })
}

export interface AssetDraft {
  name: string
  category: AssetCategory
  acquired_at_ms: number
  /** Row TOTAL, minor units — never a unit price (see Asset.quantity). */
  cost_minor: number
  /** Units this row covers; 1 for a single item. */
  quantity: number
  useful_life_months: number
  location: string | null
  note: string | null
  photoUrl: string | null
}

export async function saveAsset(
  teamId: string,
  draft: AssetDraft,
  id: string | null,
  uid: string
): Promise<string> {
  const col = collection(db, TEAMS_COLLECTION, teamId, ASSET_REGISTER_SUBCOLLECTION)
  const ref = id ? doc(col, id) : doc(col)
  await setDoc(
    ref,
    {
      id: ref.id,
      teamId,
      name: draft.name.trim(),
      category: draft.category,
      acquired_at: Timestamp.fromMillis(draft.acquired_at_ms),
      cost_minor: draft.cost_minor,
      quantity: draft.quantity,
      useful_life_months: draft.useful_life_months,
      location: draft.location,
      note: draft.note,
      photoUrl: draft.photoUrl,
      ...(id ? {} : { status: 'active', created_at: serverTimestamp(), created_by: uid }),
      updated_at: serverTimestamp(),
    },
    { merge: true }
  )
  return ref.id
}

export async function disposeAsset(
  teamId: string,
  id: string,
  disposal: { kind: AssetDisposalKind; disposedAtMs: number; proceedsMinor: number | null }
): Promise<void> {
  await setDoc(
    doc(db, TEAMS_COLLECTION, teamId, ASSET_REGISTER_SUBCOLLECTION, id),
    {
      status: 'disposed',
      disposed_at: Timestamp.fromMillis(disposal.disposedAtMs),
      disposal_kind: disposal.kind,
      disposal_proceeds_minor: disposal.kind === 'sold' ? disposal.proceedsMinor : null,
      updated_at: serverTimestamp(),
    },
    { merge: true }
  )
}

export async function deleteAsset(teamId: string, id: string): Promise<void> {
  await deleteDoc(doc(db, TEAMS_COLLECTION, teamId, ASSET_REGISTER_SUBCOLLECTION, id))
}
