'use client'

// Manifest — the printable day sheet. Every session on one day with its roster,
// check-in state, and the notes a coach needs at the door.
//
// This is an OPERATIONAL sheet, not a report: it answers "who is coming to what,
// today", and it is built to be printed. The print rules live in globals.css
// (`.manifest-sheet` / `.no-print`) — the app chrome is hidden and the sheet
// prints as plain paper with check-in boxes to tick by hand when the tablet
// isn't to hand.

import { useMemo, useState } from 'react'
import { useTranslations, useLocale } from 'next-intl'
import { Printer, ChevronLeft, ChevronRight, Users } from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { useDaySheet, activeBookings, type DaySheetEntry } from '@/hooks/useDaySheet'
import type { Booking } from '@linyup/shared'

// ─── helpers ──────────────────────────────────────────────────────────────────

function toDateKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function fromDateKey(key: string): Date {
  return new Date(key + 'T00:00:00')
}

function formatTime(ts: { toDate(): Date } | undefined, locale: string): string {
  if (!ts) return ''
  return ts.toDate().toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })
}

function bookingName(b: Booking): string {
  const full = `${b.firstname ?? ''} ${b.lastname ?? ''}`.trim()
  return full || b.email || '—'
}

/**
 * Book-form answers as one compact line.
 *
 * Answers are keyed by field id and the LABELS live on the activity, which the
 * day sheet doesn't load — so this prints values only. That reads fine in
 * practice ("left knee, size 42") and keeps the sheet to one query per session;
 * if labels turn out to matter, mirror them onto the booking at write time
 * rather than joining activities in here.
 */
function formatAnswers(answers: Record<string, unknown>): string {
  return Object.values(answers)
    .map((v) => {
      if (v === true) return '✓'
      if (v === false) return ''
      return Array.isArray(v) ? v.join(', ') : String(v ?? '')
    })
    .filter((s) => s.trim())
    .join(' · ')
}

// ─── page ─────────────────────────────────────────────────────────────────────

export default function ManifestPage() {
  const { currentTeamId, team } = useAuth()
  const t = useTranslations('Manifest')
  const locale = useLocale()
  const [dayKey, setDayKey] = useState(() => toDateKey(new Date()))
  const day = useMemo(() => fromDateKey(dayKey), [dayKey])

  const { data: entries, isLoading } = useDaySheet(currentTeamId, day)

  function shiftDay(delta: number) {
    const next = fromDateKey(dayKey)
    next.setDate(next.getDate() + delta)
    setDayKey(toDateKey(next))
  }

  const dayLabel = day.toLocaleDateString(locale, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })

  // Sessions with nobody booked still print — an empty class is exactly the
  // thing a coach wants to know before travelling to it.
  const visible = entries ?? []
  const totalBooked = visible.reduce((n, e) => n + activeBookings(e.bookings).length, 0)

  return (
    <div className="max-w-4xl space-y-5">
      {/* Toolbar — screen only */}
      <div className="no-print flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">{t('pageTitle')}</h1>
          <p className="text-sm text-muted-foreground">{t('pageSubtitle')}</p>
        </div>
        <Button onClick={() => window.print()} className="gap-2">
          <Printer className="h-4 w-4" />
          {t('print')}
        </Button>
      </div>

      {/* Day navigator — screen only */}
      <div className="no-print flex flex-wrap items-center gap-2">
        <Button variant="outline" size="sm" onClick={() => shiftDay(-1)} aria-label={t('previousDay')}>
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <input
          type="date"
          value={dayKey}
          onChange={(e) => e.target.value && setDayKey(e.target.value)}
          className="h-9 rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
        />
        <Button variant="outline" size="sm" onClick={() => shiftDay(1)} aria-label={t('nextDay')}>
          <ChevronRight className="h-4 w-4" />
        </Button>
        <Button variant="ghost" size="sm" onClick={() => setDayKey(toDateKey(new Date()))}>
          {t('today')}
        </Button>
      </div>

      {isLoading ? (
        <div className="space-y-3">
          <Skeleton className="h-24 rounded-lg" />
          <Skeleton className="h-24 rounded-lg" />
        </div>
      ) : (
        <div className="manifest-sheet space-y-5">
          {/* Sheet header — only meaningful on paper, where there's no app chrome */}
          <div className="hidden print:block border-b pb-2">
            <p className="text-lg font-semibold">{team?.name ?? ''}</p>
            <p className="text-sm">
              {dayLabel} · {t('bookedCount', { count: totalBooked })}
            </p>
          </div>

          <p className="no-print text-sm text-muted-foreground">
            {dayLabel} · {t('bookedCount', { count: totalBooked })}
          </p>

          {visible.length === 0 ? (
            <div className="rounded-xl border bg-muted/30 p-8 text-center">
              <p className="text-sm text-muted-foreground">{t('noSessions')}</p>
            </div>
          ) : (
            visible.map((entry) => <ManifestSession key={entry.session.id} entry={entry} />)
          )}
        </div>
      )}
    </div>
  )
}

