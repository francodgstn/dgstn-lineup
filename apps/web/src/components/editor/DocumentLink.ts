import { Mark, mergeAttributes } from '@tiptap/core'
import {
  DOCUMENT_LINK_ID_ATTR,
  DOCUMENT_LINK_VERSION_ATTR,
  parseDocumentLinkVersion,
} from '@linyup/shared'

/**
 * One document pointing at another, as a mark on ordinary text.
 *
 * It renders `<a data-document-link="{id}" [data-document-version="{n}"]>` with
 * NO href, on purpose — see shared/utils/documentLink.ts for why the reference
 * is an id and never a URL. `RichTextContent` hydrates the href at render time
 * from the target's CURRENT slug; anything that does not hydrate shows the
 * author's words as plain text instead of a dead link.
 *
 * A mark rather than a node because the link sits INSIDE a sentence the author
 * is writing ("see our <house rules> before booking"), so it has to behave like
 * bold does — extendable, splittable, and removable without disturbing the
 * text it wraps.
 */
export interface DocumentLinkAttrs {
  documentId: string
  /** `null` ⇒ follow the target's latest published version. */
  version: number | null
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    documentLink: {
      setDocumentLink: (attrs: DocumentLinkAttrs) => ReturnType
      unsetDocumentLink: () => ReturnType
      /** Pin (a number) or unpin (null) the link under the cursor. */
      setDocumentLinkVersion: (version: number | null) => ReturnType
    }
  }
}

export const DocumentLink = Mark.create({
  name: 'documentLink',

  // A link should not swallow the character typed straight after it — the
  // author is continuing their sentence, not extending the link.
  inclusive: false,

  addAttributes() {
    return {
      documentId: {
        default: null,
        parseHTML: (el) => el.getAttribute(DOCUMENT_LINK_ID_ATTR),
        renderHTML: (attrs) =>
          attrs.documentId ? { [DOCUMENT_LINK_ID_ATTR]: attrs.documentId } : {},
      },
      version: {
        default: null,
        // Through the shared parser: a mangled or non-integer attribute costs
        // the reader the PIN, never the link.
        parseHTML: (el) => parseDocumentLinkVersion(el.getAttribute(DOCUMENT_LINK_VERSION_ATTR)),
        renderHTML: (attrs) =>
          attrs.version != null ? { [DOCUMENT_LINK_VERSION_ATTR]: String(attrs.version) } : {},
      },
    }
  },

  parseHTML() {
    // The id attribute is what MARKS an anchor as a document link — an ordinary
    // `<a href>` is not one and must not be captured here.
    return [{ tag: `a[${DOCUMENT_LINK_ID_ATTR}]` }]
  },

  renderHTML({ HTMLAttributes }) {
    return ['a', mergeAttributes(HTMLAttributes), 0]
  },

  addCommands() {
    return {
      setDocumentLink:
        (attrs) =>
        ({ chain }) =>
          chain().setMark(this.name, attrs).run(),

      unsetDocumentLink:
        () =>
        ({ chain }) =>
          chain().unsetMark(this.name, { extendEmptyMarkRange: true }).run(),

      setDocumentLinkVersion:
        (version) =>
        ({ chain }) =>
          // extendEmptyMarkRange so a bare cursor inside the link repins the
          // WHOLE link rather than splitting it at the caret.
          chain()
            .extendMarkRange(this.name)
            .updateAttributes(this.name, { version })
            .run(),
    }
  },
})
