'use client'

import { useQuery } from '@tanstack/react-query'
import {
  collection, doc, getDoc, getDocs, query, where, orderBy,
  setDoc, updateDoc, deleteDoc, serverTimestamp, getCountFromServer,
} from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { DOCUMENTS_COLLECTION } from '@linyup/shared'
import type { StudioDocument, DocumentKind, DocumentSource } from '@linyup/shared'

// ─── Helpers ────────────────────────────────────────────────────────────────

export function slugify(input: string): string {
  const base = input
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)+/g, '')
    .slice(0, 48)
  const suffix = Math.random().toString(36).slice(2, 6)
  return `${base || 'document'}-${suffix}`
}

// Firestore rejects `undefined` field values; drop them before writing.
function stripUndefined<T extends Record<string, unknown>>(obj: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(obj).filter(([, v]) => v !== undefined),
  ) as Partial<T>
}

function documentsCol() {
  return collection(db, DOCUMENTS_COLLECTION)
}

// ─── Queries ────────────────────────────────────────────────────────────────

export function useDocuments(teamId: string | null) {
  return useQuery<StudioDocument[]>({
    queryKey: ['documents', teamId],
    enabled: !!teamId,
    queryFn: async () => {
      const snap = await getDocs(
        query(documentsCol(), where('teamId', '==', teamId), orderBy('created_at', 'desc')),
      )
      return snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<StudioDocument, 'id'>) }))
    },
  })
}

export function useDocument(id: string | null) {
  return useQuery<StudioDocument | null>({
    queryKey: ['document', id],
    enabled: !!id,
    queryFn: async () => {
      const d = await getDoc(doc(documentsCol(), id!))
      return d.exists() ? ({ id: d.id, ...(d.data() as Omit<StudioDocument, 'id'>) }) : null
    },
  })
}

// ─── Mutations (plain async helpers; call from useMutation in components) ──

export async function createDocument(input: {
  teamId: string
  userId: string
  title: string
  kind: DocumentKind
  source: DocumentSource
}): Promise<string> {
  const ref = doc(documentsCol())
  const payload = {
    teamId: input.teamId,
    title: input.title,
    slug: slugify(input.title),
    kind: input.kind,
    source: input.source,
    status: 'draft' as const,
    isPublic: false,
    order: 0,
    created_at: serverTimestamp(),
    updated_at: serverTimestamp(),
    createdBy: input.userId,
  }
  await setDoc(ref, payload)
  return ref.id
}

export async function updateDocument(
  id: string,
  patch: Partial<
    Pick<
      StudioDocument,
      | 'title'
      | 'kind'
      | 'source'
      | 'body'
      | 'externalUrl'
      | 'summary'
      | 'status'
      | 'isPublic'
      | 'order'
      | 'archived_at'
    >
  >,
): Promise<void> {
  await updateDoc(doc(documentsCol(), id), {
    ...stripUndefined(patch),
    updated_at: serverTimestamp(),
  })
}

export async function deleteDocument(id: string): Promise<void> {
  await deleteDoc(doc(documentsCol(), id))
}

// Live document count for the team — used to enforce the per-team cap even
// when the cached list query is stale.
export async function countDocuments(teamId: string): Promise<number> {
  const snap = await getCountFromServer(
    query(documentsCol(), where('teamId', '==', teamId)),
  )
  return snap.data().count
}
