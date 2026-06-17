'use client'

import { memo, useEffect, useRef, useState } from 'react'
import { useEditor, EditorContent, ReactRenderer } from '@tiptap/react'
import type { Editor } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import Placeholder from '@tiptap/extension-placeholder'
import TaskList from '@tiptap/extension-task-list'
import TaskItem from '@tiptap/extension-task-item'
import { TableKit } from '@tiptap/extension-table'
import { DragHandle } from '@tiptap/extension-drag-handle-react'
import {
  Bold, Italic, Strikethrough, Type, Heading1, Heading2, Heading3,
  List, ListOrdered, ListChecks, Quote, Code, Minus, ImageIcon, GripVertical,
  Table as TableIcon, Trash2,
} from 'lucide-react'
import { SlashCommand } from './editor/SlashCommand'
import { SlashCommandList, type SlashItem, type SlashCommandListRef } from './editor/SlashCommandList'
import { ResizableImage } from './editor/ResizableImage'

type Range = { from: number; to: number }

// ─── Toolbar ──────────────────────────────────────────────────────────────────

function ToolbarButton({
  active, onClick, children, title,
}: {
  active?: boolean
  onClick: () => void
  children: React.ReactNode
  title: string
}) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      className={`p-1.5 rounded transition-colors ${
        active
          ? 'bg-foreground/10 text-foreground'
          : 'text-muted-foreground hover:text-foreground hover:bg-foreground/5'
      }`}
    >
      {children}
    </button>
  )
}

function Toolbar({ editor, onImage }: { editor: Editor | null; onImage?: () => void }) {
  if (!editor) return null
  // Start a fresh chain on every click — a cached chain captures a stale state
  // and throws "Applying a mismatched transaction" on the second use.
  const run = (fn: (c: ReturnType<Editor['chain']>) => ReturnType<Editor['chain']>) =>
    fn(editor.chain().focus()).run()
  return (
    <div className="flex items-center gap-0.5 flex-wrap px-2 py-1.5 border-b">
      <ToolbarButton title="Bold" active={editor.isActive('bold')} onClick={() => run((c) => c.toggleBold())}>
        <Bold className="h-3.5 w-3.5" />
      </ToolbarButton>
      <ToolbarButton title="Italic" active={editor.isActive('italic')} onClick={() => run((c) => c.toggleItalic())}>
        <Italic className="h-3.5 w-3.5" />
      </ToolbarButton>
      <ToolbarButton title="Strikethrough" active={editor.isActive('strike')} onClick={() => run((c) => c.toggleStrike())}>
        <Strikethrough className="h-3.5 w-3.5" />
      </ToolbarButton>

      <div className="w-px h-4 bg-border mx-1" />

      <ToolbarButton title="Heading 1" active={editor.isActive('heading', { level: 1 })} onClick={() => run((c) => c.toggleHeading({ level: 1 }))}>
        <Heading1 className="h-3.5 w-3.5" />
      </ToolbarButton>
      <ToolbarButton title="Heading 2" active={editor.isActive('heading', { level: 2 })} onClick={() => run((c) => c.toggleHeading({ level: 2 }))}>
        <Heading2 className="h-3.5 w-3.5" />
      </ToolbarButton>
      <ToolbarButton title="Heading 3" active={editor.isActive('heading', { level: 3 })} onClick={() => run((c) => c.toggleHeading({ level: 3 }))}>
        <Heading3 className="h-3.5 w-3.5" />
      </ToolbarButton>

      <div className="w-px h-4 bg-border mx-1" />

      <ToolbarButton title="Bullet list" active={editor.isActive('bulletList')} onClick={() => run((c) => c.toggleBulletList())}>
        <List className="h-3.5 w-3.5" />
      </ToolbarButton>
      <ToolbarButton title="Numbered list" active={editor.isActive('orderedList')} onClick={() => run((c) => c.toggleOrderedList())}>
        <ListOrdered className="h-3.5 w-3.5" />
      </ToolbarButton>
      <ToolbarButton title="To-do list" active={editor.isActive('taskList')} onClick={() => run((c) => c.toggleTaskList())}>
        <ListChecks className="h-3.5 w-3.5" />
      </ToolbarButton>
      <ToolbarButton title="Quote" active={editor.isActive('blockquote')} onClick={() => run((c) => c.toggleBlockquote())}>
        <Quote className="h-3.5 w-3.5" />
      </ToolbarButton>
      <ToolbarButton title="Code block" active={editor.isActive('codeBlock')} onClick={() => run((c) => c.toggleCodeBlock())}>
        <Code className="h-3.5 w-3.5" />
      </ToolbarButton>
      <ToolbarButton title="Divider" onClick={() => run((c) => c.setHorizontalRule())}>
        <Minus className="h-3.5 w-3.5" />
      </ToolbarButton>
      <ToolbarButton
        title="Insert table"
        active={editor.isActive('table')}
        onClick={() => run((c) => c.insertTable({ rows: 3, cols: 3, withHeaderRow: true }))}
      >
        <TableIcon className="h-3.5 w-3.5" />
      </ToolbarButton>
      {onImage && (
        <ToolbarButton title="Image" onClick={onImage}>
          <ImageIcon className="h-3.5 w-3.5" />
        </ToolbarButton>
      )}

      {/* Table editing controls — only while the cursor is inside a table */}
      {editor.isActive('table') && (
        <>
          <div className="w-px h-4 bg-border mx-1" />
          <ToolbarButton title="Add column" onClick={() => run((c) => c.addColumnAfter())}>
            <span className="text-[10px] font-semibold px-0.5">+Col</span>
          </ToolbarButton>
          <ToolbarButton title="Add row" onClick={() => run((c) => c.addRowAfter())}>
            <span className="text-[10px] font-semibold px-0.5">+Row</span>
          </ToolbarButton>
          <ToolbarButton title="Delete column" onClick={() => run((c) => c.deleteColumn())}>
            <span className="text-[10px] font-semibold px-0.5">−Col</span>
          </ToolbarButton>
          <ToolbarButton title="Delete row" onClick={() => run((c) => c.deleteRow())}>
            <span className="text-[10px] font-semibold px-0.5">−Row</span>
          </ToolbarButton>
          <ToolbarButton title="Delete table" onClick={() => run((c) => c.deleteTable())}>
            <Trash2 className="h-3.5 w-3.5" />
          </ToolbarButton>
        </>
      )}
    </div>
  )
}

