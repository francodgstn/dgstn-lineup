'use client'

import * as React from 'react'
import { format, setHours, setMinutes } from 'date-fns'
import { CalendarIcon, Clock } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Calendar } from '@/components/ui/calendar'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'

// ─── shared ───────────────────────────────────────────────────────────────────

const NOW = new Date()

function toStartMonth(year: number) { return new Date(year, 0) }
function toEndMonth(year: number)   { return new Date(year, 11) }

const triggerBase =
  'flex h-9 w-full items-center gap-2 rounded-lg border border-input bg-transparent px-3 py-1 text-sm transition-colors outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 text-left'

// ─── Time select helpers ──────────────────────────────────────────────────────

const HOUR_OPTIONS = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, '0'))
const MINUTE_OPTIONS = Array.from({ length: 12 }, (_, i) => String(i * 5).padStart(2, '0'))

/** Round to nearest multiple of 5, clamped to valid minute */
function snapMinute(raw: number): string {
  return String(Math.min(55, Math.round(raw / 5) * 5)).padStart(2, '0')
}

const nativeSelectCls =
  'h-8 w-[3.2rem] rounded-md border border-input bg-background px-1 text-center text-sm text-foreground ' +
  'focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:border-ring ' +
  'cursor-pointer transition-colors hover:bg-accent/50'

/** Two compact native selects for hour + minute — safe to nest inside any Popover */
function TimeSelects({
  hour,
  minute,
  onHourChange,
  onMinuteChange,
}: {
  hour: string
  minute: string
  onHourChange: (h: string) => void
  onMinuteChange: (m: string) => void
}) {
  return (
    <div className="flex items-center gap-1">
      <select
        value={hour}
        onChange={(e) => onHourChange(e.target.value)}
        className={nativeSelectCls}
        aria-label="Hour"
      >
        {HOUR_OPTIONS.map((h) => <option key={h} value={h}>{h}</option>)}
      </select>
      <span className="text-sm font-semibold text-muted-foreground select-none">:</span>
      <select
        value={minute}
        onChange={(e) => onMinuteChange(e.target.value)}
        className={nativeSelectCls}
        aria-label="Minute"
      >
        {MINUTE_OPTIONS.map((m) => <option key={m} value={m}>{m}</option>)}
      </select>
    </div>
  )
}

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

  const hour   = value ? String(value.getHours()).padStart(2, '0') : '09'
  const minute = value ? snapMinute(value.getMinutes()) : '00'

  function handleDaySelect(day: Date | undefined) {
    if (!day) { onChange(undefined); return }
    const h = value?.getHours() ?? 9
    const m = value?.getMinutes() ?? 0
    onChange(setMinutes(setHours(day, h), m))
    // keep popover open so user can adjust time
  }

  function handleHourChange(h: string) {
    const newH = parseInt(h, 10)
    if (isNaN(newH)) return
    onChange(setHours(value ?? new Date(), newH))
  }

  function handleMinuteChange(m: string) {
    const newM = parseInt(m, 10)
    if (isNaN(newM)) return
    onChange(setMinutes(value ?? new Date(), newM))
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
        {/* Time row */}
        <div className="border-t px-3 py-2.5 flex items-center justify-between gap-3">
          <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
            <Clock className="h-4 w-4 shrink-0" />
            <span>Time</span>
          </div>
          <TimeSelects
            hour={hour}
            minute={minute}
            onHourChange={handleHourChange}
            onMinuteChange={handleMinuteChange}
          />
        </div>
      </PopoverContent>
    </Popover>
  )
}

// ─── TimePicker ───────────────────────────────────────────────────────────────

interface TimePickerProps {
  /** "HH:mm" string e.g. "09:30" */
  value?: string
  onChange: (time: string) => void
  placeholder?: string
  className?: string
  disabled?: boolean
}

export function TimePicker({
  value,
  onChange,
  placeholder = 'Pick time',
  className,
  disabled,
}: TimePickerProps) {
  const [open, setOpen] = React.useState(false)

  const parts  = value?.split(':') ?? []
  const hour   = parts[0] ? parts[0].padStart(2, '0') : '09'
  const minute = parts[1] ? snapMinute(parseInt(parts[1], 10)) : '00'

  const displayValue = value ? `${hour}:${minute}` : undefined

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        disabled={disabled}
        className={cn(triggerBase, !value && 'text-muted-foreground', className)}
      >
        <Clock className="h-4 w-4 shrink-0 opacity-50" />
        {displayValue ?? placeholder}
      </PopoverTrigger>
      <PopoverContent className="w-auto p-3" align="start">
        <div className="flex items-center gap-3">
          <span className="text-sm text-muted-foreground">Time</span>
          <TimeSelects
            hour={hour}
            minute={minute}
            onHourChange={(h) => onChange(`${h}:${minute}`)}
            onMinuteChange={(m) => onChange(`${hour}:${m}`)}
          />
        </div>
      </PopoverContent>
    </Popover>
  )
}
