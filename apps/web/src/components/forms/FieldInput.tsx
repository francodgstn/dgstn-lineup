'use client'

// The renderer for one `FormField`. Shared by the Custom Forms public page
// (/public/{slug}/forms/{slug}) and the booking flow's per-activity booking
// questions — both consume the same field schema, so they render identically
// and a new field type only has to be handled once.
//
// Controlled: the caller owns the answers map and passes value/onChange.

import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import type { FormField } from '@linyup/shared'

export function FieldInput({
  field,
  value,
  onChange,
  disabled,
}: {
  field: FormField
  value: unknown
  onChange: (v: unknown) => void
  disabled?: boolean
}) {
  switch (field.type) {
    case 'long_text':
      return (
        <Textarea
          value={(value as string) ?? ''}
          onChange={(e) => onChange(e.target.value)}
          placeholder={field.placeholder}
          disabled={disabled}
          rows={4}
        />
      )
    case 'single_choice':
    case 'dropdown':
      return (
        <Select value={(value as string) ?? ''} onValueChange={onChange} disabled={disabled}>
          <SelectTrigger><SelectValue placeholder={field.placeholder} /></SelectTrigger>
          <SelectContent>
            {(field.options ?? []).map((opt) => (
              <SelectItem key={opt} value={opt}>{opt}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      )
    case 'multiple_choice': {
      const arr = Array.isArray(value) ? (value as string[]) : []
      return (
        <div className="space-y-1.5">
          {(field.options ?? []).map((opt) => (
            <label key={opt} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={arr.includes(opt)}
                disabled={disabled}
                onChange={(e) =>
                  onChange(e.target.checked ? [...arr, opt] : arr.filter((o) => o !== opt))
                }
              />
              {opt}
            </label>
          ))}
        </div>
      )
    }
    case 'checkbox':
      return (
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={!!value}
            disabled={disabled}
            onChange={(e) => onChange(e.target.checked)}
          />
          {field.placeholder || field.label}
        </label>
      )
    case 'date':
      return (
        <Input
          type="date"
          value={(value as string) ?? ''}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
        />
      )
    case 'number':
      return (
        <Input
          type="number"
          value={(value as string) ?? ''}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
          placeholder={field.placeholder}
        />
      )
    case 'email':
      return (
        <Input
          type="email"
          value={(value as string) ?? ''}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
          placeholder={field.placeholder}
        />
      )
    default:
      return (
        <Input
          value={(value as string) ?? ''}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
          placeholder={field.placeholder}
        />
      )
  }
}

/** Is a required field satisfied? Shared so the booking flow and the forms page
 *  agree on what "answered" means (an unticked checkbox is NOT an answer). */
export function isFieldAnswered(field: FormField, value: unknown): boolean {
  if (field.type === 'checkbox') return value === true
  if (field.type === 'multiple_choice') return Array.isArray(value) && value.length > 0
  return value !== undefined && value !== null && String(value).trim() !== ''
}
