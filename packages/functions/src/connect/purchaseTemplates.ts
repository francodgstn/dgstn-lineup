/**
 * The three SHOP purchase receipts — credit pack / membership, course, product.
 *
 * Bodies only; the posture, the reads and the `mail_sends` keying live next door
 * in `purchaseReceipts.ts`. UX-77 kept these out of UX-76 for one reason: they
 * cannot share the class-booking body. A course has no time and no location, a
 * product has neither and may need collection terms instead, and a credit pack's
 * whole job is a NUMBER — how many credits the buyer now holds and what they are
 * for. One template with four holes punched in it would say nothing well.
 *
 * ESCAPING: same idiom as `booking/templates.ts` — every interpolated value is
 * escaped once at the top of its builder, under the name the body reaches for,
 * so a line added later cannot pick up a raw value by using the obvious
 * identifier. Subjects go out RAW on purpose (Brevo takes the subject as its own
 * API field) and read `p.x` explicitly to signal it.
 */
import { buildEmailTemplate } from '../utils/email'
import { detailsBox, ctaButton, factLines } from '../utils/emailLayout'
import { escapeHtml } from '../utils/html'

export type Lang = 'en' | 'de' | 'fr' | 'it'

const LOCALES: Record<Lang, string> = { en: 'en-GB', de: 'de-CH', fr: 'fr-CH', it: 'it-CH' }

/** A money fact, in MAJOR units — "CHF 30.00". Two decimals because these lines
 *  are receipts, not price tags. */
export interface PaidAmount {
  amount: number
  currency: string
  /** Paid with stored value rather than a card — the facts line says so, because
   *  a buyer who spent a gift card should not read "Paid: CHF 30.00" and wonder
   *  which of the two got charged. */
  giftCard?: boolean
}

const GIFT_CARD_SUFFIX: Record<Lang, string> = {
  en: 'gift card',
  de: 'Geschenkkarte',
  fr: 'carte cadeau',
  it: 'carta regalo',
}

function money(paid: PaidAmount | null | undefined, lang: Lang): string | null {
  if (!paid) return null
  const value = `${escapeHtml(paid.currency.toUpperCase())} ${paid.amount.toFixed(2)}`
  return paid.giftCard ? `${value} (${GIFT_CARD_SUFFIX[lang]})` : value
}

function formatDay(d: Date, lang: Lang): string {
  return d.toLocaleDateString(LOCALES[lang], {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    timeZone: 'Europe/Zurich',
  })
}

const PAID_LABELS: Record<Lang, string> = {
  en: 'Paid',
  de: 'Bezahlt',
  fr: 'Payé',
  it: 'Pagato',
}

const GREETINGS: Record<Lang, (n: string) => string> = {
  en: (n) => (n ? `Hi ${n},` : 'Hi,'),
  de: (n) => (n ? `Hallo ${n},` : 'Hallo,'),
  fr: (n) => (n ? `Bonjour ${n},` : 'Bonjour,'),
  it: (n) => (n ? `Ciao ${n},` : 'Ciao,'),
}

/** The member-area line every one of these receipts carries. A shop buyer may
 *  never have heard of the Space, and this mail is the moment they have a reason
 *  to open it. */
const SPACE_LINES: Record<Lang, (url: string) => string> = {
  en: (u) =>
    `You can see this and everything else you hold in your <a href="${u}">member area</a> — sign in with this email address, no password needed.`,
  de: (u) =>
    `Das und alles Weitere finden Sie in Ihrem <a href="${u}">Mitgliederbereich</a> — Anmeldung mit dieser E-Mail-Adresse, ohne Passwort.`,
  fr: (u) =>
    `Vous retrouvez ceci et tout le reste dans votre <a href="${u}">espace membre</a> — connexion avec cette adresse e-mail, sans mot de passe.`,
  it: (u) =>
    `Trovi questo e tutto il resto nella tua <a href="${u}">area riservata</a> — accesso con questo indirizzo e-mail, senza password.`,
}

const SPACE_CTA: Record<Lang, string> = {
  en: 'Open my member area',
  de: 'Mitgliederbereich öffnen',
  fr: 'Ouvrir mon espace membre',
  it: 'Apri la mia area riservata',
}

// ─── 1. Credit pack ───────────────────────────────────────────────────────────

