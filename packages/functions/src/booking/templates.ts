import { buildEmailTemplate } from '../utils/email'
import { detailsBox, ctaButton, factLines, BRAND } from '../utils/emailLayout'
import { escapeHtml } from '../utils/html'

// Localised heading for the studio's custom instructions box (confirmation emails).
const INSTRUCTIONS_TITLES: Record<'en' | 'de' | 'fr' | 'it', string> = {
  en: 'Important',
  de: 'Wichtig',
  fr: 'Important',
  it: 'Importante',
}

/** Studio-authored plain-text instructions → highlighted box. Text is escaped,
 *  newlines become <br>, and bare URLs become clickable links. */
export function instructionsBox(instructions: string, lang: 'en' | 'de' | 'fr' | 'it'): string {
  const html = escapeHtml(instructions.trim())
    .replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" style="color:inherit;">$1</a>')
    .replace(/\n/g, '<br>')
  return detailsBox({ title: INSTRUCTIONS_TITLES[lang], content: `<p style="margin:0;">${html}</p>` })
}

type Lang = 'en' | 'de' | 'fr' | 'it'

function formatDate(d: Date, lang: Lang): string {
  const localeMap: Record<Lang, string> = { en: 'en-GB', de: 'de-CH', fr: 'fr-CH', it: 'it-CH' }
  return d.toLocaleString(localeMap[lang], {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Europe/Zurich',
  })
}

function formatTime(d: Date, lang: Lang): string {
  const localeMap: Record<Lang, string> = { en: 'en-GB', de: 'de-CH', fr: 'fr-CH', it: 'it-CH' }
  return d.toLocaleTimeString(localeMap[lang], {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'Europe/Zurich',
  })
}

interface ConfirmationParams {
  firstname: string
  teamName: string
  activityName: string
  sessionStart: Date
  sessionEnd: Date
  locationName?: string | null
  manageBookingUrl?: string | null
  /** Studio-authored plain-text note (activity override ?? team setting). */
  instructions?: string | null
  lang?: Lang
}

export function buildBookingConfirmationEmail(params: ConfirmationParams) {
  const {
    firstname,
    teamName,
    activityName,
    sessionStart,
    sessionEnd,
    locationName,
    manageBookingUrl,
    instructions,
    lang = 'en',
  } = params

  const date = formatDate(sessionStart, lang)
  const endTime = formatTime(sessionEnd, lang)

  const titles: Record<Lang, string> = {
    en: 'Booking Confirmed',
    de: 'Buchung bestätigt',
    fr: 'Réservation confirmée',
    it: 'Prenotazione confermata',
  }

  const greetings: Record<Lang, string> = {
    en: `Hi ${firstname},`,
    de: `Hallo ${firstname},`,
    fr: `Bonjour ${firstname},`,
    it: `Ciao ${firstname},`,
  }

  const intros: Record<Lang, string> = {
    en: `Your session at <strong>${teamName}</strong> has been confirmed.`,
    de: `Ihre Sitzung bei <strong>${teamName}</strong> wurde bestätigt.`,
    fr: `Votre session chez <strong>${teamName}</strong> a été confirmée.`,
    it: `La tua sessione presso <strong>${teamName}</strong> è stata confermata.`,
  }

  const facts: Record<Lang, string[]> = {
    en: [
      `<strong>Activity:</strong> ${activityName}`,
      `<strong>Date:</strong> ${date} – ${endTime}`,
      locationName ? `<strong>Location:</strong> ${locationName}` : '',
    ],
    de: [
      `<strong>Aktivität:</strong> ${activityName}`,
      `<strong>Datum:</strong> ${date} – ${endTime}`,
      locationName ? `<strong>Ort:</strong> ${locationName}` : '',
    ],
    fr: [
      `<strong>Activité :</strong> ${activityName}`,
      `<strong>Date :</strong> ${date} – ${endTime}`,
      locationName ? `<strong>Lieu :</strong> ${locationName}` : '',
    ],
    it: [
      `<strong>Attività:</strong> ${activityName}`,
      `<strong>Data:</strong> ${date} – ${endTime}`,
      locationName ? `<strong>Luogo:</strong> ${locationName}` : '',
    ],
  }

  const closings: Record<Lang, string> = {
    en: 'We look forward to seeing you!',
    de: 'Wir freuen uns auf Sie!',
    fr: 'Nous avons hâte de vous voir !',
    it: "Non vediamo l'ora di vederti!",
  }

  const manageLabels: Record<Lang, string> = {
    en: 'Manage / Cancel Booking',
    de: 'Buchung verwalten / stornieren',
    fr: 'Gérer / Annuler la réservation',
    it: 'Gestisci / Annulla prenotazione',
  }

  const body = [
    `<p>${greetings[lang]}</p>`,
    `<p>${intros[lang]}</p>`,
    detailsBox({ content: factLines(facts[lang]) }),
    instructions?.trim() ? instructionsBox(instructions, lang) : '',
    `<p>${closings[lang]}</p>`,
    manageBookingUrl
      ? `<p style="text-align:center;margin-top:24px;">${ctaButton(manageBookingUrl, manageLabels[lang])}</p>`
      : '',
  ]
    .filter(Boolean)
    .join('\n')

  return buildEmailTemplate({ title: titles[lang], body })
}

