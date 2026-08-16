import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  canInsertDocumentLink,
  documentLinkOptions,
  parseDocumentLinkVersion,
  resolveDocumentLink,
  DOCUMENT_LINK_ID_ATTR,
  DOCUMENT_LINK_VERSION_ATTR,
} from '@linyup/shared'

// THE WHOLE MODEL: a link resolves to the target's LATEST version by default;
// the author may PIN it, and pinned means that version. Nothing is frozen at
// publish time, nothing is validated at publish time, a waiver's links are not
// special.

describe('parseDocumentLinkVersion', () => {
  it('reads a positive integer as a pin', () => {
    assert.equal(parseDocumentLinkVersion('1'), 1)
    assert.equal(parseDocumentLinkVersion('42'), 42)
  })

  it('reads anything else as UNPINNED rather than erroring', () => {
    // A mangled attribute must cost the reader the pin, never the link — this
    // value arrives from stored HTML and from a `?v=` query string, neither of
    // which is under our control.
    for (const bad of ['', '0', '-1', 'abc', '1.5', ' 2', '2 ', '0x2', '١٢', null, undefined]) {
      assert.equal(parseDocumentLinkVersion(bad), null, `${JSON.stringify(bad)} must be unpinned`)
    }
  })

  it('refuses a number too large to be an exact integer', () => {
    assert.equal(parseDocumentLinkVersion('9007199254740993'), null)
  })
})

describe('resolveDocumentLink', () => {
  const target = { slug: 'house-rules', title: 'House rules', version: 5 }

  it('unpinned FOLLOWS the target’s latest version', () => {
    const r = resolveDocumentLink({ documentId: 'd1', version: null, label: 'the rules' }, target, 'studio')
    assert.equal(r.kind, 'link')
    if (r.kind !== 'link') return
    assert.equal(r.pinned, false)
    assert.equal(r.version, 5)
    assert.ok(r.path.includes('/public/studio/documents/house-rules'))
    assert.ok(!r.path.includes('v='), 'an unpinned link must not carry a version')
  })

  it('pinned WINS over the target’s latest version', () => {
    const r = resolveDocumentLink({ documentId: 'd1', version: 2, label: 'the rules' }, target, 'studio')
    assert.equal(r.kind, 'link')
    if (r.kind !== 'link') return
    assert.equal(r.pinned, true)
    assert.equal(r.version, 2)
    assert.ok(r.path.includes('v=2'), 'a pinned link must carry its version in the URL')
  })

  it('rebuilds the path from the target’s CURRENT slug — the reason the ref is an id', () => {
    const renamed = { ...target, slug: 'club-rules' }
    const r = resolveDocumentLink({ documentId: 'd1', version: null, label: 'the rules' }, renamed, 'newslug')
    assert.equal(r.kind, 'link')
    if (r.kind !== 'link') return
    assert.ok(r.path.includes('/public/newslug/documents/club-rules'))
  })

  it('degrades honestly, keeping the author’s words, when it cannot resolve', () => {
    // A missing target is the COMPLETE availability answer: the mirror is
    // double-gated on published AND isPublic, so its absence means a visitor
    // may not open it.
    const gone = resolveDocumentLink({ documentId: 'd1', version: null, label: 'the rules' }, null, 'studio')
    assert.deepEqual(gone, { kind: 'unavailable', label: 'the rules' })
    // …and so is a team with no slug, which has no public route at all.
    const noSlug = resolveDocumentLink({ documentId: 'd1', version: null, label: 'the rules' }, target, '')
    assert.deepEqual(noSlug, { kind: 'unavailable', label: 'the rules' })
  })

  it('an unpinned link to a target that predates versioning still resolves', () => {
    const r = resolveDocumentLink(
      { documentId: 'd1', version: null, label: 'the rules' },
      { ...target, version: null },
      'studio',
    )
    assert.equal(r.kind, 'link')
    if (r.kind !== 'link') return
    assert.equal(r.version, null)
  })
})

describe('a document can never link to itself', () => {
  it('canInsertDocumentLink refuses self and refuses an empty id', () => {
    assert.equal(canInsertDocumentLink('other', 'me'), true)
    assert.equal(canInsertDocumentLink('me', 'me'), false)
    assert.equal(canInsertDocumentLink('', 'me'), false)
  })

  it('documentLinkOptions drops the current document and sorts by title', () => {
    const docs = [
      { id: 'c', title: 'Zebra' },
      { id: 'me', title: 'Aardvark' },
      { id: 'a', title: 'Mongoose' },
    ]
    assert.deepEqual(
      documentLinkOptions(docs, 'me').map((d) => d.id),
      ['a', 'c'],
      'the document being edited must never be offered, whatever its title sorts as'
    )
  })
})

