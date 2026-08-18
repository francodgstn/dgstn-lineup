'use client'

/**
 * THE SNAPSHOT — the state of the STUDIO, and the page's right-hand rail.
 *
 * ── WHAT IT IS ───────────────────────────────────────────────────────────────
 *
 * Four facts about a business — money, attendance, subscriptions, affiliation —
 * three of which happen to be counted in people. That framing is the thing to
 * protect: the moment it starts collecting contact statistics it becomes a
 * worse copy of the contacts page, which is exactly what was cut from the
 * incumbent to make room for it.
 *
 * It is FIGURES ON THE BACKGROUND — the page's second material, unframed. It
 * sits in the top-right column beside the day, and it does NOT acquire the
 * accent frame just because it moved into a slot that had one: the frame marks
 * the two blocks that carry work, and this one carries reference.
 *
 * ── THE SHAPE ────────────────────────────────────────────────────────────────
 *
 * A tall narrow column is the shape a stack of figures wanted all along. It
 * was a horizontal rail with hairlines between the numbers, which made four
 * unrelated facts read as one instrument panel. Stacked, dividerless, 24px
 * apart, each one is its own line of a short report.
 *
 * RELAXED IS THE SPEC, stated three times, and it outranks density here. No
 * dividers: a gap is not a rule, and none is needed once the numbers stop
 * pretending to be a row.
 *
 * BLANK SPACE IS A MATERIAL. The rail is `justify-between` against the height
 * of the working column beside it, so the headline pins the top, the quote pins
 * the foot, and the air between them is composition rather than leftover. Do
 * not fill it.
 *
 * BOLD TYPE IS THE ANCHOR. "Snapshot" is set at `text-2xl font-black` — the
 * loudest WORD on the page, deliberately in a different channel from the
 * loudest NUMBERS beneath it (which are bigger, at `text-3xl`). A headline and
 * a figure competing at the same size would flatten both.
 *
 * ── SUBSCRIPTIONS vs AFFILIATION, AND THE BAR ────────────────────────────────
 *
 * Two different questions, and the incumbent shipped them as two adjacent
 * numbers a manager could not tell apart:
 *
 *   Subscribed  = `subscription_type_id`            — on one of YOUR plans
 *   Affiliation = `affiliation_summary.has_active`  — an active affiliation,
 *                                                     and the WORD for it is
 *                                                     tenant-configurable
 *                                                     (`useAffiliationTerm`)
 *
 * They are kept apart, by instruction, and never merged into one number. But
 * two captions and two subtitles were the incumbent's fix and they were not
 * enough, because a label says what a number IS while the reader's actual
 * question is why the two DISAGREE.
 *
 * So the pair is followed by ONE PROPORTION BAR that decomposes their union
 * into `both / plan only / affiliation only`. Add the first two segments and
 * you have Subscribed; add the first and third and you have Affiliation. The
 * difference is not described, it is shown, and it is recoverable by
 * arithmetic the reader can do on the legend.
 *
 * WHY THIS EARNS A PLACE WHEN THE DEMOGRAPHICS CARD DID NOT. The rule this
 * page cut those cards by: a daily surface shows facts you act on, and
 * composition analysis belongs in `/contacts`. The bar passes because it
 * DECOMPOSES A FIGURE THAT IS ALREADY IN THE BAND rather than opening a new
 * subject — it answers the follow-up the pair provokes, and nothing else. An
 * age or rank distribution fails the same test and stays where it is.
 *
 * WHY IT NEEDS NO FRAME, without breaking the rule that a plot gets a plotting
 * surface: it is not a plot. There is no axis, no scale, no coordinate space —
 * it is a proportion rule, the same unframed device the day panel already uses
 * for seats. The rule is intact; this object simply is not the kind of thing it
 * governs.
 *
 * ── WHAT IS NOT HERE ─────────────────────────────────────────────────────────
 *
 * "Active members" was a third count of `affiliation_summary.has_active` under
 * a friendlier name — the same number as Affiliation, and precisely the kind of
 * quiet duplicate that made the incumbent's figures unreadable. Total contacts
 * went too: roster size is a roster fact and `/contacts` owns it.
 *
 * DEGRADATION IS BY SUBTRACTION. Money is Studio-tier, so Free and Coach get a
 * three-fact rail — shorter, not holed, and no upgrade nag in a block whose job
 * is to be read in one glance.
 */

