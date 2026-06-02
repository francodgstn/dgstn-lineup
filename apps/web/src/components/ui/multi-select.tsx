'use client'

import * as React from 'react'
import { Check, ChevronsUpDown, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'

export interface MultiSelectOption {
  value: string
  label: string
}

interface MultiSelectProps {
  options: MultiSelectOption[]
  value: string[]
  onChange: (value: string[]) => void
  placeholder?: string
  searchPlaceholder?: string
  emptyText?: string
  className?: string
  disabled?: boolean
  maxDisplay?: number
}

export function MultiSelect({
  options,
  value,
  onChange,
  placeholder = 'Select…',
  searchPlaceholder = 'Search…',
  emptyText = 'No results.',
  className,
  disabled,
  maxDisplay = 2,
}: MultiSelectProps) {
  const [open, setOpen] = React.useState(false)
  const savedScrollY = React.useRef(0)

  const handleOpenChange = (v: boolean) => {
    if (v) savedScrollY.current = window.scrollY
    setOpen(v)
  }

  // Base UI mounts the popup portal before positioning it. Any internal
  // focus call fires async (useEffect / rAF) and scrolls the page to the
  // portal's initial (0,0) position before the Positioner moves it.
  // Strategy: lock the scroll position for 2 animation frames on open —
  // long enough to absorb all async focus side-effects, short enough not
  // to block deliberate user scrolling.
  React.useLayoutEffect(() => {
    if (!open) return
    const y = savedScrollY.current
    window.scrollTo(0, y)

    const restore = () => window.scrollTo(0, y)
    window.addEventListener('scroll', restore)

    let raf2: number
    const raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => window.removeEventListener('scroll', restore))
    })

    return () => {
      cancelAnimationFrame(raf1)
      cancelAnimationFrame(raf2)
      window.removeEventListener('scroll', restore)
    }
  }, [open])

  const toggle = (val: string) => {
    onChange(value.includes(val) ? value.filter((v) => v !== val) : [...value, val])
  }

  const remove = (val: string, e: React.MouseEvent) => {
    e.stopPropagation()
    onChange(value.filter((v) => v !== val))
  }

  const labels = value.map((v) => options.find((o) => o.value === v)?.label ?? v)

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger
        disabled={disabled}
        className={cn(
          'flex min-h-8 w-full flex-wrap items-center gap-1 rounded-lg border border-input bg-transparent px-2.5 py-1 text-sm transition-colors outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50',
          className
        )}
      >
        {value.length === 0 && <span className="text-muted-foreground flex-1">{placeholder}</span>}
        {labels.slice(0, maxDisplay).map((label, i) => (
          <Badge key={value[i]} variant="secondary" className="gap-1 pr-1 text-xs">
            {label}
            <button
              onClick={(e) => remove(value[i], e)}
              className="rounded-full opacity-60 hover:opacity-100 transition-opacity"
              tabIndex={-1}
            >
              <X className="h-3 w-3" />
            </button>
          </Badge>
        ))}
        {value.length > maxDisplay && (
          <Badge variant="secondary" className="text-xs">+{value.length - maxDisplay}</Badge>
        )}
        <ChevronsUpDown className="ml-auto h-4 w-4 shrink-0 opacity-50" />
      </PopoverTrigger>
      <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
        <Command>
          <CommandInput placeholder={searchPlaceholder} />
          <CommandList>
            <CommandEmpty>{emptyText}</CommandEmpty>
            <CommandGroup>
              {options.map((option) => (
                <CommandItem
                  key={option.value}
                  value={option.value}
                  onSelect={() => toggle(option.value)}
                >
                  <Check className={cn('mr-2 h-4 w-4', value.includes(option.value) ? 'opacity-100' : 'opacity-0')} />
                  {option.label}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
