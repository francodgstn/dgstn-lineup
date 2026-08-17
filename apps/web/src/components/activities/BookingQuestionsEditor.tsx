'use client'

// Editor for an activity's book-form questions (`Activity.bookingQuestions`).
//
// Deliberately narrower than the Custom Forms builder: a book form is a
// checkout, not a survey, so this offers the handful of field types that make
// sense to ask while someone is booking and caps the count at
// MAX_BOOKING_QUESTIONS. The schema is the SAME `FormField` the forms plugin
// uses, so the public renderer is shared (components/forms/FieldInput).

import { useTranslations } from 'next-intl'
import { Plus, Trash2, GripVertical } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { MAX_BOOKING_QUESTIONS, type FormField, type FormFieldType } from '@linyup/shared'

// The subset worth asking at booking time. `email`/`phone` are deliberately
// absent — the guest form already collects those, and asking twice is how you
// end up with two conflicting addresses on one booking.
const BOOKING_FIELD_TYPES: FormFieldType[] = [
  'short_text',
  'long_text',
  'number',
  'single_choice',
  'multiple_choice',
  'checkbox',
  'date',
]

const CHOICE_TYPES: FormFieldType[] = ['single_choice', 'multiple_choice']

/** Stable-ish id for a new question. Answers are keyed by this, so it must
 *  never be regenerated for an existing question — see Booking.question_answers. */
function newFieldId(): string {
  return `q_${Math.random().toString(36).slice(2, 10)}`
}

export function BookingQuestionsEditor({
  value,
  onChange,
}: {
  value: FormField[]
  onChange: (next: FormField[]) => void
}) {
  const t = useTranslations('Activities')

  function update(idx: number, patch: Partial<FormField>) {
    onChange(value.map((f, i) => (i === idx ? { ...f, ...patch } : f)))
  }

  function add() {
    if (value.length >= MAX_BOOKING_QUESTIONS) return
    onChange([
      ...value,
      { id: newFieldId(), type: 'short_text', label: '', required: false, order: value.length },
    ])
  }

  function remove(idx: number) {
    onChange(value.filter((_, i) => i !== idx).map((f, i) => ({ ...f, order: i })))
  }

  function move(idx: number, delta: number) {
    const next = [...value]
    const target = idx + delta
    if (target < 0 || target >= next.length) return
    ;[next[idx], next[target]] = [next[target], next[idx]]
    onChange(next.map((f, i) => ({ ...f, order: i })))
  }

  return (
    <div className="space-y-3">
      <div>
        <p className="text-sm font-medium">{t('bookingQuestionsTitle')}</p>
        <p className="text-xs text-muted-foreground">{t('bookingQuestionsHelp')}</p>
      </div>

      {value.length === 0 && (
        <p className="text-xs text-muted-foreground">{t('bookingQuestionsEmpty')}</p>
      )}

      <div className="space-y-3">
        {value.map((field, idx) => {
          const isChoice = CHOICE_TYPES.includes(field.type)
          return (
            <div key={field.id} className="rounded-lg border p-3 space-y-2">
              <div className="flex items-start gap-2">
                <div className="flex flex-col pt-1.5 text-muted-foreground">
                  <button
                    type="button"
                    onClick={() => move(idx, -1)}
                    disabled={idx === 0}
                    aria-label={t('bookingQuestionMoveUp')}
                    className="disabled:opacity-30"
                  >
                    <GripVertical className="h-4 w-4" />
                  </button>
                </div>
                <div className="flex-1 space-y-2">
                  <Input
                    value={field.label}
                    onChange={(e) => update(idx, { label: e.target.value })}
                    placeholder={t('bookingQuestionLabelPlaceholder')}
                  />
                  <div className="flex flex-wrap items-center gap-2">
                    <Select
                      value={field.type}
                      onValueChange={(v) =>
                        update(idx, {
                          type: v as FormFieldType,
                          // Options are meaningless off a choice type — drop
                          // them rather than leaving invisible stale data.
                          options: CHOICE_TYPES.includes(v as FormFieldType)
                            ? (field.options ?? [])
                            : undefined,
                        })
                      }
                    >
                      <SelectTrigger className="h-8 w-44">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {BOOKING_FIELD_TYPES.map((ft) => (
                          <SelectItem key={ft} value={ft}>
                            {t(`fieldType_${ft}` as Parameters<typeof t>[0])}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <label className="flex items-center gap-1.5 text-xs">
                      <input
                        type="checkbox"
                        checked={field.required ?? false}
                        onChange={(e) => update(idx, { required: e.target.checked })}
                      />
                      {t('bookingQuestionRequired')}
                    </label>
                  </div>
                  {isChoice && (
                    <Input
                      value={(field.options ?? []).join(', ')}
                      onChange={(e) =>
                        update(idx, {
                          options: e.target.value
                            .split(',')
                            .map((o) => o.trim())
                            .filter(Boolean),
                        })
                      }
                      placeholder={t('bookingQuestionOptionsPlaceholder')}
                      className="text-sm"
                    />
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => remove(idx)}
                  aria-label={t('bookingQuestionRemove')}
                  className="pt-1.5 text-muted-foreground transition-colors hover:text-destructive"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            </div>
          )
        })}
      </div>

      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={add}
        disabled={value.length >= MAX_BOOKING_QUESTIONS}
        className="gap-1.5"
      >
        <Plus className="h-3.5 w-3.5" />
        {t('bookingQuestionAdd')}
      </Button>
      {value.length >= MAX_BOOKING_QUESTIONS && (
        <p className="text-xs text-muted-foreground">
          {t('bookingQuestionsMax', { max: MAX_BOOKING_QUESTIONS })}
        </p>
      )}
    </div>
  )
}
