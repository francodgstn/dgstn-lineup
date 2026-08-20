// ─── Moving items around a site menu tree ────────────────────────────────────
//
// Pure tree operations, shared by the editor and unit-tested without a DOM.
// They exist as functions rather than as `useState` callbacks because every one
// of them has an edge that is easy to get wrong in a component and invisible
// once it is: moving the first child up, indenting an item with no previous
// sibling, outdenting a root, indenting past the depth cap.
//
// EVERY OPERATION RETURNS A NEW TREE and never mutates the input, so the editor
// can keep the previous value for an undo or a dirty check.
//
// WHY BUTTONS AND NOT DRAG. Nesting by drag needs a drop-target model (before /
// after / inside), which is fiddly on a pointer and close to unusable on touch,
// and it still needs a keyboard path. Up/down/indent/outdent is four unambiguous
// verbs that work identically with a mouse, a finger and a screen reader — and
// they are exactly these four functions.

import { SITE_MENU_MAX_DEPTH, siteMenuDepth, type SiteMenuItem } from '../types/website'

type Path = number[]

/** Locate an item by id, as the index path to it. Null when absent. */
export function findSiteMenuPath(
  items: readonly SiteMenuItem[],
  id: string,
  prefix: Path = []
): Path | null {
  for (let i = 0; i < items.length; i++) {
    const here = [...prefix, i]
    if (items[i].id === id) return here
    const inChild = findSiteMenuPath(items[i].children ?? [], id, here)
    if (inChild) return inChild
  }
  return null
}

function childrenAt(items: SiteMenuItem[], path: Path): SiteMenuItem[] {
  let list = items
  for (const i of path) list = list[i].children ?? []
  return list
}

/** Rebuild `items` with `fn` applied to the sibling list at `parentPath`. */
function mapSiblings(
  items: readonly SiteMenuItem[],
  parentPath: Path,
  fn: (siblings: SiteMenuItem[]) => SiteMenuItem[]
): SiteMenuItem[] {
  if (parentPath.length === 0) return fn([...items])
  const [head, ...rest] = parentPath
  return items.map((item, i) =>
    i === head
      ? { ...item, children: mapSiblings(item.children ?? [], rest, fn) }
      : item
  )
}

/** Remove the item at `path` and return the tree plus the item taken out. */
function extract(
  items: readonly SiteMenuItem[],
  path: Path
): { tree: SiteMenuItem[]; item: SiteMenuItem } {
  const parentPath = path.slice(0, -1)
  const index = path[path.length - 1]
  const item = childrenAt([...items] as SiteMenuItem[], parentPath)[index]
  const tree = mapSiblings(items, parentPath, (siblings) => {
    siblings.splice(index, 1)
    return siblings
  })
  return { tree, item }
}

/** Swap an item with its previous (`-1`) or next (`+1`) SIBLING.
 *  Movement stays within one parent — crossing parents is what indent and
 *  outdent are for, and folding it in here would make a single press do two
 *  different things depending on position. */
export function moveSiteMenuItem(
  items: readonly SiteMenuItem[],
  id: string,
  direction: -1 | 1
): SiteMenuItem[] {
  const path = findSiteMenuPath(items, id)
  if (!path) return [...items]
  const parentPath = path.slice(0, -1)
  const index = path[path.length - 1]
  return mapSiblings(items, parentPath, (siblings) => {
    const target = index + direction
    if (target < 0 || target >= siblings.length) return siblings
    const [moved] = siblings.splice(index, 1)
    siblings.splice(target, 0, moved)
    return siblings
  })
}

/**
 * Make an item the LAST CHILD of the sibling above it.
 *
 * Refused when there is no previous sibling (nothing to nest under) or when the
 * result would breach SITE_MENU_MAX_DEPTH — counting the moved item's OWN
 * subtree, not just the item, or indenting a parent would smuggle its children
 * past the cap.
 */
export function indentSiteMenuItem(
  items: readonly SiteMenuItem[],
  id: string
): SiteMenuItem[] {
  const path = findSiteMenuPath(items, id)
  if (!path) return [...items]
  const index = path[path.length - 1]
  if (index === 0) return [...items]
  const parentPath = path.slice(0, -1)
  // The moved item lands one level deeper than it sits now, and brings its whole
  // subtree with it — so the check is against the SUBTREE's depth, not 1.
  const siblings = childrenAt([...items] as SiteMenuItem[], parentPath)
  if (path.length + siteMenuDepth([siblings[index]]) > SITE_MENU_MAX_DEPTH) return [...items]
  return mapSiblings(items, parentPath, (siblings) => {
    const [moved] = siblings.splice(index, 1)
    const host = siblings[index - 1]
    siblings[index - 1] = { ...host, children: [...(host.children ?? []), moved] }
    return siblings
  })
}

/** Lift an item out of its parent, landing directly AFTER that parent.
 *  A root item has nowhere to go and is returned unchanged. */
export function outdentSiteMenuItem(
  items: readonly SiteMenuItem[],
  id: string
): SiteMenuItem[] {
  const path = findSiteMenuPath(items, id)
  if (!path || path.length < 2) return [...items]
  const { tree, item } = extract(items, path)
  const grandparentPath = path.slice(0, -2)
  const parentIndex = path[path.length - 2]
  return mapSiblings(tree, grandparentPath, (siblings) => {
    siblings.splice(parentIndex + 1, 0, item)
    return siblings
  })
}

/** Drop an item and everything under it. */
export function removeSiteMenuItem(
  items: readonly SiteMenuItem[],
  id: string
): SiteMenuItem[] {
  const path = findSiteMenuPath(items, id)
  if (!path) return [...items]
  return extract(items, path).tree
}

/**
 * Reorder one SIBLING GROUP — the drag-and-drop path.
 *
 * `parentId` is null for the root group. Only the named group moves, which is
 * what makes drag safe on a tree: each sibling list is its own sortable
 * context, so a drag can never silently reparent an item. Changing which parent
 * something belongs to stays the job of indent and outdent, where it is one
 * explicit press with a visible result.
 */
export function reorderSiteMenuSiblings(
  items: readonly SiteMenuItem[],
  parentId: string | null,
  from: number,
  to: number
): SiteMenuItem[] {
  const parentPath = parentId ? findSiteMenuPath(items, parentId) : []
  if (!parentPath) return [...items]
  return mapSiblings(items, parentPath, (siblings) => {
    if (from < 0 || to < 0 || from >= siblings.length || to >= siblings.length) return siblings
    const [moved] = siblings.splice(from, 1)
    siblings.splice(to, 0, moved)
    return siblings
  })
}

/** Append a new root-level item. */
export function appendSiteMenuItem(
  items: readonly SiteMenuItem[],
  item: SiteMenuItem
): SiteMenuItem[] {
  return [...items, item]
}
