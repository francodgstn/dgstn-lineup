'use client'

// Contact Groups plugin — data hooks and tree helpers.
// Groups live in teams/{teamId}/contact_groups; nesting via parent_id.
// Membership is a group_ids array on each contact (small clubs → the full
// contact list is already loaded client-side, so filtering stays local).

import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  collection, doc, query, orderBy, getDocs, addDoc, updateDoc, deleteDoc,
  where, writeBatch, arrayRemove, serverTimestamp,
} from 'firebase/firestore'
import { db } from '@/lib/firebase'
import {
  TEAMS_COLLECTION, CONTACT_GROUPS_SUBCOLLECTION, CONTACTS_COLLECTION,
} from '@linyup/shared'
import type { ContactGroup } from '@linyup/shared'

// ─── data ─────────────────────────────────────────────────────────────────────

export function useContactGroups(teamId: string | null) {
  return useQuery<ContactGroup[]>({
    queryKey: ['contact-groups', teamId],
    enabled: !!teamId,
    queryFn: async () => {
      if (!teamId) return []
      const q = query(
        collection(db, TEAMS_COLLECTION, teamId, CONTACT_GROUPS_SUBCOLLECTION),
        orderBy('name'),
      )
      const snap = await getDocs(q)
      return snap.docs.map((d) => ({ ...d.data(), id: d.id }) as ContactGroup)
    },
  })
}

export function useInvalidateContactGroups(teamId: string | null) {
  const qc = useQueryClient()
  return () => qc.invalidateQueries({ queryKey: ['contact-groups', teamId] })
}

// ─── tree helpers ─────────────────────────────────────────────────────────────

export interface GroupTreeNode {
  group: ContactGroup
  children: GroupTreeNode[]
  depth: number
}

export function buildGroupTree(groups: ContactGroup[]): GroupTreeNode[] {
  const byParent = new Map<string | null, ContactGroup[]>()
  const ids = new Set(groups.map((g) => g.id))
  for (const g of groups) {
    // Orphans (parent deleted out-of-band) surface at the top level
    const parent = g.parent_id && ids.has(g.parent_id) ? g.parent_id : null
    const list = byParent.get(parent) ?? []
    list.push(g)
    byParent.set(parent, list)
  }
  const build = (parent: string | null, depth: number, seen: Set<string>): GroupTreeNode[] =>
    (byParent.get(parent) ?? [])
      .filter((g) => !seen.has(g.id)) // cycle guard
      .map((g) => {
        const nextSeen = new Set(seen).add(g.id)
        return { group: g, depth, children: build(g.id, depth + 1, nextSeen) }
      })
  return build(null, 0, new Set())
}

/** Depth-first flat list with depth — for indented dropdowns and filter lists. */
export function flattenGroupTree(groups: ContactGroup[]): GroupTreeNode[] {
  const out: GroupTreeNode[] = []
  const walk = (nodes: GroupTreeNode[]) => {
    for (const n of nodes) { out.push(n); walk(n.children) }
  }
  walk(buildGroupTree(groups))
  return out
}

/** IDs of a group and all its descendants — selecting a parent group includes subgroups. */
export function groupWithDescendantIds(groups: ContactGroup[], groupId: string): Set<string> {
  const result = new Set<string>([groupId])
  let grew = true
  while (grew) {
    grew = false
    for (const g of groups) {
      if (g.parent_id && result.has(g.parent_id) && !result.has(g.id)) {
        result.add(g.id)
        grew = true
      }
    }
  }
  return result
}

export function expandGroupSelection(groups: ContactGroup[], selectedIds: string[]): Set<string> {
  const result = new Set<string>()
  for (const id of selectedIds) {
    for (const gid of groupWithDescendantIds(groups, id)) result.add(gid)
  }
  return result
}

// ─── mutations ────────────────────────────────────────────────────────────────

export async function createGroup(
  teamId: string,
  userId: string,
  data: { name: string; parent_id: string | null; color?: string },
): Promise<string> {
  const ref = await addDoc(collection(db, TEAMS_COLLECTION, teamId, CONTACT_GROUPS_SUBCOLLECTION), {
    name: data.name,
    parent_id: data.parent_id,
    color: data.color ?? null,
    created_at: serverTimestamp(),
    created_by: userId,
  })
  return ref.id
}

export async function updateGroup(
  teamId: string,
  groupId: string,
  data: Partial<Pick<ContactGroup, 'name' | 'color' | 'parent_id'>>,
): Promise<void> {
  await updateDoc(doc(db, TEAMS_COLLECTION, teamId, CONTACT_GROUPS_SUBCOLLECTION, groupId), {
    ...data,
    updated_at: serverTimestamp(),
  })
}

/**
 * Delete a group: direct subgroups are re-parented to the deleted group's
 * parent (they move up one level) and the group is removed from every
 * contact's group_ids. Membership in subgroups is untouched.
 */
export async function deleteGroup(
  teamId: string,
  group: ContactGroup,
  allGroups: ContactGroup[],
): Promise<void> {
  const batch = writeBatch(db)

  for (const child of allGroups.filter((g) => g.parent_id === group.id)) {
    batch.update(doc(db, TEAMS_COLLECTION, teamId, CONTACT_GROUPS_SUBCOLLECTION, child.id), {
      parent_id: group.parent_id ?? null,
      updated_at: serverTimestamp(),
    })
  }

  const memberSnap = await getDocs(query(
    collection(db, CONTACTS_COLLECTION),
    where('teamId', '==', teamId),
    where('group_ids', 'array-contains', group.id),
  ))
  for (const d of memberSnap.docs) {
    batch.update(d.ref, { group_ids: arrayRemove(group.id) })
  }

  batch.delete(doc(db, TEAMS_COLLECTION, teamId, CONTACT_GROUPS_SUBCOLLECTION, group.id))
  await batch.commit()
}
