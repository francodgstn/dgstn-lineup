'use client'

/**
 * THE QUEUE — one block per QUESTION, not one block per collection.
 *
 * This is where this design differs from the incumbent in kind rather than
 * degree. The incumbent has a "needs attention" list of contacts, a figure
 * counting unfiled payments, and a setup checklist band — three blocks, in
 * three places, in two materials, all answering the same question: *what is
 * waiting on a human here?* They are one list on this page.
 *
 * The ordering is deliberate and is not urgency-by-score alone:
 *
 *  - **PEOPLE FIRST**, because people go cold. An unacknowledged lead, a booked
 *    trial nobody has confirmed, a member who has quietly stopped coming — every
 *    one of those decays if it waits a day. Ranked by the SHARED comparator
 *    (`compareContactsByAttention`), so "the top five here" are the top five of
 *    the contacts page's own Needs-attention view; no second definition of
 *    urgency exists.
 *  - **HOUSEKEEPING BELOW A RULE.** Unfiled payments and unfinished setup are
 *    real work, but they are exactly as urgent tomorrow. They sit under a
 *    hairline so they can be skipped by eye.
 *
 * EVERY ROW SAYS WHY. A name with no reason is a list nobody trusts.
 *
 * Zero extra reads for the people half: `contactAttentionReasons` runs over the
 * contacts the page has already loaded.
 */

import { useMemo } from 'react'
import { useTranslations } from 'next-intl'
import { Link } from '@/i18n/navigation'
import type { Route } from 'next'
import { ArrowRight, CheckCircle2, Rocket, Wallet } from 'lucide-react'
import type {
  Contact,
  ContactAttentionReason,
  ContactFilterContext,
  EngagementThresholds,
} from '@linyup/shared'
import { compareContactsByAttention, contactAttentionReasons } from '@linyup/shared'
import type { SetupStep } from '@/hooks/useSetupChecklist'
import { Skeleton } from '@/components/ui/skeleton'
import { usePlan } from '@/hooks/usePlan'
import { Panel, PanelBody, PanelHeader } from './Panel'
import { useUnassignedPaymentCount } from './preview-data'

/** How many people show before the list defers to the contacts page. */
const PEOPLE_ROWS = 5

/** The contacts page's Needs-attention view, entered directly. */
const ATTENTION_HREF = '/contacts?attention=1' as Route

type PersonRow = { contact: Contact; reason: ContactAttentionReason }

export function useQueuePeople(
  contacts: Contact[] | undefined,
  engagementThresholds?: EngagementThresholds
): PersonRow[] {
  const ctx: ContactFilterContext = useMemo(
    () => ({ engagementThresholds }),
    [engagementThresholds]
  )
  return useMemo(() => {
    const rows = (contacts ?? [])
      .filter((c) => !c.archived_at)
      .map((c) => ({ contact: c, reason: contactAttentionReasons(c, ctx)[0] }))
      .filter((r): r is PersonRow => !!r.reason)
    rows.sort((a, b) => compareContactsByAttention(a.contact, b.contact, ctx))
    return rows
  }, [contacts, ctx])
}

function PersonRowView({ contact, reason }: PersonRow) {
  const t = useTranslations('NewDashboard')
  const initials =
    `${contact.firstname?.[0] ?? ''}${contact.lastname?.[0] ?? ''}`.toUpperCase() || '?'
  return (
    <Link
      href={`/contacts/${contact.id}` as Route}
      className="flex items-center gap-2.5 rounded-lg px-1.5 py-1.5 transition-colors hover:bg-muted/60"
    >
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-amber-500/10 text-[11px] font-semibold text-amber-600">
        {initials}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium leading-tight">
          {contact.firstname} {contact.lastname}
        </span>
        <span className="block truncate text-[11px] leading-tight text-muted-foreground">
          {t(`reason_${reason}` as 'reason_alerts')}
        </span>
      </span>
      <ArrowRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground/40" />
    </Link>
  )
}