// ─── Slash command items + popup wiring ─────────────────────────────────────────

function buildSlashItems(opts: {
  placeholderText?: string
  requestImage?: () => void
}): SlashItem[] {
  const items: SlashItem[] = [
    { title: 'Text', icon: Type, command: ({ editor, range }) => (editor as Editor).chain().focus().deleteRange(range as Range).setNode('paragraph').run() },
    { title: 'Heading 1', icon: Heading1, command: ({ editor, range }) => (editor as Editor).chain().focus().deleteRange(range as Range).toggleHeading({ level: 1 }).run() },
    { title: 'Heading 2', icon: Heading2, command: ({ editor, range }) => (editor as Editor).chain().focus().deleteRange(range as Range).toggleHeading({ level: 2 }).run() },
    { title: 'Heading 3', icon: Heading3, command: ({ editor, range }) => (editor as Editor).chain().focus().deleteRange(range as Range).toggleHeading({ level: 3 }).run() },
    { title: 'Bullet list', icon: List, command: ({ editor, range }) => (editor as Editor).chain().focus().deleteRange(range as Range).toggleBulletList().run() },
    { title: 'Numbered list', icon: ListOrdered, command: ({ editor, range }) => (editor as Editor).chain().focus().deleteRange(range as Range).toggleOrderedList().run() },
    { title: 'To-do list', icon: ListChecks, command: ({ editor, range }) => (editor as Editor).chain().focus().deleteRange(range as Range).toggleTaskList().run() },
    { title: 'Quote', icon: Quote, command: ({ editor, range }) => (editor as Editor).chain().focus().deleteRange(range as Range).toggleBlockquote().run() },
    { title: 'Code block', icon: Code, command: ({ editor, range }) => (editor as Editor).chain().focus().deleteRange(range as Range).toggleCodeBlock().run() },
    { title: 'Divider', icon: Minus, command: ({ editor, range }) => (editor as Editor).chain().focus().deleteRange(range as Range).setHorizontalRule().run() },
    { title: 'Table', icon: TableIcon, command: ({ editor, range }) => (editor as Editor).chain().focus().deleteRange(range as Range).insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run() },
  ]
  if (opts.requestImage) {
    items.push({
      title: 'Image',
      icon: ImageIcon,
      command: ({ editor, range }) => {
        (editor as Editor).chain().focus().deleteRange(range as Range).run()
        opts.requestImage!()
      },
    })
  }
  return items
}

