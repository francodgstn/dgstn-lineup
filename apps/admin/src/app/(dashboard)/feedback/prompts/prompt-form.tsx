'use client'

import { useRef, useState, useTransition } from 'react'
import { Button } from '@/components/ui/button'
import { createPrompt } from './actions'

// Create form for a new prompt question. Created as a draft; pushing it to
// users is an explicit second step in the list below.
export function PromptForm() {
  const formRef = useRef<HTMLFormElement>(null)
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  function onSubmit(formData: FormData) {
    setError(null)
    setSaved(false)
    startTransition(async () => {
      const res = await createPrompt(formData)
      if (res.ok) {
        setSaved(true)
        formRef.current?.reset()
      } else {
        setError(res.error ?? 'Failed to save.')
      }
    })
  }

  return (
    <form ref={formRef} action={onSubmit} className="flex max-w-xl flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <label htmlFor="prompt-question" className="text-sm font-medium">
          Question
        </label>
        <input
          id="prompt-question"
          name="question"
          maxLength={300}
          required
          placeholder="e.g. How useful is the new schedule view for you?"
          className="flex w-full rounded-lg border border-input bg-background px-3 py-2 text-sm shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="prompt-description" className="text-sm font-medium">
          Description <span className="font-normal text-muted-foreground">(optional)</span>
        </label>
        <textarea
          id="prompt-description"
          name="description"
          maxLength={500}
          rows={2}
          placeholder="Extra context shown under the question."
          className="flex w-full rounded-lg border border-input bg-background px-3 py-2 text-sm shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
        />
      </div>

      <div className="flex items-center gap-6">
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="allow_rating" defaultChecked className="size-4 rounded border-input" />
          Rating (1–5)
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="allow_text" defaultChecked className="size-4 rounded border-input" />
          Text answer
        </label>
      </div>

      <div className="flex items-center gap-3">
        <Button type="submit" disabled={pending}>
          {pending ? 'Creating…' : 'Create draft'}
        </Button>
        {saved && <span className="text-sm text-[var(--success)]">Draft created.</span>}
        {error && <span className="text-sm text-destructive">{error}</span>}
      </div>
    </form>
  )
}
