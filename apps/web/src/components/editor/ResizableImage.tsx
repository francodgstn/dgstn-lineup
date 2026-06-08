'use client'

import { useRef } from 'react'
import Image from '@tiptap/extension-image'
import { ReactNodeViewRenderer, NodeViewWrapper, type NodeViewProps } from '@tiptap/react'

// Self-contained resizable image: extends the built-in Image node with a `width`
// attribute (persisted in the saved HTML as a width attr) and a corner drag
// handle shown when the image is selected. No external dependency.

function ImageNodeView({ node, updateAttributes, selected }: NodeViewProps) {
  const imgRef = useRef<HTMLImageElement>(null)
  const width = node.attrs.width as number | null

  function startResize(e: React.PointerEvent) {
    e.preventDefault()
    e.stopPropagation()
    const startX = e.clientX
    const startW = imgRef.current?.offsetWidth ?? 0

    function onMove(ev: PointerEvent) {
      const next = Math.max(40, Math.round(startW + (ev.clientX - startX)))
      updateAttributes({ width: next })
    }
    function onUp() {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  return (
    <NodeViewWrapper className="relative inline-block max-w-full leading-none">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        ref={imgRef}
        src={node.attrs.src}
        alt={node.attrs.alt ?? ''}
        style={{ width: width ? `${width}px` : undefined, maxWidth: '100%' }}
        className={`rounded-lg ${selected ? 'ring-2 ring-primary' : ''}`}
        draggable={false}
      />
      {selected && (
        <span
          onPointerDown={startResize}
          title="Drag to resize"
          className="absolute -right-1 -bottom-1 h-3.5 w-3.5 rounded-sm border-2 border-primary bg-background cursor-nwse-resize"
        />
      )}
    </NodeViewWrapper>
  )
}

export const ResizableImage = Image.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      width: {
        default: null,
        parseHTML: (el) => {
          const w = el.getAttribute('width')
          return w ? parseInt(w, 10) : null
        },
        renderHTML: (attrs) => (attrs.width ? { width: attrs.width } : {}),
      },
    }
  },
  addNodeView() {
    return ReactNodeViewRenderer(ImageNodeView)
  },
})