function TaskRowView({
  icon: Icon,
  label,
  meta,
  href,
}: {
  icon: React.ElementType
  label: string
  meta: string
  href: Route
}) {
  return (
    <Link
      href={href}
      className="flex items-center gap-2.5 rounded-lg px-1.5 py-1.5 transition-colors hover:bg-muted/60"
    >
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-muted">
        <Icon className="h-3.5 w-3.5 text-muted-foreground" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium leading-tight">{label}</span>
        <span className="block truncate text-[11px] leading-tight text-muted-foreground">
          {meta}
        </span>
      </span>
      <ArrowRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground/40" />
    </Link>
  )
}

export function QueuePanel({
  teamId,
  contacts,
  contactsLoading,
  engagementThresholds,
  setupSteps,
  setupLoading,
}: {
  teamId: string | null
  contacts: Contact[] | undefined
  contactsLoading: boolean
  engagementThresholds?: EngagementThresholds
  setupSteps: SetupStep[]
  setupLoading: boolean
}) {
  const t = useTranslations('NewDashboard')
  const { isAtLeast } = usePlan()

  const people = useQueuePeople(contacts, engagementThresholds)

  // Unfiled money is a Studio-tier surface, so the query only runs there —
  // passing null keeps the hook mounted and the request unsent.
  const seesMoney = isAtLeast('studio')
  const { count: unassigned } = useUnassignedPaymentCount(seesMoney ? teamId : null)

  const openSetup = setupLoading ? [] : setupSteps.filter((s) => !s.done && !s.optional)

  const tasks: { key: string; icon: React.ElementType; label: string; meta: string; href: Route }[] =
    []
  if (unassigned > 0) {
    tasks.push({
      key: 'payments',
      icon: Wallet,
      label: t('taskPayments'),
      meta: t('taskPaymentsMeta', { count: unassigned }),
      href: '/payments' as Route,
    })
  }
  if (openSetup.length > 0) {
    tasks.push({
      key: 'setup',
      icon: Rocket,
      label: t('taskSetup'),
      meta: t('taskSetupMeta', { count: openSetup.length }),
      href: openSetup[0].href as Route,
    })
  }

  const total = people.length + tasks.length
  const shown = people.slice(0, PEOPLE_ROWS)
  const hidden = people.length - shown.length

  return (
    <Panel>
      <PanelHeader
        title={t('queueTitle')}
        meta={total > 0 ? t('queueCount', { count: total }) : undefined}
        action={
          people.length > 0 ? (
            <Link
              href={ATTENTION_HREF}
              className="flex shrink-0 items-center gap-0.5 text-xs text-primary hover:underline"
            >
              {t('queueOpenContacts')}
              <ArrowRight className="h-3 w-3" />
            </Link>
          ) : undefined
        }
      />
      <PanelBody>
        {contactsLoading ? (
          <div className="space-y-3 p-1">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="flex items-center gap-2.5">
                <Skeleton className="h-7 w-7 rounded-full" />
                <div className="flex-1 space-y-1.5">
                  <Skeleton className="h-3.5 w-28" />
                  <Skeleton className="h-2.5 w-20" />
                </div>
              </div>
            ))}
          </div>
        ) : total === 0 ? (
          /* EMPTY IS THE GOOD ANSWER, and it has to read as one — a greyed
             placeholder here would look like a load that failed. */
          <div className="flex h-full flex-col items-center justify-center gap-1.5 py-10 text-center">
            <CheckCircle2 className="h-6 w-6 text-emerald-600" />
            <p className="text-sm font-medium">{t('queueEmptyTitle')}</p>
            <p className="max-w-[220px] text-xs text-muted-foreground">{t('queueEmptyBody')}</p>
          </div>
        ) : (
          <div className="space-y-0.5">
            {shown.map((row) => (
              <PersonRowView key={row.contact.id} {...row} />
            ))}
            {hidden > 0 && (
              <Link
                href={ATTENTION_HREF}
                className="block px-1.5 py-1 text-[11px] text-muted-foreground hover:text-primary hover:underline"
              >
                {t('queueMorePeople', { count: hidden })}
              </Link>
            )}
            {tasks.length > 0 && (
              <div className={shown.length > 0 ? 'mt-1.5 border-t pt-1.5' : ''}>
                {tasks.map(({ key, ...task }) => (
                  <TaskRowView key={key} {...task} />
                ))}
              </div>
            )}
          </div>
        )}
      </PanelBody>
    </Panel>
  )
}