describe('the pinned half is wired end to end', () => {
  const web = join(__dirname, '../../../../apps/web/src')

  it('the public document page READS ?v= and asks for that version', () => {
    // The dead end this pins: the resolver built a `?v=` path and the callable
    // existed, but the page never read the query string — so a pinned link
    // silently served the latest text while the URL claimed otherwise, which
    // violates the one guarantee of the model.
    const src = readFileSync(
      join(web, 'app/[locale]/(public)/public/[slug]/documents/[documentSlug]/DocumentDetail.tsx'),
      'utf8'
    )
    assert.ok(/useSearchParams\(\)/.test(src), 'the page must read the query string')
    assert.ok(
      /parseDocumentLinkVersion\(searchParams\.get\('v'\)\)/.test(src),
      'the version must come through the shared parser, not a bare Number()'
    )
    assert.ok(
      /getPublicDocumentVersion/.test(src),
      'a pinned version can only come from the callable — the mirror holds latest only'
    )
    assert.ok(
      /viewingVersion/.test(src),
      'a reader on a pinned link must be TOLD they are not reading the current text'
    )
  })

  it('the callable it depends on is exported', () => {
    const index = readFileSync(join(__dirname, '../index.ts'), 'utf8')
    assert.ok(/export \{ getPublicDocumentVersion \}/.test(index))
  })

  it('the editor can insert, pin and unpin — the authoring half exists', () => {
    const editor = readFileSync(join(web, 'components/RichTextEditor.tsx'), 'utf8')
    assert.ok(/DocumentLinkPicker/.test(editor), 'there must be a picker to choose a target')
    assert.ok(/setDocumentLinkVersion\(isPinned \? null : latest\)/.test(editor), 'pin/unpin control')
    assert.ok(/unsetDocumentLink\(\)/.test(editor), 'a link must be removable')
    assert.ok(
      /requestDocumentLink/.test(editor),
      'the slash menu must offer it — the toolbar alone is not discoverable'
    )
  })

  it('the mark round-trips through the two attributes the sanitizer allows', () => {
    const mark = readFileSync(join(web, 'components/editor/DocumentLink.ts'), 'utf8')
    assert.ok(mark.includes('DOCUMENT_LINK_ID_ATTR'))
    assert.ok(mark.includes('DOCUMENT_LINK_VERSION_ATTR'))
    assert.ok(
      /parseDocumentLinkVersion\(el\.getAttribute\(DOCUMENT_LINK_VERSION_ATTR\)\)/.test(mark),
      'parsing must go through the shared parser so the editor and the reader agree'
    )
    // The sanitizer is what lets the reference survive into a frozen snapshot.
    const sanitizer = readFileSync(join(__dirname, '../utils/sanitizeHtml.ts'), 'utf8')
    assert.ok(sanitizer.includes('DOCUMENT_LINK_ID_ATTR'))
    assert.ok(sanitizer.includes('DOCUMENT_LINK_VERSION_ATTR'))
    // …and on `a` ALONE. A wildcard would let these ride on any element.
    assert.ok(
      /a: \['href', 'target', 'rel', DOCUMENT_LINK_ID_ATTR, DOCUMENT_LINK_VERSION_ATTR\]/.test(
        sanitizer
      ),
      'the widening must stay scoped to the anchor'
    )
  })

  it('the stored anchor carries NO href — plain text is the un-hydrated baseline', () => {
    const mark = readFileSync(join(web, 'components/editor/DocumentLink.ts'), 'utf8')
    // Comments stripped: the docblock explains that RichTextContent hydrates
    // the href, so a naive search for the word matches prose and passes for the
    // wrong reason.
    const live = mark
      .split('\n')
      .filter((l) => {
        const s = l.trim()
        return s && !s.startsWith('//') && !s.startsWith('*') && !s.startsWith('/*')
      })
      .join('\n')
    assert.ok(
      !/href/.test(live),
      'rendering an href at author time would freeze a URL whose both halves are editable'
    )
    assert.equal(DOCUMENT_LINK_ID_ATTR, 'data-document-link')
    assert.equal(DOCUMENT_LINK_VERSION_ATTR, 'data-document-version')
  })
})
