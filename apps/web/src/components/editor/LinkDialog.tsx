'use client'

import { useEffect, useState } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'

/**
 * An ordinary web link — the thing the editor could not make.
 *
 * StarterKit already bundles the `link` mark, so pasted URLs were becoming
 * links; there was simply no way to write one deliberately with your own words
 * as the text. That is the common case in a terms or house-rules document
 * ("see our <insurance policy>"), and it is separate from a DOCUMENT link
 * (components/editor/DocumentLink.ts), which stores a reference to another
 * Linyup document and resolves its URL at render time.
 */
export interface LinkDialogLabels {
  title: string
  description: string
  urlLabel: string
  urlPlaceholder: string
  textLabel: string
  textPlaceholder: string
  invalidUrl: string
  cancel: string
  submit: string
  remove: string
}

/** http/https only — the same bar the bio-link and document editors apply.
 *  Rejects `javascript:` and `data:`, which is the whole point. */
export function isSafeHttpUrl(value: string): boolean {
  return /^https?:\/\/.+/.test(value.trim())
}

export function LinkDialog({
  open,
  onOpenChange,
  labels,
  initialUrl,
  initialText,
  /** True when the cursor sits in an existing link — offers Remove. */
  editing,
  onSubmit,
  onRemove,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  labels: LinkDialogLabels
  initialUrl?: string
  initialText?: string
  editing?: boolean
  onSubmit: (url: string, text: string) => void
  onRemove?: () => void
}) {
  const [url, setUrl] = useState('')
  const [text, setText] = useState('')
  const [touched, setTouched] = useState(false)

  // Seed from the selection each time it opens, rather than once on mount:
  // the same dialog instance serves "add" and "edit".
  useEffect(() => {
    if (!open) return
    setUrl(initialUrl ?? '')
    setText(initialText ?? '')
    setTouched(false)
  }, [open, initialUrl, initialText])

  const urlOk = isSafeHttpUrl(url)

  function submit() {
    setTouched(true)
    if (!urlOk) return
    // Falling back to the URL as its own text matches what every editor does
    // when you paste a bare link, and beats inserting an empty anchor.
    onSubmit(url.trim(), text.trim() || url.trim())
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{labels.title}</DialogTitle>
          <DialogDescription>{labels.description}</DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="link-url">{labels.urlLabel}</Label>
            <Input
              id="link-url"
              autoFocus
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && submit()}
              placeholder={labels.urlPlaceholder}
            />
            {touched && !urlOk && (
              <p className="text-xs text-destructive">{labels.invalidUrl}</p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="link-text">{labels.textLabel}</Label>
            <Input
              id="link-text"
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && submit()}
              placeholder={labels.textPlaceholder}
            />
          </div>
        </div>

        <div className="flex justify-end gap-2">
          {editing && onRemove && (
            <Button
              type="button"
              variant="ghost"
              className="mr-auto text-destructive hover:text-destructive"
              onClick={() => {
                onRemove()
                onOpenChange(false)
              }}
            >
              {labels.remove}
            </Button>
          )}
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
            {labels.cancel}
          </Button>
          <Button type="button" onClick={submit}>
            {labels.submit}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