interface ReminderParams {
  firstname: string
  teamName: string
  activityName: string
  sessionStart: Date
  sessionEnd: Date
  locationName?: string | null
  locationAddress?: string | null
  manageBookingUrl?: string | null
  lang?: Lang
}

export function buildBookingReminderEmail(params: ReminderParams) {
  const {
    firstname,
    teamName,
    activityName,
    sessionStart,
    sessionEnd,
    locationName,
    locationAddress,
    manageBookingUrl,
    lang = 'en',
  } = params

  const date = formatDate(sessionStart, lang)
  const endTime = formatTime(sessionEnd, lang)

  const titles: Record<Lang, string> = {
    en: 'Session Reminder',
    de: 'Terminerinnerung',
    fr: 'Rappel de session',
    it: 'Promemoria sessione',
  }

  const greetings: Record<Lang, string> = {
    en: `Hi ${firstname},`,
    de: `Hallo ${firstname},`,
    fr: `Bonjour ${firstname},`,
    it: `Ciao ${firstname},`,
  }

  const intros: Record<Lang, string> = {
    en: `This is a reminder for your upcoming session at <strong>${teamName}</strong>.`,
    de: `Dies ist eine Erinnerung für Ihre bevorstehende Sitzung bei <strong>${teamName}</strong>.`,
    fr: `Voici un rappel pour votre prochaine session chez <strong>${teamName}</strong>.`,
    it: `Questo è un promemoria per la tua prossima sessione presso <strong>${teamName}</strong>.`,
  }

  const locationLabels: Record<Lang, string> = {
    en: 'Location',
    de: 'Ort',
    fr: 'Lieu',
    it: 'Luogo',
  }

  const manageLabels: Record<Lang, string> = {
    en: 'Manage / Cancel Booking',
    de: 'Buchung verwalten / stornieren',
    fr: 'Gérer / Annuler la réservation',
    it: 'Gestisci / Annulla prenotazione',
  }

  const activityLabels: Record<Lang, string> = {
    en: 'Activity',
    de: 'Aktivität',
    fr: 'Activité',
    it: 'Attività',
  }

  const dateLabels: Record<Lang, string> = {
    en: 'Date',
    de: 'Datum',
    fr: 'Date',
    it: 'Data',
  }

  const locationLine = locationName
    ? `<strong>${locationLabels[lang]}:</strong> ${locationName}${locationAddress ? `, ${locationAddress}` : ''}`
    : ''

  const body = [
    `<p>${greetings[lang]}</p>`,
    `<p>${intros[lang]}</p>`,
    detailsBox({
      content: factLines([
        `<strong>${activityLabels[lang]}:</strong> ${activityName}`,
        `<strong>${dateLabels[lang]}:</strong> ${date} – ${endTime}`,
        locationLine,
      ]),
    }),
    manageBookingUrl
      ? `<p style="text-align:center;margin-top:24px;">${ctaButton(manageBookingUrl, manageLabels[lang])}</p>`
      : null,
  ]
    .filter(Boolean)
    .join('\n')

  return buildEmailTemplate({ title: titles[lang], body })
}

// Single-segment SMS reminder (~160 chars incl. the alphanumeric sender). Kept
// deliberately terse: team, activity, day+time, location. The manage-booking
// link is left to the email steps — URLs blow the segment budget.
export function buildBookingReminderSms(params: {
  teamName: string
  activityName: string
  sessionStart: Date
  locationName?: string | null
  lang?: Lang
}): string {
  const { teamName, activityName, sessionStart, locationName, lang = 'en' } = params
  const localeMap: Record<Lang, string> = { en: 'en-GB', de: 'de-CH', fr: 'fr-CH', it: 'it-CH' }
  const when = sessionStart.toLocaleString(localeMap[lang], {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Europe/Zurich',
  })
  const reminders: Record<Lang, string> = {
    en: 'Reminder',
    de: 'Erinnerung',
    fr: 'Rappel',
    it: 'Promemoria',
  }
  const location = locationName ? ` @ ${locationName}` : ''
  return `${teamName}: ${reminders[lang]} — ${activityName}, ${when}${location}`
}

