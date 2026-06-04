'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import type { RankingSystem } from '@linyup/shared'

export function ExamCheckinForm({
  contact,
  rankingSystems,
  existing,
  onSubmit,
  onCancel,
  busy,
}: {
  contact: { id: string; firstname: string; lastname: string }
  rankingSystems: RankingSystem[]
  existing?: Record<string, unknown>
  onSubmit: (data: Record<string, unknown>) => void
  onCancel: () => void
  busy?: boolean
}) {
  const existingDisciplines = (existing?.disciplines as Record<string, number>) ?? {}

  const [disciplines, setDisciplines] = useState<Record<string, number>>(existingDisciplines)

  function setLevel(systemId: string, level: number | null) {
    setDisciplines((prev) => {
      const next = { ...prev }
      if (level === null) delete next[systemId]
      else next[systemId] = level
      return next
    })
  }

  const hasAny = Object.values(disciplines).some((v) => v > 0)

  return (
    <div className="space-y-4">
      <p className="text-sm font-medium">{contact.firstname} {contact.lastname}</p>
      <p className="text-xs text-muted-foreground">Record the achieved rank level for each discipline examined.</p>

      {rankingSystems.length === 0 && (
        <p className="text-sm text-muted-foreground italic">
          No ranking systems configured for this team. Add ranking systems in Team Settings.
        </p>
      )}

      {rankingSystems.map((sys) => {
        const levels = sys.levels ?? []
        return (
          <div key={sys.id} className="space-y-1.5">
            <Label>{sys.name}</Label>
            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => setLevel(sys.id, null)}
                className={`px-3 py-1.5 text-xs rounded-md border transition-colors ${
                  !disciplines[sys.id]
                    ? 'bg-muted text-muted-foreground border-transparent'
                    : 'hover:bg-muted border-border'
                }`}
              >
                Not examined
              </button>
              {levels.map((lvl) => (
                <button
                  key={lvl.value}
                  onClick={() => setLevel(sys.id, lvl.value)}
                  className={`px-3 py-1.5 text-xs rounded-md border transition-colors flex items-center gap-1.5 ${
                    disciplines[sys.id] === lvl.value
                      ? 'border-primary bg-primary/10 text-primary font-medium'
                      : 'hover:bg-muted border-border'
                  }`}
                >
                  {lvl.color && (
                    <span
                      className="w-2.5 h-2.5 rounded-full shrink-0"
                      style={{ backgroundColor: lvl.color }}
                    />
                  )}
                  {lvl.label}
                </button>
              ))}
            </div>
          </div>
        )
      })}

      {!hasAny && rankingSystems.length > 0 && (
        <p className="text-xs text-amber-600">Select at least one discipline result before checking in.</p>
      )}

      <div className="flex gap-2 justify-end">
        <Button variant="outline" onClick={onCancel} disabled={busy}>Cancel</Button>
        <Button
          onClick={() => onSubmit({ disciplines })}
          disabled={busy || (!hasAny && rankingSystems.length > 0)}
        >
          {existing ? 'Update' : 'Check in'}
        </Button>
      </div>
    </div>
  )
}
