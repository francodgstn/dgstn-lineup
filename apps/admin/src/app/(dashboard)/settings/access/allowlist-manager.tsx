'use client'

import { useRef, useState, useTransition } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { formatDate } from '@/lib/format'
import { addAllowlistEmail, removeAllowlistEmail } from './actions'
import type { AllowlistRow } from '@/lib/queries/access'

export function AllowlistManager({ entries }: { entries: AllowlistRow[] }) {
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const formRef = useRef<HTMLFormElement>(null)

  function onAdd(formData: FormData) {
    setError(null)
    startTransition(async () => {
      const res = await addAllowlistEmail(formData)
      if (!res.ok) setError(res.error ?? 'Failed to add.')
      else formRef.current?.reset()
    })
  }

  function onRemove(email: string) {
    setError(null)
    startTransition(async () => {
      const fd = new FormData()
      fd.set('email', email)
      const res = await removeAllowlistEmail(fd)
      if (!res.ok) setError(res.error ?? 'Failed to remove.')
    })
  }

  return (
    <div className="flex flex-col gap-4">
      <form ref={formRef} action={onAdd} className="flex flex-col gap-3">
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex min-w-56 flex-1 flex-col gap-1.5">
            <span className="text-sm font-medium">Email</span>
            <Input name="email" type="email" placeholder="coach@example.com" required />
          </label>
          <label className="flex min-w-40 flex-1 flex-col gap-1.5">
            <span className="text-sm font-medium">Note (optional)</span>
            <Input name="note" placeholder="e.g. early access" />
          </label>
          <Button type="submit" disabled={pending}>
            {pending ? 'Saving…' : 'Authorize'}
          </Button>
        </div>
        <label className="flex items-center gap-2 text-sm text-muted-foreground">
          {/* Default ON — the action treats anything other than "off" as send. */}
          <input type="checkbox" name="invite" value="on" defaultChecked className="size-4" />
          Send them an invite email with a link to sign up
        </label>
      </form>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Email</TableHead>
            <TableHead>Note</TableHead>
            <TableHead>Added</TableHead>
            <TableHead>By</TableHead>
            <TableHead className="w-0" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {entries.length === 0 && (
            <TableRow>
              <TableCell colSpan={5} className="py-4 text-muted-foreground">
                No emails authorized yet.
              </TableCell>
            </TableRow>
          )}
          {entries.map((e) => (
            <TableRow key={e.email}>
              <TableCell className="font-medium">{e.email}</TableCell>
              <TableCell className="text-muted-foreground">{e.note ?? '—'}</TableCell>
              <TableCell className="text-muted-foreground">{formatDate(e.addedMs)}</TableCell>
              <TableCell className="text-muted-foreground">{e.addedBy ?? '—'}</TableCell>
              <TableCell>
                <Button
                  type="button"
                  variant="destructive"
                  size="sm"
                  disabled={pending}
                  onClick={() => onRemove(e.email)}
                >
                  Remove
                </Button>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}
