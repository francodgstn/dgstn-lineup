'use client'

import { useQuery } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { doc, getDoc } from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { Link } from '@/i18n/navigation'
import { Badge } from '@/components/ui/badge'
import { Button, buttonVariants } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetFooter } from '@/components/ui/sheet'
import {
  Clock,
  MapPin,
  User,
  Users,
  Mail,
  CreditCard,
  ExternalLink,
  Pencil,
  Trash2,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { EVENTS_COLLECTION } from '@linyup/shared'
import type { Event } from '@linyup/shared'

// Matches the event-type palette used in SessionsCalendar
const EVENT_TYPE_COLOR: Record<string, string> = {
  competition: '#EF4444',
  camp: '#F97316',
  exam: '#8B5CF6',
  seminar: '#3B82F6',
  workshop: '#10B981',
}
const BUILTIN_TYPES = ['competition', 'camp', 'exam', 'seminar', 'workshop']

function formatDate(ts?: { toDate(): Date } | null) {
  if (!ts) return '—'
  return ts.toDate().toLocaleDateString([], {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })
}
function formatTime(ts?: { toDate(): Date } | null) {
  if (!ts) return ''
  return ts.toDate().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

interface EventPeekSheetProps {
  eventId: string | null
  onClose: () => void
  onEdit: (e: Event) => void
  onDelete: (e: Event) => void
}

export function EventPeekSheet({ eventId, onClose, onEdit, onDelete }: EventPeekSheetProps) {
  const t = useTranslations('Calendar')
  const tE = useTranslations('Events')
  const open = !!eventId

  // Same query key as the event detail page → shared cache, instant full-page navigation
  const eventQ = useQuery<Event | null>({
    queryKey: ['event', eventId],
    enabled: open,
    queryFn: async () => {
      const snap = await getDoc(doc(db, EVENTS_COLLECTION, eventId!))
      if (!snap.exists()) return null
      return { id: snap.id, ...snap.data() } as Event
    },
  })

  const event = eventQ.data
  const accent = (event && EVENT_TYPE_COLOR[event.type]) ?? '#6B7280'
  const typeLabel = event
    ? BUILTIN_TYPES.includes(event.type)
      ? tE(`type_${event.type}` as Parameters<typeof tE>[0])
      : event.type
    : ''
  const attendees = event?.attendees_count ?? event?.participants_count ?? 0
  const invitations = event?.invitations_sent_count ?? 0

  return (
    <Sheet
      open={open}
      onOpenChange={(v) => {
        if (!v) onClose()
      }}
    >
      <SheetContent
        side="right"
        className="data-[side=right]:w-full data-[side=right]:sm:max-w-md gap-0 p-0"
      >
        {/* Event-type accent bar */}
        <div className="h-1 w-full shrink-0" style={{ background: accent }} />

        {eventQ.isLoading && (
          <div className="p-4 space-y-3">
            <Skeleton className="h-6 w-48" />
            <Skeleton className="h-4 w-64" />
            <Skeleton className="h-24 w-full rounded-xl" />
          </div>
        )}

        {!eventQ.isLoading && !event && (
          <div className="p-8 text-center text-sm text-muted-foreground">
            {t('peekEventNotFound')}
          </div>
        )}

        {event && (
          <>
            <SheetHeader className="pb-3">
              <div className="flex items-center gap-2 pr-8 flex-wrap">
                <SheetTitle className="truncate">{event.title}</SheetTitle>
                <Badge
                  variant="secondary"
                  className="text-xs shrink-0"
                  style={{ backgroundColor: `${accent}1F`, color: accent }}
                >
                  {typeLabel}
                </Badge>
                {event.scope === 'org' && (
                  <Badge variant="outline" className="text-xs shrink-0">
                    Org
                  </Badge>
                )}
                {event.status === 'cancelled' && (
                  <Badge
                    variant="outline"
                    className="text-xs shrink-0 text-destructive border-destructive/30"
                  >
                    {t('statusCancelled')}
                  </Badge>
                )}
              </div>
              <div className="space-y-1.5 text-sm text-muted-foreground mt-1">
                <div className="flex items-center gap-2">
                  <Clock className="h-3.5 w-3.5 shrink-0" />
                  <span>
                    {formatDate(event.start)} · {formatTime(event.start)}
                    {event.end ? ` – ${formatTime(event.end)}` : ''}
                  </span>
                </div>
                {event.location && (
                  <div className="flex items-center gap-2">
                    <MapPin className="h-3.5 w-3.5 shrink-0" />
                    <span className="truncate">{event.location}</span>
                  </div>
                )}
                {event.coachName && (
                  <div className="flex items-center gap-2">
                    <User className="h-3.5 w-3.5 shrink-0" />
                    <span className="truncate">{event.coachName}</span>
                  </div>
                )}
              </div>
            </SheetHeader>

            <div className="flex-1 overflow-y-auto px-4 pb-4 space-y-4">
              {/* Quick stats */}
              <div className="flex flex-wrap gap-2">
                <div className="flex items-center gap-1.5 rounded-lg bg-muted text-muted-foreground px-2.5 py-1.5 text-xs font-medium">
                  <Users className="h-3.5 w-3.5" />
                  {attendees} {tE('detail_tabAttendees')}
                </div>
                {invitations > 0 && (
                  <div className="flex items-center gap-1.5 rounded-lg bg-muted text-muted-foreground px-2.5 py-1.5 text-xs font-medium">
                    <Mail className="h-3.5 w-3.5" />
                    {invitations} {tE('detail_tabInvitations')}
                  </div>
                )}
                {event.fee != null && event.fee > 0 && (
                  <div className="flex items-center gap-1.5 rounded-lg bg-muted text-muted-foreground px-2.5 py-1.5 text-xs font-medium">
                    <CreditCard className="h-3.5 w-3.5" />
                    {tE('fieldFee')}: {event.fee}
                  </div>
                )}
              </div>

              {/* Description */}
              {event.description && (
                <p
                  className="text-sm text-muted-foreground leading-relaxed border-l-2 pl-3"
                  style={{ borderColor: accent }}
                >
                  {event.description}
                </p>
              )}
            </div>

            <SheetFooter className="flex-row items-center gap-2 border-t">
              <Link
                href={`/events/${event.id}`}
                className={cn(buttonVariants({ variant: 'default' }), 'flex-1')}
              >
                <ExternalLink className="h-3.5 w-3.5" />
                {t('peekOpenFull')}
              </Link>
              <Button
                variant="outline"
                size="icon"
                onClick={() => onEdit(event)}
                title={t('peekEdit')}
              >
                <Pencil className="h-4 w-4" />
              </Button>
              <Button
                variant="outline"
                size="icon"
                className="text-muted-foreground hover:text-destructive"
                onClick={() => onDelete(event)}
                title={t('peekDelete')}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </SheetFooter>
          </>
        )}
      </SheetContent>
    </Sheet>
  )
}
