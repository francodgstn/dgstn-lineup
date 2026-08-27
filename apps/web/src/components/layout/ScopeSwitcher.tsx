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
import { TeamSwitcher, useMyTeams } from '@/components/layout/TeamSwitcher'

export function ScopeSwitcher({ collapsed }: { collapsed: boolean }) {
  const t = useTranslations('TopBar')
  const { current, available } = useScope()
  // THIS MOVES THE STUDIOS QUERY FROM MENU-OPEN TO SIDEBAR-MOUNT, and that is a
  // real trade rather than a free one. It was deliberately lazy before: a
  // collection-group query plus a document read per studio, paid only by someone
  // who actually opened the account menu.
  //
  // It is paid up front now because the control cannot be drawn correctly
  // without the answer — whether there is anywhere to go decides whether this is
  // a button or a label, and a chevron that opens nothing is worse than the
  // query. `staleTime: 5 * 60_000` makes it roughly once a session rather than
  // once a page, and the menu now opens already populated instead of spinning.
  const { data: teams = [] } = useMyTeams()

  // GUARDED ON THE SCOPE, NOT ON THE TEAM NAME. The old row was hidden until
  // `team.name` loaded, so the one control that says where you are vanished for
  // exactly as long as that was uncertain. The kind word is always known.
  if (!current) return null

  // MOST PEOPLE HAVE NOWHERE TO SWITCH TO, and for them this is a label rather
  // than a control. TeamSwitcher's own rule was that "the account menu is
  // unchanged for the overwhelming majority" — a chevron and a dropdown whose
  // only row is "Create another studio" would break that promise for every
  // single-studio login, which is nearly all of them. They get the identity,
  // plainly, and reach studio creation where it already lives.
  const canSwitch = teams.length > 1 || available.some((s) => s.kind === 'org')

  const isOrg = current.kind === 'org'
  const kindLabel = isOrg ? t('scopeOrganisation') : t('scopeStudio')
  const name = current.name || kindLabel

  // BOTH SCOPES ARE BOXED; ONLY THE COLOUR DIFFERS (Franco, 2026-08-27).
  //
  // Studio scope was left deliberately unboxed at first, on the rule the deleted
  // indicator band followed: a badge on the DEFAULT case is noise rather than
  // information. That rule is right about badges and wrong about this control,
  // because it made the SHAPE change between scopes — and a control that changes
  // shape is harder to learn than one that changes colour. Boxed in both, the
  // eye finds the same object in the same place every time and reads the colour
  // for which place it is.
  //
  // The org keeps the loud amber; the studio gets the product's own primary at
  // low opacity, which is present enough to draw the box and quiet enough not to
  // compete with the nav rows below — it is the ordinary case, not an alert.
  const accent = isOrg
    ? 'border-amber-500/40 bg-amber-500/10 hover:bg-amber-500/15'
    : 'border-primary/20 bg-primary/5 hover:bg-primary/10'

  // NO ICON WHEN THERE IS A LABEL. Expanded, the eyebrow already says which KIND
  // of place this is, in words — a glyph beside it was the same fact twice, and
  // on a row that also carries the QR, the flip and the utilities those pixels
  // were the difference between fitting and not (Franco, 2026-08-27).
  //
  // COLLAPSED IS THE OPPOSITE CASE, by the same reasoning: there is no label at
  // w-14, so the glyph is the only thing carrying the kind and it earns its
  // place. A two-letter abbreviation was tried first and "OR" for Organisation
  // reads as the conjunction.
  const Icon = isOrg ? Landmark : Building2
  const identity = collapsed ? (
    <Icon
      className={`h-4 w-4 shrink-0 ${isOrg ? 'text-amber-600 dark:text-amber-400' : 'text-primary/70'}`}
    />
  ) : (
    <span className="flex min-w-0 flex-1 flex-col items-start">
      <span
        className={`text-[9px] font-bold uppercase leading-tight tracking-[0.12em] ${
          isOrg ? 'text-amber-700 dark:text-amber-400' : 'text-muted-foreground/70'
        }`}
      >
        {kindLabel}
      </span>
      <span className="w-full truncate text-xs font-semibold leading-tight">{name}</span>
    </span>
  )

  // `flex-1 min-w-0`, NOT `w-full`. As a flex item on a row that also holds the
  // QR, the flip and the utilities, `w-full` claimed 100% of the row and shoved
  // the rest off the end of the sidebar — the switcher itself then collapsed to
  // 18px while its own text overflowed. `flex-1` takes what is left and
  // truncates inside it, which is what `min-w-0` is there to permit.
  const shape = `flex min-w-0 items-center rounded-lg border transition-colors ${accent} ${
    collapsed ? 'h-8 w-8 shrink-0 justify-center' : 'flex-1 gap-2 pl-1 pr-2 py-1.5'
  }`

  if (!canSwitch) {
    return (
      <div
        title={collapsed ? `${kindLabel} · ${name}` : undefined}
        aria-label={`${kindLabel} · ${name}`}
        className={shape}
      >
        {identity}
      </div>
    )
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        title={collapsed ? `${kindLabel} · ${name}` : undefined}
        aria-label={`${kindLabel} · ${name}`}
        className={shape}
      >
        {identity}
        {!collapsed && <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />}
      </DropdownMenuTrigger>
      {/* `side="bottom"` because this sits at the TOP of the sidebar — the
          account menu it came from opened upward from the foot. */}
      <DropdownMenuContent align="start" side="bottom" className="w-60">
        <TeamSwitcher />
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
