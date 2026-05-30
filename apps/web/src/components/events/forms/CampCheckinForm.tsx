'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'

const ROLES = ['participant', 'staff', 'coach', 'volunteer'] as const
type Role = typeof ROLES[number]

export function CampCheckinForm({
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
  const [joinAs, setJoinAs] = useState<Role>((existing?.join_as as Role) ?? 'participant')

  return (
    <div className="space-y-4">
      <p className="text-sm font-medium">{contact.firstname} {contact.lastname}</p>
      <div className="space-y-1.5">
        <Label>Joining as</Label>
        <Select value={joinAs} onValueChange={(v) => setJoinAs(v as Role)}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            {ROLES.map((r) => (
              <SelectItem key={r} value={r} className="capitalize">{r}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="flex gap-2 justify-end">
        <Button variant="outline" onClick={onCancel} disabled={busy}>Cancel</Button>
        <Button onClick={() => onSubmit({ join_as: joinAs })} disabled={busy}>
          {existing ? 'Update' : 'Check in'}
        </Button>
      </div>
    </div>
  )
}
