'use client'

/**
 * THE SEASON, ON PAPER — the federation's calendar grouped by month.
 *
 * HMD publishes its season as a printed sheet that goes on club noticeboards
 * and into members' hands, and until now that meant retyping the calendar
 * somebody had already entered into Linyup.
 *
 * ── HTML AND `@media print`, NOT jsPDF ─────────────────────────────────────
 * The same choice the event handout made, for the same reason: a month-grouped
 * list with headings, wrapping locations and a variable number of rows is
 * something a browser lays out well and jsPDF has to be told about line by
 * line. It also means the reader can adjust the window and reprint without a
 * round trip through a file.
 *
 * ── THE CONTROLS ARE PART OF THE PAGE, AND `.no-print` ─────────────────────
 * A time window and a type filter, because a season sheet is rarely "everything
 * we have ever run" — it is next September to next July, tournaments only, or
 * one club's year. They sit above the sheet and vanish when it prints.
 */

import { useMemo, useState } from 'react'
import { useParams } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { useQuery } from '@tanstack/react-query'
import { collection, getDocs, orderBy, query, where, Timestamp } from 'firebase/firestore'
import { Printer } from 'lucide-react'
import { db } from '@/lib/firebase'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { EVENTS_COLLECTION } from '@linyup/shared'
import type { Event } from '@linyup/shared'

/** `YYYY-MM-DD` for a date input. */
function isoDay(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function startOfDay(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, (m ?? 1) - 1, d ?? 1, 0, 0, 0, 0)
}

function endOfDay(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, (m ?? 1) - 1, d ?? 1, 23, 59, 59, 999)
}

const toDate = (v: unknown): Date | null =>
  v && typeof v === 'object' && 'toDate' in (v as object)
    ? (v as { toDate(): Date }).toDate()
    : null

export default function OrgEventCalendarPrintPage() {
  const t = useTranslations('OrgEvents')
  const tCommon = useTranslations('Common')
  const { orgId } = useParams<{ orgId: string }>()

  // A SEASON, not a year: the default window opens today and runs twelve months,
  // which is the sheet somebody actually wants when they click Print.
  const today = new Date()
  const yearOut = new Date(today.getFullYear() + 1, today.getMonth(), today.getDate())
  const [from, setFrom] = useState(isoDay(today))
  const [to, setTo] = useState(isoDay(yearOut))
  const [type, setType] = useState<string>('all')

  const eventsQ = useQuery<Event[]>({
    queryKey: ['org-events-window', orgId, from, to],
    queryFn: async () => {
      const snap = await getDocs(
        query(
          collection(db, EVENTS_COLLECTION),
          where('orgId', '==', orgId),
          where('scope', '==', 'org'),
          where('deleted_at', '==', null),
          where('start', '>=', Timestamp.fromDate(startOfDay(from))),
          where('start', '<=', Timestamp.fromDate(endOfDay(to))),
          orderBy('start', 'asc')
        )
      )
      return snap.docs.map((d) => ({ ...d.data(), id: d.id }) as Event)
    },
  })

  const types = useMemo(
    () => [...new Set((eventsQ.data ?? []).map((e) => e.type).filter(Boolean))].sort(),
    [eventsQ.data]
  )

  /** Events by month, in order, each month keyed by its first day. */
  const months = useMemo(() => {
    const out = new Map<string, { label: string; events: Event[] }>()
    for (const e of eventsQ.data ?? []) {
      if (type !== 'all' && e.type !== type) continue
      const start = toDate(e.start)
      if (!start) continue
      const key = `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, '0')}`
      if (!out.has(key)) {
        out.set(key, {
          label: start.toLocaleDateString([], { month: 'long', year: 'numeric' }),
          events: [],
        })
      }
      out.get(key)!.events.push(e)
    }
    return [...out.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, v]) => v)
  }, [eventsQ.data, type])

  const total = months.reduce((n, m) => n + m.events.length, 0)

  return (
    <div className="mx-auto max-w-3xl px-6 py-8 calendar-print">
      {/* Controls — gone on paper. */}
      <div className="no-print mb-8 flex flex-wrap items-end gap-3 rounded-xl border p-4">
        <div className="space-y-1.5">
          <Label htmlFor="cal-from">{t('printFrom')}</Label>
          <Input
            id="cal-from"
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            className="w-auto"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="cal-to">{t('printTo')}</Label>
          <Input
            id="cal-to"
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            className="w-auto"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="cal-type">{t('fieldType')}</Label>
          <Select value={type} onValueChange={(v) => setType(v ?? 'all')}>
            <SelectTrigger id="cal-type" className="w-48">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t('filterAllTypes')}</SelectItem>
              {types.map((ty) => (
                <SelectItem key={ty} value={ty}>
                  {ty}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Button onClick={() => window.print()} className="ml-auto">
          <Printer className="mr-1.5 h-4 w-4" />
          {t('printButton')}
        </Button>
      </div>

      <h1 className="mb-1 text-2xl font-semibold">{t('printTitle')}</h1>
      <p className="mb-8 text-sm text-muted-foreground">
        {startOfDay(from).toLocaleDateString()} – {endOfDay(to).toLocaleDateString()}
      </p>

      {eventsQ.isLoading ? (
        <p className="text-sm text-muted-foreground">{tCommon('loading')}</p>
      ) : total === 0 ? (
        <p className="text-sm text-muted-foreground">{t('printEmpty')}</p>
      ) : (
        months.map((m) => (
          // `break-inside: avoid` on the MONTH, so a month never splits across
          // two sheets when it fits on one — the thing that makes a printed
          // calendar hard to read.
          <section key={m.label} className="calendar-print-month mb-7">
            <h2 className="mb-2 border-b pb-1 text-sm font-semibold uppercase tracking-wide">
              {m.label}
            </h2>
            <ul className="space-y-1.5">
              {m.events.map((e) => {
                const start = toDate(e.start)
                const end = toDate(e.end)
                const multiDay =
                  !!end && !!start && isoDay(end) !== isoDay(start) ? isoDay(end) : null
                return (
                  <li key={e.id} className="flex gap-3 text-sm">
                    <span className="w-24 shrink-0 tabular-nums text-muted-foreground">
                      {start?.toLocaleDateString([], { day: '2-digit', month: 'short' })}
                      {multiDay && (
                        <>
                          {' – '}
                          {end?.toLocaleDateString([], { day: '2-digit', month: 'short' })}
                        </>
                      )}
                    </span>
                    <span className="flex-1">
                      <span className="font-medium">{e.title}</span>
                      {e.location && (
                        <span className="text-muted-foreground"> · {e.location}</span>
                      )}
                    </span>
                    <span className="shrink-0 text-xs uppercase text-muted-foreground">
                      {e.type}
                    </span>
                  </li>
                )
              })}
            </ul>
          </section>
        ))
      )}
    </div>
  )
}