// ─── one session block ────────────────────────────────────────────────────────

function ManifestSession({ entry }: { entry: DaySheetEntry }) {
  const t = useTranslations('Manifest')
  const locale = useLocale()
  const { session } = entry
  const roster = activeBookings(entry.bookings)
  const checkedIn = new Set(entry.participants.map((p) => p.contactId))

  // A walk-in checked in without a booking still belongs on the sheet.
  const bookedContactIds = new Set(roster.map((b) => b.contact))
  const walkIns = entry.participants.filter((p) => !bookedContactIds.has(p.contactId))

  const cap = session.max_participants
  // Bodies in the room = bookings still holding a seat + walk-ins who checked
  // in without one. This is what capacity should be read against.
  const total = roster.length + walkIns.length
  const isCancelled = session.status === 'cancelled'

  return (
    <section
      className={`manifest-session rounded-xl border bg-card p-4 space-y-3 ${
        isCancelled ? 'opacity-60' : ''
      }`}
    >
      <header className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b pb-2">
        <div className="min-w-0">
          <p className="font-semibold">
            {formatTime(session.start, locale)}–{formatTime(session.end, locale)}{' '}
            {session.activityName || t('sessionFallback')}
          </p>
          <p className="text-xs text-muted-foreground">
            {[session.providerName, session.location].filter(Boolean).join(' · ')}
          </p>
        </div>
        {/* Headcount. Capacity is measured against TOTAL bodies in the room —
            a walk-in takes a spot as surely as a booking does, so counting only
            bookings against `cap` under-reports how full the session is.
            The booked/walk-in split is only shown when there ARE walk-ins;
            otherwise total === booked and the breakdown is pure noise. */}
        <p className="text-sm font-medium tabular-nums">
          {cap ? `${total}/${cap}` : total}
          <span className="ml-1 font-normal text-muted-foreground">
            {walkIns.length > 0 ? t('totalLabel') : t('bookedLabel')}
          </span>
          {walkIns.length > 0 && (
            <span className="ml-2 font-normal text-muted-foreground">
              ({t('countBooked', { count: roster.length })} ·{' '}
              {t('countWalkIns', { count: walkIns.length })})
            </span>
          )}
        </p>
      </header>

      {isCancelled && (
        <p className="text-sm font-medium text-destructive">{t('sessionCancelled')}</p>
      )}

      {/* The studio's own note for this specific session — the reason a
          headline exists (substitute coach, bring a mat, moved room). */}
      {session.headline && (
        <p className="text-sm font-medium">{session.headline}</p>
      )}
      {session.notes && <p className="text-sm text-muted-foreground">{session.notes}</p>}

      {roster.length === 0 && walkIns.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('nobodyBooked')}</p>
      ) : (
        <ul className="divide-y">
          {roster.map((b) => {
            const arrived = checkedIn.has(b.contact)
            return (
              <li key={b.id} className="flex items-center gap-3 py-1.5 text-sm">
                {/* Empty box on paper, filled state on screen — the sheet is
                    meant to be ticked by hand when the tablet isn't to hand. */}
                <span
                  aria-hidden
                  className={`inline-block h-4 w-4 shrink-0 rounded border ${
                    arrived ? 'bg-foreground print:bg-transparent' : ''
                  }`}
                />
                <span className="flex-1 min-w-0 truncate">{bookingName(b)}</span>
                {b.status === 'no_show' && (
                  <span className="shrink-0 text-xs text-muted-foreground">{t('noShow')}</span>
                )}
                {b.payment_status === 'required' && (
                  <span className="shrink-0 text-xs text-amber-700">{t('unpaid')}</span>
                )}
                {b.phone && (
                  <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                    {b.phone}
                  </span>
                )}
                {/* Book-form answers — the reason the studio asked. Rendered
                    inline (not behind a toggle) because the whole point is that
                    the coach reads them on paper at the door. */}
                {b.question_answers && Object.keys(b.question_answers).length > 0 && (
                  <span className="w-full pl-7 text-xs text-muted-foreground">
                    {formatAnswers(b.question_answers)}
                  </span>
                )}
              </li>
            )
          })}
          {walkIns.map((p) => (
            <li key={p.contactId} className="flex items-center gap-3 py-1.5 text-sm">
              <span aria-hidden className="inline-block h-4 w-4 shrink-0 rounded border bg-foreground print:bg-transparent" />
              <span className="flex-1 min-w-0 truncate text-muted-foreground">
                <Users className="mr-1 inline h-3 w-3" />
                {t('walkIn')}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
