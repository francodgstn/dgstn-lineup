'use client'

/**
 * ACTIVE MEMBERS — how many of the studio's people actually opened something.
 *
 * `Contact.last_seen_at` is stamped in exactly two places: when the member app
 * comes to the foreground (apps/mobile/src/services/firestore.ts) and when a
 * public contact session is established on the web (PublicContactAuthProvider).
 * So this counts members who OPENED the app or the Space — not members who
 * booked, attended or paid. The card says that under the figures rather than
 * leaving the reader to assume, because an engagement number whose definition
 * is a guess is worse than no engagement number at all.
 *
 * ── WHY THREE WINDOWS AND NOT A TREND LINE ──────────────────────────────────
 * A line wants a rollup — a per-day document written by something, which is a
 * feature with a cron and a backfill. Three `count()` aggregations answer the
 * question a studio owner actually asks first ("is anyone using this?") for the
 * price of three cheap reads on an index that already exists
 * (`contacts: teamId + last_seen_at`). If the shape survives the shelf, a trend
 * is the natural next version and the rollup is the work it costs.
 *
 * The percentage is not decoration: 12 active is a triumph at 20 members and a
 * problem at 400, so the count alone cannot be read.
 *
 * Provisional contacts are excluded from the denominator for the same reason
 * the plan cap excludes them — a trial lead who never came back is not part of
 * the membership this figure is about. They are not excluded from the numerator,
 * because a provisional who opens the app is genuinely someone using it.
 */

import { useQuery } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { Smartphone } from 'lucide-react'
import { collection, getCountFromServer, query, where } from 'firebase/firestore'
import { CONTACTS_COLLECTION } from '@linyup/shared'
import { db } from '@/lib/firebase'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'

const DAY_MS = 24 * 60 * 60 * 1000

async function countActive(teamId: string, since: Date): Promise<number> {
  const snap = await getCountFromServer(
    query(
      collection(db, CONTACTS_COLLECTION),
      where('teamId', '==', teamId),
      where('last_seen_at', '>=', since)
    )
  )
  return snap.data().count
}

async function countMembers(teamId: string): Promise<number> {
  const [all, provisional] = await Promise.all([
    getCountFromServer(query(collection(db, CONTACTS_COLLECTION), where('teamId', '==', teamId))),
    getCountFromServer(
      query(
        collection(db, CONTACTS_COLLECTION),
        where('teamId', '==', teamId),
        where('provisional', '==', true)
      )
    ),
  ])
  return Math.max(0, all.data().count - provisional.data().count)
}

export function AppUsageCard({ teamId }: { teamId: string | null }) {
  const t = useTranslations('AppUsage')

  const { data, isLoading } = useQuery({
    // Keyed on the calendar day: the windows move once a day, and a studio
    // refreshing its dashboard all morning should not re-run six aggregations.
    queryKey: ['app-usage', teamId, new Date().toDateString()],
    enabled: !!teamId,
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const id = teamId as string
      const startOfToday = new Date()
      startOfToday.setHours(0, 0, 0, 0)
      const [today, week, month, members] = await Promise.all([
        countActive(id, startOfToday),
        countActive(id, new Date(Date.now() - 7 * DAY_MS)),
        countActive(id, new Date(Date.now() - 30 * DAY_MS)),
        countMembers(id),
      ])
      return { today, week, month, members }
    },
  })

  const rows: Array<{ label: string; value: number | undefined }> = [
    { label: t('today'), value: data?.today },
    { label: t('week'), value: data?.week },
    { label: t('month'), value: data?.month },
  ]

  return (
    <Card className="flex h-full flex-col">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Smartphone className="h-4 w-4 text-muted-foreground" />
          {t('title')}
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-1 flex-col gap-4">
        <div className="grid grid-cols-3 gap-4">
          {rows.map(({ label, value }) => {
            const pct =
              data && data.members > 0 && value !== undefined
                ? Math.round((value / data.members) * 100)
                : null
            return (
              <div key={label} className="flex flex-col gap-1">
                <span className="text-xs uppercase tracking-wide text-muted-foreground">
                  {label}
                </span>
                {isLoading ? (
                  <Skeleton className="h-7 w-12" />
                ) : (
                  <span className="flex items-baseline gap-1.5">
                    <span className="text-2xl font-semibold tabular-nums">{value ?? 0}</span>
                    {pct !== null && (
                      <span className="text-xs text-muted-foreground tabular-nums">{pct}%</span>
                    )}
                  </span>
                )}
              </div>
            )
          })}
        </div>
        <p className="mt-auto text-xs text-muted-foreground">
          {isLoading ? <Skeleton className="h-4 w-3/4" /> : t('note', { members: data?.members ?? 0 })}
        </p>
      </CardContent>
    </Card>
  )
}
