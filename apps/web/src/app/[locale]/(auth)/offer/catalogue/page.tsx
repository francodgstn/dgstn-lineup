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
import { collection, deleteDoc, doc, getDocs, updateDoc, writeBatch } from 'firebase/firestore'
import {
  AlertTriangle,
  IdCard,
  Zap,
  CalendarClock,
  GraduationCap,
  GripVertical,
  Package,
  Pencil,
  Archive,
  CalendarDays,
  Copy,
  ExternalLink,
  Plus,
  Trash2,
  type LucideIcon,
} from 'lucide-react'

import {
  ACTIVITIES_COLLECTION,
  activityPlanFacets,
  COURSES_COLLECTION,
  SUBSCRIPTION_TYPES_SUBCOLLECTION,
  TEAMS_COLLECTION,
  courseGatedPlanIds,
  courseRatedPlanIds,
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
import { deleteProduct } from '@/plugins/products/hooks'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { ActivityScheduleSheet } from '@/components/activities/ActivityScheduleSheet'
import { useAuth } from '@/contexts/AuthContext'
import { useActivities } from '@/hooks/useActivities'
import { useCapabilities } from '@/hooks/useCapabilities'
import { Link, useRouter } from '@/i18n/navigation'
import { PageHeader } from '@/components/layout/PageHeader'
import { Button, buttonVariants } from '@/components/ui/button'
import { Tip } from '@/components/ui/tip'
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
import { ActivityDialog } from '@/components/activities/ActivityDialog'
import { ActivityPricingForm } from '@/components/activities/ActivityPricingForm'
import { PlanPricingForm } from '@/components/subscriptions/PlanPricingForm'
import { SubTypeDialog } from '@/components/subscriptions/SubscriptionTypeDialog'
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

/**
 * HOW A THING IS EDITED FROM THIS PAGE: open a dialog here, or go to the page
 * that owns the form. One type for both, so a row and the pane it opens cannot
 * end up offering different things — see `paneActionsFor`.
 */
type PaneActionRun = { run: () => void } | { href: Route }

/**
 * ONE ROW OF ICONS, and the last two are always the same two.
 *
 * The pane used to carry a single Edit button. The kinds it hosts do not offer
 * the same things, though — an activity can show its upcoming sessions and be
 * duplicated, a course can be neither — so a naive per-kind row would put Edit
 * in a different place on every tab, which is the one thing a studio switching
 * between them cannot afford (Franco, 2026-09-01).
 *
 * So the row is RIGHT-ALIGNED and ordered `[kind-specific…] [duplicate] [edit]
 * [destructive]`. Whatever precedes them, EDIT IS ALWAYS SECOND FROM THE RIGHT
 * AND THE DESTRUCTIVE ONE IS ALWAYS LAST — the same pixels on every kind.
 *
 * `danger` marks the destructive one, which is the only one that opens a
 * confirmation. Which destruction it is follows the kind's OWN page rather than
 * a rule invented here: an activity and a course ARCHIVE, a plan and a product
 * DELETE. The catalogue is a second door onto those records, not a second
 * policy about them.
 */
/** Archive or delete — whichever the kind's own page does. */
type DestroyMode = 'archive' | 'delete'

type Confirming = {
  kind: NonNullable<Selection>['kind']
  id: string
  name: string
  mode: DestroyMode
} | null

type PaneAction = PaneActionRun & {
  key: string
  icon: LucideIcon
  label: string
  danger?: boolean
}

function CreateAction({
  tab,
  onOpen,
}: {
  tab: TabKey
  onOpen: (kind: 'activity' | 'plan') => void
}) {
  const t = useTranslations('OfferCatalogue')
  if (tab === 'activities') {
    return (
      <Button onClick={() => onOpen('activity')}>
        <Plus className="mr-1.5 h-4 w-4" />
        {t('newActivity')}
      </Button>
    )
  }
  if (tab === 'plans') {
    return (
      <Button onClick={() => onOpen('plan')}>
        <Plus className="mr-1.5 h-4 w-4" />
        {t('newPlan')}
      </Button>
    )
  }
  const href = (tab === 'courses'
    ? '/offer/online-courses?new=1'
    : '/offer/products?new=1') as Route
  return (
    <Link href={href} className={buttonVariants()}>
      <Plus className="mr-1.5 h-4 w-4" />
      {tab === 'courses' ? t('newCourse') : t('newProduct')}
    </Link>
  )
}

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
  const tCommon = useTranslations('Common')
  const tSet = useTranslations('TeamSettings')
  const tc = useTranslations('Contacts')
  const { currentTeamId, team, user } = useAuth()
  const canEdit = useCapabilities().can('team.settings')
  const router = useRouter()
  const params = useSearchParams()
  const qc = useQueryClient()

  const selection = parseSelection(params.get('sel'))
  /**
   * `?tab=` — which list to open on, when no `?sel=` names a row.
   *
   * The retired activities and plans pages redirect here through it, so a
   * bookmark of either lands on the list it used to show rather than on
   * whichever tab this page would have picked. Ignored when it names a tab the
   * team has not installed; `activeTab` already guards that.
   */
  const tabParam = params.get('tab')
  const requestedTab: TabKey | null =
    tabParam === 'activities' || tabParam === 'plans' || tabParam === 'courses' ||
    tabParam === 'products'
      ? tabParam
      : null
  const [onlyDeadEnds, setOnlyDeadEnds] = useState(false)
  // NULL until the studio picks a tab, so a deep link (`?sel=plan:x`, which the
  // pricing warnings and both editors produce) opens on the tab that HOLDS the
  // selection rather than on Activities with the pane showing something the rail
  // beside it does not list. Once a tab is picked it wins — selecting within it
  // must not be able to move the reader somewhere else.
  const [pickedTab, setPickedTab] = useState<TabKey | null>(null)
  // ── THE EDITORS, MOUNTED HERE ────────────────────────────────────────────
  // The catalogue is where a studio reasons about what it sells, so it is where
  // the things it sells should be editable — it used to be able to do nothing
  // but link away to the list page that owned the form (Franco, 2026-08-31).
  // Both dialogs are the SAME components those pages mount, lifted out of them
  // for the purpose; nothing about either form changed in the move.
  //
  // Courses and products keep their links: a course's editor is a whole PAGE
  // (media, lessons, ordering), not a dialog, and a product's is still a fixture
  // of its own page. Linking to a form that exists is better than half-lifting
  // one that does not.
  const [editingActivity, setEditingActivity] = useState<Activity | null>(null)
  const [editingPlan, setEditingPlan] = useState<SubscriptionType | null>(null)
  // A duplicate is a CREATE seeded from a record, which is why it is separate
  // state and not a flag on the edit target — both dialogs already know it.
  const [duplicatingActivity, setDuplicatingActivity] = useState<Activity | null>(null)
  const [duplicatingPlan, setDuplicatingPlan] = useState<SubscriptionType | null>(null)
  /** Which kind is being CREATED, if any. Separate from the edit and duplicate
   *  targets because all three drive the same dialog and only one can be true. */
  const [creating, setCreating] = useState<'activity' | 'plan' | null>(null)
  const [schedulePreview, setSchedulePreview] = useState<Activity | null>(null)
  const [confirming, setConfirming] = useState<Confirming>(null)

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
  const activeTab = tabs.some((x) => x.key === (pickedTab ?? requestedTab ?? fallbackTab))
    ? (pickedTab ?? requestedTab ?? fallbackTab)
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
  // NO KIND BADGE IN THE CHIPS. The pane's header already carries it beside the
  // name, and in the rail the row sits under a heading that says it — so it was
  // printed twice on one screen and told the reader nothing either time.
  const activityChips = (a: Activity): OfferChip[] => {
    const appointment = isAppointmentActivity(a)
    const rule = resolveActivityAccessRule(a)
    return [
      ...(a.tags ?? []).map((tag) => ({ label: tag })),
      // THE FORM'S OWN WORDS for who can book — `access_open` / `access_members`
      // / `access_subscription`, the exact three options the activity editor
      // offers. It used to be a shorter private vocabulary ("Members",
      // "Subscription") that appeared nowhere the studio had chosen from, and
      // said NOTHING AT ALL for an open class — the commonest answer of the
      // three rendered as an absent chip, which reads as "not configured"
      // rather than "anyone can book" (Franco, 2026-08-31).
      //
      // CLASS-ONLY. An appointment has no access rule — the price is the gate —
      // so `resolveActivityAccessRule` falls back to 'open' for one, and
      // printing "Open to everyone" over a paid appointment would be a claim
      // about a field it does not have.
      ...(appointment
        ? []
        : [{ label: tAct(`access_${rule.type}` as const), tone: 'accent' as const }]),
      // The newcomer's trial door, where it opens something: it is independent
      // of the tier above, but on an OPEN class it grants nothing extra
      // (everyone already books free), so the editor ignores it there and so
      // does this. A PRICED trial is money and comes through the money chips
      // below as "Trial {amount}" instead — one trial fact per row, not two.
      ...(!appointment &&
      rule.type !== 'open' &&
      a.trialEnabled === true &&
      a.trialPriceAmount == null
        ? [{ label: tAct('freeTrialBadge') }]
        : []),
      // "Drop-in {amount}" is one of these — the drop-in fact, with its price.
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
    // A CHIP MARKS THE EXCEPTION, NOT THE RULE. Almost every plan is the
    // studio's own, so "Internal" was a label on nearly every row — carrying no
    // information while costing a scan. Only a plan that comes from somewhere
    // else (a partner fitness app) is worth naming (Franco, 2026-09-01).
    ...(st.source === 'aggregator' ? [{ label: tSet('subTypeSourceAggregator') }] : []),
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

  /**
   * The row's second line — the chips, flattened.
   *
   * THE SAME DERIVATION THE PANE USES, joined rather than re-decided: a row that
   * summarised the thing differently from the pane it opens would make the
   * reader check which one to believe. Truncation is the layout's job (the row
   * is `truncate`), not this function's — cutting the string here would put an
   * ellipsis in the middle of the accessible name too.
   */
  const detailLine = (chips: OfferChip[]) =>
    // A BULLET BETWEEN CHIPS, not the middot the chips use INSIDE themselves. A
    // plan's price chip is already "CHF 89.00 · Monthly", so joining chips with
    // the same mark turned two prices into six anonymous fragments — the line is
    // there to be read at a glance, and that is the one thing it could not be.
    chips.map((c) => c.label).join(' • ') || undefined

  /**
   * HOW A THING IS EDITED FROM HERE — the one answer, shared by a row's pencil
   * and by the pane's Edit button, so the two can never lead somewhere
   * different.
   *
   * An activity or a plan opens its form RIGHT HERE. A course or a product
   * still navigates: a course's editor is a page, and a product's is a fixture
   * of its own page — linking to a form that exists beats half-lifting one that
   * does not.
   *
   * A reader who cannot edit gets neither: a shortcut into a form that refuses
   * them is worse than no shortcut.
   */
  const paneActionsFor = (kind: NonNullable<Selection>['kind'], id: string): PaneAction[] => {
    if (!canEdit) return []
    const edit = (run: PaneActionRun): PaneAction => ({
      key: 'edit',
      icon: Pencil,
      label: t('editAll'),
      ...run,
    })
    const duplicate = (run: PaneActionRun): PaneAction => ({
      key: 'duplicate',
      icon: Copy,
      label: tCommon('duplicate'),
      ...run,
    })
    const destroy = (name: string, mode: DestroyMode): PaneAction => ({
      key: 'destroy',
      icon: mode === 'archive' ? Archive : Trash2,
      label: mode === 'archive' ? t('archiveAction') : t('deleteAction'),
      danger: true,
      run: () => setConfirming({ kind, id, name, mode }),
    })

    if (kind === 'activity') {
      const a = activities.find((x) => x.id === id)
      if (!a) return []
      return [
        // Viewing precedes changing, and "is this actually on the calendar?" is
        // the question the pane cannot answer about itself.
        {
          key: 'schedule',
          icon: CalendarDays,
          label: tAct('viewSchedule'),
          run: () => setSchedulePreview(a),
        },
        duplicate({ run: () => setDuplicatingActivity(a) }),
        edit({ run: () => setEditingActivity(a) }),
        destroy(a.name, 'archive'),
      ]
    }
    if (kind === 'plan') {
      const pl = plans.find((x) => x.id === id)
      if (!pl) return []
      return [
        duplicate({ run: () => setDuplicatingPlan(pl) }),
        edit({ run: () => setEditingPlan(pl) }),
        destroy(pl.name, 'delete'),
      ]
    }
    if (kind === 'course') {
      const c = courses.find((x) => x.id === id)
      if (!c) return []
      // No duplicate: the course page does not offer one either, and a course
      // copied without its modules and lessons would be an empty shell.
      return [
        edit({ href: `/offer/online-courses/${id}` as Route }),
        destroy(c.title, 'archive'),
      ]
    }
    const pr = products.find((x) => x.id === id)
    if (!pr) return []
    return [
      duplicate({ href: `/offer/products?duplicate=${id}` as Route }),
      edit({ href: `/offer/products?edit=${id}` as Route }),
      destroy(pr.name, 'delete'),
    ]
  }

  /** A ROW shows one pencil, not the bar — the bar belongs to the thing you have
   *  opened. Taken from the same list so the two can never disagree. */
  const editOf = (kind: NonNullable<Selection>['kind'], id: string): PaneAction | undefined =>
    paneActionsFor(kind, id).find((a) => a.key === 'edit')

  /** The destructive action, run against the same collection its own page uses. */
  async function runDestroy() {
    if (!confirming || !currentTeamId) return
    const { kind, id } = confirming
    if (kind === 'activity') {
      await updateDoc(doc(db, ACTIVITIES_COLLECTION, id), { isActive: false })
      await qc.invalidateQueries({ queryKey: ['activities'] })
    } else if (kind === 'plan') {
      await deleteDoc(doc(db, TEAMS_COLLECTION, currentTeamId, SUBSCRIPTION_TYPES_SUBCOLLECTION, id))
      await qc.invalidateQueries({ queryKey: ['subscription-types', currentTeamId] })
    } else if (kind === 'course') {
      await updateDoc(doc(db, COURSES_COLLECTION, id), { status: 'archived' })
      await qc.invalidateQueries({ queryKey: ['courses', currentTeamId] })
    } else {
      await deleteProduct(currentTeamId, id)
      await qc.invalidateQueries({ queryKey: ['products', currentTeamId] })
    }
    // The pane is now pointing at something that is gone or filed away.
    setConfirming(null)
    select(null)
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

  /** An open class carries neither facet — see `activityPlanFacets`, which is
   *  where that is decided, so this screen cannot drift from the write path. */
  const selectedActivity =
    selection?.kind === 'activity' ? activities.find((a) => a.id === selection.id) : undefined
  /** An open class carries neither facet — see `activityPlanFacets`. Used for
   *  the SUMMARY line only; what to render is the pricing form's decision. */
  const openActivity = !!selectedActivity && !activityPlanFacets(selectedActivity).access
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
        // NO SUBTITLE. "What you offer, and which plans open it" restated the
        // page title in a longer sentence, above a screen that demonstrates the
        // same thing in the first second of looking at it (Franco, 2026-08-31).
        // The related links are what this page CANNOT answer about itself:
        // what everything costs, when it actually runs, and the one sellable
        // thing that has no catalogue row at all.
        //
        // "All activities" was not one of those — the Activities tab is right
        // there, so the link led out of the page to a subset of it. Gift cards
        // take its place: a studio sells them, but there is nothing here to
        // list, because a gift card is a CONFIG (`settings.giftCards` — enabled
        // plus the denominations) and then a ledger of issued codes. Neither is
        // a catalogue item, so it is a link rather than a tab (Franco,
        // 2026-09-01).
        quickLinks={[
          { href: '/offer/pricing' as Route, label: t('toPricing') },
          { href: '/schedule' as Route, label: t('toSchedule') },
          { href: '/payments?tab=giftCards' as Route, label: t('toGiftCards') },
        ]}
        // CREATE BELONGS TO THE ACTIVE TAB. One button that makes whatever the
        // rail is currently listing — the catalogue could not make anything at
        // all before, which was the one thing its own pages still had to be
        // opened for (Franco, 2026-09-02).
        //
        // Activities and plans open their dialog HERE, because this page
        // already mounts it for edit and duplicate. Courses and products link
        // to their own page instead: both gate creation on a per-plan cap and
        // own a bespoke first-step form, and a second copy of either is how the
        // two drift apart.
        action={canEdit ? <CreateAction tab={activeTab} onOpen={setCreating} /> : undefined}
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

      {/* THE RAIL HOLDS ITS SIZE. Two `fr` tracks share free space, but an `fr`
          still floors at its content's min-content width — so a wide pane (the
          plan matcher is five columns and a set-all row) pushed the list of
          items narrower the moment you selected something, and the list moved
          under the cursor that had just clicked it.

          A fixed track for the rail, and `minmax(0,1fr)` for the pane: the zero
          minimum is what lets the pane shrink BELOW its content instead of
          shoving, which is also what makes its own overflow scrolling work
          (Franco, 2026-09-01). */}
      <div className="grid items-start gap-6 lg:grid-cols-[minmax(300px,340px)_minmax(0,1fr)]">
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
                  // SWITCHING TABS CLEARS A SELECTION FROM ANOTHER ONE. The
                  // rail and the pane are one screen making one statement, and
                  // a rail of plans beside a pane of activity pricing is two
                  // (Franco, 2026-09-02). A selection that BELONGS to the tab
                  // being opened survives — going Plans → Activities → Plans
                  // should not lose your place.
                  onClick={() => {
                    setPickedTab(tab.key)
                    if (selection && TAB_FOR_KIND[selection.kind] !== tab.key) select(null)
                  }}
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

          {/* ONE LINE PER TAB, printed. It briefly lived behind an info mark to
              save the height; the mark cost more than the lines did — a studio
              had to know there was something to hover before it could tell them
              anything, which is the wrong trade for a sentence that orients
              somebody who has just arrived (Franco, 2026-09-01).

              Written as four literal keys rather than `t(`hint_${activeTab}`)`:
              `i18n:check` counts computed keys and never fails them, so a typo
              in one would ship silently. */}
          <p className="px-2 text-xs leading-snug text-muted-foreground">
            {
              {
                activities: t('hintActivities'),
                plans: t('hintPlans'),
                courses: t('hintCourses'),
                products: t('hintProducts'),
              }[activeTab]
            }
          </p>

          {/* THE WAY OUT, on the two tabs that need one. A course and a product
              are only PRICED here — their content, media, variants and
              collections live on their own page, and the pane's Edit button is
              easy to miss when you have not selected a row yet. So the rail
              says where the rest of the job is, before the list rather than
              after it (Franco, 2026-09-02).
              Absent on activities and plans: nothing about either is edited
              anywhere else any more. */}
          {(activeTab === 'courses' || activeTab === 'products') && (
            <Link
              href={(activeTab === 'courses' ? '/offer/online-courses' : '/offer/products') as Route}
              className="mx-2 flex items-center gap-1.5 rounded-md border border-dashed px-2 py-1.5 text-xs text-muted-foreground transition-colors hover:border-solid hover:bg-muted hover:text-foreground"
            >
              <ExternalLink className="h-3 w-3 shrink-0" />
              <span className="min-w-0 flex-1">
                {activeTab === 'courses' ? t('fullEditCourses') : t('fullEditProducts')}
              </span>
            </Link>
          )}


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
                        detail={detailLine(activityChips(a))}
                        color={a.color}
                        warn={deadEndIds.has(a.id)}
                        selected={selection?.kind === 'activity' && selection.id === a.id}
                        onClick={() => toggle('activity', a.id)}
                        sortable={sortable}
                        reorderLabel={t('reorder')}
                        edit={editOf('activity', a.id)}
                        editLabel={t('editAll')}
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
                        detail={detailLine(activityChips(a))}
                        color={a.color}
                        warn={deadEndIds.has(a.id)}
                        selected={selection?.kind === 'activity' && selection.id === a.id}
                        onClick={() => toggle('activity', a.id)}
                        sortable={sortable}
                        reorderLabel={t('reorder')}
                        edit={editOf('activity', a.id)}
                        editLabel={t('editAll')}
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
                      detail={detailLine(planChips(pl))}
                      selected={selection?.kind === 'plan' && selection.id === pl.id}
                      onClick={() => toggle('plan', pl.id)}
                      sortable={sortable}
                      reorderLabel={t('reorder')}
                      edit={editOf('plan', pl.id)}
                      editLabel={t('editAll')}
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
                    detail={detailLine(courseChips(c))}
                    warn={deadEndIds.has(c.id)}
                    selected={selection?.kind === 'course' && selection.id === c.id}
                    onClick={() => toggle('course', c.id)}
                    edit={editOf('course', c.id)}
                    editLabel={t('editAll')}
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
                    detail={detailLine(productChips(p))}
                    selected={selection?.kind === 'product' && selection.id === p.id}
                    onClick={() => toggle('product', p.id)}
                    edit={editOf('product', p.id)}
                    editLabel={t('editAll')}
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
                openActivity
                  ? t('summaryClassOpen')
                  : isAppointmentActivity(selectedActivity)
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
              actions={paneActionsFor('activity', selectedActivity.id)}
              extraTabs={
                currentTeamId && user
                  ? (['details', 'booking'] as const).map((section) => ({
                      key: section,
                      label: section === 'details' ? t('paneTabDetails') : t('paneTabBooking'),
                      content: (
                        <ActivityDialog
                          // Keyed by the record AND the section so switching
                          // rows remounts each form rather than leaving the
                          // previous one's draft in it.
                          key={`${section}-${selectedActivity.id}`}
                          inline
                          section={section}
                          open
                          onClose={() => {}}
                          teamId={currentTeamId}
                          userId={user.uid}
                          editing={selectedActivity}
                          duplicating={null}
                          nextOrder={activities.length}
                          currency={currency}
                        />
                      ),
                    }))
                  : undefined
              }
            >
              {/* ALWAYS MOUNTED, and the guard that used to sit here was a dead
                  end. It hid this whole form for an OPEN class, which is the
                  one kind that has no other route out: the tier switch lives
                  inside it, so an open activity could not be made anything else
                  from anywhere in the product (Franco, 2026-09-01). Only the
                  MATCHER is conditional, and that decision belongs inside the
                  form, next to the switch that changes it. */}
              <ActivityPricingForm
                activity={selectedActivity}
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
              actions={paneActionsFor('plan', selectedPlan.id)}
              extraTabs={
                currentTeamId
                  ? [{ key: 'details', label: t('paneTabDetails'), content: (
                  <SubTypeDialog
                    key={`details-${selectedPlan.id}`}
                    inline
                    open
                    onOpenChange={() => {}}
                    teamId={currentTeamId}
                    editing={selectedPlan}
                    duplicating={null}
                    currency={currency}
                    nextOrder={plans.length}
                    onSaved={() => {
                      void qc.invalidateQueries({ queryKey: ['subscription-types', currentTeamId] })
                      void qc.invalidateQueries({ queryKey: ['activities'] })
                    }}
                  />
                ) }]
                  : undefined
              }
            >
              {/* PRICES FIRST, then what they open. A plan is a price and a
                  promise, and the promise means nothing until the price is
                  real — so the money reads top-down into the matcher rather
                  than sitting behind it. */}
              {currentTeamId && (
                <PlanPricingForm
                  plan={selectedPlan}
                  teamId={currentTeamId}
                  currency={currency}
                  canEdit={canEdit}
                />
              )}
              <div className="border-t pt-4">
                <ActivityPlanLinks
                  direction="from-plan"
                  plan={selectedPlan}
                  offerings={allOfferings}
                  plans={plans}
                  currency={currency}
                  canEdit={canEdit}
                />
              </div>
            </PaneBody>
          )}

          {selectedCourse && (
            <PaneBody
              key={selectedCourse.id}
              title={selectedCourse.title}
              badge={t('courseBadge')}
              summary={t(
                selectedCourse.accessRule?.type === 'purchase'
                  ? 'summaryCoursePriced'
                  : selectedCourse.accessRule?.type === 'subscription'
                    ? 'summaryCourseGated'
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
              actions={paneActionsFor('course', selectedCourse.id)}
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
                // latter. ONE SENTENCE: it explained the reasoning as well as
                // the fact, and the fact is the part a studio needs.
                note: t('productNoPlanEdge'),
              }}
              actions={paneActionsFor('product', selectedProduct.id)}
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

      {/* THE EDITORS. Keyed by the record so reopening on a different one
          remounts the form rather than leaving the previous draft in it — the
          same key both list pages use. `currentTeamId` and `user` gate the
          activity form because it writes with both. */}
      {currentTeamId && user && creating === 'activity' && (
        <ActivityDialog
          key="new-activity"
          open
          onClose={() => setCreating(null)}
          teamId={currentTeamId}
          userId={user.uid}
          editing={null}
          duplicating={null}
          nextOrder={activities.length}
          currency={currency}
          onCreated={(id) => select({ kind: 'activity', id })}
        />
      )}

      {currentTeamId && creating === 'plan' && (
        <SubTypeDialog
          key="new-plan"
          open
          onOpenChange={(v) => !v && setCreating(null)}
          teamId={currentTeamId}
          editing={null}
          duplicating={null}
          currency={currency}
          nextOrder={plans.length}
          onSaved={() => {
            void qc.invalidateQueries({ queryKey: ['subscription-types', currentTeamId] })
            void qc.invalidateQueries({ queryKey: ['activities'] })
          }}
        />
      )}

      {currentTeamId && user && duplicatingActivity && (
        <ActivityDialog
          key={`dup-${duplicatingActivity.id}`}
          open
          onClose={() => setDuplicatingActivity(null)}
          onCreated={(id) => select({ kind: 'activity', id })}
          teamId={currentTeamId}
          userId={user.uid}
          editing={null}
          duplicating={duplicatingActivity}
          nextOrder={activities.length}
          currency={currency}
        />
      )}

      {currentTeamId && duplicatingPlan && (
        <SubTypeDialog
          key={`dup-${duplicatingPlan.id}`}
          open
          onOpenChange={(v) => !v && setDuplicatingPlan(null)}
          teamId={currentTeamId}
          editing={null}
          duplicating={duplicatingPlan}
          currency={currency}
          nextOrder={plans.length}
          onSaved={() => {
            void qc.invalidateQueries({ queryKey: ['subscription-types', currentTeamId] })
            void qc.invalidateQueries({ queryKey: ['activities'] })
          }}
        />
      )}

      <ActivityScheduleSheet
        activity={schedulePreview}
        open={!!schedulePreview}
        onOpenChange={(v) => {
          if (!v) setSchedulePreview(null)
        }}
        teamId={currentTeamId ?? ''}
      />

      {/* NEVER STRAIGHT AWAY. One dialog for all four kinds, because the
          question is the same one and only the verb and the noun change. */}
      <AlertDialog open={!!confirming} onOpenChange={(v) => !v && setConfirming(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirming?.mode === 'archive' ? t('archiveAction') : t('deleteAction')}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirming
                ? t(confirming.mode === 'archive' ? 'archiveConfirm' : 'deleteConfirm', {
                    name: confirming.name,
                  })
                : ''}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{tCommon('cancel')}</AlertDialogCancel>
            <AlertDialogAction
              className={
                confirming?.mode === 'delete'
                  ? 'bg-destructive text-destructive-foreground hover:bg-destructive/90'
                  : undefined
              }
              onClick={() => void runDestroy()}
            >
              {confirming?.mode === 'archive' ? t('archiveAction') : t('deleteAction')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {currentTeamId && user && editingActivity && (
        <ActivityDialog
          key={editingActivity.id}
          open
          onClose={() => setEditingActivity(null)}
          teamId={currentTeamId}
          userId={user.uid}
          // The LIVE document, re-read from the query on every render — the plan
          // editor inside the form writes `accessRule` on this same doc, so a
          // snapshot taken when the dialog opened would have Save write the
          // pre-edit allow-list back over it.
          editing={activities.find((a) => a.id === editingActivity.id) ?? editingActivity}
          duplicating={null}
          nextOrder={activities.length}
          currency={currency}
        />
      )}

      {currentTeamId && editingPlan && (
        <SubTypeDialog
          key={editingPlan.id}
          open
          onOpenChange={(v) => !v && setEditingPlan(null)}
          teamId={currentTeamId}
          editing={plans.find((pl) => pl.id === editingPlan.id) ?? editingPlan}
          duplicating={null}
          currency={currency}
          nextOrder={plans.length}
          onSaved={() => {
            void qc.invalidateQueries({ queryKey: ['subscription-types', currentTeamId] })
            void qc.invalidateQueries({ queryKey: ['activities'] })
          }}
        />
      )}
    </div>
  )
}

/**
 * The pane's frame: the name, a one-line summary, the facts, an Edit button and
 * the edge editor below.
 *
 * ── NO INLINE RENAME ────────────────────────────────────────────────────────
 * The name used to be editable here, on the reasoning that a pane showing a name
 * but unable to change it sends you to a modal for the commonest small edit
 * there is. That was the wrong trade (Franco, 2026-08-31): it put a second,
 * quieter way to change one field beside a button that changes all of them, so
 * the screen had two edit affordances with different scopes and no way to tell
 * from looking which one a given change needed. One Edit, and it opens the
 * editor that owns the whole record.
 *
 * ── EDIT IS PRIMARY ─────────────────────────────────────────────────────────
 * It was an outline button, which is what you use for the SECOND action on a
 * screen. There is no first one here: this pane reads, and the only thing it
 * does is send you to the form. Primary, with the pencil, because the thing it
 * competes with for attention is the edge grid below it — which saves itself.
 *
 * Edit deep-links: it lands on the owning page AND opens that entity's editor
 * (`?edit=<id>`). Sending the studio to a list page with the row somewhere on
 * it is the shape UX-99 is about — a page naming a destination and then making
 * you look for it.
 */
function PaneBody({
  title,
  badge,
  summary,
  facts,
  actions,
  extraTabs,
  children,
}: {
  title: string
  badge?: string
  summary: string
  /** What the list page would show on this thing's row — see OfferFacts. */
  facts?: OfferFactsProps
  /** The icon row. Empty for a reader who cannot edit — see PaneAction. */
  actions?: PaneAction[]
  /**
   * The tabs BESIDE the main one, in order. Empty or absent means no strip at
   * all: a course and a product are edited on their own page, so their pane
   * has one thing in it and a strip of one tab would be a lie about there
   * being a choice.
   */
  extraTabs?: { key: string; label: string; content: React.ReactNode }[]
  /** The edge editor. ABSENT for a product, which has no edge — the facts block
   *  says so in its `note` rather than leaving a gap that reads as a bug. */
  children?: React.ReactNode
}) {
  const t = useTranslations('OfferCatalogue')

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-base font-semibold">{title}</h2>
            {badge && (
              <Badge variant="outline" className="text-xs font-normal">
                {badge}
              </Badge>
            )}
          </div>
          <p className="text-xs text-muted-foreground">{summary}</p>
        </div>
        {actions && actions.length > 0 && (
          /* EDIT IS NOT AN ICON. The rest are: they name an operation on this
             record, and the icon carries it. Edit is different — the pane now
             shows so much (facts, prices, the plan table) that a small pencil
             among three others read as "one more of those" rather than "there
             is a whole other half of this thing", which is the name, the
             description, the colour, the prose (Franco, 2026-09-01).

             So it sits BELOW the icon row, labelled, in the same place on every
             kind. The icons stay icon-only — three same-shaped verbs where
             position teaches faster than repeated words. */
          <div className="flex shrink-0 flex-col items-end gap-1.5">
            <div className="flex items-center gap-0.5">
              {actions
                .filter((a) => a.key !== 'edit')
                .map((a) => {
                  const Icon = a.icon
                  const cls = `rounded p-1.5 text-muted-foreground transition-colors ${
                    a.danger ? 'hover:text-destructive' : 'hover:text-foreground'
                  } hover:bg-muted`
                  // A STYLED tooltip, not `title=`: these are icon-only, so
                  // the label is the only thing that says what the button does
                  // — and the browser's own tooltip waits a second, cannot be
                  // read by a keyboard, and never appears on touch.
                  return (
                    <Tip key={a.key} label={a.label}>
                      {'href' in a ? (
                        <Link href={a.href} className={cls} aria-label={a.label}>
                          <Icon className="h-4 w-4" />
                        </Link>
                      ) : (
                        <button
                          type="button"
                          onClick={a.run}
                          className={cls}
                          aria-label={a.label}
                        >
                          <Icon className="h-4 w-4" />
                        </button>
                      )}
                    </Tip>
                  )
                })}
            </div>
            {/* Edit stays a BUTTON only where the editor is somewhere else — a
                course and a product are edited on their own page. Where the
                fields are right here under a tab, a button labelled "Edit"
                beside them said the visible fields were not editing, which was
                false, and gave no hint of what it hid (Franco, 2026-09-02). */}
            {(extraTabs?.length ? [] : actions.filter((a) => a.key === 'edit')).map((a) =>
                'href' in a ? (
                  <Link
                    key={a.key}
                    href={a.href}
                    className={buttonVariants({ variant: 'outline', size: 'sm' })}
                  >
                    <Pencil className="mr-1.5 h-3.5 w-3.5" />
                    {t('editDetails')}
                  </Link>
                ) : (
                  <Button key={a.key} variant="outline" size="sm" onClick={a.run}>
                    <Pencil className="mr-1.5 h-3.5 w-3.5" />
                    {t('editDetails')}
                  </Button>
                )
              )}
          </div>
        )}
      </div>

      {/* THE FACTS, above the hairline: they belong to the header — what this
          thing IS — while everything below the line is what it CONNECTS to. */}
      {facts && <OfferFacts {...facts} />}

      {extraTabs?.length ? (
        <PaneTabs main={children} extra={extraTabs} />
      ) : (
        children && <div className="border-t pt-4">{children}</div>
      )}
    </div>
  )
}

/**
 * TWO TABS, NOT MORE.
 *
 * The pane holds two different questions — what this costs and who it is for,
 * and what the thing itself is. Splitting the second further would trade one
 * hunt for another: a name, a colour, the prose and the session lengths are all
 * "what this is", and a studio reads them together.
 *
 * Booking and pricing leads because it is the one asked most often, and it is
 * where the plan matcher lives.
 */
function PaneTabs({
  main,
  extra,
}: {
  main?: React.ReactNode
  extra: { key: string; label: string; content: React.ReactNode }[]
}) {
  const t = useTranslations('OfferCatalogue')
  const [tab, setTab] = useState('main')
  // AN UNDERLINE, not pills — the same shape the contact detail page uses for
  // its tabs. The rail above already spends a filled pill strip on choosing
  // WHAT you are looking at, and a second filled strip choosing which half of
  // it read as two controls of equal weight competing on one screen.
  const tabCls = (on: boolean) =>
    `-mb-px whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium transition-colors ${
      on
        ? 'border-primary text-foreground'
        : 'border-transparent text-muted-foreground hover:text-foreground'
    }`
  return (
    <div className="border-t pt-3">
      <div className="mb-3 flex gap-1 overflow-x-auto border-b" role="tablist">
        <button type="button" role="tab" aria-selected={tab === 'main'}
          onClick={() => setTab('main')} className={tabCls(tab === 'main')}>
          {t('paneTabAccess')}
        </button>
        {extra.map((x) => (
          <button key={x.key} type="button" role="tab" aria-selected={tab === x.key}
            onClick={() => setTab(x.key)} className={tabCls(tab === x.key)}>
            {x.label}
          </button>
        ))}
      </div>
      {/* EVERY TAB STAYS MOUNTED. Each is a form that may hold unsaved input,
          and unmounting the one you tabbed away from would throw it away
          without saying so. */}
      <div className={tab === 'main' ? '' : 'hidden'}>{main}</div>
      {extra.map((x) => (
        <div key={x.key} className={tab === x.key ? '' : 'hidden'}>
          {x.content}
        </div>
      ))}
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
      <SectionHeading level="eyebrow" icon={Icon} title={label} className="px-2 pb-1.5 pt-2" />
      <div className="space-y-1">{children}</div>
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
/**
 * One row of the rail: a drag handle where the list is orderable, a two-line
 * select target, and an edit shortcut that appears on hover.
 *
 * ── TWO LINES ───────────────────────────────────────────────────────────────
 * The rail was one name per row, which was all it had space for while it stacked
 * four groups. Tabs gave it the height back, so the row now carries the same
 * summary the pane does (price, access, state) — enough to pick the right thing
 * WITHOUT selecting each one to find out, which is the whole job of a list you
 * scan. Exactly one detail line: a third would make the list a second copy of
 * the pane, and then the pane is the redundant one.
 *
 * ── THREE CONTROLS, THREE BUTTONS ───────────────────────────────────────────
 * The handle and the edit shortcut are siblings of the select target, not
 * children: a `<button>` inside a `<button>` is invalid, and all three are
 * different intents on the same row. The edit shortcut is hidden until hover or
 * KEYBOARD FOCUS — `focus-visible:opacity-100` is not decoration, it is the only
 * thing that keeps it reachable without a mouse.
 */
function RailRow({
  name,
  detail,
  color,
  warn,
  selected,
  onClick,
  sortable,
  reorderLabel,
  edit,
  editLabel,
}: {
  name: string
  /** The second line — see `detailLine` in the page. */
  detail?: string
  color?: string
  warn?: boolean
  selected: boolean
  onClick: () => void
  /** Present only when this list is orderable — see `canReorder` in the page. */
  sortable?: SortableRenderProps
  reorderLabel?: string
  /** What the pencil does — open a dialog, or go somewhere. Absent for a reader
   *  who cannot edit. */
  edit?: PaneAction
  editLabel?: string
}) {
  return (
    <div
      ref={sortable?.setNodeRef}
      style={sortable?.style}
      className={`group flex items-center rounded-lg ${
        sortable?.isDragging ? 'bg-card shadow-lg' : ''
      } ${selected ? 'bg-primary/10' : 'hover:bg-muted'}`}
    >
      {sortable && (
        <button
          type="button"
          {...sortable.attributes}
          {...sortable.listeners}
          aria-label={reorderLabel}
          // `touch-none` is what makes this work on a phone at all: without it
          // the browser claims the gesture for scrolling before the sensor sees
          // it.
          className="shrink-0 cursor-grab touch-none rounded p-1 text-muted-foreground/50 transition-colors hover:text-foreground active:cursor-grabbing"
        >
          <GripVertical className="h-3.5 w-3.5" />
        </button>
      )}

      <button
        type="button"
        onClick={onClick}
        aria-pressed={selected}
        // ROOM TO SCAN. Two lines of text in `py-1.5` made a rail of twenty
        // items one dense block; the eye needs a gap to find the boundary
        // between rows, and the name is doing the work now that it has weight
        // (Franco, 2026-09-02).
        className={`flex min-w-0 flex-1 items-start gap-2.5 rounded-lg px-2 py-2.5 text-left ${
          selected ? 'text-primary' : ''
        }`}
      >
        {color !== undefined && (
          <span
            className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full"
            style={{ background: color || DEFAULT_ACCENT }}
          />
        )}
        <span className="min-w-0 flex-1">
          {/* THE NAME CARRIES THE ROW. It was `text-sm` with no weight, one
              step from the muted detail line under it, so a rail of twenty
              items read as twenty pairs of similar-looking lines rather than a
              list of names with notes attached (Franco, 2026-09-02). */}
          <span className="block truncate text-[15px] font-semibold leading-tight">{name}</span>
          {detail && (
            <span className="mt-1 block truncate text-[11px] leading-tight text-muted-foreground">
              {detail}
            </span>
          )}
        </span>
        {warn && <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600" />}
      </button>

      {edit && (
        <EditPencil edit={edit} label={editLabel} />
      )}
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

/** The row's pencil. A BUTTON or a LINK depending on what editing this thing
 *  means — the two must look identical, because to the reader they are the same
 *  affordance and the difference is ours, not theirs. */
function EditPencil({ edit, label }: { edit: PaneAction; label?: string }) {
  const className =
    'mr-1 shrink-0 rounded p-1 text-muted-foreground opacity-0 transition-opacity hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100'
  return (
    <Tip label={label ?? ''}>
      {'run' in edit ? (
        <button
          type="button"
          aria-label={label}
          onClick={(e) => {
            e.stopPropagation()
            edit.run()
          }}
          className={className}
        >
          <Pencil className="h-3.5 w-3.5" />
        </button>
      ) : (
        <Link
          href={edit.href}
          aria-label={label}
          onClick={(e) => e.stopPropagation()}
          className={className}
        >
          <Pencil className="h-3.5 w-3.5" />
        </Link>
      )}
    </Tip>
  )
}

function RailEmpty({ text }: { text: string }) {
  return <p className="px-2 py-1.5 text-xs text-muted-foreground">{text}</p>
}
