'use client'

// Contact Groups plugin — data hooks.
//
// Groups live in teams/{teamId}/contact_groups; nesting via parent_id.
// Membership has exactly two disjoint sources:
//   • MANUAL  — the group_ids array on each contact.
//   • DYNAMIC — the group's saved `rule`, evaluated lazily wherever it's needed
//     and never materialized. See packages/shared/src/utils/contactFilter.ts.
// A group is one or the other, which is what keeps "can I pin a manual member
// into a dynamic group?" unaskable rather than merely undefined.
//
// The tree helpers now live in @linyup/shared (utils/contactGroups.ts) so the
// automation engine expands descendants the same way this UI does; they are
// re-exported here so existing imports keep working.

import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useMemo } from 'react'
import {
  collection, doc, query, orderBy, getDocs, addDoc, updateDoc,
  where, writeBatch, arrayRemove, arrayUnion, serverTimestamp, deleteField,
} from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { useAuth } from '@/contexts/AuthContext'
import {
  TEAMS_COLLECTION, CONTACT_GROUPS_SUBCOLLECTION, CONTACTS_COLLECTION,
  consentDocumentIds, contactMatchesGroup, membersOfGroup, isDynamicGroup,
  expandGroupSelection, wouldCreateCycle,
} from '@linyup/shared'
import { useConsentLedgers } from '@/hooks/useContactDocuments'
import type {
  ContactGroup, ContactFilter, ContactFilterContext, ContactFilterSubject,
} from '@linyup/shared'

export {
  buildGroupTree, flattenGroupTree, groupWithDescendantIds, expandGroupSelection,
  isDynamicGroup, wouldCreateCycle, contactMatchesGroup, membersOfGroup, groupsForContact,
} from '@linyup/shared'
export type { GroupTreeNode } from '@linyup/shared'

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

/**
 * The evaluation context every surface must share. A dynamic rule can filter on
 * engagement, which is derived from the TEAM's thresholds — so a page that built
 * its own context without them would silently count a group differently from the
 * contacts list. One hook, one answer.
 *
 * It also loads the CONSENT LEDGERS every rule here asks about, plus any the
 * caller names (`extraFilters` — the contacts page's own filter). One query per
 * referenced document, never one per contact; a rule that names no document
 * costs nothing. Without this a consent-based dynamic group would count zero
 * members everywhere but the page that happened to load the ledger itself — the
 * dimension fails CLOSED, so the symptom is a silent empty set.
 */
export function useContactFilterContext(
  groups: ContactGroup[],
  extraFilters: (Partial<ContactFilter> | null | undefined)[] = [],
): ContactFilterContext {
  const { team, currentTeamId } = useAuth()
  const thresholds = team?.engagement_thresholds
  const documentIds = useMemo(
    () => consentDocumentIds([...groups.map((g) => g.rule), ...extraFilters]),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [groups, JSON.stringify(extraFilters.map((f) => f?.consent ?? null))],
  )
  const { ledgers } = useConsentLedgers(currentTeamId, documentIds)
  return useMemo(
    () => ({ groups, engagementThresholds: thresholds, consent: ledgers }),
    [groups, thresholds, ledgers],
  )
}

/**
 * Members of a group out of an already-loaded contact list — manual membership
 * or a dynamic rule, resolved the same way for both so callers never branch.
 *
 * `includeSubgroups` unions in every descendant group's members, matching what
 * selecting a parent does in the contacts filter.
 */
export function useGroupMembers<T extends ContactFilterSubject>(
  contacts: T[],
  group: ContactGroup | null,
  allGroups: ContactGroup[],
  ctx: ContactFilterContext,
  includeSubgroups = false,
): T[] {
  return useMemo(() => {
    if (!group) return []
    if (!includeSubgroups) return membersOfGroup(contacts, group, ctx)
    const ids = expandGroupSelection(allGroups, [group.id])
    const targets = allGroups.filter((g) => ids.has(g.id))
    return contacts.filter((c) => targets.some((g) => contactMatchesGroup(c, g, ctx)))
  }, [contacts, group, allGroups, ctx, includeSubgroups])
}

/** Direct + total (subgroups included) member counts for every group. */
export function useGroupCounts<T extends ContactFilterSubject>(
  contacts: T[],
  groups: ContactGroup[],
  ctx: ContactFilterContext,
): { direct: Record<string, number>; total: Record<string, number> } {
  return useMemo(() => {
    const direct: Record<string, number> = {}
    for (const g of groups) direct[g.id] = membersOfGroup(contacts, g, ctx).length
    const total: Record<string, number> = {}
    for (const g of groups) {
      const ids = expandGroupSelection(groups, [g.id])
      const targets = groups.filter((x) => ids.has(x.id))
      total[g.id] = contacts.filter((c) => targets.some((x) => contactMatchesGroup(c, x, ctx))).length
    }
    return { direct, total }
  }, [contacts, groups, ctx])
}

// ─── mutations ────────────────────────────────────────────────────────────────