import type React from 'react'
import { useTranslations } from 'next-intl'
import { Link } from '@/i18n/navigation'
import type { Route } from 'next'
import { Banknote, CreditCard, IdCard, Layers, TrendingDown, TrendingUp, UserCheck } from 'lucide-react'
import type { Contact } from '@linyup/shared'
import { Skeleton } from '@/components/ui/skeleton'
import { usePlan } from '@/hooks/usePlan'
import { useMonthlyRevenue } from '@/hooks/useMonthlyRevenue'
import { useAffiliationTerm } from '@/hooks/useAffiliationTerm'
import { formatMoneyMinor } from '@/lib/payments'
import { getDailyQuote } from '@/data/quotes'
import { cn } from '@/lib/utils'
import { startOfWeek } from './preview-data'

/** One fact: a captioned number with a line of context under it. */
function Figure({
  icon: Icon,
  caption,
  value,
  note,
  loading,
  href,
}: {
  icon: React.ElementType
  caption: string
  value: React.ReactNode
  note?: React.ReactNode
  loading?: boolean
  href: Route
}) {
  return (
    <Link href={href} className="group/figure block">
      <div className="mb-1 flex items-center gap-1.5">
        <Icon className="h-3.5 w-3.5 shrink-0 text-primary/60" />
        <p className="truncate text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          {caption}
        </p>
      </div>
      {loading ? (
        <Skeleton className="h-8 w-24" />
      ) : (
        <p className="text-3xl font-black leading-none tracking-tight tabular-nums transition-colors group-hover/figure:text-primary">
          {value}
        </p>
      )}
      {/* A FIXED note line, present whether or not there is a note: figures
          stacked with ragged bottoms read as unrelated blocks. */}
      <div className="mt-1 h-4 text-xs text-muted-foreground">{loading ? null : note}</div>
    </Link>
  )
}

