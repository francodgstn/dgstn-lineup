'use client'

import { Button } from '@/components/ui/button'

export function GenericCheckinForm({
  contact,
  existing,
  onSubmit,
  onCancel,
  busy,
}: {
  contact: { id: string; firstname: string; lastname: string }
  existing?: Record<string, unknown>
  onSubmit: (data: Record<string, unknown>) => void
  onCancel: () => void
  busy?: boolean
}) {
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Mark attendance for <strong>{contact.firstname} {contact.lastname}</strong>.
        No additional data required for this event type.
      </p>
      <div className="flex gap-2 justify-end">
        <Button variant="outline" onClick={onCancel} disabled={busy}>Cancel</Button>
        <Button onClick={() => onSubmit({})} disabled={busy}>
          {existing ? 'Update check-in' : 'Check in'}
        </Button>
      </div>
    </div>
  )
}
