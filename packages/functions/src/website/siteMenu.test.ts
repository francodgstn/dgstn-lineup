import assert from 'node:assert/strict'
import {
  SITE_MENU_MAX_DEPTH,
  appendSiteMenuItem,
  deriveSiteMenu,
  findSiteMenuPath,
  flattenSiteMenu,
  indentSiteMenuItem,
  moveSiteMenuItem,
  outdentSiteMenuItem,
  removeSiteMenuItem,
  reorderSiteMenuSiblings,
  siteMenuDepth,
  type SiteMenuItem,
} from '@linyup/shared'

// The four verbs of the menu editor, and the edges each one has.
//
// These are pure tree operations pulled OUT of the component on purpose: every
// failure below is one a reader would have to reproduce by clicking, and three
// of them (indenting a first child, outdenting a root, indenting a parent whose
// subtree would breach the cap) produce a tree that looks fine until it is
// published.

const item = (id: string, children?: SiteMenuItem[]): SiteMenuItem => ({
  id,
  target: { kind: 'none' },
  ...(children ? { children } : {}),
})

/** Compact shape for assertions: "a>b" is b nested under a. */
function shape(items: readonly SiteMenuItem[]): string {
  return items
    .map((i) => (i.children?.length ? `${i.id}>(${shape(i.children)})` : i.id))
    .join(',')
}

describe('site menu — moving', () => {
  it('swaps with the previous sibling, and refuses at the top', () => {
    const tree = [item('a'), item('b'), item('c')]
    assert.equal(shape(moveSiteMenuItem(tree, 'b', -1)), 'b,a,c')
    assert.equal(shape(moveSiteMenuItem(tree, 'a', -1)), 'a,b,c', 'nothing above a')
  })

  it('swaps with the next sibling, and refuses at the bottom', () => {
    const tree = [item('a'), item('b')]
    assert.equal(shape(moveSiteMenuItem(tree, 'a', 1)), 'b,a')
    assert.equal(shape(moveSiteMenuItem(tree, 'b', 1)), 'a,b', 'nothing below b')
  })

  it('stays inside its own parent — moving never crosses branches', () => {
    // `y` is last under `a`; pressing down must NOT hop it out to become a
    // sibling of `a`. Crossing parents is what indent/outdent are for, and one
    // button doing two things depending on position is the bug this pins.
    const tree = [item('a', [item('x'), item('y')]), item('b')]
    assert.equal(shape(moveSiteMenuItem(tree, 'y', 1)), 'a>(x,y),b')
  })

  it('does not mutate the input', () => {
    const tree = [item('a'), item('b')]
    const before = shape(tree)
    moveSiteMenuItem(tree, 'a', 1)
    assert.equal(shape(tree), before)
  })
})

describe('site menu — indent', () => {
  it('nests under the previous sibling, as its LAST child', () => {
    const tree = [item('a', [item('x')]), item('b')]
    assert.equal(shape(indentSiteMenuItem(tree, 'b')), 'a>(x,b)')
  })

  it('refuses a first child — there is nothing to nest under', () => {
    const tree = [item('a'), item('b')]
    assert.equal(shape(indentSiteMenuItem(tree, 'a')), 'a,b')
  })

  it('refuses when the item ALONE would breach the cap', () => {
    // a>b>c>d is already at the cap of 4; indenting `d` would make it level 5.
    const deep = [item('a', [item('b', [item('c', [item('d')])])])]
    assert.equal(siteMenuDepth(deep), SITE_MENU_MAX_DEPTH)
    const withSibling = [item('a', [item('b', [item('c', [item('c2'), item('d')])])])]
    assert.equal(
      shape(indentSiteMenuItem(withSibling, 'd')),
      shape(withSibling),
      'd would land at level 5',
    )
  })

  it('refuses when the item is shallow but its SUBTREE would breach the cap', () => {
    // `b` sits at root with a three-deep branch under it (b,c,d,e). Indenting
    // moves the WHOLE branch one level down, so the deepest node would land at
    // level 5. Checking the item's own position and not its subtree is the
    // mistake this catches — it produces a tree that only fails at publish.
    const tree = [item('a'), item('b', [item('c', [item('d', [item('e')])])])]
    assert.equal(shape(indentSiteMenuItem(tree, 'b')), shape(tree))
  })

  it('allows a subtree that lands exactly on the cap', () => {
    // The boundary the case above must not over-shoot: b,c,d indented under `a`
    // reaches level 4, which IS allowed. A guard written with `>=` would refuse
    // this and quietly cost a level.
    const tree = [item('a'), item('b', [item('c', [item('d')])])]
    assert.equal(shape(indentSiteMenuItem(tree, 'b')), 'a>(b>(c>(d)))')
    assert.equal(siteMenuDepth(indentSiteMenuItem(tree, 'b')), SITE_MENU_MAX_DEPTH)
  })

  it('allows an indent that lands exactly ON the cap', () => {
    const tree = [item('a'), item('b', [item('c')])]
    assert.equal(siteMenuDepth(indentSiteMenuItem(tree, 'b')), 3)
    assert.equal(shape(indentSiteMenuItem(tree, 'b')), 'a>(b>(c))')
  })
})

