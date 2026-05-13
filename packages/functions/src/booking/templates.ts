import { buildEmailTemplate } from '../utils/email'

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

  const lines: Record<Lang, string[]> = {
    en: [
      `Your session at <strong>${teamName}</strong> has been confirmed.`,
      `<strong>Activity:</strong> ${activityName}`,
      `<strong>Date:</strong> ${date} – ${endTime}`,
      locationName ? `<strong>Location:</strong> ${locationName}` : '',
      'We look forward to seeing you!',
    ],
    de: [
      `Ihre Sitzung bei <strong>${teamName}</strong> wurde bestätigt.`,
      `<strong>Aktivität:</strong> ${activityName}`,
      `<strong>Datum:</strong> ${date} – ${endTime}`,
      locationName ? `<strong>Ort:</strong> ${locationName}` : '',
      'Wir freuen uns auf Sie!',
    ],
    fr: [
      `Votre session chez <strong>${teamName}</strong> a été confirmée.`,
      `<strong>Activité :</strong> ${activityName}`,
      `<strong>Date :</strong> ${date} – ${endTime}`,
      locationName ? `<strong>Lieu :</strong> ${locationName}` : '',
      'Nous avons hâte de vous voir !',
    ],
    it: [
      `La tua sessione presso <strong>${teamName}</strong> è stata confermata.`,
      `<strong>Attività:</strong> ${activityName}`,
      `<strong>Data:</strong> ${date} – ${endTime}`,
      locationName ? `<strong>Luogo:</strong> ${locationName}` : '',
      'Non vediamo l\'ora di vederti!',
    ],
  }

  const manageLabels: Record<Lang, string> = {
    en: 'Manage / Cancel Booking',
    de: 'Buchung verwalten / stornieren',
    fr: 'Gérer / Annuler la réservation',
    it: 'Gestisci / Annulla prenotazione',
  }

  const body = [
    `<p>${greetings[lang]}</p>`,
    ...lines[lang].filter(Boolean).map((l) => `<p>${l}</p>`),
    manageBookingUrl ? `<p><a href="${manageBookingUrl}">${manageLabels[lang]}</a></p>` : '',
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
    : null

  const body = [
    `<p>${greetings[lang]}</p>`,
    `<p>${intros[lang]}</p>`,
    `<p><strong>${activityLabels[lang]}:</strong> ${activityName}</p>`,
    `<p><strong>${dateLabels[lang]}:</strong> ${date} – ${endTime}</p>`,
    locationLine ? `<p>${locationLine}</p>` : null,
    manageBookingUrl ? `<p><a href="${manageBookingUrl}">${manageLabels[lang]}</a></p>` : null,
  ]
    .filter(Boolean)
    .join('\n')

  return buildEmailTemplate({ title: titles[lang], body })
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

  const body = lines[lang].map((l) => `<p>${l}</p>`).join('\n')
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

  const bodies: Record<Lang, string> = {
    en: `<p>Your verification code is:</p><p style="font-size:2rem;font-weight:bold;letter-spacing:0.25em">${code}</p><p>This code expires in ${expiresInMinutes} minutes. Do not share it.</p>`,
    de: `<p>Ihr Verifizierungscode lautet:</p><p style="font-size:2rem;font-weight:bold;letter-spacing:0.25em">${code}</p><p>Dieser Code läuft in ${expiresInMinutes} Minuten ab. Geben Sie ihn nicht weiter.</p>`,
    fr: `<p>Votre code de vérification est :</p><p style="font-size:2rem;font-weight:bold;letter-spacing:0.25em">${code}</p><p>Ce code expire dans ${expiresInMinutes} minutes. Ne le partagez pas.</p>`,
    it: `<p>Il tuo codice di verifica è:</p><p style="font-size:2rem;font-weight:bold;letter-spacing:0.25em">${code}</p><p>Questo codice scade in ${expiresInMinutes} minuti. Non condividerlo.</p>`,
  }

  return buildEmailTemplate({ title: titles[lang], body: bodies[lang] })
}
