'use client'

import { useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { httpsCallable } from 'firebase/functions'
import { useTranslations } from 'next-intl'
import { functions } from '@/lib/firebase'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { CalendarDays, MapPin, CheckCircle2, XCircle, AlertTriangle, RefreshCw } from 'lucide-react'

export const dynamic = 'force-dynamic'

// ─── types ────────────────────────────────────────────────────────────────────

interface AvailableSession {
  id: string
  start: string
  end: string
  location: string | null
}

interface BookingDetails {
  booking: {
    contactId: string
    firstname: string
    lastname: string
    email: string
    phone: string | null
    status: string
    joinedAt: string | null
  }
  session: {
    id: string
    start: string
    end: string
    location: string | null
    isPast: boolean
  }
  activity: { id: string | null; name: string }
  team: { id: string; name: string; slug: string | null; language: string }
  availableSessions: AvailableSession[]
  canCancel: boolean
  canRebook: boolean
}

// ─── helpers ──────────────────────────────────────────────────────────────────

function formatSessionDate(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleDateString([], {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })
}

function formatSessionTime(startIso: string, endIso: string): string {
  const fmt = (iso: string) =>
    new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  return `${fmt(startIso)} – ${fmt(endIso)}`
}

function StatusBadge({ status }: { status: string }) {
  const t = useTranslations('ManageBooking')
  const map: Record<
    string,
    { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline' }
  > = {
    pending: { label: t('statusPending'), variant: 'outline' },
    confirmed: { label: t('statusConfirmed'), variant: 'default' },
    cancelled: { label: t('statusCancelled'), variant: 'destructive' },
    no_show: { label: t('statusNoShow'), variant: 'secondary' },
  }
  const entry = map[status] ?? { label: status, variant: 'secondary' as const }
  return <Badge variant={entry.variant}>{entry.label}</Badge>
}

// ─── page ─────────────────────────────────────────────────────────────────────

export default function ManageBookingPage() {
  const t = useTranslations('ManageBooking')
  const searchParams = useSearchParams()
  const token = searchParams.get('token') ?? ''

  const [details, setDetails] = useState<BookingDetails | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [cancelling, setCancelling] = useState(false)
  const [cancelDone, setCancelDone] = useState(false)
  const [rebooking, setRebooking] = useState(false)
  const [rebookDone, setRebookDone] = useState(false)
  const [showCancelConfirm, setShowCancelConfirm] = useState(false)
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null)
  const [activeToken, setActiveToken] = useState(token)

  const loadDetails = async (tok: string) => {
    setLoading(true)
    setError(null)
    try {
      const fn = httpsCallable<{ token: string }, { success: boolean } & BookingDetails>(
        functions,
        'getBookingDetails'
      )
      const result = await fn({ token: tok })
      setDetails(result.data as BookingDetails)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      setError(msg.includes('not-found') || msg.includes('not found') ? t('notFound') : msg)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (activeToken) loadDetails(activeToken)
    else setLoading(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeToken])

  const handleCancel = async () => {
    if (!activeToken) return
    setCancelling(true)
    try {
      const fn = httpsCallable<{ token: string }, { success: boolean }>(functions, 'cancelBooking')
      await fn({ token: activeToken })
      setCancelDone(true)
      setShowCancelConfirm(false)
      setDetails(null)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      setError(msg)
    } finally {
      setCancelling(false)
    }
  }

  const handleRebook = async () => {
    if (!activeToken || !selectedSessionId) return
    setRebooking(true)
    try {
      const fn = httpsCallable<
        { token: string; newSessionId: string },
        { success: boolean; newBookingToken?: string }
      >(functions, 'rebookSession')
      const result = await fn({ token: activeToken, newSessionId: selectedSessionId })
      setRebookDone(true)
      if (result.data.newBookingToken) {
        setActiveToken(result.data.newBookingToken)
        setSelectedSessionId(null)
        setRebookDone(false)
        await loadDetails(result.data.newBookingToken)
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      setError(msg)
    } finally {
      setRebooking(false)
    }
  }

  if (!token) {
    return <p className="text-muted-foreground">{t('notFound')}</p>
  }

  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-7 w-48" />
        <div className="rounded-xl border p-5 space-y-3">
          <Skeleton className="h-4 w-64" />
          <Skeleton className="h-4 w-48" />
          <Skeleton className="h-4 w-56" />
        </div>
      </div>
    )
  }

  if (cancelDone) {
    return (
      <div className="text-center py-12 space-y-3">
        <CheckCircle2 className="h-12 w-12 text-green-500 mx-auto" />
        <p className="font-semibold text-lg">{t('cancelSuccess')}</p>
      </div>
    )
  }

  if (error && !details) {
    return (
      <div className="text-center py-12 space-y-3">
        <XCircle className="h-12 w-12 text-muted-foreground mx-auto" />
        <p className="text-muted-foreground">{error}</p>
      </div>
    )
  }

  if (!details) return null

  const { booking, session, activity, availableSessions, canCancel, canRebook } = details
  const sessionDateStr = formatSessionDate(session.start)
  const sessionTimeStr = formatSessionTime(session.start, session.end)

  return (
    <div className="space-y-6 max-w-lg">
      <h1 className="text-2xl font-bold tracking-tight">{t('title')}</h1>

      {/* Booking info card */}
      <div className="rounded-xl border bg-card p-5 space-y-4">
        <div>
          <p className="text-xs text-muted-foreground uppercase tracking-wide mb-1">
            {t('bookingFor')}
          </p>
          <p className="font-semibold text-lg">
            {booking.firstname} {booking.lastname}
          </p>
          <p className="text-sm text-muted-foreground">{booking.email}</p>
        </div>

        <div className="flex items-start gap-2">
          <CalendarDays className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
          <div>
            <p className="text-sm font-medium">{activity.name}</p>
            <p className="text-sm text-muted-foreground">{sessionDateStr}</p>
            <p className="text-sm text-muted-foreground">{sessionTimeStr}</p>
          </div>
        </div>

        {session.location && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <MapPin className="h-4 w-4 shrink-0" />
            <span>{session.location}</span>
          </div>
        )}

        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">{t('status')}:</span>
          <StatusBadge status={booking.status} />
        </div>

        {session.isPast && (
          <div className="flex items-center gap-2 text-sm text-orange-600 bg-orange-50 rounded-lg px-3 py-2">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            <span>{t('pastSession')}</span>
          </div>
        )}
      </div>

      {/* Cancel action */}
      {canCancel && !showCancelConfirm && (
        <Button
          variant="outline"
          className="text-destructive border-destructive/30 hover:bg-destructive/5 w-full"
          onClick={() => setShowCancelConfirm(true)}
        >
          {t('cancelButton')}
        </Button>
      )}

      {canCancel && showCancelConfirm && (
        <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-4 space-y-3">
          <p className="text-sm font-medium">
            {t('cancelConfirm', { activity: activity.name, date: sessionDateStr })}
          </p>
          <div className="flex gap-2">
            <Button
              variant="destructive"
              size="sm"
              onClick={handleCancel}
              disabled={cancelling}
              className="flex-1"
            >
              {cancelling ? t('cancelling') : t('cancelConfirmYes')}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowCancelConfirm(false)}
              disabled={cancelling}
              className="flex-1"
            >
              {t('cancelConfirmNo')}
            </Button>
          </div>
        </div>
      )}

      {/* Rebook section */}
      {canRebook && (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <RefreshCw className="h-4 w-4 text-muted-foreground" />
            <h2 className="font-semibold">{t('rebookTitle')}</h2>
          </div>
          <p className="text-sm text-muted-foreground">{t('rebookDesc')}</p>

          <div className="space-y-2">
            {availableSessions.map((s) => (
              <button
                key={s.id}
                onClick={() => setSelectedSessionId(s.id === selectedSessionId ? null : s.id)}
                className={`w-full text-left rounded-lg border p-3 transition-colors ${
                  selectedSessionId === s.id
                    ? 'border-primary bg-primary/5'
                    : 'border-border hover:border-primary/50'
                }`}
              >
                <p className="text-sm font-medium">{formatSessionDate(s.start)}</p>
                <p className="text-sm text-muted-foreground">{formatSessionTime(s.start, s.end)}</p>
                {s.location && (
                  <p className="text-xs text-muted-foreground mt-0.5 flex items-center gap-1">
                    <MapPin className="h-3 w-3" /> {s.location}
                  </p>
                )}
              </button>
            ))}
          </div>

          {selectedSessionId && (
            <Button onClick={handleRebook} disabled={rebooking} className="w-full">
              {rebooking ? t('rebooking') : t('rebookButton')}
            </Button>
          )}
        </div>
      )}

      {!canRebook && !session.isPast && availableSessions.length === 0 && activity.id && (
        <p className="text-sm text-muted-foreground">{t('noAlternatives')}</p>
      )}

      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  )
}
