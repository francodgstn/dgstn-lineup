'use client'

import { format, parseISO } from 'date-fns'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { DatePicker } from '@/components/ui/date-picker'
import type { CustomFieldDefinition } from '@linyup/shared'

export type CustomFieldValue = string | number | boolean

/**
 * The per-type input widget for ONE custom field value.
 *
 * Extracted from `CustomFieldsCardBody` (the single-contact form) so the
 * bulk-edit dialog can render the exact same widgets rather than a parallel
 * implementation — see CLAUDE.md's "ONE resolver" rule. `onChange` is handed
 * whatever the widget itself produces, including an empty string for
 * `type: 'text'`; deciding what an empty answer MEANS (unset vs. an explicit
 * clear) is the caller's job — the single-contact form treats it as "leave
 * unset" and the bulk dialog treats it as "clear this field on every selected
 * contact", both by inspecting the value this component reports, never by
 * this component guessing.
 */
export function CustomFieldValueInput({
  def,
  value,
  onChange,
}: {
  def: CustomFieldDefinition
  value: CustomFieldValue | undefined
  onChange: (v: CustomFieldValue | undefined) => void
}) {
  switch (def.type) {
    case 'number':
      return (
        <Input
          type="number"
          inputMode="decimal"
          value={value === undefined ? '' : String(value)}
          onChange={(e) => {
            const n = Number(e.target.value)
            onChange(e.target.value === '' || Number.isNaN(n) ? undefined : n)
          }}
        />
      )
    case 'date': {
      const asDate = typeof value === 'string' && value ? parseISO(value) : undefined
      return (
        <DatePicker
          value={asDate}
          fromYear={1920}
          onChange={(d) => onChange(d ? format(d, 'yyyy-MM-dd') : undefined)}
        />
      )
    }
    case 'select':
      return (
        <Select
          value={typeof value === 'string' ? value : ''}
          onValueChange={(v) => onChange(v || undefined)}
        >
          <SelectTrigger className="w-full">
            <SelectValue placeholder="—" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="">—</SelectItem>
            {(def.options ?? []).map((opt) => (
              <SelectItem key={opt} value={opt}>
                {opt}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )
    case 'checkbox':
      return (
        <div className="pt-0.5">
          <Switch checked={value === true} onCheckedChange={(v) => onChange(v)} />
        </div>
      )
    case 'text':
    default:
      return (
        <Input
          value={typeof value === 'string' ? value : value === undefined ? '' : String(value)}
          onChange={(e) => onChange(e.target.value)}
        />
      )
  }
}
