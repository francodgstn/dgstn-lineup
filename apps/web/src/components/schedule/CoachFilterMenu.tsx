'use client'

// THE COACH FILTER — several coaches at once, not "one or everyone".
//
// It was single-select (All coaches | Only me | one named coach), which made the
// ordinary question "what are Anna and Ben doing this week" inexpressible: you
// could see one of them, or the whole studio. It is now a multi-select in the
// same checkbox idiom as the layers menu beside it, so the row has ONE grammar
// for "there is more behind this caret".
//
// CLEARED MEANS ALL. An empty selection is "every coach", never "no coaches" —
// an empty calendar produced by a filter that defaulted to nothing selected is
// the failure mode this rule exists to prevent, and it is the reason the state
// is a plain `string[]` with `[]` as its start rather than a nullable set.
//
// "Only me" survives as an ACTION, not a mode. It used to be a mutually
// exclusive option, which is precisely the thing being removed; but it is still
// the single most-used scope in the product and it is one click, so it sits with
// "All coaches" under the separator and simply SETS the selection to yourself.
// Because it is no longer a mode, the current user also appears as an ordinary
// checkbox in the list above — previously they were filtered out of it, which
// meant a studio could not build "me and Anna" at all.
//
// THE TRIGGER NAMES THE STATE (the precedent this chip itself set): "All
// coaches" when cleared, "Only me" when the one selected coach is you, that
// coach's name when it is somebody else, and a count once there are several —
// past one name there is nothing short enough to say, and the menu is one click
// away.
//
// WHAT THIS DOES NOT TOUCH: no Firestore query takes a coach. Sessions are
// fetched by team and window (`useSessionsInRange`) and availability by team
// (`useAvailabilityTemplates`); the selection narrows arrays already in memory.
// So there is no `in` clause here, no 30-value cap, and no "empty array is not a
// valid `in`" hazard — the widening from one id to a set is genuinely just a
// widening. Say so here rather than let the next reader wonder.

import { useTranslations } from 'next-intl'
import { ChevronDown, User } from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { coachLabel, type CoachOption } from '@/hooks/useCoaches'

interface Props {
  coaches: CoachOption[]
  /** Selected coach uids. **Empty = every coach** — see the header. */
  selected: string[]
  onChange: (next: string[]) => void
  currentUserId: string | null
}

export function CoachFilterMenu({ coaches, selected, onChange, currentUserId }: Props) {
  const t = useTranslations('Calendar')

  const isMineOnly = selected.length === 1 && selected[0] === currentUserId
  const triggerLabel =
    selected.length === 0
      ? t('coachAll')
      : isMineOnly
        ? t('coachMine')
        : selected.length === 1
          ? (() => {
              const c = coaches.find((x) => x.userId === selected[0])
              return c ? coachLabel(c) : t('coachAll')
            })()
          : t('coachCount', { count: selected.length })

  const toggle = (userId: string) =>
    onChange(
      selected.includes(userId)
        ? selected.filter((id) => id !== userId)
        : // Roster order, so the selection reads the same however it was built.
          coaches.filter((c) => c.userId === userId || selected.includes(c.userId)).map((c) => c.userId)
    )

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={t('coachMenuLabel')}
        title={triggerLabel}
        className={cn(
          'inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition-colors',
          selected.length === 0
            ? 'bg-muted text-muted-foreground hover:text-foreground'
            : 'bg-primary text-primary-foreground'
        )}
      >
        <User className="h-3.5 w-3.5 shrink-0" />
        <span className="max-w-[13rem] truncate">{triggerLabel}</span>
        <ChevronDown className="h-3.5 w-3.5 shrink-0" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        {coaches.map((c) => (
          <DropdownMenuCheckboxItem
            key={c.userId}
            checked={selected.includes(c.userId)}
            // Picking a second coach must not dismiss the menu.
            closeOnClick={false}
            onCheckedChange={() => toggle(c.userId)}
          >
            <span className="truncate">{coachLabel(c)}</span>
          </DropdownMenuCheckboxItem>
        ))}

        {/* The two shortcuts — peers of the layers menu's "Show all" / "Reset to
            default", in the same place, for the same reason: they set the whole
            selection at once rather than stating one member of it. */}
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => onChange([])} disabled={selected.length === 0}>
          {t('coachAll')}
        </DropdownMenuItem>
        {currentUserId && coaches.some((c) => c.userId === currentUserId) && (
          <DropdownMenuItem onClick={() => onChange([currentUserId])} disabled={isMineOnly}>
            {t('coachMine')}
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
