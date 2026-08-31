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
// ── THE RAIL IS TABBED, AND PRODUCTS ARE ONE OF THE TABS ────────────────────
// It was four stacked groups, which meant scrolling past every plan to reach a
// class, and past every class to reach a course. Tabs are the right shape for
// lists that are alternatives to each other rather than parts of one list.
//
// Classes and appointments stay as SUB-HEADINGS inside the Activities tab: they
// differ in a way the pane has to show (an appointment has no access gate,
// because the price is the gate), and that asymmetry is worth seeing, but they
// are the same kind of thing and splitting them into two tabs would say
// otherwise.
//
// PRODUCTS ARE HERE NOW, and the file used to say flatly that they were not.
// The old reasoning was sound about the EDGE — a product carries no access rule
// and no benefit, so no plan can open it and the edge editor has nothing to
// draw. It was wrong about the PAGE: a studio opening "the catalogue" expects
// everything it sells to be in it, and being told nothing is worse than being
// told "this one is sold on its own" (Franco, 2026-08-31). So a product selects
// like anything else, the pane shows its facts, and where the edge editor would
// be it says plainly that a plan cannot open a product. Gift cards stay out:
// a gift card is a TENDER, not a thing that is sold.
//
// ── NO MATRIX ───────────────────────────────────────────────────────────────
// Not because a cell could not hold "20% off", but because there is no per-pair
// value to put in one: `memberBenefit` is ONE rule per activity shared by every
// plan on it. The per-pair matrix existed and was cut in 2026-07 after it
// produced real coach confusion.

import { Fragment, useMemo, useState } from 'react'
import { useTranslations } from 'next-intl'
import { useSearchParams } from 'next/navigation'
import type { Route } from 'next'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { collection, doc, getDocs, updateDoc, writeBatch } from 'firebase/firestore'
import {
  AlertTriangle,
  IdCard,
  Zap,
  CalendarClock,
  GraduationCap,
  GripVertical,
  Package,
  Pencil,
  Check,
  X,
} from 'lucide-react'