/* eslint-disable @typescript-eslint/no-explicit-any */
function makeSlashRenderer() {
  let component: ReactRenderer<SlashCommandListRef> | null = null
  let el: HTMLDivElement | null = null

  function place(rect: DOMRect | null | undefined) {
    if (!el || !rect) return
    el.style.position = 'fixed'
    el.style.left = `${rect.left}px`
    el.style.top = `${rect.bottom + 6}px`
    el.style.zIndex = '60'
  }

  return {
    onStart: (props: any) => {
      component = new ReactRenderer(SlashCommandList, { props, editor: props.editor })
      el = document.createElement('div')
      el.appendChild(component.element)
      document.body.appendChild(el)
      place(props.clientRect?.())
    },
    onUpdate: (props: any) => {
      component?.updateProps(props)
      place(props.clientRect?.())
    },
    onKeyDown: (props: any) => {
      if (props.event.key === 'Escape') return true
      return component?.ref?.onKeyDown(props) ?? false
    },
    onExit: () => {
      el?.remove()
      component?.destroy()
      el = null
      component = null
    },
  }
}
/* eslint-enable @typescript-eslint/no-explicit-any */

// ─── Editor ─────────────────────────────────────────────────────────────────

export const RichTextEditor = memo(function RichTextEditor({
  value,
  onChange,
  placeholder,
  minHeight = 220,
  onUploadImage,
}: {
  /** Initial HTML. Editor is uncontrolled after mount — remount via `key` to reset. */
  value: string
  onChange: (html: string) => void
  placeholder?: string
  minHeight?: number
  /** When provided, enables image insertion (slash + toolbar) that uploads via this fn. */
  onUploadImage?: (file: File) => Promise<string>
}) {
  const fileRef = useRef<HTMLInputElement>(null)
  // DragHandle touches the DOM/floating-ui — only mount it client-side.
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])

  const requestImage = onUploadImage ? () => fileRef.current?.click() : undefined

  const editor = useEditor({
    extensions: [
      StarterKit,
      Placeholder.configure({
        placeholder: placeholder ?? 'Write something, or press “/” for commands…',
      }),
      ResizableImage,
      TaskList,
      TaskItem.configure({ nested: true }),
      TableKit.configure({ table: { resizable: true } }),
      SlashCommand.configure({
        suggestion: {
          char: '/',
          command: ({ editor, range, props }: { editor: unknown; range: unknown; props: SlashItem }) =>
            props.command({ editor, range }),
          items: ({ query }: { query: string }) =>
            buildSlashItems({ requestImage }).filter((i) =>
              i.title.toLowerCase().includes(query.toLowerCase()),
            ),
          render: makeSlashRenderer,
        },
      }),
    ],
    content: value ?? '',
    onUpdate: ({ editor }) => onChange(editor.getHTML()),
    editorProps: {
      attributes: {
        class: 'prose-notes px-3 py-2.5 text-sm outline-none',
        style: `min-height:${minHeight}px`,
      },
    },
  })

  async function handleImageFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file || !editor || !onUploadImage) return
    try {
      const url = await onUploadImage(file)
      editor.chain().focus().setImage({ src: url }).run()
    } catch {
      // onUploadImage surfaces its own error (e.g. file too large); abort insert.
    } finally {
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  return (
    <div className="rounded-lg border bg-card overflow-hidden">
      <Toolbar editor={editor} onImage={requestImage} />
      <div className="relative">
        {mounted && editor && (
          <DragHandle editor={editor}>
            <div className="flex h-5 w-4 items-center justify-center rounded text-muted-foreground/50 hover:bg-accent cursor-grab active:cursor-grabbing">
              <GripVertical className="h-4 w-4" />
            </div>
          </DragHandle>
        )}
        <EditorContent editor={editor} />
      </div>
      {onUploadImage && (
        <input ref={fileRef} type="file" accept="image/*" onChange={handleImageFile} className="hidden" />
      )}
    </div>
  )
})

export function RichTextContent({ html, className }: { html: string; className?: string }) {
  return (
    <div
      className={`prose-notes text-sm ${className ?? ''}`}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  )
}
