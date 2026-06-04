'use client'

import { useState, useCallback } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import {
  collection, query, orderBy, getDocs, addDoc, updateDoc, deleteDoc,
  doc, serverTimestamp, Timestamp,
} from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { CONTACTS_COLLECTION, CONTACT_NOTES_SUBCOLLECTION } from '@linyup/shared'
import type { Contact } from '@linyup/shared'
import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import {
  Bold, Italic, Strikethrough, Code, Heading2, Heading3,
  List, ListOrdered, Quote, Plus, Pencil, Trash2, X, Check,
} from 'lucide-react'

// ─── types ────────────────────────────────────────────────────────────────────

interface ContactNote {
  id: string
  content: string
  created_at: Timestamp
  updated_at: Timestamp
}

// ─── toolbar ──────────────────────────────────────────────────────────────────

function ToolbarButton({
  active, disabled, onClick, children, title,
}: {
  active?: boolean
  disabled?: boolean
  onClick: () => void
  children: React.ReactNode
  title: string
}) {
  return (
    <button
      type="button"
      title={title}
      disabled={disabled}
      onClick={onClick}
      className={`p-1.5 rounded transition-colors ${
        active
          ? 'bg-foreground/10 text-foreground'
          : 'text-muted-foreground hover:text-foreground hover:bg-foreground/5'
      } disabled:opacity-40`}
    >
      {children}
    </button>
  )
}

function Toolbar({ editor }: { editor: ReturnType<typeof useEditor> }) {
  if (!editor) return null
  return (
    <div className="flex items-center gap-0.5 flex-wrap px-2 py-1.5 border-b">
      <ToolbarButton title="Bold" active={editor.isActive('bold')} onClick={() => editor.chain().focus().toggleBold().run()}>
        <Bold className="h-3.5 w-3.5" />
      </ToolbarButton>
      <ToolbarButton title="Italic" active={editor.isActive('italic')} onClick={() => editor.chain().focus().toggleItalic().run()}>
        <Italic className="h-3.5 w-3.5" />
      </ToolbarButton>
      <ToolbarButton title="Strikethrough" active={editor.isActive('strike')} onClick={() => editor.chain().focus().toggleStrike().run()}>
        <Strikethrough className="h-3.5 w-3.5" />
      </ToolbarButton>
      <ToolbarButton title="Inline code" active={editor.isActive('code')} onClick={() => editor.chain().focus().toggleCode().run()}>
        <Code className="h-3.5 w-3.5" />
      </ToolbarButton>

      <div className="w-px h-4 bg-border mx-1" />

      <ToolbarButton title="Heading 2" active={editor.isActive('heading', { level: 2 })} onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}>
        <Heading2 className="h-3.5 w-3.5" />
      </ToolbarButton>
      <ToolbarButton title="Heading 3" active={editor.isActive('heading', { level: 3 })} onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}>
        <Heading3 className="h-3.5 w-3.5" />
      </ToolbarButton>

      <div className="w-px h-4 bg-border mx-1" />

      <ToolbarButton title="Bullet list" active={editor.isActive('bulletList')} onClick={() => editor.chain().focus().toggleBulletList().run()}>
        <List className="h-3.5 w-3.5" />
      </ToolbarButton>
      <ToolbarButton title="Ordered list" active={editor.isActive('orderedList')} onClick={() => editor.chain().focus().toggleOrderedList().run()}>
        <ListOrdered className="h-3.5 w-3.5" />
      </ToolbarButton>
      <ToolbarButton title="Blockquote" active={editor.isActive('blockquote')} onClick={() => editor.chain().focus().toggleBlockquote().run()}>
        <Quote className="h-3.5 w-3.5" />
      </ToolbarButton>
    </div>
  )
}

// ─── editor ───────────────────────────────────────────────────────────────────

function NoteEditor({
  initialContent,
  onSave,
  onCancel,
  saving,
}: {
  initialContent?: string
  onSave: (html: string) => Promise<void>
  onCancel: () => void
  saving: boolean
}) {
  const t = useTranslations('Contacts')
  const [editorEmpty, setEditorEmpty] = useState(!initialContent)

  const editor = useEditor({
    extensions: [StarterKit],
    content: initialContent ?? '',
    autofocus: true,
    onUpdate: ({ editor }) => setEditorEmpty(editor.isEmpty),
    onCreate: ({ editor }) => setEditorEmpty(editor.isEmpty),
    editorProps: {
      attributes: {
        class: 'prose-notes min-h-[120px] px-3 py-2.5 text-sm outline-none',
      },
    },
  })

  const handleSave = useCallback(async () => {
    if (!editor || editor.isEmpty) return
    await onSave(editor.getHTML())
  }, [editor, onSave])

  return (
    <div className="rounded-lg border bg-card overflow-hidden">
      <Toolbar editor={editor} />
      <EditorContent editor={editor} />
      <div className="flex justify-end gap-2 px-3 py-2 border-t bg-muted/30">
        <button
          onClick={onCancel}
          disabled={saving}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          <X className="h-3.5 w-3.5" />
          {t('cancel')}
        </button>
        <button
          onClick={handleSave}
          disabled={saving || editorEmpty}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90 transition-colors disabled:opacity-50"
        >
          <Check className="h-3.5 w-3.5" />
          {saving ? '…' : t('save')}
        </button>
      </div>
    </div>
  )
}