interface NotificationParams {
  teamOwnerFirstname: string
  contactName: string
  contactEmail: string
  contactPhone?: string | null
  activityName: string
  sessionStart: Date
  sessionEnd: Date
  lang?: Lang
}

export function buildTeacherNotificationEmail(params: NotificationParams) {
  const {
    teamOwnerFirstname,
    contactName,
    contactEmail,
    contactPhone,
    activityName,
    sessionStart,
    sessionEnd,
    lang = 'en',
  } = params

  const date = formatDate(sessionStart, lang)
  const endTime = formatTime(sessionEnd, lang)

  const titles: Record<Lang, string> = {
    en: `New Booking: ${contactName}`,
    de: `Neue Buchung: ${contactName}`,
    fr: `Nouvelle réservation : ${contactName}`,
    it: `Nuova prenotazione: ${contactName}`,
  }

  const lines: Record<Lang, string[]> = {
    en: [
      `Hi ${teamOwnerFirstname}, a new booking has been made.`,
      `<strong>Contact:</strong> ${contactName} (${contactEmail})${contactPhone ? ` – ${contactPhone}` : ''}`,
      `<strong>Activity:</strong> ${activityName}`,
      `<strong>Date:</strong> ${date} – ${endTime}`,
    ],
    de: [
      `Hallo ${teamOwnerFirstname}, eine neue Buchung ist eingegangen.`,
      `<strong>Kontakt:</strong> ${contactName} (${contactEmail})${contactPhone ? ` – ${contactPhone}` : ''}`,
      `<strong>Aktivität:</strong> ${activityName}`,
      `<strong>Datum:</strong> ${date} – ${endTime}`,
    ],
    fr: [
      `Bonjour ${teamOwnerFirstname}, une nouvelle réservation vient d'être effectuée.`,
      `<strong>Contact :</strong> ${contactName} (${contactEmail})${contactPhone ? ` – ${contactPhone}` : ''}`,
      `<strong>Activité :</strong> ${activityName}`,
      `<strong>Date :</strong> ${date} – ${endTime}`,
    ],
    it: [
      `Ciao ${teamOwnerFirstname}, è stata effettuata una nuova prenotazione.`,
      `<strong>Contatto:</strong> ${contactName} (${contactEmail})${contactPhone ? ` – ${contactPhone}` : ''}`,
      `<strong>Attività:</strong> ${activityName}`,
      `<strong>Data:</strong> ${date} – ${endTime}`,
    ],
  }

  const [greeting, ...factList] = lines[lang]
  const body = [`<p>${greeting}</p>`, detailsBox({ content: factLines(factList) })].join('\n')
  return buildEmailTemplate({ title: titles[lang], body })
}

interface VerificationCodeParams {
  code: string
  teamName: string
  expiresInMinutes: number
  lang?: Lang
}

export function buildVerificationCodeEmail(params: VerificationCodeParams) {
  const { code, teamName, expiresInMinutes, lang = 'en' } = params

  const titles: Record<Lang, string> = {
    en: `Your verification code for ${teamName}`,
    de: `Ihr Verifizierungscode für ${teamName}`,
    fr: `Votre code de vérification pour ${teamName}`,
    it: `Il tuo codice di verifica per ${teamName}`,
  }

  const codeStyle = `font-size:2rem;font-weight:bold;letter-spacing:0.25em;color:${BRAND.primaryDeep};text-align:center;`
  const bodies: Record<Lang, string> = {
    en: `<p>Your verification code is:</p><p style="${codeStyle}">${code}</p><p>This code expires in ${expiresInMinutes} minutes. Do not share it.</p>`,
    de: `<p>Ihr Verifizierungscode lautet:</p><p style="${codeStyle}">${code}</p><p>Dieser Code läuft in ${expiresInMinutes} Minuten ab. Geben Sie ihn nicht weiter.</p>`,
    fr: `<p>Votre code de vérification est :</p><p style="${codeStyle}">${code}</p><p>Ce code expire dans ${expiresInMinutes} minutes. Ne le partagez pas.</p>`,
    it: `<p>Il tuo codice di verifica è:</p><p style="${codeStyle}">${code}</p><p>Questo codice scade in ${expiresInMinutes} minuti. Non condividerlo.</p>`,
  }

  return buildEmailTemplate({ title: titles[lang], body: bodies[lang] })
}