describe('site menu — outdent', () => {
  it('lands directly AFTER its former parent, not at the end', () => {
    const tree = [item('a', [item('x'), item('y')]), item('z')]
    assert.equal(shape(outdentSiteMenuItem(tree, 'x')), 'a>(y),x,z')
  })

  it('refuses a root item — there is nowhere to go', () => {
    const tree = [item('a'), item('b')]
    assert.equal(shape(outdentSiteMenuItem(tree, 'a')), 'a,b')
  })

  it('carries its own children with it', () => {
    const tree = [item('a', [item('x', [item('deep')])])]
    assert.equal(shape(outdentSiteMenuItem(tree, 'x')), 'a,x>(deep)')
  })
})

describe('site menu — remove, append, lookup', () => {
  it('remove takes the whole subtree', () => {
    const tree = [item('a', [item('x')]), item('b')]
    assert.equal(shape(removeSiteMenuItem(tree, 'a')), 'b')
  })

  it('append adds at root level', () => {
    assert.equal(shape(appendSiteMenuItem([item('a')], item('b'))), 'a,b')
  })

  it('finds a nested item by id, and reports absence as null', () => {
    const tree = [item('a', [item('x', [item('deep')])])]
    assert.deepEqual(findSiteMenuPath(tree, 'deep'), [0, 0, 0])
    assert.equal(findSiteMenuPath(tree, 'nope'), null)
  })

  it('flatten reports depth-first order with 1-based depth', () => {
    const tree = [item('a', [item('x')]), item('b')]
    assert.deepEqual(
      flattenSiteMenu(tree).map((e) => `${e.item.id}@${e.depth}`),
      ['a@1', 'x@2', 'b@1'],
    )
  })
})

describe('site menu — the derived default', () => {
  it('reproduces the old two-run header: anchors in order, then surfaces', () => {
    const menu = deriveSiteMenu({
      sections: [
        { id: 'h', type: 'hero' },
        { id: 's1', type: 'content' },
        { id: 's2', type: 'activities' },
      ],
      surfaceLinks: [{ surface: 'shop' }, { surface: 'space' }],
    })
    assert.deepEqual(menu.map((m) => m.id), [
      'section:s1',
      'section:s2',
      'surface:shop',
      'surface:space',
    ])
  })

  it('omits the hero and anything with showInNav false', () => {
    const menu = deriveSiteMenu({
      sections: [
        { id: 'h', type: 'hero' },
        { id: 'hidden', type: 'content', showInNav: false },
        { id: 'shown', type: 'content' },
      ],
      surfaceLinks: [],
    })
    assert.deepEqual(menu.map((m) => m.id), ['section:shown'])
  })
})

describe('site menu — sibling reorder (the drag path)', () => {
  it('reorders the root group', () => {
    const tree = [item('a'), item('b'), item('c')]
    assert.equal(shape(reorderSiteMenuSiblings(tree, null, 2, 0)), 'c,a,b')
  })

  it('reorders inside a parent without touching the root', () => {
    const tree = [item('a', [item('x'), item('y')]), item('b')]
    assert.equal(shape(reorderSiteMenuSiblings(tree, 'a', 1, 0)), 'a>(y,x),b')
  })

  it('CANNOT reparent — a drag stays in its own group', () => {
    // The whole reason each sibling list is its own sortable context. An index
    // past the end of the group is refused rather than spilling into the parent.
    const tree = [item('a', [item('x')]), item('b')]
    assert.equal(shape(reorderSiteMenuSiblings(tree, 'a', 0, 5)), shape(tree))
  })

  it('does not mutate the input', () => {
    const tree = [item('a'), item('b')]
    const before = shape(tree)
    reorderSiteMenuSiblings(tree, null, 0, 1)
    assert.equal(shape(tree), before)
  })
})
