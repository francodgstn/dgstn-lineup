'use client'

/**
 * WHERE YOU ARE STANDING, AND HOW TO STAND SOMEWHERE ELSE — one control.
 *
 * ── WHY THIS MOVED (a reversal, recorded) ───────────────────────────────────
 *
 * The sidebar's header row used to be ORIENTATION ONLY, and that was argued
 * deliberately: the name told you where you were, and the switcher lived in the
 * account menu at the foot because reaching a SECOND STUDIO was a rare
 * account-level action somebody took after an invitation.
 *
 * The scope model (docs/org-navigation.md) invalidated the premise rather than
 * the reasoning. "Which place am I standing in" stopped being a rare question:
 * an organisation and a studio each have an Events, a Places, a Website, a
 * Plugins, a Members and a Settings, so the answer is load-bearing on every
 * screen, and moving between the two is something an org admin who also runs a
 * studio does all day. A question asked constantly should not be answered at
 * one end of the sidebar and changed at the other (Franco, 2026-08-27).
 *
 * So the indicator and the control are the same object, and the separate amber
 * band this replaced is deleted — its accent moves ONTO this trigger, because
 * the design's own stated failure mode is "just the org's name where the
 * studio's name used to be". A different name in the same slot is exactly that;
 * a different colour is not.
 *
 * ── IT OPENS A MENU. IT DOES NOT NAVIGATE. ──────────────────────────────────
 *
 * The row it replaced was a link to the studio dashboard, which in org scope
 * meant the topmost control in an organisation's sidebar quietly left the
 * organisation. A control that both navigates and opens a menu has to guess
 * which you meant; this one never does.
 */

import { useTranslations } from 'next-intl'
import { ChevronsUpDown, Landmark, Building2 } from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useScope } from '@/contexts/ScopeContext'
import { TeamSwitcher } from '@/components/layout/TeamSwitcher'

export function ScopeSwitcher({ collapsed }: { collapsed: boolean }) {
  const t = useTranslations('TopBar')
  const { current } = useScope()

  // GUARDED ON THE SCOPE, NOT ON THE TEAM NAME. The old row was hidden until
  // `team.name` loaded, so the one control that says where you are vanished for
  // exactly as long as that was uncertain. The kind word is always known.
  if (!current) return null

  const isOrg = current.kind === 'org'
  const kindLabel = isOrg ? t('scopeOrganisation') : t('scopeStudio')
  const name = current.name || kindLabel
  const Icon = isOrg ? Landmark : Building2

  // The accent the deleted band carried. Studio scope stays NEUTRAL, on the
  // band's own rule: a badge on the default case is noise rather than
  // information.
  const accent = isOrg
    ? 'border-amber-500/40 bg-amber-500/10 hover:bg-amber-500/15'
    : 'border-transparent hover:bg-accent'

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        title={collapsed ? `${kindLabel} · ${name}` : undefined}
        aria-label={`${kindLabel} · ${name}`}
        className={`flex min-w-0 items-center rounded-lg border transition-colors ${accent} ${
          collapsed ? 'h-8 w-8 justify-center' : 'w-full gap-2 px-2 py-1.5'
        }`}
      >
        <Icon
          className={`h-4 w-4 shrink-0 ${isOrg ? 'text-amber-600 dark:text-amber-400' : 'text-muted-foreground'}`}
        />
        {!collapsed && (
          <>
            <span className="flex min-w-0 flex-1 flex-col items-start">
              {/* The eyebrow is what stops a different NAME in the same slot
                  from being the only signal — it says which KIND of place this
                  is, in words, above the name. */}
              <span
                className={`text-[9px] font-bold uppercase leading-tight tracking-[0.12em] ${
                  isOrg ? 'text-amber-700 dark:text-amber-400' : 'text-muted-foreground/70'
                }`}
              >
                {kindLabel}
              </span>
              <span className="w-full truncate text-xs font-semibold leading-tight">{name}</span>
            </span>
            <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          </>
        )}
      </DropdownMenuTrigger>
      {/* `side="bottom"` because this sits at the TOP of the sidebar — the
          account menu it came from opened upward from the foot. The studios
          query inside only mounts when the menu opens, which is why the list
          lives in the portalled content rather than in the trigger. */}
      <DropdownMenuContent align="start" side="bottom" className="w-60">
        <TeamSwitcher />
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
