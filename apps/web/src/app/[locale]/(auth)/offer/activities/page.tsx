'use client'

import { useSearchParams } from 'next/navigation'
import { useState, useRef, useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import type { Route } from 'next'
import { useRouter } from '@/i18n/navigation'
import { Link } from '@/i18n/navigation'
import { updateDoc, doc, writeBatch } from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { useAuth } from '@/contexts/AuthContext'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Button, buttonVariants } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { ACTIVITIES_COLLECTION, resolveActivityAccessRule } from '@linyup/shared'
import type { Activity, SubscriptionType } from '@linyup/shared'

import { useSubscriptionTypes } from '@/hooks/useSubscriptionTypes'
import { useActivities } from '@/hooks/useActivities'
import { useInvalidateSetupChecklist } from '@/hooks/useSetupChecklist'
import { activityMoneyChipLabels } from '@/lib/activityTerms'
import { reorderWithinSection } from '@/lib/reorder'
import { formatCurrency } from '@/lib/format'
import { PageHeader } from '@/components/layout/PageHeader'
import { SortableList, SortableItem, type SortableRenderProps } from '@/components/ui/sortable'
import {
  Archive,
  CalendarDays,
  ChevronDown,
  ChevronRight,
  Copy,
  GripVertical,
  Pencil,
  Plus,
  Waypoints
} from 'lucide-react'
import { ActivityScheduleSheet } from '@/components/activities/ActivityScheduleSheet'
import { QUICK_ACTION_PARAM } from '@/lib/quickActions'
import { ActivityDialog } from '@/components/activities/ActivityDialog'