export async function createGroup(
  teamId: string,
  userId: string,
  data: { name: string; parent_id: string | null; color?: string; rule?: ContactFilter },
): Promise<string> {
  const ref = await addDoc(collection(db, TEAMS_COLLECTION, teamId, CONTACT_GROUPS_SUBCOLLECTION), {
    name: data.name,
    parent_id: data.parent_id,
    color: data.color ?? null,
    ...(data.rule ? { rule: data.rule } : {}),
    created_at: serverTimestamp(),
    created_by: userId,
  })
  return ref.id
}

/**
 * Create a group from a filter. 'snapshot' writes today's matches into
 * group_ids; 'dynamic' stores the filter and writes no membership at all.
 */
export async function createGroupFromFilter(
  teamId: string,
  userId: string,
  args: {
    name: string
    parentId: string | null
    mode: 'snapshot' | 'dynamic'
    filter: ContactFilter
    memberIds: string[]
  },
): Promise<string> {
  const groupId = await createGroup(teamId, userId, {
    name: args.name,
    parent_id: args.parentId,
    rule: args.mode === 'dynamic' ? args.filter : undefined,
  })
  if (args.mode === 'snapshot' && args.memberIds.length) {
    // Firestore caps a batch at 500 writes.
    for (let i = 0; i < args.memberIds.length; i += 450) {
      const batch = writeBatch(db)
      for (const id of args.memberIds.slice(i, i + 450)) {
        batch.update(doc(db, CONTACTS_COLLECTION, id), { group_ids: arrayUnion(groupId) })
      }
      await batch.commit()
    }
  }
  return groupId
}

export async function updateGroup(
  teamId: string,
  groupId: string,
  data: Partial<Pick<ContactGroup, 'name' | 'color' | 'parent_id'>>,
  allGroups: ContactGroup[] = [],
): Promise<void> {
  // Re-parenting is the one way the UI can produce a cycle; the tree builder
  // defends against one at render time, but it should never be written.
  if (data.parent_id !== undefined && allGroups.length
      && wouldCreateCycle(allGroups, groupId, data.parent_id ?? null)) {
    throw new Error('cycle')
  }
  await updateDoc(doc(db, TEAMS_COLLECTION, teamId, CONTACT_GROUPS_SUBCOLLECTION, groupId), {
    ...data,
    updated_at: serverTimestamp(),
  })
}

/** Set or clear a group's dynamic rule. Clearing converts it back to manual. */
export async function setGroupRule(
  teamId: string,
  groupId: string,
  rule: ContactFilter | null,
): Promise<void> {
  await updateDoc(doc(db, TEAMS_COLLECTION, teamId, CONTACT_GROUPS_SUBCOLLECTION, groupId), {
    rule: rule ?? deleteField(),
    updated_at: serverTimestamp(),
  })
}

/**
 * Freeze a dynamic group: copy its current members into group_ids and drop the
 * rule, so membership stops updating.
 *
 * The two writes go in ONE batch whenever they fit (Firestore commits a batch
 * atomically), because a half-applied conversion is the one state the model
 * forbids — a group carrying both a rule and stored membership. Above the batch
 * limit atomicity isn't available, so the rule is cleared LAST: an interrupted
 * run then leaves a still-correct dynamic group with some harmless, ignored
 * group_ids, rather than a manual group missing most of its members.
 */
export async function freezeGroupToManual(
  teamId: string,
  groupId: string,
  memberIds: string[],
): Promise<void> {
  const groupRef = doc(db, TEAMS_COLLECTION, teamId, CONTACT_GROUPS_SUBCOLLECTION, groupId)
  const clearRule = { rule: deleteField(), updated_at: serverTimestamp() }

  if (memberIds.length < 450) {
    const batch = writeBatch(db)
    for (const id of memberIds) {
      batch.update(doc(db, CONTACTS_COLLECTION, id), { group_ids: arrayUnion(groupId) })
    }
    batch.update(groupRef, clearRule)
    await batch.commit()
    return
  }

  for (let i = 0; i < memberIds.length; i += 450) {
    const batch = writeBatch(db)
    for (const id of memberIds.slice(i, i + 450)) {
      batch.update(doc(db, CONTACTS_COLLECTION, id), { group_ids: arrayUnion(groupId) })
    }
    await batch.commit()
  }
  await updateDoc(groupRef, clearRule)
}

/**
 * Delete a group: direct subgroups are re-parented to the deleted group's
 * parent (they move up one level) and, for a MANUAL group, the id is removed
 * from every contact's group_ids. A dynamic group stores no membership, so
 * there is nothing to strip — its delete is a single doc write.
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

  if (!isDynamicGroup(group)) {
    const memberSnap = await getDocs(query(
      collection(db, CONTACTS_COLLECTION),
      where('teamId', '==', teamId),
      where('group_ids', 'array-contains', group.id),
    ))
    for (const d of memberSnap.docs) {
      batch.update(d.ref, { group_ids: arrayRemove(group.id) })
    }
  }

  batch.delete(doc(db, TEAMS_COLLECTION, teamId, CONTACT_GROUPS_SUBCOLLECTION, group.id))
  await batch.commit()
}
