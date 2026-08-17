// ONE iCalendar writer for the whole package.
//
// It used to live privately inside `appointments/templates.ts`, which is how
// class bookings ended up with no calendar invite at all on EITHER path (free or
// paid) while appointments had one: the code that would have been reused was not
// reachable. Anything that emails a person a time now builds its attachment
// here.
//
// Deliberately hand-rolled and tiny — RFC 5545 with UTC stamps, which every
// calendar client accepts and which costs no VTIMEZONE block. The timestamps are
// absolute instants (`Z`), so the DST-safe Europe/Zurich reasoning that governs
// recurrence never applies to this file.

export interface ICalEventInput {
  /** Globally unique and STABLE for the same booking — a client updates an
   *  existing entry rather than adding a second one when a mail is re-sent. */
  uid: string
  title: string
  start: Date
  end: Date
  location?: string | null
  organizer: { name: string; email: string }
  attendee: { name: string; email: string }
}

export function buildICalEvent(params: ICalEventInput): string {
  const fmt = (d: Date) => d.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z'
  const esc = (s: string) => s.replace(/[\\;,]/g, (c) => `\\${c}`).replace(/\n/g, '\\n')
  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Linyup//EN',
    'METHOD:REQUEST',
    'BEGIN:VEVENT',
    `UID:${params.uid}`,
    `DTSTAMP:${fmt(new Date())}`,
    `DTSTART:${fmt(params.start)}`,
    `DTEND:${fmt(params.end)}`,
    `SUMMARY:${esc(params.title)}`,
    params.location ? `LOCATION:${esc(params.location)}` : null,
    `ORGANIZER;CN="${esc(params.organizer.name)}":mailto:${params.organizer.email}`,
    `ATTENDEE;CN="${esc(params.attendee.name)}";RSVP=FALSE:mailto:${params.attendee.email}`,
    'END:VEVENT',
    'END:VCALENDAR',
  ]
    .filter(Boolean)
    .join('\r\n')
}

/** The Brevo attachment triple every caller wants — one spelling of the
 *  `text/calendar` content type, so a client that is fussy about `method` is
 *  fussy about it once. */
export function icalAttachment(
  filename: string,
  content: string
): { filename: string; content: string; contentType: string } {
  return { filename, content, contentType: 'text/calendar; charset=utf-8; method=REQUEST' }
}

/** The organizer address on a calendar invite when the studio has published
 *  none. A real mailbox is not required for the event to import; an ORGANIZER
 *  line is. */
export const ICAL_FALLBACK_ORGANIZER_EMAIL = 'noreply@linyup.com'
