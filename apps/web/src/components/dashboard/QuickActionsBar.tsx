'use client'

/**
 * The dashboard's quick-action strip, and the picker that decides what is in it.
 *
 * WHAT BELONGS HERE is settled in `lib/quickActions.ts` — every entry starts
 * something. This file is only the rendering and the choosing.
 *
 * ── THE AUTOMATIONS ARE DATA, THE REST IS A CATALOGUE ────────────────────────
 *
 * Four of the five fixed actions are a route with a `?new=1` on it; the QR is a
 * dialog with nothing behind it, so it opens in place. Automations are neither:
 * there is one per rule the studio wrote, so they are read from the team and
 * appended to the picker beneath a separator.
 *
 * ONLY ACTIVE RULES ARE OFFERED. `triggerAutomationRule` refuses a paused rule
 * outright, so a pill for one would be a button that always fails — and the
 * failure would arrive on the automations page, two clicks from here, with no
 * hint that the dashboard sent a request that never had a chance.
 *
 * A SELECTED RULE THAT LATER DISAPPEARS (deleted, or paused) simply stops
 * rendering: `resolved` drops any id that no longer resolves to something
 * runnable, and the stored id is left alone rather than pruned. Un-pausing the
 * rule brings its pill back, which is what somebody who paused a rule for a
 * fortnight expects.
 */

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import type { Route } from 'next'
import { Link } from '@/i18n/navigation'
import { MoreHorizontal, Settings2 } from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import { useAutomationRules } from '@/hooks/useAutomationRules'
import { useQuickActions } from '@/hooks/useQuickActions'
import {
  QUICK_ACTION_CATALOGUE,
  QUICK_ACTION_MAX,
  quickActionAutomationRuleId,
  quickActionForAutomation,
  type QuickActionDef,
} from '@/lib/quickActions'
import { QRDialog } from '@/components/layout/QRDialog'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

const PILL =
  'inline-flex items-center gap-1.5 rounded-full border bg-card px-3 py-1.5 text-xs font-medium shadow-sm transition-colors hover:bg-muted/60'

export function QuickActionsBar() {
  const t = useTranslations('QuickActions')
  const { currentTeamId, team } = useAuth()
  const { ids, toggle, atMax } = useQuickActions()
  const { data: rules = [] } = useAutomationRules(currentTeamId)
  const [qrOpen, setQrOpen] = useState(false)

  const automationActions = rules
    .filter((r) => r.active)
    .map((r) => quickActionForAutomation(r.id, r.name || t('unnamedAutomation')))

  const available: QuickActionDef[] = [...QUICK_ACTION_CATALOGUE, ...automationActions]
  const byId = new Map(available.map((a) => [a.id, a]))
  // The studio's ORDER, not the catalogue's — the bar reads the way it was
  // built. Anything that no longer resolves is dropped for this render only.
  const resolved = ids.map((id) => byId.get(id)).filter((a): a is QuickActionDef => !!a)

  const labelOf = (a: QuickActionDef) =>
    a.label ?? t(a.labelKey as Parameters<typeof t>[0])

  return (
    <>
      <div className="flex shrink-0 flex-wrap items-center gap-2">
        {resolved.map((a) => {
          const Icon = a.icon
          const label = labelOf(a)
          if (!a.href) {
            return (
              <button key={a.id} type="button" onClick={() => setQrOpen(true)} className={PILL}>
                <Icon className="h-3.5 w-3.5 text-primary" />
                {label}
              </button>
            )
          }
          return (
            <Link key={a.id} href={a.href as Route} className={PILL}>
              <Icon className="h-3.5 w-3.5 text-primary" />
              {label}
            </Link>
          )
        })}

        <DropdownMenu>
          {/* No `asChild` — this project's DropdownMenuTrigger renders its own
              button and does not take it (see UserMenu). */}
          <DropdownMenuTrigger
            title={t('configure')}
            aria-label={t('configure')}
            className="inline-flex h-[30px] w-[30px] items-center justify-center rounded-full border bg-card text-muted-foreground shadow-sm transition-colors hover:bg-muted/60 hover:text-foreground"
          >
            {/* The bar can be emptied completely, and an empty strip with no
                control on it is a dead end — this is the way back in. */}
            {resolved.length === 0 ? (
              <Settings2 className="h-3.5 w-3.5" />
            ) : (
              <MoreHorizontal className="h-4 w-4" />
            )}
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-64">
            {/* PLAIN DIVS, not `DropdownMenuLabel`. That export is Base UI's
                `Menu.GroupLabel` and throws "MenuGroupRootContext is missing"
                unless it sits inside a `Menu.Group` — it took the whole
                dashboard down behind the error boundary the first time this
                menu was opened. These are headings, not group labels, so they
                have no business claiming that role anyway. */}
            <div className="flex items-baseline justify-between gap-2 px-2 py-1.5 text-sm font-medium">
              <span>{t('pickerTitle')}</span>
              <span className="text-[11px] font-normal text-muted-foreground">
                {t('pickerCount', { used: ids.length, max: QUICK_ACTION_MAX })}
              </span>
            </div>
            <DropdownMenuSeparator />
            {QUICK_ACTION_CATALOGUE.map((a) => (
              <QuickActionRow
                key={a.id}
                action={a}
                label={labelOf(a)}
                checked={ids.includes(a.id)}
                atMax={atMax}
                onToggle={() => toggle(a.id)}
              />
            ))}
            {automationActions.length > 0 && (
              <>
                <DropdownMenuSeparator />
                <div className="px-2 py-1 text-[11px] text-muted-foreground">
                  {t('automationsGroup')}
                </div>
                {automationActions.map((a) => (
                  <QuickActionRow
                    key={a.id}
                    action={a}
                    label={labelOf(a)}
                    checked={ids.includes(a.id)}
                    atMax={atMax}
                    onToggle={() => toggle(a.id)}
                  />
                ))}
              </>
            )}
            {/* Said once, where the choice is made: this is not where pages go.
                Without it the obvious next request is "add Contacts to the bar",
                which is the thing the nav already does better. */}
            <DropdownMenuSeparator />
            <p className="px-2 py-1.5 text-[11px] leading-snug text-muted-foreground">
              {t('pickerHint')}
            </p>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <QRDialog open={qrOpen} onClose={() => setQrOpen(false)} team={team} />
    </>
  )
}

/** One row of the picker. Unticked rows go disabled at the cap rather than
 *  vanishing — a list that shrinks as you fill it is a list you cannot learn. */
function QuickActionRow({
  action,
  label,
  checked,
  atMax,
  onToggle,
}: {
  action: QuickActionDef
  label: string
  checked: boolean
  atMax: boolean
  onToggle: () => void
}) {
  const Icon = action.icon
  const isAutomation = quickActionAutomationRuleId(action.id) !== null
  return (
    <DropdownMenuCheckboxItem
      checked={checked}
      disabled={!checked && atMax}
      onCheckedChange={onToggle}
      // The menu stays open: choosing five things one at a time through a menu
      // that closes on every click is five round trips.
      onSelect={(e) => e.preventDefault()}
      className="gap-2"
    >
      <Icon className={`h-3.5 w-3.5 shrink-0 ${isAutomation ? 'text-amber-500' : 'text-primary'}`} />
      <span className="truncate">{label}</span>
    </DropdownMenuCheckboxItem>
  )
}