export interface CreditPackReceiptParams {
  firstname: string
  teamName: string
  packName: string
  /** THE POINT OF THIS MAIL. Comes from the grant document that was just
   *  written — never from `Contact.credit_summary`, which a trigger maintains
   *  and which can still be stale at the moment this is built. */
  credits: number
  /** The pack's validity window, or null when the credits never expire. */
  expiresAt?: Date | null
  /** Activity names the credits can be spent on, when the pack is scoped to
   *  some. Empty ⇒ the copy stays general rather than inventing a scope. */
  activityNames?: string[]
  paid?: PaidAmount | null
  spaceUrl?: string | null
  lang?: Lang
}

export function buildCreditPackReceiptEmail(p: CreditPackReceiptParams): {
  subject: string
  html: string
  text: string
} {
  const lang = p.lang ?? 'en'
  const firstname = escapeHtml(p.firstname)
  const teamName = escapeHtml(p.teamName)
  const packName = escapeHtml(p.packName)
  const n = p.credits
  const paidLine = money(p.paid, lang)
  const activities = (p.activityNames ?? []).map((a) => escapeHtml(a))

  const titles: Record<Lang, string> = {
    en: 'Your credits are ready',
    de: 'Ihr Guthaben ist bereit',
    fr: 'Vos crédits sont prêts',
    it: 'I tuoi crediti sono pronti',
  }

  const subjects: Record<Lang, string> = {
    en: `${n} credits at ${p.teamName}`,
    de: `${n} Guthaben bei ${p.teamName}`,
    fr: `${n} crédits chez ${p.teamName}`,
    it: `${n} crediti presso ${p.teamName}`,
  }

  const intros: Record<Lang, string> = {
    en: `Thank you — your purchase is confirmed. Your pack gives you <strong>${n} credits</strong> at <strong>${teamName}</strong>, and one credit books one class.`,
    de: `Vielen Dank — Ihr Kauf ist bestätigt. Ihr Paket enthält <strong>${n} Guthaben</strong> bei <strong>${teamName}</strong>; eine Buchung kostet ein Guthaben.`,
    fr: `Merci — votre achat est confirmé. Votre pack vous donne <strong>${n} crédits</strong> chez <strong>${teamName}</strong>, et un crédit réserve un cours.`,
    it: `Grazie — il tuo acquisto è confermato. Il tuo pacchetto ti dà <strong>${n} crediti</strong> presso <strong>${teamName}</strong>, e un credito prenota una lezione.`,
  }

  const factLabels: Record<Lang, { pack: string; credits: string; valid: string; noExpiry: string }> = {
    en: { pack: 'Pack', credits: 'Credits', valid: 'Valid until', noExpiry: 'No expiry date' },
    de: { pack: 'Paket', credits: 'Guthaben', valid: 'Gültig bis', noExpiry: 'Ohne Ablaufdatum' },
    fr: { pack: 'Pack', credits: 'Crédits', valid: "Valable jusqu'au", noExpiry: "Pas de date d'expiration" },
    it: { pack: 'Pacchetto', credits: 'Crediti', valid: 'Valido fino al', noExpiry: 'Senza scadenza' },
  }
  const L = factLabels[lang]

  const facts = [
    `<strong>${L.pack}:</strong> ${packName}`,
    `<strong>${L.credits}:</strong> ${n}`,
    p.expiresAt
      ? `<strong>${L.valid}:</strong> ${formatDay(p.expiresAt, lang)}`
      : `<strong>${L.valid}:</strong> ${L.noExpiry}`,
    paidLine ? `<strong>${PAID_LABELS[lang]}:</strong> ${paidLine}` : '',
  ]

  // Named, not summarised: "selected classes" tells a buyer nothing, and a pack
  // that turns out not to cover the class they wanted is the complaint this line
  // exists to prevent.
  const scopeLines: Record<Lang, (list: string) => string> = {
    en: (l) => `Use them to book: ${l}.`,
    de: (l) => `Damit buchen Sie: ${l}.`,
    fr: (l) => `Utilisez-les pour réserver : ${l}.`,
    it: (l) => `Usali per prenotare: ${l}.`,
  }

  const body = [
    `<p>${GREETINGS[lang](firstname)}</p>`,
    `<p>${intros[lang]}</p>`,
    detailsBox({ content: factLines(facts) }),
    activities.length ? `<p>${scopeLines[lang](activities.join(', '))}</p>` : '',
    p.spaceUrl
      ? `<p style="text-align:center;margin-top:24px;">${ctaButton(p.spaceUrl, SPACE_CTA[lang])}</p>`
      : '',
    p.spaceUrl ? `<p style="font-size:14px;">${SPACE_LINES[lang](p.spaceUrl)}</p>` : '',
  ]
    .filter(Boolean)
    .join('\n')

  return { subject: subjects[lang], ...buildEmailTemplate({ title: titles[lang], body }) }
}

