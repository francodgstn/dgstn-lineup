import assert from 'node:assert/strict'
import { resolveSiteSurfaceLinks, type PublicSurface, type SiteHeader } from '@linyup/shared'

// The website header's cross-surface links: DERIVED from what's live, then
// adjusted by the studio's overrides. The derivation direction is the point —
// enabling a plugin must surface its link without the studio editing the site.
//
// Run with: pnpm --filter @linyup/functions test

const label = (s: PublicSurface) => `the ${s}`
const header = (h: Partial<SiteHeader>): SiteHeader => ({ showNav: true, ...h })

describe('resolveSiteSurfaceLinks', () => {
  it('shows every live surface when nothing is configured', () => {
    assert.deepEqual(resolveSiteSurfaceLinks(undefined, ['shop', 'space'], label), [
      { surface: 'shop', label: 'the shop' },
      { surface: 'space', label: 'the space' },
    ])
  })

  it('a NEWLY live surface appears without any config change', () => {
    // The studio configured only the shop; enabling documents later must not
    // require re-editing the website.
    const h = header({ surfaceLinks: [{ surface: 'shop', label: 'Store' }] })
    assert.deepEqual(resolveSiteSurfaceLinks(h, ['shop', 'space', 'documents'], label), [
      { surface: 'shop', label: 'Store' },
      { surface: 'space', label: 'the space' },
      { surface: 'documents', label: 'the documents' },
    ])
  })

  it('hides what the studio hid', () => {
    const h = header({ surfaceLinks: [{ surface: 'space', hidden: true }] })
    assert.deepEqual(resolveSiteSurfaceLinks(h, ['shop', 'space'], label), [
      { surface: 'shop', label: 'the shop' },
    ])
  })

  it('never invents a link for a surface that is not live', () => {
    // Config can only ever REMOVE or restyle — the live list is the authority.
    const h = header({ surfaceLinks: [{ surface: 'documents', label: 'Policies' }] })
    assert.deepEqual(resolveSiteSurfaceLinks(h, ['shop'], label), [
      { surface: 'shop', label: 'the shop' },
    ])
  })

  it('keeps a config for a surface that went offline, so the label survives', () => {
    // Toggling the plugin off and on again must not lose the studio's wording.
    const h = header({ surfaceLinks: [{ surface: 'documents', label: 'Policies' }] })
    assert.deepEqual(resolveSiteSurfaceLinks(h, [], label), [])
    assert.deepEqual(resolveSiteSurfaceLinks(h, ['documents'], label), [
      { surface: 'documents', label: 'Policies' },
    ])
  })

  it('orders configured links first, unconfigured after in natural order', () => {
    const h = header({
      surfaceLinks: [
        { surface: 'documents', order: 0 },
        { surface: 'shop', order: 1 },
      ],
    })
    assert.deepEqual(
      resolveSiteSurfaceLinks(h, ['shop', 'space', 'documents'], label).map((l) => l.surface),
      ['documents', 'shop', 'space']
    )
  })

  it('falls back to the default label for blank or whitespace overrides', () => {
    const h = header({
      surfaceLinks: [
        { surface: 'shop', label: '   ' },
        { surface: 'space', label: '' },
      ],
    })
    assert.deepEqual(resolveSiteSurfaceLinks(h, ['shop', 'space'], label), [
      { surface: 'shop', label: 'the shop' },
      { surface: 'space', label: 'the space' },
    ])
  })
})
