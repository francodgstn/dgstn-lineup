'use client'

import { useMemo, useState, useRef, useEffect } from 'react'
import { Calendar, dateFnsLocalizer, Views } from 'react-big-calendar'
import { format, parse, startOfWeek, getDay } from 'date-fns'
import { enUS } from 'date-fns/locale/en-US'
import 'react-big-calendar/lib/css/react-big-calendar.css'
import type { Session, Activity } from '@lineup/shared'
import {
  MapPin, Clock, Pencil, Trash2, Users, BookOpen, Repeat, X, ExternalLink,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { useRouter } from '@/i18n/navigation'

// ─── localizer ───────────────────────────────────────────────────────────────

const localizer = dateFnsLocalizer({
  format,
  parse,
  startOfWeek: () => startOfWeek(new Date(), { weekStartsOn: 1 }),
  getDay,
  locales: { 'en-US': enUS },
})

// ─── activity color palette ───────────────────────────────────────────────────
// Each entry: light tinted background, readable text, accent for left-border

const PALETTE = [
  { bg: '#EDE9FE', text: '#5B21B6', accent: '#7C3AED' },
  { bg: '#FCE7F3', text: '#9D174D', accent: '#EC4899' },
  { bg: '#DBEAFE', text: '#1D4ED8', accent: '#3B82F6' },
  { bg: '#D1FAE5', text: '#065F46', accent: '#10B981' },
  { bg: '#FEF3C7', text: '#92400E', accent: '#F59E0B' },
  { bg: '#FFE4E6', text: '#9F1239', accent: '#F43F5E' },
  { bg: '#E0F2FE', text: '#075985', accent: '#0EA5E9' },
  { bg: '#F0FDF4', text: '#14532D', accent: '#22C55E' },
]

function activityPalette(activityId: string | null | undefined, customColor?: string | null) {
  if (customColor) {
    return { bg: `${customColor}18`, text: customColor, accent: customColor }
  }
  if (!activityId) return PALETTE[0]
  let h = 0
  for (let i = 0; i < activityId.length; i++) h = (h * 31 + activityId.charCodeAt(i)) >>> 0
  return PALETTE[h % PALETTE.length]
}

// ─── types ────────────────────────────────────────────────────────────────────

interface CalEvent {
  id: string
  title: string
  baseLabel: string
  start: Date
  end: Date
  resource: Session
}

// ─── event detail panel ───────────────────────────────────────────────────────

function EventPanel({
  session,
  onClose,
  onEdit,
  onDelete,
  anchorRef,
}: {
  session: Session | null
  onClose: () => void
  onEdit: (s: Session) => void
  onDelete: (s: Session) => void
  anchorRef: React.RefObject<HTMLDivElement | null>
}) {
  const router = useRouter()
  const panelRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (
        panelRef.current && !panelRef.current.contains(e.target as Node) &&
        anchorRef.current && !anchorRef.current.contains(e.target as Node)
      ) {
        onClose()
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [onClose, anchorRef])

  if (!session) return null

  const start = session.start?.toDate()
  const end = session.end?.toDate()
  const { accent } = activityPalette(session.activityId)

  const dateStr = start
    ? start.toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long' })
    : '—'
  const timeStr = start
    ? `${start.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}${end ? ` – ${end.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : ''}`
    : '—'

  return (
    <div
      ref={panelRef}
      className="absolute z-50 w-72 rounded-xl border bg-card shadow-xl overflow-hidden"
      style={{ top: 8, right: 8 }}
    >
      {/* Accent bar */}
      <div className="h-1 w-full" style={{ background: accent }} />

      <div className="p-4">
        <div className="flex items-start justify-between gap-2">
          <p className="font-semibold text-sm leading-tight">
            {session.activityName ?? 'Session'}
          </p>
          <button
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground flex-shrink-0 -mt-0.5"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>

        <div className="mt-3 space-y-2 text-sm text-muted-foreground">
          <div className="flex items-center gap-2">
            <Clock className="h-3.5 w-3.5 shrink-0" />
            <span>{dateStr}</span>
          </div>
          <div className="flex items-center gap-2">
            <Clock className="h-3.5 w-3.5 shrink-0 opacity-0" />
            <span>{timeStr}</span>
          </div>
          {session.location && (
            <div className="flex items-center gap-2">
              <MapPin className="h-3.5 w-3.5 shrink-0" />
              <span>{session.location}</span>
            </div>
          )}
          {(session.participants_count ?? 0) > 0 && (
            <div className="flex items-center gap-2">
              <Users className="h-3.5 w-3.5 shrink-0" />
              <span>{session.participants_count} participants</span>
            </div>
          )}
        </div>

        {session.allowBooking && (
          <div className="mt-3">
            <Badge variant="secondary" className="text-xs gap-1">
              <BookOpen className="h-3 w-3" />
              Booking open
            </Badge>
          </div>
        )}

        <div className="mt-4 flex gap-2">
          <button
            onClick={() => router.push(`/sessions/${session.id}` as Parameters<typeof router.push>[0])}
            className="flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90 transition-colors"
          >
            <ExternalLink className="h-3 w-3" /> Open
          </button>
          <button
            onClick={() => { onEdit(session); onClose() }}
            className="flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-medium hover:bg-muted transition-colors"
          >
            <Pencil className="h-3 w-3" />
          </button>
          <button
            onClick={() => { onDelete(session); onClose() }}
            className="flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg border border-destructive/30 text-destructive text-xs font-medium hover:bg-destructive/10 transition-colors"
          >
            <Trash2 className="h-3 w-3" />
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── agenda custom components ─────────────────────────────────────────────────

function AgendaEvent({ event, activityColorById }: { event: CalEvent; activityColorById: Map<string, string> }) {
  const { accent } = activityPalette(event.resource.activityId, activityColorById.get(event.resource.activityId ?? ''))
  const participants = event.resource.participants_count ?? 0
  const bookings = (event.resource as Session & { portal_bookings_count?: number }).portal_bookings_count ?? 0

  return (
    <div style={{ borderLeft: `3px solid ${accent}`, paddingLeft: 10, paddingTop: 2, paddingBottom: 2 }}>
      <p className="font-semibold text-[0.8125rem] leading-tight">{event.baseLabel}</p>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 mt-1">
        {event.resource.location && (
          <span className="flex items-center gap-1 text-xs text-muted-foreground">
            <MapPin className="h-3 w-3" />
            {event.resource.location}
          </span>
        )}
        {participants > 0 && (
          <span className="flex items-center gap-1 text-xs text-muted-foreground">
            <Users className="h-3 w-3" />
            {participants}
          </span>
        )}
        {bookings > 0 && (
          <span className="flex items-center gap-1 text-xs text-primary font-medium">
            <BookOpen className="h-3 w-3" />
            +{bookings} booked
          </span>
        )}
        {(event.resource as Session & { seriesId?: string }).seriesId && (
          <span className="flex items-center gap-1 text-xs text-muted-foreground">
            <Repeat className="h-3 w-3" /> Recurring
          </span>
        )}
      </div>
    </div>
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

export default function SessionsCalendar({ sessions, activities, onEdit, onDelete, onSlotSelect }: Props) {
  const [selected, setSelected] = useState<Session | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  const activityColorById = useMemo(() => {
    const m = new Map<string, string>()
    for (const a of activities) {
      if (a.id && a.color) m.set(a.id, a.color)
    }
    return m
  }, [activities])

  const events: CalEvent[] = useMemo(() =>
    sessions
      .filter((s) => s.start && s.end)
      .map((s) => {
        const start = s.start!.toDate()
        const timePrefix = format(start, 'HH:mm')
        const baseLabel = s.activityName ?? 'Session'
        return {
          id: s.id,
          title: `${timePrefix} · ${baseLabel}`,
          baseLabel,
          start,
          end: s.end!.toDate(),
          resource: s,
        }
      }),
    [sessions],
  )

  const eventPropGetter = (event: CalEvent) => {
    const { bg, text, accent } = activityPalette(
      event.resource.activityId,
      activityColorById.get(event.resource.activityId ?? '')
    )
    return {
      style: {
        backgroundColor: bg,
        color: text,
        border: 'none',
        borderLeft: `3px solid ${accent}`,
        borderRadius: '5px',
        fontSize: '0.72rem',
        fontWeight: 600,
        padding: '1px 4px',
      },
    }
  }

  const CustomEvent = ({ event }: { event: CalEvent }) => (
    <div
      style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '100%' }}
      title={event.title}
    >
      {event.title}
    </div>
  )

  return (
    <div ref={containerRef} className="rbc-lineup relative rounded-xl border overflow-hidden bg-card" style={{ height: 640 }}>
      <Calendar
        localizer={localizer}
        events={events}
        defaultView={Views.MONTH}
        views={[Views.MONTH, Views.WEEK, Views.DAY, Views.AGENDA]}
        eventPropGetter={eventPropGetter}
        components={{
          event: CustomEvent,
          agenda: {
            event: (props: { event: CalEvent }) => (
              <AgendaEvent event={props.event} activityColorById={activityColorById} />
            ),
          },
        }}
        onSelectEvent={(event) => setSelected(event.resource)}
        onSelectSlot={(slot) => onSlotSelect(slot.start as Date)}
        selectable
        popup
        style={{ height: '100%' }}
      />

      {selected && (
        <EventPanel
          session={selected}
          onClose={() => setSelected(null)}
          onEdit={onEdit}
          onDelete={onDelete}
          anchorRef={containerRef}
        />
      )}

      <style>{`
        /* ─── Base ──────────────────────────────────────────────────────────── */
        .rbc-lineup .rbc-calendar { font-family: inherit; }
        .rbc-lineup .rbc-month-view,
        .rbc-lineup .rbc-time-view,
        .rbc-lineup .rbc-agenda-view { border: none; }

        /* ─── Toolbar ────────────────────────────────────────────────────────── */
        .rbc-lineup .rbc-toolbar {
          padding: 10px 14px;
          gap: 6px;
          flex-wrap: wrap;
          border-bottom: 1px solid var(--border);
          background: var(--card);
        }
        .rbc-lineup .rbc-toolbar button {
          border-radius: 7px;
          border: 1px solid var(--border);
          background: transparent;
          color: var(--foreground);
          font-size: 0.8125rem;
          font-family: inherit;
          font-weight: 500;
          padding: 4px 11px;
          cursor: pointer;
          transition: background 0.12s;
        }
        .rbc-lineup .rbc-toolbar button:hover { background: var(--muted); }
        .rbc-lineup .rbc-toolbar button.rbc-active {
          background: var(--primary);
          color: var(--primary-foreground);
          border-color: transparent;
        }
        .rbc-lineup .rbc-toolbar .rbc-toolbar-label {
          font-weight: 700;
          font-size: 0.9375rem;
          color: var(--foreground);
        }

        /* ─── Month view ─────────────────────────────────────────────────────── */
        .rbc-lineup .rbc-header {
          padding: 7px 4px;
          font-size: 0.72rem;
          font-weight: 600;
          text-transform: uppercase;
          letter-spacing: 0.04em;
          color: var(--muted-foreground);
          border-bottom: 1px solid var(--border);
        }
        .rbc-lineup .rbc-month-view table { tableLayout: fixed; width: 100%; }
        .rbc-lineup .rbc-month-row { min-height: 90px; }
        .rbc-lineup .rbc-date-cell { padding: 4px 6px; font-size: 0.75rem; }
        .rbc-lineup .rbc-date-cell.rbc-now a { font-weight: 700; color: var(--primary); }
        .rbc-lineup .rbc-today { background-color: color-mix(in oklab, var(--primary) 6%, transparent); }
        .rbc-lineup .rbc-off-range-bg { background-color: var(--muted); }
        .rbc-lineup .rbc-off-range .rbc-button-link { color: var(--muted-foreground); opacity: 0.6; }
        .rbc-lineup .rbc-month-row + .rbc-month-row { border-top: 1px solid var(--border); }
        .rbc-lineup .rbc-day-bg + .rbc-day-bg { border-left: 1px solid var(--border); }

        /* ─── Events ─────────────────────────────────────────────────────────── */
        .rbc-lineup .rbc-event:focus { outline: none; }
        .rbc-lineup .rbc-event-label { display: none; }
        .rbc-lineup .rbc-show-more {
          font-size: 0.7rem;
          color: var(--primary);
          font-weight: 600;
          padding: 0 4px;
        }
        .rbc-lineup .rbc-slot-selection {
          background: color-mix(in oklab, var(--primary) 18%, transparent);
        }

        /* ─── Time / Week view ───────────────────────────────────────────────── */
        .rbc-lineup .rbc-time-content { border-top: 1px solid var(--border); }
        .rbc-lineup .rbc-time-header-content,
        .rbc-lineup .rbc-time-content { border-left: 1px solid var(--border); }
        .rbc-lineup .rbc-timeslot-group { border-bottom: 1px solid color-mix(in oklab, var(--border) 50%, transparent); }
        .rbc-lineup .rbc-day-slot .rbc-time-slot { border-top: 1px solid color-mix(in oklab, var(--border) 40%, transparent); }
        .rbc-lineup .rbc-current-time-indicator { background: var(--primary); opacity: 0.7; height: 2px; }
        .rbc-lineup .rbc-time-gutter .rbc-label { font-size: 0.7rem; color: var(--muted-foreground); }

        /* ─── Agenda view ────────────────────────────────────────────────────── */
        .rbc-lineup .rbc-agenda-view table.rbc-agenda-table { border-collapse: separate; border-spacing: 0; border: none; }
        .rbc-lineup .rbc-agenda-view .rbc-agenda-table thead { display: none; }
        .rbc-lineup .rbc-agenda-view .rbc-agenda-empty {
          padding: 3rem;
          text-align: center;
          color: var(--muted-foreground);
          font-size: 0.875rem;
          font-style: italic;
        }
        .rbc-lineup td.rbc-agenda-date-cell {
          vertical-align: top;
          padding: 16px 12px 20px 16px;
          white-space: nowrap;
          min-width: 110px;
          width: 110px;
          border-top: 2px solid var(--border);
          font-size: 0.8125rem;
          font-weight: 700;
          color: var(--foreground);
        }
        .rbc-lineup td.rbc-agenda-time-cell {
          vertical-align: top;
          padding: 16px 12px;
          white-space: nowrap;
          font-size: 0.78rem;
          color: var(--muted-foreground);
          font-variant-numeric: tabular-nums;
          border-top: 1px solid var(--border);
          width: 72px;
          min-width: 72px;
        }
        .rbc-lineup td.rbc-agenda-event-cell {
          vertical-align: top;
          padding: 14px 16px 14px 8px;
          border-top: 1px solid var(--border);
          width: 100%;
        }
        .rbc-lineup td.rbc-agenda-event-cell .rbc-event {
          background-color: transparent !important;
          color: inherit !important;
          padding: 0 !important;
          border-radius: 0 !important;
          box-shadow: none !important;
          border: none !important;
        }
        .rbc-lineup .rbc-agenda-table tbody tr { background-color: transparent !important; }
        .rbc-lineup .rbc-agenda-table tbody td,
        .rbc-lineup .rbc-agenda-table tbody td + td { border-left: none !important; border-right: none !important; }
        .rbc-lineup .rbc-agenda-table tbody tr:hover td.rbc-agenda-time-cell,
        .rbc-lineup .rbc-agenda-table tbody tr:hover td.rbc-agenda-event-cell {
          background-color: color-mix(in oklab, var(--primary) 5%, transparent);
        }
        .rbc-lineup .rbc-agenda-table tbody tr:has(td.rbc-agenda-date-cell) td.rbc-agenda-time-cell,
        .rbc-lineup .rbc-agenda-table tbody tr:has(td.rbc-agenda-date-cell) td.rbc-agenda-event-cell {
          border-top: 2px solid var(--border) !important;
        }
      `}</style>
    </div>
  )
}