// ─── 2. Membership (the same rail, without credits) ───────────────────────────

export interface MembershipReceiptParams {
  firstname: string
  teamName: string
  planName: string
  /** Recurring ⇒ the copy says it renews by itself; one-off ⇒ it does not. */
  recurring: boolean
  /** One-off memberships that include a run of months — the date they run to. */
  validUntil?: Date | null
  paid?: PaidAmount | null
  spaceUrl?: string | null
  lang?: Lang
}

export function buildMembershipReceiptEmail(p: MembershipReceiptParams): {
  subject: string
  html: string
  text: string
} {
  const lang = p.lang ?? 'en'
  const firstname = escapeHtml(p.firstname)
  const teamName = escapeHtml(p.teamName)
  const planName = escapeHtml(p.planName)
  const paidLine = money(p.paid, lang)

  const titles: Record<Lang, string> = {
    en: 'Membership confirmed',
    de: 'Mitgliedschaft bestätigt',
    fr: 'Abonnement confirmé',
    it: 'Abbonamento confermato',
  }

  const subjects: Record<Lang, string> = {
    en: `Membership confirmed – ${p.planName}`,
    de: `Mitgliedschaft bestätigt – ${p.planName}`,
    fr: `Abonnement confirmé – ${p.planName}`,
    it: `Abbonamento confermato – ${p.planName}`,
  }

  const intros: Record<Lang, string> = {
    en: `Thank you — your <strong>${planName}</strong> membership at <strong>${teamName}</strong> is active.`,
    de: `Vielen Dank — Ihre Mitgliedschaft <strong>${planName}</strong> bei <strong>${teamName}</strong> ist aktiv.`,
    fr: `Merci — votre abonnement <strong>${planName}</strong> chez <strong>${teamName}</strong> est actif.`,
    it: `Grazie — il tuo abbonamento <strong>${planName}</strong> presso <strong>${teamName}</strong> è attivo.`,
  }

  const factLabels: Record<Lang, { plan: string; until: string }> = {
    en: { plan: 'Membership', until: 'Included until' },
    de: { plan: 'Mitgliedschaft', until: 'Enthalten bis' },
    fr: { plan: 'Abonnement', until: "Inclus jusqu'au" },
    it: { plan: 'Abbonamento', until: 'Incluso fino al' },
  }
  const L = factLabels[lang]

  const facts = [
    `<strong>${L.plan}:</strong> ${planName}`,
    p.validUntil ? `<strong>${L.until}:</strong> ${formatDay(p.validUntil, lang)}` : '',
    paidLine ? `<strong>${PAID_LABELS[lang]}:</strong> ${paidLine}` : '',
  ]

  // "Manage or cancel", not "cancel": the member area opens Stripe's billing
  // portal (Space → Payments), which does both — and claiming only the second
  // would understate it while claiming a button that is labelled differently.
  const renewalLines: Record<Lang, string> = {
    en: 'This membership renews automatically until you cancel it. You can manage or cancel it any time from your member area.',
    de: 'Diese Mitgliedschaft verlängert sich automatisch, bis Sie sie kündigen. Verwalten oder kündigen können Sie sie jederzeit im Mitgliederbereich.',
    fr: "Cet abonnement se renouvelle automatiquement jusqu'à votre résiliation. Vous pouvez le gérer ou le résilier à tout moment depuis votre espace membre.",
    it: 'Questo abbonamento si rinnova automaticamente finché non lo disdici. Puoi gestirlo o disdirlo in qualsiasi momento dalla tua area riservata.',
  }

  const oneOffLines: Record<Lang, string> = {
    en: 'This was a one-off payment — nothing renews automatically.',
    de: 'Das war eine einmalige Zahlung — es verlängert sich nichts automatisch.',
    fr: "Il s'agit d'un paiement unique — rien ne se renouvelle automatiquement.",
    it: 'È stato un pagamento una tantum — non si rinnova nulla automaticamente.',
  }

  const body = [
    `<p>${GREETINGS[lang](firstname)}</p>`,
    `<p>${intros[lang]}</p>`,
    detailsBox({ content: factLines(facts) }),
    `<p>${p.recurring ? renewalLines[lang] : oneOffLines[lang]}</p>`,
    p.spaceUrl
      ? `<p style="text-align:center;margin-top:24px;">${ctaButton(p.spaceUrl, SPACE_CTA[lang])}</p>`
      : '',
    p.spaceUrl ? `<p style="font-size:14px;">${SPACE_LINES[lang](p.spaceUrl)}</p>` : '',
  ]
    .filter(Boolean)
    .join('\n')

  return { subject: subjects[lang], ...buildEmailTemplate({ title: titles[lang], body }) }
}