// ─── note card ────────────────────────────────────────────────────────────────

function NoteCard({
  note,
  onEdit,
  onDelete,
}: {
  note: ContactNote
  onEdit: (note: ContactNote) => void
  onDelete: (id: string) => void
}) {
  const [confirmDelete, setConfirmDelete] = useState(false)

  const dateLabel = note.updated_at?.toDate().toLocaleString([], {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  }) ?? ''

  return (
    <div className="group rounded-lg border bg-card">
      {/* Header row */}
      <div className="flex items-center justify-between px-3 pt-2.5 pb-1">
        <span className="text-[11px] text-muted-foreground">{dateLabel}</span>
        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          {confirmDelete ? (
            <>
              <span className="text-[11px] text-destructive mr-1">Delete?</span>
              <button
                onClick={() => onDelete(note.id)}
                className="p-1 rounded text-destructive hover:bg-destructive/10 transition-colors"
              >
                <Check className="h-3.5 w-3.5" />
              </button>
              <button
                onClick={() => setConfirmDelete(false)}
                className="p-1 rounded text-muted-foreground hover:bg-muted transition-colors"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </>
          ) : (
            <>
              <button
                onClick={() => onEdit(note)}
                className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
              >
                <Pencil className="h-3.5 w-3.5" />
              </button>
              <button
                onClick={() => setConfirmDelete(true)}
                className="p-1 rounded text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </>
          )}
        </div>
      </div>
      {/* Content */}
      <div
        className="prose-notes px-3 pb-3 text-sm"
        dangerouslySetInnerHTML={{ __html: note.content }}
      />
    </div>
  )
}

// ─── main tab ─────────────────────────────────────────────────────────────────

export function NotesTab({ contact }: { contact: Contact }) {
  const t = useTranslations('Contacts')
  const qc = useQueryClient()
  const [adding, setAdding] = useState(false)
  const [editingNote, setEditingNote] = useState<ContactNote | null>(null)
  const [saving, setSaving] = useState(false)

  const notesRef = collection(db, CONTACTS_COLLECTION, contact.id, CONTACT_NOTES_SUBCOLLECTION)

  const { data: notes = [], isLoading } = useQuery<ContactNote[]>({
    queryKey: ['contact-notes', contact.id],
    queryFn: async () => {
      const snap = await getDocs(query(notesRef, orderBy('created_at', 'desc')))
      return snap.docs.map(d => ({ ...d.data(), id: d.id } as ContactNote))
    },
  })

  const invalidate = () => qc.invalidateQueries({ queryKey: ['contact-notes', contact.id] })

  const handleAdd = async (html: string) => {
    setSaving(true)
    try {
      await addDoc(notesRef, {
        content: html,
        created_at: serverTimestamp(),
        updated_at: serverTimestamp(),
      })
      setAdding(false)
      await invalidate()
    } finally {
      setSaving(false)
    }
  }

  const handleUpdate = async (html: string) => {
    if (!editingNote) return
    setSaving(true)
    try {
      await updateDoc(doc(db, CONTACTS_COLLECTION, contact.id, CONTACT_NOTES_SUBCOLLECTION, editingNote.id), {
        content: html,
        updated_at: serverTimestamp(),
      })
      setEditingNote(null)
      await invalidate()
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (id: string) => {
    await deleteDoc(doc(db, CONTACTS_COLLECTION, contact.id, CONTACT_NOTES_SUBCOLLECTION, id))
    await invalidate()
  }

  if (isLoading) {
    return (
      <div className="space-y-2 pt-1">
        {[1, 2].map(i => <div key={i} className="h-24 rounded-lg bg-muted animate-pulse" />)}
      </div>
    )
  }

  return (
    <div className="space-y-3 pt-1">
      {/* Add note button / inline editor */}
      {adding ? (
        <NoteEditor
          onSave={handleAdd}
          onCancel={() => setAdding(false)}
          saving={saving}
        />
      ) : (
        <button
          onClick={() => setAdding(true)}
          className="flex items-center gap-2 w-full px-3 py-2.5 rounded-lg border border-dashed text-sm text-muted-foreground hover:text-foreground hover:border-border transition-colors"
        >
          <Plus className="h-4 w-4" />
          {t('notesAddNote')}
        </button>
      )}

      {/* Notes list */}
      {notes.length === 0 && !adding && (
        <p className="py-10 text-center text-sm text-muted-foreground">{t('noNotes')}</p>
      )}

      {notes.map(note => (
        editingNote?.id === note.id ? (
          <NoteEditor
            key={note.id}
            initialContent={note.content}
            onSave={handleUpdate}
            onCancel={() => setEditingNote(null)}
            saving={saving}
          />
        ) : (
          <NoteCard
            key={note.id}
            note={note}
            onEdit={setEditingNote}
            onDelete={handleDelete}
          />
        )
      ))}
    </div>
  )
}
