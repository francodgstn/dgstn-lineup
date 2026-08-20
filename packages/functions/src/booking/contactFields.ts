/**
 * Turning a book form's CONTACT-field answers into a contact patch.
 *
 * ── WHY THIS IS A NARROWING FUNCTION AND NOT A MERGE ─────────────────────────
 * The public book form is ANONYMOUS. Its payload is attacker-controlled, and it
 * is writing to a contact document — so the server decides which keys exist, not
 * the caller. This mirrors what `bookingQuestions` already does ("the server
 * re-narrows these to the activity's own questions before storing"), for the
 * same reason and against the same threat: without it, a crafted payload sets
 * `archived_at`, `subscription_type_id`, or a custom field the studio never
 * asked for.
 *
 * So the ONLY keys that survive are the ones the resolved field list names, and
 * a `custom:` key survives only when its definition exists AND opted in to being
 * asked publicly. A definition that was never ticked is not merely hidden from
 * the form — it is refused at the write.
 *
 * ── AN EMPTY ANSWER NEVER BLANKS A STORED VALUE ──────────────────────────────
 * A studio adds "phone" to the form; a member who already has one books and
 * leaves the prefilled box untouched, or the client sends ''. Treating that as
 * an edit would delete a phone number the studio collected months ago, silently,
 * on an ordinary booking. Absent and empty are therefore both "no answer".
 */

import type { BookingContactField, CustomFieldDefinition } from '@linyup/shared'
import {
  bookingContactFieldCustomId,
  BOOKING_CONTACT_BASE_FIELDS,
  resolveBookingContactFields,
} from '@linyup/shared'
import { Timestamp } from 'firebase-admin/firestore'
import { loadBookingSettings } from './bookingSettings'

/** Base contact fields a book form may write. Kept as a Set of the shared
 *  vocabulary so adding one there cannot silently fail to be writable here. */
const WRITABLE_BASE = new Set<string>(BOOKING_CONTACT_BASE_FIELDS)

export interface ContactFieldPatchInput {
  /** The resolved list — `resolveBookingContactFields(bookingSettings, activity)`. */
  fields: BookingContactField[]
  /** Raw client payload, keyed the same way the fields are. */
  answers: Record<string, unknown> | null | undefined
  /** The team's definitions, for validating `custom:` keys. */
  definitions: CustomFieldDefinition[] | null | undefined
  /**
   * The contact as it stands, when there is one. Used ONLY to leave a stored
   * value alone when the answer is empty — never to decide what is writable.
   */
  existing?: Record<string, unknown> | null
}

/** A flat Firestore patch (dotted paths for custom fields), or `{}` when the
 *  form asked for nothing the caller answered. */
export function buildContactFieldPatch(input: ContactFieldPatchInput): Record<string, unknown> {
  const answers = input.answers ?? {}
  const patch: Record<string, unknown> = {}
  const defs = new Map((input.definitions ?? []).map((d) => [d.id, d]))

  for (const field of input.fields ?? []) {
    const key = field?.key
    if (!key) continue
    const raw = answers[key]
    const value = typeof raw === 'string' ? raw.trim() : raw
    // Absent, empty string, or null — all "no answer". Never an instruction to
    // erase what is already stored.
    if (value === undefined || value === null || value === '') continue

    const customId = bookingContactFieldCustomId(key)
    if (customId) {
      const def = defs.get(customId)
      // Refused at the WRITE, not merely hidden from the form: a definition the
      // studio never opted in to is not askable, however the payload arrived.
      if (!def || def.publicOnBookingForm !== true) continue
      if (!isValidCustomValue(def, value)) continue
      patch[`custom_fields.${customId}`] = value
      continue
    }

    if (!WRITABLE_BASE.has(key)) continue

    // ── The two base fields that are NOT strings on the contact ──────────────
    // Both were a silent-wrong-write before they were special-cased: a date
    // input posts 'YYYY-MM-DD' into a Timestamp field, and an address is a
    // four-part map with no single-line member at all. Writing the raw string
    // in either case stores something the readers never look at — no error, no
    // failing test, just a value nobody sees again.
    if (key === 'birthdate') {
      const ts = parseBirthdate(value)
      if (ts) patch.birthdate = ts
      continue
    }
    if (key === 'address') {
      const addr = narrowAddress(value)
      if (addr) patch.address = { ...((input.existing?.address as object) ?? {}), ...addr }
      continue
    }

    patch[key] = value
  }

  return patch
}

/** A select must be one of its own options; everything else is taken as typed.
 *  Narrow rather than coerce — a value outside the vocabulary is dropped, not
 *  guessed at. */