// ─── 3. Course ────────────────────────────────────────────────────────────────

export interface CourseReceiptParams {
  firstname: string
  teamName: string
  courseTitle: string
  paid?: PaidAmount | null
  /** Deep link to the course in the member area when the course has a slug,
   *  else the Space root. WHERE TO WATCH IT is the whole job of this mail. */
  watchUrl?: string | null
  spaceUrl?: string | null
  lang?: Lang
}

export function buildCourseReceiptEmail(p: CourseReceiptParams): {
  subject: string
  html: string
  text: string
} {
  const lang = p.lang ?? 'en'
  const firstname = escapeHtml(p.firstname)
  const teamName = escapeHtml(p.teamName)
  const courseTitle = escapeHtml(p.courseTitle)
  const paidLine = money(p.paid, lang)

  const titles: Record<Lang, string> = {
    en: 'Your course is ready',
    de: 'Ihr Kurs ist bereit',
    fr: 'Votre cours est prêt',
    it: 'Il tuo corso è pronto',
  }

  const subjects: Record<Lang, string> = {
    en: `You now have access to ${p.courseTitle}`,
    de: `Sie haben jetzt Zugang zu ${p.courseTitle}`,
    fr: `Vous avez maintenant accès à ${p.courseTitle}`,
    it: `Ora hai accesso a ${p.courseTitle}`,
  }

  const intros: Record<Lang, string> = {
    en: `Thank you — <strong>${courseTitle}</strong> from <strong>${teamName}</strong> is now open in your member area.`,
    de: `Vielen Dank — <strong>${courseTitle}</strong> von <strong>${teamName}</strong> ist jetzt in Ihrem Mitgliederbereich freigeschaltet.`,
    fr: `Merci — <strong>${courseTitle}</strong> de <strong>${teamName}</strong> est maintenant ouvert dans votre espace membre.`,
    it: `Grazie — <strong>${courseTitle}</strong> di <strong>${teamName}</strong> è ora disponibile nella tua area riservata.`,
  }

  const factLabels: Record<Lang, string> = {
    en: 'Course',
    de: 'Kurs',
    fr: 'Cours',
    it: 'Corso',
  }

  const facts = [
    `<strong>${factLabels[lang]}:</strong> ${courseTitle}`,
    paidLine ? `<strong>${PAID_LABELS[lang]}:</strong> ${paidLine}` : '',
  ]

  // A course entitlement is LIFETIME (courses/{id}/purchases/{contactId} has no
  // expiry and nothing ever removes it), so say that plainly instead of the
  // vague "enjoy your access" that reads like a window.
  const lifetimeLines: Record<Lang, string> = {
    en: 'It is yours for good — watch it as often as you like, with no expiry date.',
    de: 'Der Kurs gehört dauerhaft Ihnen — beliebig oft ansehen, ohne Ablaufdatum.',
    fr: "Il est à vous pour toujours — regardez-le autant de fois que vous voulez, sans date d'expiration.",
    it: 'È tuo per sempre — guardalo quante volte vuoi, senza scadenza.',
  }

  const watchCtas: Record<Lang, string> = {
    en: 'Watch the course',
    de: 'Kurs ansehen',
    fr: 'Regarder le cours',
    it: 'Guarda il corso',
  }

  const cta = p.watchUrl ?? p.spaceUrl ?? null

  const body = [
    `<p>${GREETINGS[lang](firstname)}</p>`,
    `<p>${intros[lang]}</p>`,
    detailsBox({ content: factLines(facts) }),
    `<p>${lifetimeLines[lang]}</p>`,
    cta ? `<p style="text-align:center;margin-top:24px;">${ctaButton(cta, watchCtas[lang])}</p>` : '',
    p.spaceUrl ? `<p style="font-size:14px;">${SPACE_LINES[lang](p.spaceUrl)}</p>` : '',
  ]
    .filter(Boolean)
    .join('\n')

  return { subject: subjects[lang], ...buildEmailTemplate({ title: titles[lang], body }) }
}

// ─── 4. Product ───────────────────────────────────────────────────────────────

export interface ProductReceiptParams {
  firstname: string
  teamName: string
  /** "Hoodie · XL" — product name plus the variant when one was chosen. */
  itemLabel: string
  paid?: PaidAmount | null
  /** The studio's published address, when it has one. */
  teamEmail?: string | null
  spaceUrl?: string | null
  lang?: Lang
}