function RevenueFigure({ teamId }: { teamId: string | null }) {
  const t = useTranslations('NewDashboard')
  const { data, isLoading } = useMonthlyRevenue(teamId)
  const delta = data?.deltaPercent ?? null
  const up = delta !== null && delta >= 0

  return (
    <Figure
      icon={Banknote}
      caption={t('pulseRevenue')}
      value={formatMoneyMinor(data?.thisMonth ?? 0, data?.currency ?? 'CHF')}
      loading={isLoading}
      href={'/payments' as Route}
      note={
        delta !== null ? (
          <span
            className={cn('flex items-center gap-1', up ? 'text-emerald-600' : 'text-amber-600')}
          >
            {up ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
            {t('pulseRevenueDelta', { percent: Math.abs(delta) })}
          </span>
        ) : (
          t('pulseRevenueNoBaseline')
        )
      }
    />
  )
}

/**
 * The overlap of the two membership figures, as one bar.
 *
 * Segments are separated by a 2px GAP, never a stroke — three tints of one hue
 * need telling apart, and the band's rule is that nothing here is divided by a
 * line. The whole thing renders nothing at all when there is no membership to
 * decompose: a young studio gets three facts and no empty rail.
 */
function OverlapBar({
  both,
  planOnly,
  affiliationOnly,
  affiliationTerm,
}: {
  both: number
  planOnly: number
  affiliationOnly: number
  affiliationTerm: string
}) {
  const t = useTranslations('NewDashboard')
  const total = both + planOnly + affiliationOnly
  if (total === 0) return null

  const segments = [
    { key: 'both', count: both, bar: 'bg-primary', dot: 'bg-primary', label: t('snapshotLegendBoth') },
    {
      key: 'plan',
      count: planOnly,
      bar: 'bg-primary/50',
      dot: 'bg-primary/50',
      label: t('snapshotLegendPlanOnly'),
    },
    {
      key: 'affiliation',
      count: affiliationOnly,
      bar: 'bg-primary/25',
      dot: 'bg-primary/25',
      label: t('snapshotLegendAffiliationOnly', { term: affiliationTerm }),
    },
  ].filter((s) => s.count > 0)

  return (
    <div>
      <div className="mb-2 flex items-center gap-1.5">
        <Layers className="h-3.5 w-3.5 shrink-0 text-primary/60" />
        <p className="truncate text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          {t('snapshotOverlap')}
        </p>
      </div>
      <div className="flex h-2.5 w-full gap-0.5 overflow-hidden rounded-full">
        {segments.map((s) => (
          <div
            key={s.key}
            className={cn('h-full rounded-full', s.bar)}
            style={{ width: `${(s.count / total) * 100}%` }}
          />
        ))}
      </div>
      <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1">
        {segments.map((s) => (
          <span key={s.key} className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <span className={cn('h-2 w-2 shrink-0 rounded-full', s.dot)} />
            {s.label}
            <span className="font-semibold tabular-nums text-foreground/70">{s.count}</span>
          </span>
        ))}
      </div>
    </div>
  )
}

/**
 * THE QUOTE, given a home instead of a footer.
 *
 * It was the page's last line — a sign-off below the fold that nobody reads.
 * It is the one element on this page with no job to do, which is exactly what
 * makes it right for the foot of a rail whose air also has no job.
 *
 * IT MUST NOT READ AS A SYSTEM MESSAGE. Beside real figures, a small italic
 * grey line looks like a status or a warning. So the treatment is unmistakably
 * a quotation and nothing else: a large muted quote glyph, upright text (no
 * italic), an em-dashed attribution — and `figure`/`blockquote`/`figcaption`
 * markup, so it announces itself as an aside to a screen reader too.
 */
function DailyAside() {
  const quote = getDailyQuote()
  return (
    <figure>
      <span aria-hidden className="font-heading block text-4xl leading-none text-primary/15">
        &ldquo;
      </span>
      <blockquote className="mt-1 text-sm leading-relaxed text-muted-foreground">
        {quote.text}
      </blockquote>
      <figcaption className="mt-2 text-xs text-muted-foreground/60">— {quote.author}</figcaption>
    </figure>
  )
}

export function SnapshotColumn({
  teamId,
  contacts,
  loading,
}: {
  teamId: string | null
  contacts: Contact[] | undefined
  loading: boolean
}) {
  const t = useTranslations('NewDashboard')
  const { isAtLeast } = usePlan()
  const affiliationTerm = useAffiliationTerm()
  const seesMoney = isAtLeast('studio')

  const live = (contacts ?? []).filter((c) => !c.archived_at)
  const hasPlan = (c: Contact) => !!c.subscription_type_id
  const hasAffiliation = (c: Contact) => !!c.affiliation_summary?.has_active

  const subscribed = live.filter(hasPlan).length
  const affiliated = live.filter(hasAffiliation).length
  const both = live.filter((c) => hasPlan(c) && hasAffiliation(c)).length

  const weekStart = startOfWeek().getTime()
  const attended = live.filter((c) => {
    const ts = c.last_session_at as { toDate(): Date } | null | undefined
    return !!ts && ts.toDate().getTime() >= weekStart
  }).length

  return (
    /* `justify-between` against the working column's height: headline at the
       top, quote at the foot, air in between — see the module comment. */
    <div className="flex h-full flex-col justify-between gap-8">
      <div>
        <h2 className="font-heading mb-5 text-2xl font-black leading-none tracking-tight text-heading">
          {t('snapshotTitle')}
        </h2>

        <div className="space-y-6">
          {seesMoney && <RevenueFigure teamId={teamId} />}

          <Figure
            icon={UserCheck}
            caption={t('pulseAttended')}
            value={loading ? '' : attended}
            loading={loading}
            href={'/bookings' as Route}
            note={t('pulseAttendedNote')}
          />

          <Figure
            icon={CreditCard}
            caption={t('snapshotSubscribed')}
            value={loading ? '' : subscribed}
            loading={loading}
            href={'/subscriptions' as Route}
            note={t('snapshotSubscribedSub')}
          />

          <Figure
            icon={IdCard}
            caption={affiliationTerm}
            value={loading ? '' : affiliated}
            loading={loading}
            href={'/affiliations' as Route}
            note={t('snapshotAffiliationSub')}
          />

          {!loading && (
            <OverlapBar
              both={both}
              planOnly={subscribed - both}
              affiliationOnly={affiliated - both}
              affiliationTerm={affiliationTerm}
            />
          )}
        </div>
      </div>

      <DailyAside />
    </div>
  )
}
