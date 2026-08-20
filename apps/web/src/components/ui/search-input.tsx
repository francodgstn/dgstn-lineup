'use client'

// A search field with a magnifier and a CLEAR BUTTON.
//
// Seven surfaces in this app filter a list of people by typing, and until this
// existed exactly ONE of them (the contacts roster) let you undo that with a
// click — everywhere else the only way back to the full list was to select the
// text and delete it. On a phone that means summoning the keyboard again to
// erase a word you can already see is wrong, which is why the missing × reads as
// the list being broken rather than the field being sparse.
//
// The markup is lifted from the roster's version, which was the one that worked;
// this is that copy promoted, not a new design. Adopting it also settles a second
// inconsistency: some pickers used a raw `<input>` and got none of the `Input`
// primitive's focus ring or dark-mode handling.
//
// `onValueChange` rather than `onChange`: every caller of this holds the query in
// state and wants the string, and a clear button has no `ChangeEvent` to hand
// back. Making the string the contract means the clear path and the typing path
// are the same call, so a caller cannot wire one and forget the other.

import * as React from 'react'
import { Search, X } from 'lucide-react'
import { useTranslations } from 'next-intl'

import { cn } from '@/lib/utils'
import { Input } from '@/components/ui/input'

export function SearchInput({
  value,
  onValueChange,
  onArrowDown,
  inputRef: externalRef,
  className,
  onKeyDown,
  ...props
}: Omit<React.ComponentProps<'input'>, 'value' | 'onChange'> & {
  value: string
  onValueChange: (value: string) => void
  /** ArrowDown moves into the list this field filters — see useListKeyboardNav. */
  onArrowDown?: () => void
  /** Supply one to reach the field from outside (ArrowUp out of the list returns
   *  here). Omitted, the internal ref still serves the clear button. */
  inputRef?: React.RefObject<HTMLInputElement | null>
}) {
  const t = useTranslations('Common')
  const internalRef = React.useRef<HTMLInputElement>(null)
  const inputRef = externalRef ?? internalRef

  return (
    <div className="relative">
      <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
      <Input
        ref={inputRef}
        type="search"
        value={value}
        onChange={(e) => onValueChange(e.target.value)}
        onKeyDown={(e) => {
          // Down = into the results. preventDefault because the default is to
          // move the caret to the end of the field, which fights the intent and
          // (in a scrolling popup) can scroll the list out from under it.
          if (e.key === 'ArrowDown' && onArrowDown) {
            e.preventDefault()
            onArrowDown()
          }
          onKeyDown?.(e)
        }}
        // pr-9 always, not only when there is something to clear: reserving the
        // space unconditionally stops the text jumping sideways on the first
        // keystroke and again when the field empties.
        className={cn('pl-9 pr-9', className)}
        {...props}
      />
      {value && (
        <button
          type="button"
          // Focus returns to the field, because clearing is almost always
          // followed by typing something else — handing focus back to the page
          // would cost a second tap for the thing you were already doing.
          onClick={() => {
            onValueChange('')
            inputRef.current?.focus()
          }}
          aria-label={t('clearSearch')}
          className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  )
}

/**
 * Keyboard movement between a search field and the list it filters.
 *
 * A picker you can only reach with the mouse after typing is half a picker —
 * and ArrowDown that lands in a list which then ignores ArrowDown is worse than
 * none, because it strands the focus. So this owns BOTH halves: entering the
 * list, and moving inside it.
 *
 * Rows opt in with `data-list-row`, rather than being found by tag: these lists
 * contain other buttons (a clear ×, a checkbox glyph) and "first button in the
 * container" would eventually grab one of them.
 *
 * ArrowUp from the first row returns to the field, so the way in is the way out
 * and nothing traps focus. Home/End jump the ends. Everything else is left to
 * the browser — these are ordinary buttons, so Enter and Space already work.
 */
export function useListKeyboardNav<T extends HTMLElement = HTMLDivElement>(
  searchRef?: React.RefObject<HTMLInputElement | null>
) {
  const listRef = React.useRef<T>(null)

  const rows = React.useCallback(
    () =>
      Array.from(
        listRef.current?.querySelectorAll<HTMLElement>('[data-list-row]:not([disabled])') ?? []
      ),
    []
  )

  const focusFirst = React.useCallback(() => rows()[0]?.focus(), [rows])

  const onListKeyDown = React.useCallback(
    (e: React.KeyboardEvent) => {
      const all = rows()
      if (all.length === 0) return
      const i = all.indexOf(document.activeElement as HTMLElement)
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        all[Math.min(i + 1, all.length - 1)]?.focus()
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        if (i <= 0) searchRef?.current?.focus()
        else all[i - 1]?.focus()
      } else if (e.key === 'Home') {
        e.preventDefault()
        all[0]?.focus()
      } else if (e.key === 'End') {
        e.preventDefault()
        all[all.length - 1]?.focus()
      }
    },
    [rows, searchRef]
  )

  return { listRef, focusFirst, onListKeyDown }
}
