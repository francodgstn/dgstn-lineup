'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import type { EventTypeField } from '@linyup/shared'

/**
 * The check-in form for an event type with no special shape — and, with
 * `fields`, for a team-authored type whose shape is DATA.
 *
 * A studio builds `EventTypeConfig.checkin_fields` in Settings → Event types
 * (text, number, select, multiselect, boolean, each optionally required). That
 * is the generic case with a list attached, not a fourth kind of form, so the
 * fields render here rather than in a component of their own: without them this
 * is the "nothing to collect" body it has always been, with them it is the same
 * body plus the studio's questions.
 *
 * Answers are written into `checkin_data` keyed by `field.key`.
 */

/** What one authored field holds while it is being filled in. */
type FieldValue = string | number | boolean | string[]

/** Chosen in a select but meaning "nothing chosen" — Base UI has no empty
 *  option, and the repo already spells it this way (see the event place picker). */
const NO_SELECTION = '__none'

function seedValues(
  fields: EventTypeField[],
  existing?: Record<string, unknown>,
): Record<string, FieldValue> {
  const out: Record<string, FieldValue> = {}
  for (const f of fields) {
    const stored = existing?.[f.key]
    switch (f.type) {
      case 'multiselect':
        out[f.key] = Array.isArray(stored) ? (stored as string[]) : []
        break
      case 'boolean':
        out[f.key] = stored === true
        break
      case 'number':
        out[f.key] = typeof stored === 'number' ? stored : ''
        break
      default:
        out[f.key] = typeof stored === 'string' ? stored : ''
    }
  }
  return out
}

/** Whether a field has an answer — which is not the same as a truthy value. */
function answered(field: EventTypeField, value: FieldValue | undefined): boolean {
  switch (field.type) {
    case 'multiselect':
      return Array.isArray(value) && value.length > 0
    // A switch has no third, unanswered state: it reads false until somebody
    // moves it. So "required" here can only mean it must be ON — read the other
    // way round it would never block anything, making the flag inert.
    case 'boolean':
      return value === true
    // 0 IS an answer — "0 previous competitions", "0 kg to lose". The same trap
    // the exam form's entry grade fell into: a falsy test drops it silently.
    case 'number':
      return typeof value === 'number' && Number.isFinite(value)
    // text and select alike. The select's "nothing chosen" sentinel is mapped
    // back to '' as it is picked, so it never reaches here — a text answer that
    // happens to read like the sentinel is still an answer.
    default:
      return typeof value === 'string' && value.trim().length > 0
  }
}

function toCheckinData(
  fields: EventTypeField[],
  values: Record<string, FieldValue>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const f of fields) {
    const v = values[f.key]
    // A boolean is stored either way: false is the answer "no", not a blank.
    if (f.type === 'boolean') {
      out[f.key] = v === true
      continue
    }
    if (answered(f, v)) out[f.key] = v
  }
  return out
}

function CustomField({
  field,
  value,
  onChange,
}: {
  field: EventTypeField
  value: FieldValue | undefined
  onChange: (value: FieldValue) => void
}) {
  const t = useTranslations('CheckinPanel')
  const label = (
    <Label>
      {field.label || field.key}
      {field.required && (
        <span className="text-destructive" title={t('fieldRequired')} aria-label={t('fieldRequired')}>*</span>
      )}
    </Label>
  )

  if (field.type === 'boolean') {
    return (
      <label className="flex items-center gap-2.5 cursor-pointer">
        <Switch checked={value === true} onCheckedChange={(checked) => onChange(checked)} />
        <span className="text-sm">
          {field.label || field.key}
          {field.required && (
            <span className="text-destructive" title={t('fieldRequired')} aria-label={t('fieldRequired')}>*</span>
          )}
        </span>
      </label>
    )
  }

  if (field.type === 'select') {
    return (
      <div className="space-y-1.5">
        {label}
        <Select
          value={typeof value === 'string' && value ? value : NO_SELECTION}
          onValueChange={(v) => onChange(v === NO_SELECTION ? '' : (v as string))}
        >
          <SelectTrigger className="w-full">
            <SelectValue placeholder={t('fieldSelectPlaceholder')} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NO_SELECTION}>{t('fieldSelectPlaceholder')}</SelectItem>
            {(field.options ?? []).map((opt) => (
              <SelectItem key={opt} value={opt}>{opt}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    )
  }

  if (field.type === 'multiselect') {
    // Chips, not a popover picker: this is filled in at a door with a queue
    // behind it, and it is the idiom the exam form beside it already uses.
    const selected = Array.isArray(value) ? value : []
    return (
      <div className="space-y-1.5">
        {label}
        <div className="flex flex-wrap gap-2">
          {(field.options ?? []).map((opt) => {
            const on = selected.includes(opt)
            return (
              <button
                key={opt}
                type="button"
                aria-pressed={on}
                onClick={() => onChange(on ? selected.filter((s) => s !== opt) : [...selected, opt])}
                className={`px-3 py-1.5 text-xs rounded-md border transition-colors ${
                  on
                    ? 'border-primary bg-primary/10 text-primary font-medium'
                    : 'hover:bg-muted border-border'
                }`}
              >
                {opt}
              </button>
            )
          })}
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-1.5">
      {label}
      <Input
        type={field.type === 'number' ? 'number' : 'text'}
        value={value === undefined || value === null ? '' : String(value)}
        placeholder={field.placeholder}
        onChange={(e) => {
          const raw = e.target.value
          onChange(field.type === 'number' ? (raw === '' ? '' : Number(raw)) : raw)
        }}
      />
    </div>
  )
}

export function GenericCheckinForm({
  contact,
  existing,
  fields,
  onSubmit,
  onCancel,
  busy,
}: {
  contact: { id: string; firstname: string; lastname: string }
  existing?: Record<string, unknown>
  /** The event type's authored check-in fields, when it has any. */
  fields?: EventTypeField[]
  onSubmit: (data: Record<string, unknown>) => void
  onCancel: () => void
  busy?: boolean
}) {
  const t = useTranslations('CheckinPanel')
  const tCommon = useTranslations('Common')

  const fieldList = fields ?? []
  const [values, setValues] = useState<Record<string, FieldValue>>(
    () => seedValues(fieldList, existing),
  )

  const missingRequired = fieldList.some((f) => f.required && !answered(f, values[f.key]))

  return (
    <div className="space-y-4">
      {fieldList.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {t.rich('genericMarkAttendance', {
            name: `${contact.firstname} ${contact.lastname}`,
            strong: (chunks) => <strong>{chunks}</strong>,
          })}{' '}
          {t('genericNoExtraData')}
        </p>
      ) : (
        <>
          <p className="text-sm font-medium">{contact.firstname} {contact.lastname}</p>
          <p className="text-xs text-muted-foreground">{t('customFieldsIntro')}</p>
          {fieldList.map((f) => (
            <CustomField
              key={f.key}
              field={f}
              value={values[f.key]}
              onChange={(v) => setValues((prev) => ({ ...prev, [f.key]: v }))}
            />
          ))}
          {missingRequired && (
            <p className="text-xs text-amber-600">{t('customFieldsRequiredHint')}</p>
          )}
        </>
      )}

      <div className="flex gap-2 justify-end">
        <Button variant="outline" onClick={onCancel} disabled={busy}>{tCommon('cancel')}</Button>
        <Button
          onClick={() => onSubmit(toCheckinData(fieldList, values))}
          disabled={busy || missingRequired}
        >
          {existing ? t('genericSubmitUpdate') : t('submitCheckIn')}
        </Button>
      </div>
    </div>
  )
}