function ArchiveConfirmDialog({
  activity,
  onConfirm,
  onCancel,
}: {
  activity: Activity | null
  onConfirm: () => void
  onCancel: () => void
}) {
  const t = useTranslations('Activities')
  return (
    <Dialog open={!!activity} onOpenChange={(o) => { if (!o) onCancel() }}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{t('archive')}</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground py-2">
          {activity ? t('archiveConfirm', { name: activity.name }) : ''}
        </p>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onCancel}>{t('cancel')}</Button>
          <Button variant="destructive" onClick={onConfirm}>{t('archive')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ─── helpers ──────────────────────────────────────────────────────────────────

function ActivityCard({
  activity,
  onEdit,
  onDuplicate,
  onArchive,
  onViewSchedule,
  sortable,
  currency,
  subscriptionTypes,
}: {
  activity: Activity
  onEdit: () => void
  onDuplicate: () => void
  onArchive: () => void
  onViewSchedule: () => void
  sortable: SortableRenderProps
  currency: string
  subscriptionTypes: SubscriptionType[]
}) {
  const t = useTranslations('Activities')
  const tCommon = useTranslations('Common')
  const { setNodeRef, style, attributes, listeners, isDragging } = sortable
  // The FREE trial keeps its own badge below (freeTrialBadge); a PRICED trial is
  // a real money story, so the shared resolver gives it a money chip instead.
  const moneyChips = activityMoneyChipLabels(
    activity,
    currency,
    subscriptionTypes,
    t as unknown as (key: string, values?: Record<string, string | number>) => string,
    formatCurrency
  )

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`flex items-center gap-3 p-3 rounded-lg border bg-card ${
        isDragging ? 'shadow-lg' : 'hover:shadow-sm'
      } transition-shadow`}
    >
      <button
        type="button"
        {...attributes}
        {...listeners}
        className="p-1 -ml-1 rounded text-muted-foreground hover:bg-muted transition-colors cursor-grab active:cursor-grabbing touch-none"
        aria-label={t('reorder')}
      >
        <GripVertical className="h-4 w-4" />
      </button>

      {activity.image_url ? (
        <div className="h-10 w-10 rounded-md overflow-hidden flex-shrink-0 ring-1 ring-inset ring-black/10">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={activity.image_url} alt="" className="h-full w-full object-cover" />
        </div>
      ) : (
        <div
          className="h-4 w-4 rounded-full flex-shrink-0 ring-1 ring-inset ring-black/10"
          style={{ backgroundColor: activity.color ?? '#e5e7eb' }}
        />
      )}

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <p className="font-medium text-sm">{activity.name}</p>
          {activity.type === 'appointment' && (
            <Badge variant="secondary" className="text-xs">{t('type_appointment')}</Badge>
          )}
          {activity.tags?.map((tag) => (
            <Badge key={tag} variant="secondary" className="text-xs">
              {tag}
            </Badge>
          ))}
          {(() => {
            const rule = resolveActivityAccessRule(activity)
            if (rule.type === 'subscription')
              return <Badge variant="outline" className="text-xs">{t('accessBadgeSubscription')}</Badge>
            // The SHORT label, not the tier card's: this is a chip in a row of
            // chips, and the card title carries a qualifier that would wrap here.
            if (rule.type === 'members')
              return <Badge variant="outline" className="text-xs">{t('accessBadgeMembers')}</Badge>
            return activity.isFreeTrial ? (
              <Badge variant="outline" className="text-xs">{t('freeTrialBadge')}</Badge>
            ) : null
          })()}
          {moneyChips.map((label, i) => (
            <Badge key={`money-${i}`} variant="secondary" className="text-xs">
              {label}
            </Badge>
          ))}
        </div>
        {activity.description && (
          <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{activity.description}</p>
        )}
      </div>

      <div className="flex items-center gap-0.5 flex-shrink-0">
        {/* FIRST, before edit: viewing precedes changing, and "is this actually
            on the calendar?" is the question this row could never answer about
            itself — an activity with no sessions behind it is invisible to every
            visitor while looking perfectly configured. */}
        <button
          onClick={onViewSchedule}
          className="p-1.5 text-muted-foreground hover:text-foreground rounded transition-colors"
          title={t('viewSchedule')}
        >
          <CalendarDays className="h-4 w-4" />
        </button>
        <button
          onClick={onEdit}
          className="p-1.5 text-muted-foreground hover:text-foreground rounded transition-colors"
          title={t('editActivity')}
        >
          <Pencil className="h-4 w-4" />
        </button>
        <button
          onClick={onDuplicate}
          className="p-1.5 text-muted-foreground hover:text-foreground rounded transition-colors"
          title={tCommon('duplicate')}
        >
          <Copy className="h-4 w-4" />
        </button>
        <button
          onClick={onArchive}
          className="p-1.5 text-muted-foreground hover:text-destructive rounded transition-colors"
          title={t('archive')}
        >
          <Archive className="h-4 w-4" />
        </button>
      </div>
    </div>
  )
}

// ─── page ─────────────────────────────────────────────────────────────────────

