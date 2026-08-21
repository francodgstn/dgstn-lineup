'use client'

// ─── THE CATALOGUE ───────────────────────────────────────────────────────────
//
// Activities and plans are a many-to-many, and the thing a studio is actually
// editing is the EDGE between them — "Premium includes Yoga Basics". That edge
// had no home: it was authored from inside the activity dialog and again from
// inside the plan dialog, and displayed nowhere you could scan. A coach
// answering "what does Premium get?" switched routes and opened a modal.
//
// So: one rail, one pane, and the edge visible from whichever side you are
// thinking in. The pane owns the RELATIONSHIP and the name; everything else
// stays with the entity's own editor, which is a ~700-line form per kind and a
// different project to move.
//
// ── WHY PLANS SIT ABOVE THE ACTIVITIES ──────────────────────────────────────
// A studio has a handful of plans and can have thirty classes. Plans-below
// would mean scrolling past every class to reach the short list you came for;
// this way scrolling only ever happens INSIDE the long list you are already
// browsing.
//
// ── WHY THREE GROUPS AND NOT TWO ────────────────────────────────────────────
// Classes and appointments differ in a way the pane has to show — an
// appointment has no access gate, because the price is the gate — so the rail
// is where that asymmetry costs nothing to make visible.
//
// ── NO MATRIX ───────────────────────────────────────────────────────────────
// Not because a cell could not hold "20% off", but because there is no per-pair
// value to put in one: `memberBenefit` is ONE rule per activity shared by every
// plan on it. The per-pair matrix existed and was cut in 2026-07 after it
// produced real coach confusion.

import { useMemo, useState } from 'react'
import { useTranslations } from 'next-intl'
import { useSearchParams } from 'next/navigation'
import type { Route } from 'next'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { collection, doc, getDocs, updateDoc } from 'firebase/firestore'
import { AlertTriangle, IdCard, Zap, CalendarClock, Pencil, Check, X } from 'lucide-react'

import {
  ACTIVITIES_COLLECTION,
  SUBSCRIPTION_TYPES_SUBCOLLECTION,
  TEAMS_COLLECTION,
  gatedPlanIds,
  isAppointmentActivity,
  ratedPlanIds,
  type Activity,
  type SubscriptionType,
} from '@linyup/shared'
import { db } from '@/lib/firebase'
import { useAuth } from '@/contexts/AuthContext'
import { useActivities } from '@/hooks/useActivities'
import { useCapabilities } from '@/hooks/useCapabilities'
import { Link, useRouter } from '@/i18n/navigation'
import { PageHeader } from '@/components/layout/PageHeader'
import { Button, buttonVariants } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { computePricingHealth, type PricingWarning } from '@/lib/pricingSurface'
import { useGatewayCurrency } from '@/components/connect/BillingCurrencyCard'
import { ActivityPlanLinks } from '@/components/offer/ActivityPlanLinks'

const DEFAULT_ACCENT = '#6366f1'

/** The two health codes that mean "nobody can book this". The banner counts
 *  exactly these and adds no second definition of covered — a members-tier class
 *  in no plan is healthy, and stays uncounted. */
const DEAD_END_CODES = new Set<PricingWarning['code']>([
  'gated_empty_allowlist',
  'appointment_no_way_in',
])

type Selection = { kind: 'activity' | 'plan'; id: string } | null

/** Selection rides in the URL so the pane is deep-linkable — which is what lets
 *  the pricing surface's warnings point AT the thing to fix instead of at a list
 *  page with the fix somewhere on it. */
function parseSelection(raw: string | null): Selection {
  if (!raw) return null
  const [kind, ...rest] = raw.split(':')
  const id = rest.join(':')
  if (!id) return null
  if (kind === 'activity' || kind === 'plan') return { kind, id }
  return null
}

function useSubscriptionTypes(teamId: string | null) {
  return useQuery<SubscriptionType[]>({
    queryKey: ['subscription-types', teamId],
    enabled: !!teamId,
    queryFn: async () => {
      if (!teamId) return []
      const snap = await getDocs(
        collection(db, TEAMS_COLLECTION, teamId, SUBSCRIPTION_TYPES_SUBCOLLECTION)
      )
      return snap.docs
        .map((d) => ({ ...d.data(), id: d.id }) as SubscriptionType)
        .sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || a.name.localeCompare(b.name))
    },
  })
}

