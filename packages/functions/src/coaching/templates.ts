import { buildEmailTemplate } from '../utils/email'

type Lang = 'en' | 'de' | 'fr' | 'it'

const LOCALE_MAP: Record<Lang, string> = { en: 'en-GB', de: 'de-CH', fr: 'fr-CH', it: 'it-CH' }

function formatDateTime(d: Date, lang: Lang): string {
  return d.toLocaleString(LOCALE_MAP[lang], {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
    hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Zurich',
  })
}

function formatTime(d: Date, lang: Lang): string {
  return d.toLocaleTimeString(LOCALE_MAP[lang], {
    hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Europe/Zurich',
  })
}

// ─── iCal helper ─────────────────────────────────────────────────────────────

function buildICalEvent(params: {
  uid: string
  title: string
  start: Date
  end: Date
  location?: string | null
  organizer: { name: string; email: string }
  attendee: { name: string; email: string }
}): string {
  const fmt = (d: Date) => d.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z'
  const esc = (s: string) => s.replace(/[\\;,]/g, (c) => `\\${c}`).replace(/\n/g, '\\n')
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Lineup//EN',
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
  ].filter(Boolean).join('\r\n')
  return lines
}

// ─── client confirmation ──────────────────────────────────────────────────────

interface ConfirmParams {
  firstname: string
  teamName: string
  slotTitle: string
  coachName: string
  start: Date
  end: Date
  location?: string | null
  onlineUrl?: string | null
  cancelUrl?: string | null
  lang?: Lang
}

export function buildCoachingConfirmationEmail(params: ConfirmParams) {
  const { firstname, teamName, slotTitle, coachName, start, end, location, onlineUrl, cancelUrl, lang = 'en' } = params
  const dateStr = formatDateTime(start, lang)
  const endTime = formatTime(end, lang)

  const titles: Record<Lang, string> = {
    en: 'Appointment Confirmed',
    de: 'Termin bestätigt',
    fr: 'Rendez-vous confirmé',
    it: 'Appuntamento confermato',
  }
  const greetings: Record<Lang, string> = {
    en: `Hi ${firstname},`, de: `Hallo ${firstname},`, fr: `Bonjour ${firstname},`, it: `Ciao ${firstname},`,
  }
  const lines: Record<Lang, string[]> = {
    en: [
      `Your appointment with <strong>${teamName}</strong> has been confirmed.`,
      `<strong>Session:</strong> ${slotTitle}`,
      `<strong>Coach:</strong> ${coachName}`,
      `<strong>Date:</strong> ${dateStr} – ${endTime}`,
      location ? `<strong>Location:</strong> ${location}` : '',
      onlineUrl ? `<strong>Online:</strong> <a href="${onlineUrl}">${onlineUrl}</a>` : '',
      'A calendar invite (.ics) is attached to this email.',
    ],
    de: [
      `Ihr Termin bei <strong>${teamName}</strong> wurde bestätigt.`,
      `<strong>Sitzung:</strong> ${slotTitle}`,
      `<strong>Coach:</strong> ${coachName}`,
      `<strong>Datum:</strong> ${dateStr} – ${endTime}`,
      location ? `<strong>Ort:</strong> ${location}` : '',
      onlineUrl ? `<strong>Online:</strong> <a href="${onlineUrl}">${onlineUrl}</a>` : '',
      'Ein Kalender-Einladung (.ics) ist dieser E-Mail beigefügt.',
    ],
    fr: [
      `Votre rendez-vous avec <strong>${teamName}</strong> a été confirmé.`,
      `<strong>Séance :</strong> ${slotTitle}`,
      `<strong>Coach :</strong> ${coachName}`,
      `<strong>Date :</strong> ${dateStr} – ${endTime}`,
      location ? `<strong>Lieu :</strong> ${location}` : '',
      onlineUrl ? `<strong>En ligne :</strong> <a href="${onlineUrl}">${onlineUrl}</a>` : '',
      'Une invitation de calendrier (.ics) est jointe à cet e-mail.',
    ],
    it: [
      `Il tuo appuntamento con <strong>${teamName}</strong> è stato confermato.`,
      `<strong>Sessione:</strong> ${slotTitle}`,
      `<strong>Coach:</strong> ${coachName}`,
      `<strong>Data:</strong> ${dateStr} – ${endTime}`,
      location ? `<strong>Luogo:</strong> ${location}` : '',
      onlineUrl ? `<strong>Online:</strong> <a href="${onlineUrl}">${onlineUrl}</a>` : '',
      'Un invito al calendario (.ics) è allegato a questa email.',
    ],
  }
  const cancelLabels: Record<Lang, string> = {
    en: 'Cancel appointment', de: 'Termin absagen', fr: 'Annuler le rendez-vous', it: 'Annulla appuntamento',
  }
  const body = [
    `<p>${greetings[lang]}</p>`,
    ...lines[lang].filter(Boolean).map((l) => `<p>${l}</p>`),
    ...(cancelUrl ? [`<p><a href="${cancelUrl}">${cancelLabels[lang]}</a></p>`] : []),
  ].join('\n')

  return buildEmailTemplate({ title: titles[lang], body })
}