import {
  ACTIVITIES_COLLECTION,
  COURSES_COLLECTION,
  PRODUCTS_SUBCOLLECTION,
  SUBSCRIPTION_TYPES_SUBCOLLECTION,
  TEAMS_COLLECTION,
  courseGatedPlanIds,
  courseRatedPlanIds,
  coursePlanFacets,
  gatedPlanIds,
  isAppointmentActivity,
  ratedPlanIds,
  resolveActivityAccessRule,
  type Activity,
  type Course,
  type Product,
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
import { ActivityPlanLinks, type Offering } from '@/components/offer/ActivityPlanLinks'
import { useCourses } from '@/plugins/online-courses/hooks'
import { useProducts } from '@/plugins/products/hooks'
import { activityMoneyChipLabels } from '@/lib/activityTerms'
import { reorderWithinSection } from '@/lib/reorder'
import { SortableItem, SortableList, type SortableRenderProps } from '@/components/ui/sortable'
import { formatCurrency } from '@/lib/format'
import { OfferFacts, type OfferChip, type OfferFactsProps } from '@/components/offer/OfferFacts'
import { useInstalledPlugins } from '@/hooks/useInstalledPlugins'
import { SectionHeading } from '@/components/layout/SectionHeading'

const DEFAULT_ACCENT = '#6366f1'

/** The two health codes that mean "nobody can book this". The banner counts
 *  exactly these and adds no second definition of covered — a members-tier class
 *  in no plan is healthy, and stays uncounted. */
const DEAD_END_CODES = new Set<PricingWarning['code']>([
  'gated_empty_allowlist',
  'appointment_no_way_in',
])

type Selection = { kind: 'activity' | 'course' | 'plan' | 'product'; id: string } | null

/** The rail's tabs. `activities` holds classes AND appointments — see the header. */
type TabKey = 'activities' | 'plans' | 'courses' | 'products'

/** Which tab a selection belongs to, so a deep link opens the tab holding it. */
const TAB_FOR_KIND: Record<NonNullable<Selection>['kind'], TabKey> = {
  activity: 'activities',
  plan: 'plans',
  course: 'courses',
  product: 'products',
}

/** Selection rides in the URL so the pane is deep-linkable — which is what lets
 *  the pricing surface's warnings point AT the thing to fix instead of at a list
 *  page with the fix somewhere on it. */
function parseSelection(raw: string | null): Selection {
  if (!raw) return null
  const [kind, ...rest] = raw.split(':')
  const id = rest.join(':')
  if (!id) return null
  if (kind === 'activity' || kind === 'course' || kind === 'plan' || kind === 'product')
    return { kind, id }
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
  // The facts block reuses the list pages' OWN copy rather than restating it:
  // three namespaces, because three pages own these words and a fourth set of
  // strings saying the same things is how they start saying different ones.
  const tAct = useTranslations('Activities')
  const tSet = useTranslations('TeamSettings')
  const tc = useTranslations('Contacts')
  const { currentTeamId, team } = useAuth()
  const canEdit = useCapabilities().can('team.settings')
  const router = useRouter()
  const params = useSearchParams()
  const qc = useQueryClient()

  const selection = parseSelection(params.get('sel'))
  const [onlyDeadEnds, setOnlyDeadEnds] = useState(false)
  // NULL until the studio picks a tab, so a deep link (`?sel=plan:x`, which the
  // pricing warnings and both editors produce) opens on the tab that HOLDS the
  // selection rather than on Activities with the pane showing something the rail
  // beside it does not list. Once a tab is picked it wins — selecting within it
  // must not be able to move the reader somewhere else.
  const [pickedTab, setPickedTab] = useState<TabKey | null>(null)

  const { data: activities = [], isLoading: loadingActivities } = useActivities(currentTeamId)
  const { data: plans = [], isLoading: loadingPlans } = useSubscriptionTypes(currentTeamId)
  const { data: gatewayCurrency } = useGatewayCurrency(currentTeamId)
  // Courses only exist for a studio that installed the plugin, so the group is
  // absent rather than empty when it is not — an empty "Courses" heading would
  // advertise a feature this studio has not got.
  const { isInstalled } = useInstalledPlugins()
  const coursesInstalled = isInstalled('online-courses')
  const { data: courses = [], isLoading: loadingCourses } = useCourses(
    coursesInstalled ? currentTeamId : null
  )
  // Same gate, same reason: a "Products" tab on a studio without the plugin
  // advertises a feature it has not got.
  const productsInstalled = isInstalled('products')
  const { data: products = [], isLoading: loadingProducts } = useProducts(
    productsInstalled ? currentTeamId : null
  )
  const loading =
    loadingActivities ||
    loadingPlans ||
    (coursesInstalled && loadingCourses) ||
    (productsInstalled && loadingProducts)
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

  // ── everything a plan can open or discount, flattened to rows ──
  // Products and gift cards are deliberately absent: a product carries no
  // access rule and no benefit, and a gift card is a tender. Neither has an
  // edge for a plan to sit on. See `PlanLinkTarget` in @linyup/shared.
  const toActivityOffering = (a: Activity): Offering => ({
    id: a.id,
    name: a.name,
    collection: ACTIVITIES_COLLECTION,
    color: a.color ?? '',
    badge: isAppointmentActivity(a) ? t('appointmentBadge') : undefined,
    target: { kind: 'activity', doc: a },
  })
  const toCourseOffering = (c: Course): Offering => ({
    id: c.id,
    name: c.title,
    collection: COURSES_COLLECTION,
    badge: t('courseBadge'),
    target: { kind: 'course', doc: c },
  })
  const allOfferings: Offering[] = [
    ...activities.map(toActivityOffering),
    ...courses.map(toCourseOffering),
  ]

  const classes = activities.filter((a) => !isAppointmentActivity(a))
  const appointments = activities.filter(isAppointmentActivity)
  const visible = (list: Activity[]) =>
    onlyDeadEnds ? list.filter((a) => deadEndIds.has(a.id)) : list
  const visibleCourses = onlyDeadEnds ? courses.filter((c) => deadEndIds.has(c.id)) : courses

  // ICON ABOVE THE LABEL, not beside it. Side by side, four labelled-and-iconed
  // tabs do not fit the rail column once the pane opens next to it: the strip
  // wrapped to two lines, which moves the tab a studio is aiming at at exactly
  // the moment it selects something. Stacked, each tab is as narrow as its word
  // and the icons cost no width at all — and the SAME icons name these things in
  // the sidebar, so they are what the studio already recognises them by.
  const tabs: { key: TabKey; label: string; icon: React.ElementType }[] = [
    { key: 'activities', label: t('tabActivities'), icon: Zap },
    { key: 'plans', label: t('railPlans'), icon: IdCard },
    ...(coursesInstalled
      ? [{ key: 'courses' as const, label: t('railCourses'), icon: GraduationCap }]
      : []),
    ...(productsInstalled
      ? [{ key: 'products' as const, label: t('tabProducts'), icon: Package }]
      : []),
  ]
  const fallbackTab: TabKey = selection ? TAB_FOR_KIND[selection.kind] : 'activities'
  // A tab can vanish under a stored choice: uninstall the products plugin with
  // that tab open and `pickedTab` names a tab that is not rendered, which would
  // show an empty rail with nothing selected in the strip.
  const activeTab = tabs.some((x) => x.key === (pickedTab ?? fallbackTab))
    ? (pickedTab ?? fallbackTab)
    : 'activities'

  /** How many dead ends each tab holds — shown on the strip while the filter is
   *  on, because a tab that filters to nothing otherwise reads as "no problems
   *  here" exactly when the studio is hunting for problems. */
  const deadEndsPerTab: Partial<Record<TabKey, number>> = {
    activities: activities.filter((a) => deadEndIds.has(a.id)).length,
    courses: courses.filter((c) => deadEndIds.has(c.id)).length,
  }

  // ── THE FACTS, per kind ──────────────────────────────────────────────────
  // What each list page shows on a row, for the one thing that is selected.
  // Derived HERE because this page already holds the documents; the one part
  // that is real logic — an activity's money chips — comes from the SHARED
  // `activityMoneyChipLabels` the activities list itself reads, so the two
  // surfaces cannot disagree about what something costs.
  const activityChips = (a: Activity): OfferChip[] => {
    const rule = resolveActivityAccessRule(a)
    return [
      { label: isAppointmentActivity(a) ? t('appointmentBadge') : t('classBadge') },
      ...(a.tags ?? []).map((tag) => ({ label: tag })),
      ...(rule.type === 'subscription'
        ? [{ label: tAct('accessBadgeSubscription'), tone: 'accent' as const }]
        : rule.type === 'members'
          ? [{ label: tAct('accessBadgeMembers'), tone: 'accent' as const }]
          : a.isFreeTrial
            ? [{ label: tAct('freeTrialBadge') }]
            : []),
      ...activityMoneyChipLabels(
        a,
        currency,
        plans,
        tAct as unknown as (key: string, values?: Record<string, string | number>) => string,
        formatCurrency
      ).map((label) => ({ label })),
    ]
  }

  const planChips = (st: SubscriptionType): OfferChip[] => [
    {
      label: tSet(
        st.source === 'aggregator' ? 'subTypeSourceAggregator' : 'subTypeSourceInternal'
      ),
    },
    // INACTIVE AND PRIVATE ARE WARNINGS, not neutral facts: a plan the studio
    // is reading the coverage of, that nobody can currently buy, is the single
    // most useful thing this pane can tell them.
    ...(st.active === false ? [{ label: tSet('subTypeInactive'), tone: 'warn' as const }] : []),
    ...(st.public ? [{ label: tSet('subTypePublicBadge') }] : []),
    ...(st.prices ?? [])
      .filter((price) => price.active !== false)
      .map((price) => ({
        label:
          `${formatCurrency(price.amount, currency)} · ${tc(`recurrence_${price.recurrence}`)}` +
          (price.credits ? ` · ${tSet('subTypeCreditsBadge', { count: price.credits })}` : ''),
      })),
  ]

  const courseChips = (c: Course): OfferChip[] => [
    { label: t('courseBadge') },
    ...(c.status !== 'published'
      ? [{ label: t(c.status === 'draft' ? 'courseDraft' : 'courseArchived'), tone: 'warn' as const }]
      : []),
    {
      label:
        c.accessRule.type === 'purchase' && typeof c.accessRule.priceAmount === 'number'
          ? formatCurrency(c.accessRule.priceAmount, currency)
          : t(`courseAccess_${c.accessRule.type}` as Parameters<typeof t>[0]),
      tone: 'accent' as const,
    },
  ]

  const productChips = (pr: Product): OfferChip[] => [
    { label: formatCurrency(pr.priceAmount, currency), tone: 'accent' as const },
    ...(pr.active === false ? [{ label: t('productInactive'), tone: 'warn' as const }] : []),
    ...(pr.variants?.length
      ? [{ label: t('productVariants', { count: pr.variants.length }) }]
      : []),
  ]

  function select(next: Selection) {
    const sel = next ? `${next.kind}:${next.id}` : null
    router.replace((sel ? `/offer/catalogue?sel=${sel}` : '/offer/catalogue') as Route, {
      scroll: false,
    })
  }

  /** Click a row: select it, or clear it if it was already the selection. Was
   *  written out per row four times over; one helper is one behaviour. */
  function toggle(kind: NonNullable<Selection>['kind'], id: string) {
    select(selection?.kind === kind && selection.id === id ? null : { kind, id })
  }

  // ── ORDERING ─────────────────────────────────────────────────────────────
  // The same `order` field the activities list and the subscriptions manager
  // write, through the same `reorderWithinSection` permutation — so a studio
  // that arranges its plans here sees that arrangement everywhere, including on
  // the public surfaces, and not a third opinion about the order.
  //
  // NOT WHILE THE DEAD-END FILTER IS ON. The rail then shows a SUBSET, and every
  // one of these writes `order = index over the full list`: dragging within a
  // filtered view would compute positions from rows that are not all the rows.
  // The handles disappear rather than misbehave.
  const canReorder = canEdit && !onlyDeadEnds

  async function reorderActivities(section: Activity[], from: number, to: number) {
    if (from === to) return
    const full = reorderWithinSection(activities, section, from, to)
    const batch = writeBatch(db)
    full.forEach((a, i) => {
      if (a.order !== i) batch.update(doc(db, ACTIVITIES_COLLECTION, a.id), { order: i })
    })
    await batch.commit()
    await qc.invalidateQueries({ queryKey: ['activities'] })
  }

  async function reorderPlans(from: number, to: number) {
    if (from === to || !currentTeamId) return
    const next = reorderWithinSection(plans, plans, from, to)
    const batch = writeBatch(db)
    next.forEach((st, i) => {
      if (st.order !== i) {
        batch.update(
          doc(db, TEAMS_COLLECTION, currentTeamId, SUBSCRIPTION_TYPES_SUBCOLLECTION, st.id),
          { order: i }
        )
      }
    })
    await batch.commit()
    await qc.invalidateQueries({ queryKey: ['subscription-types', currentTeamId] })
  }

  const selectedActivity =
    selection?.kind === 'activity' ? activities.find((a) => a.id === selection.id) : undefined
  const selectedCourse =
    selection?.kind === 'course' ? courses.find((c) => c.id === selection.id) : undefined
  const selectedPlan =
    selection?.kind === 'plan' ? plans.find((p) => p.id === selection.id) : undefined
  const selectedProduct =
    selection?.kind === 'product' ? products.find((p) => p.id === selection.id) : undefined

  // ── the way back ──
  // Same markup as the course and document detail pages, but the target is NOT
  // a fixed parent: this page has TWO of them. It is reached from Activities,
  // from Subscriptions, from either editor's dialog and from a pricing warning,
  // and it has no nav row of its own — so the sidebar cannot be the way back the
  // way it is everywhere else, and a hardcoded parent would be wrong for half
  // of the arrivals.
  //
  // Following the SELECTION is deterministic, never leaves the app (unlike
  // history.back() on a deep link), and matches what the studio was just
  // looking at: a plan in the pane means Subscriptions is where they came from,
  // or at least where they were thinking.
  const backToPlans = selection?.kind === 'plan'

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('title')}
        back={{
          href: (backToPlans ? '/offer/plans' : '/offer/activities') as Route,
          label: backToPlans ? t('backToSubscriptions') : t('backToActivities'),
        }}
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
        <div className="space-y-3 rounded-xl border bg-card p-2">
          {/* THE TAB STRIP. Wraps rather than scrolls: there are at most four,
              and a horizontally scrolling strip hides the very tab a studio is
              looking for on the width where it matters most. */}
          <div className="flex gap-0.5 rounded-lg bg-muted/50 p-0.5" role="tablist" aria-label={t('title')}>
            {tabs.map((tab) => {
              const on = tab.key === activeTab
              const dead = onlyDeadEnds ? (deadEndsPerTab[tab.key] ?? 0) : 0
              const TabIcon = tab.icon
              return (
                <button
                  key={tab.key}
                  type="button"
                  role="tab"
                  aria-selected={on}
                  onClick={() => setPickedTab(tab.key)}
                  className={`relative flex flex-1 flex-col items-center justify-center gap-1 rounded-lg px-1 py-2 text-[11px] font-medium leading-none transition-colors ${
                    on
                      ? 'bg-primary text-primary-foreground'
                      : 'text-muted-foreground hover:bg-muted'
                  }`}
                >
                  <TabIcon className="h-4 w-4" />
                  <span className="truncate">{tab.label}</span>
                  {/* The dead-end count rides in the CORNER rather than in the
                      flow: inline it would widen one tab and unbalance a strip
                      whose whole job is four equal targets. */}
                  {dead > 0 && (
                    <span
                      className={`absolute right-1 top-1 rounded-full px-1 text-[9px] leading-tight ${
                        on ? 'bg-primary-foreground/20' : 'bg-amber-500/20 text-amber-700'
                      }`}
                    >
                      {dead}
                    </span>
                  )}
                </button>
              )
            })}
          </div>

          {loading && (
            <div className="space-y-2 p-2">
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className="h-9 rounded-lg" />
              ))}
            </div>
          )}

          {!loading && activeTab === 'activities' && (
            <>
              {/* Classes and appointments stay SUB-HEADINGS, not tabs — same
                  kind of thing, one asymmetry worth seeing. See the header. */}
              {/* Classes and appointments reorder SEPARATELY, exactly as they do
                  on the activities page: they are two groups over one stored
                  list, and `reorderWithinSection` keeps a drag inside a group
                  from renumbering the other one. */}
              <RailGroup icon={Zap} label={t('railClasses')}>
                {visible(classes).length === 0 ? (
                  <RailEmpty text={onlyDeadEnds ? t('noneFiltered') : t('noClasses')} />
                ) : (
                  <OrderableRows
                    items={visible(classes)}
                    canReorder={canReorder}
                    onReorder={(from, to) => void reorderActivities(classes, from, to)}
                    renderRow={(a, sortable) => (
                      <RailRow
                        name={a.name}
                        color={a.color}
                        warn={deadEndIds.has(a.id)}
                        selected={selection?.kind === 'activity' && selection.id === a.id}
                        onClick={() => toggle('activity', a.id)}
                        sortable={sortable}
                        reorderLabel={t('reorder')}
                      />
                    )}
                  />
                )}
              </RailGroup>

              <RailGroup icon={CalendarClock} label={t('railAppointments')}>
                {visible(appointments).length === 0 ? (
                  <RailEmpty text={onlyDeadEnds ? t('noneFiltered') : t('noAppointments')} />
                ) : (
                  <OrderableRows
                    items={visible(appointments)}
                    canReorder={canReorder}
                    onReorder={(from, to) => void reorderActivities(appointments, from, to)}
                    renderRow={(a, sortable) => (
                      <RailRow
                        name={a.name}
                        color={a.color}
                        warn={deadEndIds.has(a.id)}
                        selected={selection?.kind === 'activity' && selection.id === a.id}
                        onClick={() => toggle('activity', a.id)}
                        sortable={sortable}
                        reorderLabel={t('reorder')}
                      />
                    )}
                  />
                )}
              </RailGroup>
            </>
          )}

          {!loading && activeTab === 'plans' && (
            <div className="space-y-0.5 p-1">
              {plans.length === 0 ? (
                <RailEmpty text={t('noPlans')} />
              ) : (
                <OrderableRows
                  items={plans}
                  canReorder={canReorder}
                  onReorder={(from, to) => void reorderPlans(from, to)}
                  renderRow={(pl, sortable) => (
                    <RailRow
                      name={pl.name}
                      selected={selection?.kind === 'plan' && selection.id === pl.id}
                      onClick={() => toggle('plan', pl.id)}
                      sortable={sortable}
                      reorderLabel={t('reorder')}
                    />
                  )}
                />
              )}
            </div>
          )}

          {!loading && activeTab === 'courses' && (
            <div className="space-y-0.5 p-1">
              {visibleCourses.length === 0 ? (
                <RailEmpty text={onlyDeadEnds ? t('noneFiltered') : t('noCourses')} />
              ) : (
                visibleCourses.map((c) => (
                  <RailRow
                    key={c.id}
                    name={c.title}
                    warn={deadEndIds.has(c.id)}
                    selected={selection?.kind === 'course' && selection.id === c.id}
                    onClick={() => toggle('course', c.id)}
                  />
                ))
              )}
            </div>
          )}

          {!loading && activeTab === 'products' && (
            <div className="space-y-0.5 p-1">
              {/* NEVER filtered by the dead-end banner: no health code is ever
                  raised for a product (it has no access rule to be wrong), so
                  filtering would empty the tab and imply the opposite. */}
              {products.length === 0 ? (
                <RailEmpty text={t('noProducts')} />
              ) : (
                products.map((p) => (
                  <RailRow
                    key={p.id}
                    name={p.name}
                    selected={selection?.kind === 'product' && selection.id === p.id}
                    onClick={() => toggle('product', p.id)}
                  />
                ))
              )}
            </div>
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
              facts={{
                chips: activityChips(selectedActivity),
                description: selectedActivity.description,
              }}
              editHref={`/offer/activities?edit=${selectedActivity.id}` as Route}
              canEdit={canEdit}
              onRename={async (name) => {
                await updateDoc(doc(db, ACTIVITIES_COLLECTION, selectedActivity.id), { name })
                await qc.invalidateQueries({ queryKey: ['activities'] })
              }}
            >
              <ActivityPlanLinks
                direction="from-offering"
                offering={toActivityOffering(selectedActivity)}
                offerings={allOfferings}
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
                count:
                  activities.filter(
                    (a) =>
                      gatedPlanIds(a).includes(selectedPlan.id) ||
                      ratedPlanIds(a).includes(selectedPlan.id)
                  ).length +
                  courses.filter(
                    (c) =>
                      courseGatedPlanIds(c).includes(selectedPlan.id) ||
                      courseRatedPlanIds(c).includes(selectedPlan.id)
                  ).length,
              })}
              facts={{
                chips: planChips(selectedPlan),
                description: selectedPlan.description,
              }}
              editHref={`/offer/plans?edit=${selectedPlan.id}` as Route}
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
                offerings={allOfferings}
                plans={plans}
                currency={currency}
                canEdit={canEdit}
              />
            </PaneBody>
          )}

          {selectedCourse && (
            <PaneBody
              key={selectedCourse.id}
              title={selectedCourse.title}
              badge={t('courseBadge')}
              summary={t(
                coursePlanFacets(selectedCourse).access
                  ? 'summaryCourseGated'
                  : coursePlanFacets(selectedCourse).rate
                    ? 'summaryCoursePriced'
                    : 'summaryCourseOpen',
                {
                  plans:
                    courseGatedPlanIds(selectedCourse).length +
                    courseRatedPlanIds(selectedCourse).length,
                }
              )}
              facts={{
                chips: courseChips(selectedCourse),
                // `summary`, not `description`: a course's blurb is its summary.
                description: selectedCourse.summary,
              }}
              editHref={`/offer/online-courses/${selectedCourse.id}` as Route}
              canEdit={canEdit}
              onRename={async (title) => {
                await updateDoc(doc(db, COURSES_COLLECTION, selectedCourse.id), { title })
                await qc.invalidateQueries({ queryKey: ['courses'] })
              }}
            >
              <ActivityPlanLinks
                direction="from-offering"
                offering={toCourseOffering(selectedCourse)}
                offerings={allOfferings}
                plans={plans}
                currency={currency}
                canEdit={canEdit}
              />
            </PaneBody>
          )}

          {selectedProduct && (
            <PaneBody
              key={selectedProduct.id}
              title={selectedProduct.name}
              badge={t('productBadge')}
              summary={t('summaryProduct')}
              facts={{
                chips: productChips(selectedProduct),
                description: selectedProduct.description,
                // WHERE THE EDGE EDITOR WOULD BE, the pane says why there is
                // none. A product carries no access rule and no benefit, so no
                // plan can open it — that is a fact about the model, not a gap
                // in this screen, and leaving the space blank would read as the
                // latter.
                note: t('productNoPlanEdge'),
              }}
              editHref={`/offer/products?edit=${selectedProduct.id}` as Route}
              canEdit={canEdit}
              onRename={async (name) => {
                if (!currentTeamId) return
                await updateDoc(
                  doc(db, TEAMS_COLLECTION, currentTeamId, PRODUCTS_SUBCOLLECTION, selectedProduct.id),
                  { name }
                )
                await qc.invalidateQueries({ queryKey: ['products', currentTeamId] })
              }}
            />
          )}

          {/* Selected, but gone — a stale deep link, or something archived in
              another tab. Saying so beats an empty pane that looks like a bug. */}
          {selection &&
            !selectedActivity &&
            !selectedCourse &&
            !selectedPlan &&
            !selectedProduct &&
            !loading && (
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
 *  hatch, and the edge editor below.
 *
 *  Edit deep-links: it lands on the owning page AND opens that entity's editor
 *  (`?edit=<id>`). Sending the studio to a list page with the row somewhere on
 *  it is the shape UX-99 is about — a page naming a destination and then making
 *  you look for it. */
function PaneBody({
  title,
  badge,
  summary,
  facts,
  editHref,
  canEdit,
  onRename,
  children,
}: {
  title: string
  badge?: string
  summary: string
  /** What the list page would show on this thing's row — see OfferFacts. */
  facts?: OfferFactsProps
  editHref: Route
  canEdit: boolean
  onRename: (name: string) => Promise<void>
  /** The edge editor. ABSENT for a product, which has no edge — the facts block
   *  says so in its `note` rather than leaving a gap that reads as a bug. */
  children?: React.ReactNode
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

      {/* THE FACTS, above the hairline: they belong to the header — what this
          thing IS — while everything below the line is what it CONNECTS to. */}
      {facts && <OfferFacts {...facts} />}

      {children && <div className="border-t pt-4">{children}</div>}
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
      <SectionHeading level="eyebrow" icon={Icon} title={label} className="px-2 py-1.5" />
      <div className="space-y-0.5">{children}</div>
    </div>
  )
}

/**
 * One row of the rail — a select target, and (where the list is orderable) a
 * drag handle beside it.
 *
 * THE HANDLE IS ITS OWN BUTTON, not the row. Two reasons, and the first is not
 * negotiable: a `<button>` inside a `<button>` is invalid, so the row cannot
 * both be the select target and carry the drag listeners. The second is that
 * dragging and selecting are different intents on the same pixels — making the
 * whole row draggable means every mis-drag also changes what the pane is
 * showing. Same shape the activities and subscription lists already use.
 */
function RailRow({
  name,
  color,
  warn,
  selected,
  onClick,
  sortable,
  reorderLabel,
}: {
  name: string
  color?: string
  warn?: boolean
  selected: boolean
  onClick: () => void
  /** Present only when this list is orderable — see `canReorder` in the page. */
  sortable?: SortableRenderProps
  reorderLabel?: string
}) {
  const row = (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className={`flex min-w-0 flex-1 items-center gap-2 rounded-lg px-2 py-1.5 text-left transition-colors ${
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

  if (!sortable) return row

  return (
    <div
      ref={sortable.setNodeRef}
      style={sortable.style}
      className={`flex items-center rounded-lg ${sortable.isDragging ? 'bg-card shadow-lg' : ''}`}
    >
      <button
        type="button"
        {...sortable.attributes}
        {...sortable.listeners}
        aria-label={reorderLabel}
        // `touch-none` is what makes this work on a phone at all: without it the
        // browser claims the gesture for scrolling before the sensor sees it.
        className="shrink-0 cursor-grab touch-none rounded p-1 text-muted-foreground/50 transition-colors hover:bg-muted hover:text-foreground active:cursor-grabbing"
      >
        <GripVertical className="h-3.5 w-3.5" />
      </button>
      {row}
    </div>
  )
}

/**
 * A rail list that is orderable, or the same list that is not.
 *
 * The branch is here rather than at each call site because there are three of
 * them and the difference is one wrapper: with `canReorder` the rows sit in a
 * `SortableList` and each gets its handle props; without it they render plain.
 * Writing that out three times is how one of them ends up still draggable while
 * the dead-end filter is on — which would reorder the whole collection from a
 * subset of it.
 */
function OrderableRows<T extends { id: string }>({
  items,
  canReorder,
  onReorder,
  renderRow,
}: {
  items: T[]
  canReorder: boolean
  onReorder: (from: number, to: number) => void
  renderRow: (item: T, sortable?: SortableRenderProps) => React.ReactNode
}) {
  if (!canReorder) {
    return (
      <div className="space-y-0.5">
        {items.map((item) => (
          <Fragment key={item.id}>{renderRow(item)}</Fragment>
        ))}
      </div>
    )
  }
  return (
    <SortableList ids={items.map((item) => item.id)} onReorder={onReorder}>
      <div className="space-y-0.5">
        {items.map((item) => (
          <SortableItem key={item.id} id={item.id}>
            {(sortable) => <>{renderRow(item, sortable)}</>}
          </SortableItem>
        ))}
      </div>
    </SortableList>
  )
}

function RailEmpty({ text }: { text: string }) {
  return <p className="px-2 py-1.5 text-xs text-muted-foreground">{text}</p>
}