export default function CataloguePage() {
  const t = useTranslations('OfferCatalogue')
  const { currentTeamId, team } = useAuth()
  const canEdit = useCapabilities().can('team.settings')
  const router = useRouter()
  const params = useSearchParams()
  const qc = useQueryClient()

  const selection = parseSelection(params.get('sel'))
  const [onlyDeadEnds, setOnlyDeadEnds] = useState(false)

  const { data: activities = [], isLoading: loadingActivities } = useActivities(currentTeamId)
  const { data: plans = [], isLoading: loadingPlans } = useSubscriptionTypes(currentTeamId)
  const { data: gatewayCurrency } = useGatewayCurrency(currentTeamId)
  const loading = loadingActivities || loadingPlans
  // Same derivation as the Subscriptions panel — the stored team currency, else
  // whatever the payment gateway is configured in, else CHF. Two surfaces
  // showing a rate in different currencies would be worse than either being
  // wrong.
  const currency = (team?.default_currency ?? gatewayCurrency ?? 'CHF').toUpperCase()

  // Courses are passed empty on purpose: the banner counts only the two ACTIVITY
  // codes above, and neither is ever raised for a course — so fetching them
  // would buy a round-trip and change nothing that is displayed.
  const warnings = useMemo(
    () => computePricingHealth(activities, plans, []).filter((w) => DEAD_END_CODES.has(w.code)),
    [activities, plans]
  )
  const deadEndIds = useMemo(() => new Set(warnings.map((w) => w.subjectId)), [warnings])

  const classes = activities.filter((a) => !isAppointmentActivity(a))
  const appointments = activities.filter(isAppointmentActivity)
  const visible = (list: Activity[]) =>
    onlyDeadEnds ? list.filter((a) => deadEndIds.has(a.id)) : list

  function select(next: Selection) {
    const sel = next ? `${next.kind}:${next.id}` : null
    router.replace((sel ? `/offer/catalogue?sel=${sel}` : '/offer/catalogue') as Route, {
      scroll: false,
    })
  }

  const selectedActivity =
    selection?.kind === 'activity' ? activities.find((a) => a.id === selection.id) : undefined
  const selectedPlan =
    selection?.kind === 'plan' ? plans.find((p) => p.id === selection.id) : undefined

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('title')}
        subtitle={t('subtitle')}
        quickLinks={[
          { href: '/offer/pricing' as Route, label: t('toPricing') },
          { href: '/offer/activities' as Route, label: t('toActivities') },
        ]}
      />

      {/* The banner counts dead ends, and clicking it FILTERS THE RAIL rather
          than opening a report — the fix is in the pane beside it. */}
      {warnings.length > 0 && (
        <button
          type="button"
          onClick={() => setOnlyDeadEnds((v) => !v)}
          aria-pressed={onlyDeadEnds}
          className={`flex w-full items-start gap-2.5 rounded-lg border p-3 text-left transition-colors ${
            onlyDeadEnds
              ? 'border-amber-500 bg-amber-500/10'
              : 'border-amber-500/40 bg-amber-500/5 hover:bg-amber-500/10'
          }`}
        >
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
          <span className="min-w-0 flex-1 text-sm">
            <span className="font-medium">{t('deadEnds', { count: warnings.length })}</span>
            <span className="block text-xs text-muted-foreground">
              {onlyDeadEnds ? t('deadEndsClear') : t('deadEndsAction')}
            </span>
          </span>
        </button>
      )}

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(260px,2fr)_3fr]">
        {/* ── the rail ── */}
        <div className="space-y-4 rounded-xl border bg-card p-2">
          {loading && (
            <div className="space-y-2 p-2">
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className="h-9 rounded-lg" />
              ))}
            </div>
          )}

          {!loading && (
            <>
              <RailGroup icon={IdCard} label={t('railPlans')}>
                {plans.length === 0 ? (
                  <RailEmpty text={t('noPlans')} />
                ) : (
                  plans.map((p) => (
                    <RailRow
                      key={p.id}
                      name={p.name}
                      selected={selection?.kind === 'plan' && selection.id === p.id}
                      onClick={() =>
                        select(
                          selection?.kind === 'plan' && selection.id === p.id
                            ? null
                            : { kind: 'plan', id: p.id }
                        )
                      }
                    />
                  ))
                )}
              </RailGroup>

              <RailGroup icon={Zap} label={t('railClasses')}>
                {visible(classes).length === 0 ? (
                  <RailEmpty text={onlyDeadEnds ? t('noneFiltered') : t('noClasses')} />
                ) : (
                  visible(classes).map((a) => (
                    <RailRow
                      key={a.id}
                      name={a.name}
                      color={a.color}
                      warn={deadEndIds.has(a.id)}
                      selected={selection?.kind === 'activity' && selection.id === a.id}
                      onClick={() =>
                        select(
                          selection?.kind === 'activity' && selection.id === a.id
                            ? null
                            : { kind: 'activity', id: a.id }
                        )
                      }
                    />
                  ))
                )}
              </RailGroup>

              <RailGroup icon={CalendarClock} label={t('railAppointments')}>
                {visible(appointments).length === 0 ? (
                  <RailEmpty text={onlyDeadEnds ? t('noneFiltered') : t('noAppointments')} />
                ) : (
                  visible(appointments).map((a) => (
                    <RailRow
                      key={a.id}
                      name={a.name}
                      color={a.color}
                      warn={deadEndIds.has(a.id)}
                      selected={selection?.kind === 'activity' && selection.id === a.id}
                      onClick={() =>
                        select(
                          selection?.kind === 'activity' && selection.id === a.id
                            ? null
                            : { kind: 'activity', id: a.id }
                        )
                      }
                    />
                  ))
                )}
              </RailGroup>
            </>
          )}
        </div>

        {/* ── the pane ── */}
        <div className="rounded-xl border bg-card p-4">
          {!selection && (
            <div className="space-y-2 px-4 py-12 text-center">
              <IdCard className="mx-auto h-8 w-8 text-muted-foreground/40" />
              <p className="text-sm text-muted-foreground">{t('paneEmpty')}</p>
            </div>
          )}

          {selectedActivity && (
            <PaneBody
              key={selectedActivity.id}
              title={selectedActivity.name}
              badge={
                isAppointmentActivity(selectedActivity) ? t('appointmentBadge') : t('classBadge')
              }
              summary={
                isAppointmentActivity(selectedActivity)
                  ? t('summaryAppointment', { plans: ratedPlanIds(selectedActivity).length })
                  : t('summaryClass', {
                      gated: gatedPlanIds(selectedActivity).length,
                      rated: ratedPlanIds(selectedActivity).length,
                    })
              }
              editHref={'/offer/activities' as Route}
              canEdit={canEdit}
              onRename={async (name) => {
                await updateDoc(doc(db, ACTIVITIES_COLLECTION, selectedActivity.id), { name })
                await qc.invalidateQueries({ queryKey: ['activities'] })
              }}
            >
              <ActivityPlanLinks
                direction="from-activity"
                activity={selectedActivity}
                activities={activities}
                plans={plans}
                currency={currency}
                canEdit={canEdit}
              />
            </PaneBody>
          )}

          {selectedPlan && (
            <PaneBody
              key={selectedPlan.id}
              title={selectedPlan.name}
              summary={t('summaryPlan', {
                count: activities.filter(
                  (a) =>
                    gatedPlanIds(a).includes(selectedPlan.id) ||
                    ratedPlanIds(a).includes(selectedPlan.id)
                ).length,
              })}
              editHref={'/offer/plans' as Route}
              canEdit={canEdit}
              onRename={async (name) => {
                if (!currentTeamId) return
                await updateDoc(
                  doc(
                    db,
                    TEAMS_COLLECTION,
                    currentTeamId,
                    SUBSCRIPTION_TYPES_SUBCOLLECTION,
                    selectedPlan.id
                  ),
                  { name }
                )
                await qc.invalidateQueries({ queryKey: ['subscription-types', currentTeamId] })
              }}
            >
              <ActivityPlanLinks
                direction="from-plan"
                plan={selectedPlan}
                activities={activities}
                plans={plans}
                currency={currency}
                canEdit={canEdit}
              />
            </PaneBody>
          )}

          {/* Selected, but gone — a stale deep link, or something archived in
              another tab. Saying so beats an empty pane that looks like a bug. */}
          {selection && !selectedActivity && !selectedPlan && !loading && (
            <div className="space-y-2 px-4 py-12 text-center">
              <p className="text-sm text-muted-foreground">{t('paneMissing')}</p>
              <Button variant="outline" size="sm" onClick={() => select(null)}>
                {t('paneMissingAction')}
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

/** The pane's frame: name (inline-editable), a one-line summary, an Edit escape
 *  hatch, and the edge editor below. */
function PaneBody({
  title,
  badge,
  summary,
  editHref,
  canEdit,
  onRename,
  children,
}: {
  title: string
  badge?: string
  summary: string
  editHref: Route
  canEdit: boolean
  onRename: (name: string) => Promise<void>
  children: React.ReactNode
}) {
  const t = useTranslations('OfferCatalogue')
  // A pane that shows a name but cannot change it sends you to a modal for the
  // commonest small edit there is. So the NAME is here and everything else is
  // behind Edit.
  const [renaming, setRenaming] = useState(false)
  const [draft, setDraft] = useState(title)
  const [busy, setBusy] = useState(false)

  async function commit() {
    const next = draft.trim()
    if (!next || next === title) {
      setRenaming(false)
      setDraft(title)
      return
    }
    setBusy(true)
    try {
      await onRename(next)
      setRenaming(false)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          {renaming ? (
            <div className="flex items-center gap-1.5">
              <Input
                autoFocus
                value={draft}
                disabled={busy}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void commit()
                  if (e.key === 'Escape') {
                    setRenaming(false)
                    setDraft(title)
                  }
                }}
                className="h-8 w-56 text-sm"
                aria-label={t('nameLabel')}
              />
              <Button size="icon" variant="ghost" disabled={busy} onClick={() => void commit()}>
                <Check className="h-4 w-4" />
              </Button>
              <Button
                size="icon"
                variant="ghost"
                disabled={busy}
                onClick={() => {
                  setRenaming(false)
                  setDraft(title)
                }}
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <h2 className="truncate text-lg font-semibold">{title}</h2>
              {badge && (
                <Badge variant="outline" className="text-[10px] font-normal">
                  {badge}
                </Badge>
              )}
              {canEdit && (
                <button
                  type="button"
                  onClick={() => {
                    setDraft(title)
                    setRenaming(true)
                  }}
                  title={t('rename')}
                  aria-label={t('rename')}
                  className="rounded p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                >
                  <Pencil className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          )}
          <p className="text-xs text-muted-foreground">{summary}</p>
        </div>
        <Link href={editHref} className={buttonVariants({ variant: 'outline', size: 'sm' })}>
          {t('editAll')}
        </Link>
      </div>

      <div className="border-t pt-4">{children}</div>
    </div>
  )
}

function RailGroup({
  icon: Icon,
  label,
  children,
}: {
  icon: React.ElementType
  label: string
  children: React.ReactNode
}) {
  return (
    <div>
      <div className="flex items-center gap-1.5 px-2 py-1.5 text-xs font-medium text-muted-foreground">
        <Icon className="h-3.5 w-3.5" />
        {label}
      </div>
      <div className="space-y-0.5">{children}</div>
    </div>
  )
}

function RailRow({
  name,
  color,
  warn,
  selected,
  onClick,
}: {
  name: string
  color?: string
  warn?: boolean
  selected: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className={`flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left transition-colors ${
        selected ? 'bg-primary/10 text-primary' : 'hover:bg-muted'
      }`}
    >
      {color !== undefined && (
        <span
          className="h-2.5 w-2.5 shrink-0 rounded-full"
          style={{ background: color || DEFAULT_ACCENT }}
        />
      )}
      <span className="truncate text-sm">{name}</span>
      {warn && <AlertTriangle className="ml-auto h-3.5 w-3.5 shrink-0 text-amber-600" />}
    </button>
  )
}

function RailEmpty({ text }: { text: string }) {
  return <p className="px-2 py-1.5 text-xs text-muted-foreground">{text}</p>
}
