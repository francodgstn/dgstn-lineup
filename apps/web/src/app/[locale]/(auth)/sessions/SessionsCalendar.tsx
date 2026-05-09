'use client'

import { useMemo, useState } from 'react'
import { Calendar, dateFnsLocalizer, Views } from 'react-big-calendar'
import { format, parse, startOfWeek, getDay } from 'date-fns'
import { enUS } from 'date-fns/locale/en-US'
import 'react-big-calendar/lib/css/react-big-calendar.css'
import type { Session, Activity } from '@lineup/shared'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Badge } from '@/components/ui/badge'
import { MapPin, Clock, Pencil, Trash2 } from 'lucide-react'

// ─── localizer ───────────────────────────────────────────────────────────────

const localizer = dateFnsLocalizer({
  format,
  parse,
  startOfWeek: () => startOfWeek(new Date(), { weekStartsOn: 1 }),
  getDay,
  locales: { 'en-US': enUS },
})

// ─── activity color palette ───────────────────────────────────────────────────

const ACTIVITY_COLORS = [
  '#6366f1', '#8b5cf6', '#ec4899', '#f97316',
  '#14b8a6', '#10b981', '#3b82f6', '#f59e0b',
]
function activityColor(activityId: string | null | undefined): string {
  if (!activityId) return '#6366f1'
  let h = 0
  for (let i = 0; i < activityId.length; i++) h = (h * 31 + activityId.charCodeAt(i)) >>> 0
  return ACTIVITY_COLORS[h % ACTIVITY_COLORS.length]
}

// ─── types ────────────────────────────────────────────────────────────────────

interface CalEvent {
  id: string
  title: string
  start: Date
  end: Date
  resource: Session
}

// ─── event popover ────────────────────────────────────────────────────────────

function EventDetail({
  session,
  open,
  onClose,
  onEdit,
  onDelete,
}: {
  session: Session | null
  open: boolean
  onClose: () => void
  onEdit: (s: Session) => void
  onDelete: (s: Session) => void
}) {
  if (!session) return null

  const start = session.start?.toDate()
  const end = session.end?.toDate()

  const timeStr = start
    ? `${start.toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' })} · ${start.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}${end ? ` – ${end.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : ''}`
    : '—'

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{session.activityName ?? 'Session'}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 pt-1">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Clock className="h-4 w-4 shrink-0" />
            <span>{timeStr}</span>
          </div>
          {session.location && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <MapPin className="h-4 w-4 shrink-0" />
              <span>{session.location}</span>
            </div>
          )}
          {session.allowBooking && (
            <Badge variant="secondary" className="text-xs">Online booking enabled</Badge>
          )}
        </div>
        <div className="flex gap-2 pt-2">
          <button
            onClick={() => { onEdit(session); onClose() }}
            className="flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-lg border text-sm font-medium hover:bg-muted transition-colors"
          >
            <Pencil className="h-4 w-4" /> Edit
          </button>
          <button
            onClick={() => { onDelete(session); onClose() }}
            className="flex items-center justify-center gap-2 px-3 py-2 rounded-lg border border-destructive/30 text-destructive text-sm font-medium hover:bg-destructive/10 transition-colors"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

// ─── component ────────────────────────────────────────────────────────────────

interface Props {
  sessions: Session[]
  activities: Activity[]
  onEdit: (s: Session) => void
  onDelete: (s: Session) => void
  onSlotSelect: (start: Date) => void
}

export default function SessionsCalendar({ sessions, activities: _activities, onEdit, onDelete, onSlotSelect }: Props) {
  const [selected, setSelected] = useState<Session | null>(null)

  const events: CalEvent[] = useMemo(() =>
    sessions
      .filter((s) => s.start && s.end)
      .map((s) => ({
        id: s.id,
        title: s.activityName ?? 'Session',
        start: s.start!.toDate(),
        end: s.end!.toDate(),
        resource: s,
      })),
    [sessions],
  )

  const eventPropGetter = (event: CalEvent) => ({
    style: {
      backgroundColor: activityColor(event.resource.activityId),
      borderColor: 'transparent',
      borderRadius: '6px',
      fontSize: '0.75rem',
      fontWeight: 500,
    },
  })

  return (
    <>
      <div className="rbc-calendar-wrapper rounded-xl border overflow-hidden bg-card" style={{ height: 600 }}>
        <Calendar
          localizer={localizer}
          events={events}
          defaultView={Views.WEEK}
          views={[Views.MONTH, Views.WEEK, Views.DAY, Views.AGENDA]}
          eventPropGetter={eventPropGetter}
          onSelectEvent={(event) => setSelected(event.resource)}
          onSelectSlot={(slot) => onSlotSelect(slot.start as Date)}
          selectable
          popup
        />
      </div>

      <EventDetail
        session={selected}
        open={!!selected}
        onClose={() => setSelected(null)}
        onEdit={onEdit}
        onDelete={onDelete}
      />

      <style>{`
        .rbc-calendar-wrapper .rbc-calendar { font-family: inherit; }
        .rbc-calendar-wrapper .rbc-header { padding: 8px 4px; font-size: 0.75rem; font-weight: 500; border-bottom: 1px solid hsl(var(--border)); }
        .rbc-calendar-wrapper .rbc-today { background-color: color-mix(in oklab, var(--primary) 8%, transparent); }
        .rbc-calendar-wrapper .rbc-off-range-bg { background-color: hsl(var(--muted)); }
        .rbc-calendar-wrapper .rbc-toolbar { padding: 12px 16px; gap: 8px; }
        .rbc-calendar-wrapper .rbc-toolbar button { border-radius: 6px; border: 1px solid hsl(var(--border)); background: transparent; color: hsl(var(--foreground)); font-size: 0.8125rem; padding: 4px 12px; cursor: pointer; transition: background 0.15s; }
        .rbc-calendar-wrapper .rbc-toolbar button:hover { background: hsl(var(--muted)); }
        .rbc-calendar-wrapper .rbc-toolbar button.rbc-active { background: hsl(var(--primary)); color: hsl(var(--primary-foreground)); border-color: transparent; }
        .rbc-calendar-wrapper .rbc-toolbar .rbc-toolbar-label { font-weight: 600; font-size: 0.9375rem; }
        .rbc-calendar-wrapper .rbc-event:focus { outline: none; }
        .rbc-calendar-wrapper .rbc-slot-selection { background: color-mix(in oklab, var(--primary) 20%, transparent); }
        .rbc-calendar-wrapper .rbc-day-slot .rbc-time-slot { border-top: 1px solid hsl(var(--border) / 40%); }
        .rbc-calendar-wrapper .rbc-time-view, .rbc-calendar-wrapper .rbc-month-view { border: none; }
        .rbc-calendar-wrapper .rbc-time-header-content, .rbc-calendar-wrapper .rbc-time-content { border-left: 1px solid hsl(var(--border)); }
      `}</style>
    </>
  )
}
