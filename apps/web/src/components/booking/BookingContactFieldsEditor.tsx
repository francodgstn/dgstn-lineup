'use client'

/**
 * Picking which CONTACT fields a book form collects.
 *
 * Used in two places with the same shape: Settings → Booking (the team-wide
 * list) and the activity editor (the per-activity list, which EXTENDS the team
 * one — it never replaces it, so the activity surface says so rather than
 * letting a studio assume the fields it does not tick are switched off).
 *
 * ── WHY A CUSTOM FIELD MAY BE UNAVAILABLE HERE ───────────────────────────────
 * A custom field can only be asked on the public book form once its definition
 * opts in (`publicOnBookingForm`), because asking it means mirroring its label
 * and options into the world-readable team profile. Rather than hide the
 * un-ticked ones — which reads as "the field is missing" and sends people
 * looking for a bug — they are listed, disabled, with the reason and where to
 * change it.
 */

import { useTranslations } from 'next-intl'
import {
  BOOKING_CONTACT_BASE_FIELDS,
  BOOKING_CONTACT_FIELD_CUSTOM_PREFIX,
  type BookingContactField,
  type CustomFieldDefinition,
} from '@linyup/shared'
import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'

interface Props {
  value: BookingContactField[]
  onChange: (next: BookingContactField[]) => void
  /** The team's definitions — un-opted-in ones render disabled, not hidden. */
  definitions: CustomFieldDefinition[]
  /** True in the activity editor, where the list EXTENDS the team default. */
  extendsTeamDefault?: boolean
  /** Keys already asked team-wide, shown as inherited in the activity editor. */
  inheritedKeys?: string[]
}

export function BookingContactFieldsEditor({
  value,
  onChange,
  definitions,
  extendsTeamDefault,
  inheritedKeys = [],
}: Props) {
  const t = useTranslations('BookingContactFields')
  const selected = new Map(value.map((f) => [f.key, f]))

  function toggle(key: string, on: boolean) {
    onChange(on ? [...value, { key }] : value.filter((f) => f.key !== key))
  }

  function setRequired(key: string, required: boolean) {
    onChange(value.map((f) => (f.key === key ? { ...f, required } : f)))
  }

  function row(key: string, label: string, opts?: { disabled?: boolean; hint?: string }) {
    const chosen = selected.get(key)
    const inherited = inheritedKeys.includes(key)
    return (
      <div key={key} className="flex items-start justify-between gap-3 py-2">
        <div className="space-y-0.5">
          <Label className="text-sm font-medium">{label}</Label>
          {inherited && (
            <p className="text-xs text-muted-foreground">{t('inheritedFromTeam')}</p>
          )}
          {opts?.hint && <p className="text-xs text-muted-foreground">{opts.hint}</p>}
        </div>
        <div className="flex items-center gap-4 shrink-0">
          {chosen && (
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              {t('required')}
              <Switch
                checked={chosen.required === true}
                onCheckedChange={(v) => setRequired(key, v)}
              />
            </label>
          )}
          <Switch
            checked={!!chosen}
            disabled={opts?.disabled}
            onCheckedChange={(v) => toggle(key, v)}
          />
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div>
        <p className="text-sm font-medium">{t('title')}</p>
        <p className="text-xs text-muted-foreground">
          {extendsTeamDefault ? t('descriptionActivity') : t('descriptionTeam')}
        </p>
      </div>

      <div className="divide-y rounded-md border px-3">
        {BOOKING_CONTACT_BASE_FIELDS.map((key) =>
          row(key, t(`field_${key}` as Parameters<typeof t>[0]))
        )}
        {definitions.map((def) => {
          const key = `${BOOKING_CONTACT_FIELD_CUSTOM_PREFIX}${def.id}`
          const askable = def.publicOnBookingForm === true
          return row(key, def.label, {
            disabled: !askable,
            hint: askable ? undefined : t('notPublicHint'),
          })
        })}
      </div>

      {/* The distinction the whole feature rests on, said once, where someone is
          about to make the choice. */}
      <p className="text-xs text-muted-foreground">{t('versusBookingQuestions')}</p>
    </div>
  )
}