export function buildCoachingICalAttachment(params: {
  bookingId: string
  slotTitle: string
  start: Date
  end: Date
  location?: string | null
  coachName: string
  coachEmail: string
  clientName: string
  clientEmail: string
}): { filename: string; content: string; contentType: string } {
  const ical = buildICalEvent({
    uid: `coaching-${params.bookingId}@lineup.app`,
    title: params.slotTitle,
    start: params.start,
    end: params.end,
    location: params.location,
    organizer: { name: params.coachName, email: params.coachEmail },
    attendee: { name: params.clientName, email: params.clientEmail },
  })
  return { filename: 'appointment.ics', content: ical, contentType: 'text/calendar; charset=utf-8; method=REQUEST' }
}

// ─── coach notification ───────────────────────────────────────────────────────

interface CoachNotifParams {
  coachFirstname: string
  clientName: string
  clientEmail: string
  clientPhone?: string | null
  slotTitle: string
  start: Date
  end: Date
  notes?: string | null
  lang?: Lang
}

export function buildCoachNotificationEmail(params: CoachNotifParams) {
  const { coachFirstname, clientName, clientEmail, clientPhone, slotTitle, start, end, notes, lang = 'en' } = params
  const dateStr = formatDateTime(start, lang)
  const endTime = formatTime(end, lang)

  const titles: Record<Lang, string> = {
    en: `New appointment: ${clientName}`,
    de: `Neuer Termin: ${clientName}`,
    fr: `Nouveau rendez-vous : ${clientName}`,
    it: `Nuovo appuntamento: ${clientName}`,
  }
  const lines: Record<Lang, string[]> = {
    en: [
      `Hi ${coachFirstname}, a new appointment has been booked.`,
      `<strong>Session:</strong> ${slotTitle}`,
      `<strong>Client:</strong> ${clientName} (${clientEmail})${clientPhone ? ` · ${clientPhone}` : ''}`,
      `<strong>Date:</strong> ${dateStr} – ${endTime}`,
      notes ? `<strong>Notes:</strong> ${notes}` : '',
    ],
    de: [
      `Hallo ${coachFirstname}, ein neuer Termin wurde gebucht.`,
      `<strong>Sitzung:</strong> ${slotTitle}`,
      `<strong>Klient:</strong> ${clientName} (${clientEmail})${clientPhone ? ` · ${clientPhone}` : ''}`,
      `<strong>Datum:</strong> ${dateStr} – ${endTime}`,
      notes ? `<strong>Notizen:</strong> ${notes}` : '',
    ],
    fr: [
      `Bonjour ${coachFirstname}, un nouveau rendez-vous a été réservé.`,
      `<strong>Séance :</strong> ${slotTitle}`,
      `<strong>Client :</strong> ${clientName} (${clientEmail})${clientPhone ? ` · ${clientPhone}` : ''}`,
      `<strong>Date :</strong> ${dateStr} – ${endTime}`,
      notes ? `<strong>Notes :</strong> ${notes}` : '',
    ],
    it: [
      `Ciao ${coachFirstname}, è stato prenotato un nuovo appuntamento.`,
      `<strong>Sessione:</strong> ${slotTitle}`,
      `<strong>Cliente:</strong> ${clientName} (${clientEmail})${clientPhone ? ` · ${clientPhone}` : ''}`,
      `<strong>Data:</strong> ${dateStr} – ${endTime}`,
      notes ? `<strong>Note:</strong> ${notes}` : '',
    ],
  }
  const body = lines[lang].filter(Boolean).map((l) => `<p>${l}</p>`).join('\n')
  return buildEmailTemplate({ title: titles[lang], body })
}

// ─── cancellation confirmation ────────────────────────────────────────────────

interface CancelParams {
  firstname: string
  teamName: string
  slotTitle: string
  start: Date
  lang?: Lang
}

export function buildCoachingCancellationEmail(params: CancelParams) {
  const { firstname, teamName, slotTitle, start, lang = 'en' } = params
  const dateStr = formatDateTime(start, lang)

  const titles: Record<Lang, string> = {
    en: 'Appointment Cancelled', de: 'Termin abgesagt', fr: 'Rendez-vous annulé', it: 'Appuntamento annullato',
  }
  const bodies: Record<Lang, string> = {
    en: `<p>Hi ${firstname},</p><p>Your <strong>${slotTitle}</strong> appointment with ${teamName} on ${dateStr} has been cancelled.</p>`,
    de: `<p>Hallo ${firstname},</p><p>Ihr <strong>${slotTitle}</strong>-Termin bei ${teamName} am ${dateStr} wurde abgesagt.</p>`,
    fr: `<p>Bonjour ${firstname},</p><p>Votre rendez-vous <strong>${slotTitle}</strong> avec ${teamName} le ${dateStr} a été annulé.</p>`,
    it: `<p>Ciao ${firstname},</p><p>Il tuo appuntamento <strong>${slotTitle}</strong> con ${teamName} del ${dateStr} è stato annullato.</p>`,
  }
  return buildEmailTemplate({ title: titles[lang], body: bodies[lang] })
}
