// The one mail `requestWaiverAcceptance` sends: "your studio needs your
// signature, here is where to give it".
//
// Its own module, on the idiom `booking/templates.ts` established: every
// interpolated value is escaped ONCE at the top under the name the template
// reaches for, so a line added later cannot pick up a raw value by using the
// obvious identifier. A document title is studio-authored and a name may come
// from a public form; neither is trusted here.
//
// THE OPENING LINE VARIES BY STATE, and that is the whole reason this is not one
// paragraph. "We do not have your signature" sent to somebody who signed last
// year and whose signature a `require_resign` publish superseded reads as a
// mistake by the studio — and the member's most likely response to a mistake is
// to ignore it. The four sentences are the four things that can actually have
// happened.

import { buildEmailTemplate } from '../utils/email'
import { ctaButton, detailsBox, factLines } from '../utils/emailLayout'
import { escapeHtml } from '../utils/html'
import type { WaiverAcceptanceState } from '@linyup/shared'

export type Lang = 'en' | 'de' | 'fr' | 'it'

export const isLang = (v: unknown): v is Lang =>
  v === 'en' || v === 'de' || v === 'fr' || v === 'it'

export interface WaiverRequestEmailParams {
  firstname: string
  teamName: string
  documentTitle: string
  /** Why we are asking — never `valid`, which is not asked at all. */
  state: Exclude<WaiverAcceptanceState, 'valid'>
  /** The member's own Space, where the document is presented and signed. There is
   *  deliberately no second signing surface. */
  spaceUrl: string
  lang?: Lang
}

const TITLES: Record<Lang, string> = {
  en: 'Your signature is needed',
  de: 'Ihre Unterschrift wird benötigt',
  fr: 'Votre signature est requise',
  it: 'Serve la tua firma',
}

const GREETINGS: Record<Lang, (name: string) => string> = {
  en: (n) => (n ? `Hi ${n},` : 'Hi,'),
  de: (n) => (n ? `Hallo ${n},` : 'Hallo,'),
  fr: (n) => (n ? `Bonjour ${n},` : 'Bonjour,'),
  it: (n) => (n ? `Ciao ${n},` : 'Ciao,'),
}

const DOCUMENT_LABELS: Record<Lang, string> = {
  en: 'Document',
  de: 'Dokument',
  fr: 'Document',
  it: 'Documento',
}

const CTA_LABELS: Record<Lang, string> = {
  en: 'Read and sign',
  de: 'Lesen und unterschreiben',
  fr: 'Lire et signer',
  it: 'Leggi e firma',
}

const CLOSINGS: Record<Lang, string> = {
  en: 'It takes a minute, and you only need to do it once. Sign in with this email address to see it.',
  de: 'Es dauert eine Minute und ist nur einmal nötig. Melden Sie sich mit dieser E-Mail-Adresse an, um es zu sehen.',
  fr: 'Cela prend une minute et une seule fois suffit. Connectez-vous avec cette adresse e-mail pour le consulter.',
  it: 'Ci vuole un minuto e basta farlo una volta. Accedi con questo indirizzo e-mail per vederlo.',
}

const CONSEQUENCES: Record<Lang, string> = {
  en: 'Until it is signed, we cannot take your bookings.',
  de: 'Solange es nicht unterschrieben ist, können wir Ihre Buchungen nicht annehmen.',
  fr: "Tant qu'il n'est pas signé, nous ne pouvons pas accepter vos réservations.",
  it: 'Finché non è firmato, non possiamo accettare le tue prenotazioni.',
}

/** Why we are writing. One sentence per thing that can actually have happened. */
function intro(state: WaiverRequestEmailParams['state'], lang: Lang, title: string, team: string): string {
  const byState: Record<WaiverRequestEmailParams['state'], Record<Lang, string>> = {
    none: {
      en: `<strong>${team}</strong> asks everyone to accept <strong>${title}</strong>, and we do not have your signature yet.`,
      de: `<strong>${team}</strong> bittet alle, <strong>${title}</strong> zu akzeptieren — Ihre Unterschrift fehlt uns noch.`,
      fr: `<strong>${team}</strong> demande à chacun d'accepter <strong>${title}</strong>, et nous n'avons pas encore votre signature.`,
      it: `<strong>${team}</strong> chiede a tutti di accettare <strong>${title}</strong> e non abbiamo ancora la tua firma.`,
    },
    superseded: {
      en: `<strong>${title}</strong> has been updated since you signed it, so <strong>${team}</strong> needs your signature on the new version.`,
      de: `<strong>${title}</strong> wurde seit Ihrer Unterschrift aktualisiert — <strong>${team}</strong> benötigt Ihre Unterschrift zur neuen Fassung.`,
      fr: `<strong>${title}</strong> a été mis à jour depuis votre signature : <strong>${team}</strong> a besoin de votre signature sur la nouvelle version.`,
      it: `<strong>${title}</strong> è stato aggiornato dopo la tua firma, quindi <strong>${team}</strong> ha bisogno della tua firma sulla nuova versione.`,
    },
    expired: {
      en: `Your signature on <strong>${title}</strong> has expired, so <strong>${team}</strong> needs a fresh one.`,
      de: `Ihre Unterschrift zu <strong>${title}</strong> ist abgelaufen — <strong>${team}</strong> benötigt eine neue.`,
      fr: `Votre signature sur <strong>${title}</strong> a expiré : <strong>${team}</strong> en a besoin d'une nouvelle.`,
      it: `La tua firma su <strong>${title}</strong> è scaduta, quindi <strong>${team}</strong> ne ha bisogno di una nuova.`,
    },
    revoked: {
      en: `Your signature on <strong>${title}</strong> was withdrawn, so <strong>${team}</strong> needs it again.`,
      de: `Ihre Unterschrift zu <strong>${title}</strong> wurde zurückgezogen — <strong>${team}</strong> benötigt sie erneut.`,
      fr: `Votre signature sur <strong>${title}</strong> a été retirée : <strong>${team}</strong> en a de nouveau besoin.`,
      it: `La tua firma su <strong>${title}</strong> è stata ritirata, quindi <strong>${team}</strong> ne ha di nuovo bisogno.`,
    },
  }
  return byState[state][lang]
}

/** The mail SUBJECT, which Brevo takes as its own API field — so it is built from
 *  the raw title, never the HTML-escaped one. */
export function waiverRequestSubject(documentTitle: string, lang: Lang): string {
  const subjects: Record<Lang, string> = {
    en: `Please sign: ${documentTitle}`,
    de: `Bitte unterschreiben: ${documentTitle}`,
    fr: `À signer : ${documentTitle}`,
    it: `Da firmare: ${documentTitle}`,
  }
  return subjects[lang]
}

export function buildWaiverRequestEmail(params: WaiverRequestEmailParams) {
  const { spaceUrl, state, lang = 'en' } = params
  const firstname = escapeHtml(params.firstname)
  const teamName = escapeHtml(params.teamName)
  const documentTitle = escapeHtml(params.documentTitle)

  const body = [
    `<p>${GREETINGS[lang](firstname)}</p>`,
    `<p>${intro(state, lang, documentTitle, teamName)}</p>`,
    detailsBox({
      content: factLines([`<strong>${DOCUMENT_LABELS[lang]}:</strong> ${documentTitle}`]),
    }),
    `<p>${CONSEQUENCES[lang]}</p>`,
    `<p style="text-align:center;margin-top:24px;">${ctaButton(spaceUrl, CTA_LABELS[lang])}</p>`,
    `<p>${CLOSINGS[lang]}</p>`,
  ].join('\n')

  return buildEmailTemplate({ title: TITLES[lang], body })
}