export default function ActivitiesPage() {
  const { currentTeamId, user, team } = useAuth()
  const { data: activities = [], isLoading } = useActivities(currentTeamId)
  const { data: subscriptionTypes = [] } = useSubscriptionTypes(currentTeamId)
  // Same capability the catalogue gates the plan editor on, so the control does
  // not appear here for someone the write would be refused for.
  const currency = team?.default_currency ?? 'CHF'
  const qc = useQueryClient()
  // Archiving the last activity puts the "add an activity" step back.
  const invalidateSetupChecklist = useInvalidateSetupChecklist()
  const t = useTranslations('Activities')
  const tNav = useTranslations('Nav')
  // The button's label IS the catalogue's page title, so the two cannot drift.
  const tCat = useTranslations('OfferCatalogue')
  // Opened straight from the dashboard's quick action. Read ONCE, in a lazy
  // initializer, so clearing the param or closing the dialog is not undone by
  // the next render — the same shape as `openOnAttention` on the contacts list.
  const quickActionParams = useSearchParams()
  const [dialogOpen, setDialogOpen] = useState(
    () => quickActionParams.get(QUICK_ACTION_PARAM) === '1'
  )
  const [editing, setEditing] = useState<Activity | null>(null)
  const [duplicating, setDuplicating] = useState<Activity | null>(null)
  const [archiving, setArchiving] = useState<Activity | null>(null)
  // "When does this actually run?" — a read-only peek, deliberately NOT a section
  // inside the editor: that dialog is a long scroll with a rule about what may
  // sit above its disclosure, and this answers a question you ask BEFORE
  // deciding to change anything.
  const router = useRouter()
  const [schedulePreview, setSchedulePreview] = useState<Activity | null>(null)
  // The dialog gets the LIVE row, never this snapshot. It now hosts the plan
  // editor, which writes `accessRule` on the same activity and invalidates
  // ['activities'] — so the form must be looking at the refreshed document when
  // its own Save carries that field forward. The dialog is keyed on the id, so
  // it does not remount on the refetch and nothing typed is lost.
  const editingLive = editing ? (activities.find((a) => a.id === editing.id) ?? editing) : null

  function openNew() { setEditing(null); setDuplicating(null); setDialogOpen(true) }
  function openEdit(a: Activity) { setDuplicating(null); setEditing(a); setDialogOpen(true) }

  // ── arriving from the catalogue's Edit button (?edit=<id>) ──
  // Unlike the "new" param above, this cannot be read in a lazy initializer:
  // the activities load async, so there is nothing to find on first render. The
  // ref makes it fire ONCE — otherwise closing the dialog with the param still
  // in the URL would reopen it on the next render.
  const editParam = quickActionParams.get('edit')
  const consumedEditParam = useRef(false)
  useEffect(() => {
    if (consumedEditParam.current || !editParam || activities.length === 0) return
    const target = activities.find((a) => a.id === editParam)
    consumedEditParam.current = true
    if (target) openEdit(target)
  }, [editParam, activities])
  // A copy OPENS in the same dialog rather than being written silently: the name
  // and everything else is there to change before anything exists.
  function openDuplicate(a: Activity) { setEditing(null); setDuplicating(a); setDialogOpen(true) }
  function closeDialog() { setDialogOpen(false); setEditing(null); setDuplicating(null) }

  async function handleArchiveConfirm() {
    if (!archiving) return
    await updateDoc(doc(db, ACTIVITIES_COLLECTION, archiving.id), { isActive: false })
    await qc.invalidateQueries({ queryKey: ['activities'] })
    void invalidateSetupChecklist()
    setArchiving(null)
  }

  // The admin list is split into Classes and Appointments. Legacy docs without a
  // type count as classes, matching the model's default.
  const classActivities = activities.filter((a) => a.type !== 'appointment')
  const appointmentActivities = activities.filter((a) => a.type === 'appointment')
  const [collapsed, setCollapsed] = useState<{ classes: boolean; appointments: boolean }>({
    classes: false,
    appointments: false,
  })

  // Drag-and-drop reorder, scoped to one section. The permutation itself is
  // `reorderWithinSection` (lib/reorder.ts) — shared with the catalogue's rail,
  // which reorders the same collection from a different screen. Persists
  // `order = global index` for the whole list in one batch, normalising docs
  // that never had an explicit order.
  async function reorderSection(section: Activity[], from: number, to: number) {
    if (from === to || !currentTeamId) return
    const full = reorderWithinSection(activities, section, from, to)
    const batch = writeBatch(db)
    full.forEach((a, i) => {
      if (a.order !== i) batch.update(doc(db, ACTIVITIES_COLLECTION, a.id), { order: i })
    })
    await batch.commit()
    await qc.invalidateQueries({ queryKey: ['activities'] })
  }

  function renderSection(
    key: 'classes' | 'appointments',
    label: string,
    items: Activity[],
  ) {
    const isCollapsed = collapsed[key]
    return (
      <section className="space-y-2">
        <button
          type="button"
          onClick={() => setCollapsed((c) => ({ ...c, [key]: !c[key] }))}
          className="flex w-full items-center gap-1.5 text-left"
          aria-expanded={!isCollapsed}
        >
          {isCollapsed ? (
            <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
          ) : (
            <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />
          )}
          <span className="text-sm font-semibold">{label}</span>
          <span className="text-xs text-muted-foreground">({items.length})</span>
        </button>
        {!isCollapsed &&
          (items.length === 0 ? (
            <p className="pl-6 text-sm text-muted-foreground">{t('sectionEmpty')}</p>
          ) : (
            <SortableList
              ids={items.map((a) => a.id)}
              onReorder={(from, to) => reorderSection(items, from, to)}
            >
              <div className="space-y-2">
                {items.map((a) => (
                  <SortableItem key={a.id} id={a.id}>
                    {(sortable) => (
                      <ActivityCard
                        activity={a}
                        onEdit={() => openEdit(a)}
                        onDuplicate={() => openDuplicate(a)}
                        onArchive={() => setArchiving(a)}
                        onViewSchedule={() => setSchedulePreview(a)}
                        sortable={sortable}
                        currency={currency}
                        subscriptionTypes={subscriptionTypes}
                      />
                    )}
                  </SortableItem>
                ))}
              </div>
            </SortableList>
          ))}
      </section>
    )
  }

  return (
    <div className="space-y-6">
      {/* Two quick links (UX-71). The Schedule answers the question this page
          cannot: an activity is a TEMPLATE, nothing here says whether it is
          actually on the calendar, and one with no sessions behind it is
          invisible to every visitor while looking perfectly configured. The
          Catalogue answers the other one — which plans open it. (This used to
          claim the rows already showed that. They did not: the class chips drop
          the `gate` term, so a row showed the bare word "Subscription" and never
          a plan name.) */}
      <PageHeader
        title={t('title')}
        quickLinks={[
          { href: '/schedule' as Route, label: tNav('calendar') },
          // The two pages that decide whether an activity can actually be
          // booked and at what price: the plan that unlocks it, and the price a
          // member ends up paying. Both were reachable only by hunting.
          { href: '/offer/plans' as Route, label: tNav('subscriptionPlans') },
          { href: '/offer/pricing' as Route, label: tNav('pricing') },
        ]}
        action={
          <>
            {/* The catalogue was a quick link, which is a line of muted text
                below the fold on a phone and easy to read past on any screen.
                It is the answer to "which plans open this", asked constantly —
                so it gets a button. Outline, not primary: creating an activity
                is still the thing this page is for. */}
            <Link
              href={'/offer/catalogue' as Route}
              className={buttonVariants({ variant: 'outline' })}
            >
              <Waypoints className="h-4 w-4 mr-1.5" />
              {tCat('title')}
            </Link>
            <Button onClick={openNew}>
              <Plus className="h-4 w-4 mr-1.5" />
              {t('newActivity')}
            </Button>
          </>
        }
      />

      {isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-16 w-full rounded-lg" />
          ))}
        </div>
      ) : activities.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 border rounded-xl border-dashed gap-2 bg-card">
          <p className="text-sm text-muted-foreground">{t('empty')}</p>
          <button onClick={openNew} className="text-sm text-primary hover:underline">
            {t('emptyAction')}
          </button>
        </div>
      ) : (
        <div className="space-y-5">
          {renderSection('classes', t('sectionClasses'), classActivities)}
          {renderSection('appointments', t('sectionAppointments'), appointmentActivities)}
        </div>
      )}

      {currentTeamId && user && (
        <ActivityDialog
          key={editing?.id ?? (duplicating ? `copy-${duplicating.id}` : 'new')}
          open={dialogOpen}
          onClose={closeDialog}
          teamId={currentTeamId}
          userId={user.uid}
          editing={editingLive}
          duplicating={duplicating}
          nextOrder={activities.length}
          currency={team?.default_currency ?? 'CHF'}
          // A new activity has no tier, no price and no plans, and this form no
          // longer asks — so finish the job where those controls are, rather
          // than leaving a class on the list that nobody can book.
          onCreated={(id) => router.push(`/offer/catalogue?sel=activity:${id}` as Route)}
        />
      )}

      <ArchiveConfirmDialog
        activity={archiving}
        onConfirm={handleArchiveConfirm}
        onCancel={() => setArchiving(null)}
      />

      <ActivityScheduleSheet
        activity={schedulePreview}
        open={!!schedulePreview}
        onOpenChange={(v) => { if (!v) setSchedulePreview(null) }}
        teamId={currentTeamId}
      />
    </div>
  )
}