function isValidCustomValue(def: CustomFieldDefinition, value: unknown): boolean {
  switch (def.type) {
    case 'select':
      return typeof value === 'string' && (def.options ?? []).includes(value)
    case 'number':
      return typeof value === 'number' || (typeof value === 'string' && value.trim() !== '' && !Number.isNaN(Number(value)))
    case 'checkbox':
      return typeof value === 'boolean'
    default:
      return typeof value === 'string'
  }
}

/**
 * The same patch, shaped for `.set()` instead of `.update()`.
 *
 * THE TWO ARE NOT INTERCHANGEABLE, and the difference is silent. `update()`
 * reads `custom_fields.swim_level` as a PATH and writes a nested field;
 * `set()` reads it as a LITERAL field name and creates a top-level key with a
 * dot in it — which no reader ever looks for, and which the console renders as
 * if it were nested. The value is stored, looks plausible, and is unreachable.
 *
 * So the new-contact branch (a `set()`) goes through here, and the existing-
 * contact branch (an `update()`) uses the dotted form directly.
 */
export function expandContactFieldPatch(
  patch: Record<string, unknown>
): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(patch)) {
    const dot = key.indexOf('.')
    if (dot < 0) {
      out[key] = value
      continue
    }
    const parent = key.slice(0, dot)
    const child = key.slice(dot + 1)
    const existing = (out[parent] ?? {}) as Record<string, unknown>
    out[parent] = { ...existing, [child]: value }
  }
  return out
}

/**
 * The patch, for a caller that has NOT already loaded the team's book settings.
 *
 * `bookSession` builds its patch inline because it reads those settings anyway
 * (for the cutoff) and re-reading them would be a second read of the same
 * document. Every other rail — the appointment rails — has no such read, so it
 * comes through here.
 *
 * THE READ IS PAID ONLY WHEN THERE IS SOMETHING TO WRITE: a caller that sent no
 * answers gets `{}` before any document is touched, which is every caller that
 * existed before this feature.
 */
export async function resolveContactFieldPatchForBooking(params: {
  teamId: string
  /** The already-loaded team doc — its `custom_field_definitions` validate
   *  `custom:` keys. Null is treated as "no definitions", so custom answers are
   *  refused rather than trusted. */
  team: { custom_field_definitions?: unknown } | null
  activityContactFields?: BookingContactField[] | null
  answers?: Record<string, unknown> | null
  existing?: Record<string, unknown> | null
}): Promise<Record<string, unknown>> {
  const answers = params.answers
  if (!answers || Object.keys(answers).length === 0) return {}

  const bookingSettings = await loadBookingSettings(params.teamId)
  return buildContactFieldPatch({
    fields: resolveBookingContactFields(bookingSettings, params.activityContactFields ?? null),
    answers,
    definitions: (params.team?.custom_field_definitions ?? null) as CustomFieldDefinition[] | null,
    existing: params.existing ?? null,
  })
}

/** `'YYYY-MM-DD'` → a Timestamp, because `Contact.birthdate` IS one. Anything
 *  else — a malformed string, an impossible day, a year outside living memory —
 *  is dropped rather than coerced. */
function parseBirthdate(value: unknown): Timestamp | null {
  if (value instanceof Timestamp) return value
  if (typeof value !== 'string') return null
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim())
  if (!m) return null
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])]
  if (y < 1900 || y > 2200 || mo < 1 || mo > 12 || d < 1 || d > 31) return null
  // Midday UTC, so a timezone shift on the way to a display can never move the
  // date across a day boundary — the same reason birthdays are stored this way
  // everywhere else in the codebase.
  const date = new Date(Date.UTC(y, mo - 1, d, 12))
  if (date.getUTCMonth() !== mo - 1 || date.getUTCDate() !== d) return null // 31 Feb
  return Timestamp.fromDate(date)
}

/** The four parts of `ContactAddress`, and nothing else. Returns null when the
 *  answer contributes nothing, so an empty address never overwrites a stored
 *  one — the same rule the empty-answer check applies to every other field. */
function narrowAddress(value: unknown): Record<string, string> | null {
  if (typeof value !== 'object' || value === null) return null
  const src = value as Record<string, unknown>
  const out: Record<string, string> = {}
  for (const part of ['route', 'street_number', 'postal_code', 'locality'] as const) {
    const v = src[part]
    if (typeof v === 'string' && v.trim()) out[part] = v.trim()
  }
  return Object.keys(out).length > 0 ? out : null
}