export function buildProductReceiptEmail(p: ProductReceiptParams): {
  subject: string
  html: string
  text: string
} {
  const lang = p.lang ?? 'en'
  const firstname = escapeHtml(p.firstname)
  const teamName = escapeHtml(p.teamName)
  const itemLabel = escapeHtml(p.itemLabel)
  const teamEmail = p.teamEmail ? escapeHtml(p.teamEmail) : null
  const paidLine = money(p.paid, lang)

  const titles: Record<Lang, string> = {
    en: 'Order confirmed',
    de: 'Bestellung bestätigt',
    fr: 'Commande confirmée',
    it: 'Ordine confermato',
  }

  const subjects: Record<Lang, string> = {
    en: `Order confirmed – ${p.itemLabel}`,
    de: `Bestellung bestätigt – ${p.itemLabel}`,
    fr: `Commande confirmée – ${p.itemLabel}`,
    it: `Ordine confermato – ${p.itemLabel}`,
  }

  const intros: Record<Lang, string> = {
    en: `Thank you — your order at <strong>${teamName}</strong> is confirmed.`,
    de: `Vielen Dank — Ihre Bestellung bei <strong>${teamName}</strong> ist bestätigt.`,
    fr: `Merci — votre commande chez <strong>${teamName}</strong> est confirmée.`,
    it: `Grazie — il tuo ordine presso <strong>${teamName}</strong> è confermato.`,
  }

  const factLabels: Record<Lang, string> = {
    en: 'Item',
    de: 'Artikel',
    fr: 'Article',
    it: 'Articolo',
  }

  const facts = [
    `<strong>${factLabels[lang]}:</strong> ${itemLabel}`,
    paidLine ? `<strong>${PAID_LABELS[lang]}:</strong> ${paidLine}` : '',
  ]

  const nextTitles: Record<Lang, string> = {
    en: 'What happens next',
    de: 'Wie es weitergeht',
    fr: 'La suite',
    it: 'Cosa succede ora',
  }

  // WHAT IS TRUE, NOT WHAT WOULD BE NICE. Products carry no fulfilment, delivery
  // or collection information anywhere in the product model, and the checkout
  // collects no address — so this mail promises no shipping and no timeframe. It
  // says the studio has the order and gives the buyer a way to ask. Rewrite this
  // paragraph the day a product grows fulfilment terms, not before.
  const nextLines: Record<Lang, string> = {
    en: `${teamName} arranges handover directly — nothing is shipped automatically.`,
    de: `${teamName} regelt die Übergabe direkt — es wird nichts automatisch versendet.`,
    fr: `${teamName} organise la remise directement — rien n'est expédié automatiquement.`,
    it: `${teamName} organizza la consegna direttamente — non viene spedito nulla automaticamente.`,
  }

  const askLines: Record<Lang, (mail: string) => string> = {
    en: (m) => `Ask them at <a href="mailto:${m}">${m}</a> if you are not sure how to collect it.`,
    de: (m) => `Fragen Sie unter <a href="mailto:${m}">${m}</a> nach, wenn Sie nicht wissen, wie Sie es erhalten.`,
    fr: (m) => `Écrivez-leur à <a href="mailto:${m}">${m}</a> si vous ne savez pas comment le récupérer.`,
    it: (m) => `Scrivi a <a href="mailto:${m}">${m}</a> se non sai come ritirarlo.`,
  }

  const askReplyLines: Record<Lang, string> = {
    en: 'Reply to this email if you are not sure how to collect it.',
    de: 'Antworten Sie auf diese E-Mail, wenn Sie nicht wissen, wie Sie es erhalten.',
    fr: 'Répondez à cet e-mail si vous ne savez pas comment le récupérer.',
    it: 'Rispondi a questa email se non sai come ritirarlo.',
  }

  const body = [
    `<p>${GREETINGS[lang](firstname)}</p>`,
    `<p>${intros[lang]}</p>`,
    detailsBox({ content: factLines(facts) }),
    detailsBox({
      title: nextTitles[lang],
      content: `<p style="margin:0;">${nextLines[lang]} ${
        teamEmail ? askLines[lang](teamEmail) : askReplyLines[lang]
      }</p>`,
    }),
    p.spaceUrl ? `<p style="font-size:14px;">${SPACE_LINES[lang](p.spaceUrl)}</p>` : '',
  ]
    .filter(Boolean)
    .join('\n')

  return { subject: subjects[lang], ...buildEmailTemplate({ title: titles[lang], body }) }
}
