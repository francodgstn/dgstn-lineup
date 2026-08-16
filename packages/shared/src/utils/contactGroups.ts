// Contact Groups — pure tree helpers, shared by web and functions.
//
// Groups live in teams/{teamId}/contact_groups; nesting is a single self-
// referential `parent_id`. These helpers were previously duplicated in the web
// plugin only, which is why the automations builder rendered a FLAT group list
// and its add_to_group/remove_from_group actions never expanded descendants
// while the contacts filter did. One implementation, one meaning of "in".

import type { ContactGroup } from '../types/contact'

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

/** IDs of a group and all its descendants — selecting a parent includes subgroups. */
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

/** A dynamic group derives its members from a saved filter; it stores no membership. */
export function isDynamicGroup(group: Pick<ContactGroup, 'rule'> | null | undefined): boolean {
  return !!group?.rule
}

/**
 * Would setting `parentId` as `groupId`'s parent create a cycle?
 * Walks up from the candidate parent; true if we reach groupId (or run past the
 * tree's own size, which means the existing chain is already cyclic).
 */
export function wouldCreateCycle(
  groups: ContactGroup[],
  groupId: string,
  parentId: string | null,
): boolean {
  if (!parentId) return false
  if (parentId === groupId) return true
  const byId = new Map(groups.map((g) => [g.id, g]))
  const seen = new Set<string>([groupId])
  let cursor: string | null = parentId
  while (cursor) {
    if (seen.has(cursor)) return true
    seen.add(cursor)
    cursor = byId.get(cursor)?.parent_id ?? null
  }
  return false
}
