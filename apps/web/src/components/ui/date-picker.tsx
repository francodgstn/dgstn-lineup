'use client'

import * as React from 'react'
import { format, setHours, setMinutes } from 'date-fns'
import { CalendarIcon, Clock } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Calendar } from '@/components/ui/calendar'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Input } from '@/components/ui/input'

// ─── shared ───────────────────────────────────────────────────────────────────

const NOW = new Date()

function toStartMonth(year: number) { return new Date(year, 0) }
function toEndMonth(year: number)   { return new Date(year, 11) }

const triggerBase =
  'flex h-9 w-full items-center gap-2 rounded-lg border border-input bg-transparent px-3 py-1 text-sm transition-colors outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 text-left'

// ─── DatePicker ───────────────────────────────────────────────────────────────

interface DatePickerProps {
  value?: Date
  onChange: (date: Date | undefined) => void
  placeholder?: string
  className?: string
  disabled?: boolean
  /** Earliest selectable year. Default: current year − 5. Pass e.g. 1920 for birthdate pickers. */
  fromYear?: number
  /** Latest selectable year. Default: current year + 5. */
  toYear?: number
}

export function DatePicker({
  value,
  onChange,
  placeholder = 'Pick a date',
  className,
  disabled,
  fromYear = NOW.getFullYear() - 5,
  toYear = NOW.getFullYear() + 5,
}: DatePickerProps) {
  const [open, setOpen] = React.useState(false)

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        disabled={disabled}
        className={cn(triggerBase, !value && 'text-muted-foreground', className)}
      >
        <CalendarIcon className="h-4 w-4 shrink-0 opacity-50" />
        {value ? format(value, 'dd MMM yyyy') : placeholder}
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <Calendar
          mode="single"
          captionLayout="dropdown"
          selected={value}
          defaultMonth={value ?? NOW}
          startMonth={toStartMonth(fromYear)}
          endMonth={toEndMonth(toYear)}
          reverseYears
          onSelect={(d) => { onChange(d); setOpen(false) }}
        />
      </PopoverContent>
    </Popover>
  )
}

// ─── DateTimePicker ───────────────────────────────────────────────────────────

interface DateTimePickerProps {
  value?: Date
  onChange: (date: Date | undefined) => void
  placeholder?: string
  className?: string
  disabled?: boolean
  fromYear?: number
  toYear?: number
}

export function DateTimePicker({
  value,
  onChange,
  placeholder = 'Pick date & time',
  className,
  disabled,
  fromYear = NOW.getFullYear() - 5,
  toYear = NOW.getFullYear() + 5,
}: DateTimePickerProps) {
  const [open, setOpen] = React.useState(false)

  const timeValue = value
    ? `${String(value.getHours()).padStart(2, '0')}:${String(value.getMinutes()).padStart(2, '0')}`
    : ''

  function handleDaySelect(day: Date | undefined) {
    if (!day) { onChange(undefined); return }
    // Preserve existing time; default to 09:00 for new selections
    const h = value?.getHours() ?? 9
    const m = value?.getMinutes() ?? 0
    onChange(setMinutes(setHours(day, h), m))
  }

  function handleTimeChange(e: React.ChangeEvent<HTMLInputElement>) {
    const [hStr, mStr] = e.target.value.split(':')
    const h = parseInt(hStr, 10)
    const m = parseInt(mStr, 10)
    if (isNaN(h) || isNaN(m)) return
    onChange(setMinutes(setHours(value ?? new Date(), h), m))
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        disabled={disabled}
        className={cn(triggerBase, !value && 'text-muted-foreground', className)}
      >
        <CalendarIcon className="h-4 w-4 shrink-0 opacity-50" />
        {value ? format(value, 'dd MMM yyyy, HH:mm') : placeholder}
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <Calendar
          mode="single"
          captionLayout="dropdown"
          selected={value}
          defaultMonth={value ?? NOW}
          startMonth={toStartMonth(fromYear)}
          endMonth={toEndMonth(toYear)}
          reverseYears
          onSelect={handleDaySelect}
        />
        <div className="border-t px-3 py-2.5 flex items-center gap-2">
          <Clock className="h-4 w-4 text-muted-foreground shrink-0" />
          <Input
            type="time"
            value={timeValue}
            onChange={handleTimeChange}
            className="h-8 flex-1 text-sm"
          />
        </div>
      </PopoverContent>
    </Popover>
  )
}
