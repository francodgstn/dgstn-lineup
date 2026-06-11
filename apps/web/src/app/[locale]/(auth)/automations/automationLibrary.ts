// Automation Library — curated pre-built automation rules for Linyup.
//
// Each LibraryItem represents one automation rule (and an optional email template)
// that can be browsed and installed from the Library dialog.
//
// library_key: stable identifier stored as `system_key` on Firestore docs.
//   - Migrated starter-kit items keep their old sys_* keys for backward compat.
//   - New items use lib_* keys.
//
// Template system_key convention:
//   - New items: `${library_key}:${lang}` per language variant
//   - Migrated items: no `template` field; action references existing sys_* template
//
// Adding new items in future: append to AUTOMATION_LIBRARY, ship. The library
// dialog re-reads this at load time — no migration needed.

import type { LucideIcon } from 'lucide-react'
import {
  UserPlus, RefreshCw, Trophy, CalendarCheck, Settings2,
} from 'lucide-react'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type LibraryCategory = 'trial' | 'retention' | 'milestones' | 'coaching' | 'admin'
export type SupportedLanguage = 'en' | 'de' | 'fr' | 'it'

export interface TemplateContent {
  subject: string
  body: string   // markdown
}

export type LibraryAction =
  | { type: 'send_email'; template_key: string }     // resolved to templateId at install time
  | { type: 'update_field'; field: string; value: string }
  | { type: 'notify_team'; subject: string; body: string }
  | { type: 'log_activity'; message: string }

export interface LibraryItem {
  library_key: string
  category: LibraryCategory
  name: string
  description: string   // 1-line shown on card
  tags: string[]
  requires_plan: 'coach' | 'studio'
  /** Defined only for items that own their email template. Migrated items reference
   *  an existing sys_* template via the action's template_key instead. */
  template?: {
    name: string
    body_mode: 'markdown'
    /** At least 'en' is required. All 4 variants are created at install time when present. */
    translations: { en: TemplateContent } & Partial<Record<SupportedLanguage, TemplateContent>>
  }
  rule: {
    trigger: { type: string; delayMinutes?: number }
    conditions: Array<Record<string, unknown>>
    actions: LibraryAction[]
  }
}

// ---------------------------------------------------------------------------
// Category metadata
// ---------------------------------------------------------------------------

export const CATEGORY_META: Record<LibraryCategory, { label: string; icon: LucideIcon; color: string }> = {
  trial:      { label: 'Trial Conversion', icon: UserPlus,      color: 'text-blue-500' },
  retention:  { label: 'Retention',        icon: RefreshCw,     color: 'text-green-500' },
  milestones: { label: 'Milestones',       icon: Trophy,        color: 'text-amber-500' },
  coaching:   { label: 'Coaching',         icon: CalendarCheck, color: 'text-purple-500' },
  admin:      { label: 'Internal / Admin', icon: Settings2,     color: 'text-slate-500' },
}

// ---------------------------------------------------------------------------
// Automation Library
// ---------------------------------------------------------------------------

export const AUTOMATION_LIBRARY: LibraryItem[] = [

  // ── TRIAL CONVERSION ──────────────────────────────────────────────────────

  {
    library_key: 'lib_trial_welcome',
    category: 'trial',
    name: 'Welcome new trial',
    description: 'Sends a warm welcome email the moment a trial contact is created.',
    tags: ['trial', 'welcome', 'first contact', 'onboarding'],
    requires_plan: 'studio',
    template: {
      name: 'Welcome to your first class',
      body_mode: 'markdown',
      translations: {
        en: {
          subject: 'Welcome to {{teamName}}, {{firstname}}!',
          body: `Hi {{firstname}},

We are so excited to have you joining us at **{{teamName}}** for your first class!

Here is everything you need to know before you arrive:

- **Come a few minutes early** so we can welcome you properly and answer any questions.
- Wear comfortable clothes and bring water.
- No experience needed — we will take care of the rest.

📅 **[Book your trial session ↗]({{bookingUrl}})**

We look forward to meeting you!

The {{teamName}} team`,
        },
        de: {
          subject: 'Willkommen bei {{teamName}}, {{firstname}}!',
          body: `Hallo {{firstname}},

wir freuen uns sehr, dich bei **{{teamName}}** zum ersten Training begrüssen zu dürfen!

Was du wissen solltest, bevor du kommst:

- **Komm ein paar Minuten früher** — wir begrüssen dich gerne persönlich und beantworten deine Fragen.
- Trag bequeme Kleidung und bring Wasser mit.
- Keine Erfahrung nötig — wir kümmern uns um den Rest.

📅 **[Trainingszeit buchen ↗]({{bookingUrl}})**

Wir freuen uns, dich kennenzulernen!

Das {{teamName}}-Team`,
        },
        fr: {
          subject: 'Bienvenue chez {{teamName}}, {{firstname}} !',
          body: `Bonjour {{firstname}},

Nous sommes ravis de vous accueillir chez **{{teamName}}** pour votre premier cours !

Ce qu'il faut savoir avant d'arriver :

- **Arrivez quelques minutes à l'avance** pour que nous puissions vous accueillir et répondre à vos questions.
- Portez des vêtements confortables et apportez de l'eau.
- Aucune expérience nécessaire — nous nous occupons du reste.

📅 **[Réserver votre séance d'essai ↗]({{bookingUrl}})**

Nous avons hâte de vous rencontrer !

L'équipe {{teamName}}`,
        },
        it: {
          subject: 'Benvenuto/a a {{teamName}}, {{firstname}}!',
          body: `Ciao {{firstname}},

Siamo felicissimi di accoglierti a **{{teamName}}** per il tuo primo allenamento!

Ecco tutto quello che devi sapere prima di venire:

- **Arriva qualche minuto prima** — ti accoglieremo personalmente e risponderemo alle tue domande.
- Indossa abiti comodi e porta dell'acqua.
- Nessuna esperienza necessaria — pensiamo noi al resto.

📅 **[Prenota la tua sessione di prova ↗]({{bookingUrl}})**

Non vediamo l'ora di conoscerti!

Il team {{teamName}}`,
        },
      },
    },
    rule: {
      trigger: { type: 'contact_created' },
      conditions: [{ type: 'contact_type', value: 'trial' }],
      actions: [{ type: 'send_email', template_key: 'lib_trial_welcome' }],
    },
  },

  {
    library_key: 'sys_rule_noshow_1d',
    category: 'trial',
    name: 'Trial no-show — 1-day follow-up',
    description: 'Sends a rebook nudge one day after a trial booking is marked no-show.',
    tags: ['trial', 'no-show', 'rebook', 'recovery'],
    requires_plan: 'studio',
    // No template field — uses existing sys_rebook_nudge
    rule: {
      trigger: { type: 'schedule_daily' },
      conditions: [
        { type: 'portal_booking_no_show', delay_days: 1 },
        { type: 'sessions_attended_exactly', value: 0 },
        { type: 'contact_type', value: 'trial' },
      ],
      actions: [{ type: 'send_email', template_key: 'sys_rebook_nudge' }],
    },
  },

  {
    library_key: 'lib_trial_noshow_3d',
    category: 'trial',
    name: 'Trial no-show — 3-day reminder',
    description: 'A gentler mid-point follow-up 3 days after a missed trial booking.',
    tags: ['trial', 'no-show', 'rebook', 'recovery'],
    requires_plan: 'studio',
    template: {
      name: 'We still have a spot for you',
      body_mode: 'markdown',
      translations: {
        en: {
          subject: 'We still have a spot for you, {{firstname}}',
          body: `Hi {{firstname}},

We know life can be unpredictable — we noticed you missed your trial at **{{teamName}}** a few days ago, and we wanted to reach out one more time.

If you are still interested, we would love to have you. Booking again takes just a moment:

📅 **[Find a new time ↗]({{bookingUrl}})**

No pressure — but the door is always open.

The {{teamName}} team`,
        },
        de: {
          subject: 'Wir haben noch einen Platz für dich, {{firstname}}',
          body: `Hallo {{firstname}},

das Leben ist manchmal unberechenbar — wir haben bemerkt, dass du dein Probetraining bei **{{teamName}}** vor einigen Tagen verpasst hast, und möchten uns noch einmal melden.

Falls du noch Interesse hast, sind wir gerne für dich da. Eine neue Zeit buchen geht ganz schnell:

📅 **[Neuen Termin finden ↗]({{bookingUrl}})**

Kein Druck — die Tür steht immer offen.

Das {{teamName}}-Team`,
        },
        fr: {
          subject: 'Nous avons encore une place pour vous, {{firstname}}',
          body: `Bonjour {{firstname}},

Nous savons que la vie peut être imprévisible — nous avons remarqué que vous avez manqué votre essai chez **{{teamName}}** il y a quelques jours et nous voulions vous contacter une dernière fois.

Si vous êtes toujours intéressé·e, nous serions ravis de vous accueillir. Reprendre rendez-vous ne prend qu'un instant :

📅 **[Trouver un nouveau créneau ↗]({{bookingUrl}})**

Sans pression — la porte est toujours ouverte.

L'équipe {{teamName}}`,
        },
        it: {
          subject: 'Abbiamo ancora un posto per te, {{firstname}}',
          body: `Ciao {{firstname}},

La vita può essere imprevedibile — abbiamo notato che hai perso il tuo appuntamento di prova a **{{teamName}}** qualche giorno fa e volevamo contattarti ancora una volta.

Se sei ancora interessato/a, ci farebbe molto piacere averti con noi. Prenotare un nuovo orario è semplicissimo:

📅 **[Trova un nuovo orario ↗]({{bookingUrl}})**

Nessuna pressione — la porta è sempre aperta.

Il team {{teamName}}`,
        },
      },
    },
    rule: {
      trigger: { type: 'schedule_daily' },
      conditions: [
        { type: 'portal_booking_no_show', delay_days: 3 },
        { type: 'sessions_attended_exactly', value: 0 },
        { type: 'contact_type', value: 'trial' },
      ],
      actions: [{ type: 'send_email', template_key: 'lib_trial_noshow_3d' }],
    },
  },

  {
    library_key: 'sys_rule_noshow_5d',
    category: 'trial',
    name: 'Trial no-show — 5-day reminder',
    description: 'Final rebook nudge 5 days after a missed trial booking.',
    tags: ['trial', 'no-show', 'rebook', 'recovery'],
    requires_plan: 'studio',
    rule: {
      trigger: { type: 'schedule_daily' },
      conditions: [
        { type: 'portal_booking_no_show', delay_days: 5 },
        { type: 'sessions_attended_exactly', value: 0 },
        { type: 'contact_type', value: 'trial' },
      ],
      actions: [{ type: 'send_email', template_key: 'sys_rebook_nudge' }],
    },
  },

  {
    library_key: 'sys_rule_trial_day1',
    category: 'trial',
    name: 'Trial attended — day-1 follow-up',
    description: 'Follows up the day after a trial contact completes their first class.',
    tags: ['trial', 'follow-up', 'conversion', 'first class'],
    requires_plan: 'studio',
    rule: {
      trigger: { type: 'schedule_daily' },
      conditions: [
        { type: 'sessions_attended_exactly', value: 1 },
        { type: 'contact_type', value: 'trial' },
        { type: 'subscription', value: 'none' },
      ],
      actions: [{ type: 'send_email', template_key: 'sys_trial_followup' }],
    },
  },

  {
    library_key: 'sys_rule_trial_7d',
    category: 'trial',
    name: 'Trial attended — 7-day nudge',
    description: 'Nudges a trial contact who hasn\'t subscribed 7 days after their first class.',
    tags: ['trial', 'nudge', 'conversion', 'inactivity'],
    requires_plan: 'studio',
    rule: {
      trigger: { type: 'schedule_daily' },
      conditions: [
        { type: 'sessions_attended_exactly', value: 1 },
        { type: 'contact_type', value: 'trial' },
        { type: 'subscription', value: 'none' },
        { type: 'inactivity_days', value: 7 },
      ],
      actions: [{ type: 'send_email', template_key: 'sys_trial_followup' }],
    },
  },

  {
    library_key: 'sys_rule_trial_21d',
    category: 'trial',
    name: 'Trial attended — 21-day final',
    description: 'Final conversion email sent 21 days after a trial with no follow-up booking.',
    tags: ['trial', 'conversion', 'final', 'inactivity'],
    requires_plan: 'studio',
    rule: {
      trigger: { type: 'schedule_daily' },
      conditions: [
        { type: 'sessions_attended_exactly', value: 1 },
        { type: 'contact_type', value: 'trial' },
        { type: 'inactivity_days', value: 21 },
      ],
      actions: [{ type: 'send_email', template_key: 'sys_trial_followup' }],
    },
  },

  // ── RETENTION ─────────────────────────────────────────────────────────────

  {
    library_key: 'sys_rule_winback_30d',
    category: 'retention',
    name: 'Student inactive — 30 days',
    description: 'Win-back email after 30 days of inactivity for regular students.',
    tags: ['student', 'winback', 'inactivity', 'retention'],
    requires_plan: 'studio',
    rule: {
      trigger: { type: 'schedule_daily' },
      conditions: [
        { type: 'sessions_attended_min', value: 2 },
        { type: 'contact_type', value: 'student' },
        { type: 'inactivity_days', value: 30 },
      ],
      actions: [{ type: 'send_email', template_key: 'sys_winback' }],
    },
  },

  {
    library_key: 'sys_rule_winback_60d',
    category: 'retention',
    name: 'Student inactive — 60 days',
    description: 'Second win-back email for students absent for 60 days.',
    tags: ['student', 'winback', 'inactivity', 'retention'],
    requires_plan: 'studio',
    rule: {
      trigger: { type: 'schedule_daily' },
      conditions: [
        { type: 'sessions_attended_min', value: 2 },
        { type: 'contact_type', value: 'student' },
        { type: 'inactivity_days', value: 60 },
      ],
      actions: [{ type: 'send_email', template_key: 'sys_winback' }],
    },
  },

  {
    library_key: 'lib_winback_90d',
    category: 'retention',
    name: 'Student inactive — 90 days (last chance)',
    description: 'A final, heartfelt reach-out to students who have been away for 3 months.',
    tags: ['student', 'winback', 'inactivity', 'retention', 'last chance'],
    requires_plan: 'studio',
    template: {
      name: 'One last message from us',
      body_mode: 'markdown',
      translations: {
        en: {
          subject: 'One last message from {{teamName}}, {{firstname}}',
          body: `Hi {{firstname}},

It has been three months since we last saw you at **{{teamName}}**, and we did not want to let more time pass without reaching out.

We genuinely miss having you around. If something got in the way — life, work, anything — we understand completely.

Whenever you are ready, we will be here. No judgment, no catch-up required.

📅 **[Come back ↗]({{bookingUrl}})**

If you have moved on, that is okay too. We just wanted you to know the door is always open.

With care,
The {{teamName}} team`,
        },
        de: {
          subject: 'Eine letzte Nachricht von {{teamName}}, {{firstname}}',
          body: `Hallo {{firstname}},

drei Monate sind vergangen, seit wir dich zuletzt bei **{{teamName}}** gesehen haben, und wir wollten uns noch einmal melden, bevor noch mehr Zeit vergeht.

Wir vermissen dich wirklich. Wenn etwas dazwischengekommen ist — das Leben, die Arbeit, was auch immer — haben wir vollstes Verständnis.

Wann immer du bereit bist, sind wir für dich da. Kein Druck, kein Aufholen nötig.

📅 **[Wieder einsteigen ↗]({{bookingUrl}})**

Wenn du dich anderweitig entschieden hast, ist das auch vollkommen in Ordnung. Wir wollten nur, dass du weisst: die Tür steht immer offen.

Mit herzlichen Grüssen,
Das {{teamName}}-Team`,
        },
        fr: {
          subject: 'Un dernier message de {{teamName}}, {{firstname}}',
          body: `Bonjour {{firstname}},

Cela fait trois mois que nous ne vous avons pas vu·e chez **{{teamName}}**, et nous ne voulions pas laisser passer plus de temps sans prendre de vos nouvelles.

Vous nous manquez sincèrement. Si quelque chose s'est mis en travers du chemin — la vie, le travail, n'importe quoi — nous comprenons tout à fait.

Quand vous serez prêt·e, nous serons là. Sans jugement, sans avoir besoin de rattraper quoi que ce soit.

📅 **[Revenir ↗]({{bookingUrl}})**

Si vous avez tourné la page, c'est tout à fait bien aussi. Nous voulions juste que vous sachiez que la porte est toujours ouverte.

Avec sincérité,
L'équipe {{teamName}}`,
        },
        it: {
          subject: 'Un ultimo messaggio da {{teamName}}, {{firstname}}',
          body: `Ciao {{firstname}},

sono passati tre mesi dall'ultima volta che ti abbiamo visto/a a **{{teamName}}**, e non volevamo lasciare passare altro tempo senza farti sapere che pensiamo a te.

Ci manchi davvero. Se qualcosa ti ha impedito di tornare — la vita, il lavoro, qualsiasi cosa — lo capiamo perfettamente.

Quando sei pronto/a, siamo qui. Senza giudizi, senza pressioni.

📅 **[Torna con noi ↗]({{bookingUrl}})**

Se hai deciso di andare avanti altrove, va benissimo così. Volevamo solo che tu sapesse che la porta è sempre aperta.

Con affetto,
Il team {{teamName}}`,
        },
      },
    },
    rule: {
      trigger: { type: 'schedule_daily' },
      conditions: [
        { type: 'sessions_attended_min', value: 2 },
        { type: 'contact_type', value: 'student' },
        { type: 'inactivity_days', value: 90 },
      ],
      actions: [{ type: 'send_email', template_key: 'lib_winback_90d' }],
    },
  },

  {
    library_key: 'lib_membership_expired',
    category: 'retention',
    name: 'Membership expired — re-engagement',
    description: 'Fires the moment a contact\'s membership status changes to "expired".',
    tags: ['membership', 'expired', 'renewal', 'retention'],
    requires_plan: 'studio',
    template: {
      name: 'Your membership has expired',
      body_mode: 'markdown',
      translations: {
        en: {
          subject: '{{firstname}}, your membership at {{teamName}} has expired',
          body: `Hi {{firstname}},

Your membership at **{{teamName}}** has expired. We hope you have enjoyed training with us!

If you would like to continue, renewing is simple:

📝 **[Renew your membership ↗]({{membershipUrl}})**

If you have any questions or would like to talk about your options, just reply to this email — we are happy to help.

We hope to see you on the mat again soon.

The {{teamName}} team`,
        },
        de: {
          subject: '{{firstname}}, deine Mitgliedschaft bei {{teamName}} ist abgelaufen',
          body: `Hallo {{firstname}},

deine Mitgliedschaft bei **{{teamName}}** ist abgelaufen. Wir hoffen, du hattest eine tolle Zeit beim Training!

Wenn du weitermachen möchtest, ist die Verlängerung ganz einfach:

📝 **[Mitgliedschaft verlängern ↗]({{membershipUrl}})**

Wenn du Fragen hast oder über deine Möglichkeiten sprechen möchtest, antworte einfach auf diese E-Mail — wir helfen dir gerne.

Wir hoffen, dich bald wieder bei uns zu sehen.

Das {{teamName}}-Team`,
        },
        fr: {
          subject: '{{firstname}}, votre adhésion chez {{teamName}} a expiré',
          body: `Bonjour {{firstname}},

Votre adhésion chez **{{teamName}}** a expiré. Nous espérons que vous avez apprécié vous entraîner avec nous !

Si vous souhaitez continuer, le renouvellement est simple :

📝 **[Renouveler votre adhésion ↗]({{membershipUrl}})**

Si vous avez des questions ou souhaitez discuter de vos options, répondez simplement à cet e-mail — nous sommes là pour vous aider.

Nous espérons vous revoir bientôt.

L'équipe {{teamName}}`,
        },
        it: {
          subject: '{{firstname}}, la tua iscrizione a {{teamName}} è scaduta',
          body: `Ciao {{firstname}},

La tua iscrizione a **{{teamName}}** è scaduta. Speriamo tu abbia apprezzato allenarti con noi!

Se vuoi continuare, il rinnovo è semplicissimo:

📝 **[Rinnova la tua iscrizione ↗]({{membershipUrl}})**

Se hai domande o vuoi parlare delle tue opzioni, rispondi a questa email — siamo felici di aiutarti.

Speriamo di rivederti presto.

Il team {{teamName}}`,
        },
      },
    },
    rule: {
      trigger: { type: 'membership_status_changed' },
      conditions: [{ type: 'membership_status', value: 'expired' }],
      actions: [{ type: 'send_email', template_key: 'lib_membership_expired' }],
    },
  },

  // ── MILESTONES ─────────────────────────────────────────────────────────────

  {
    library_key: 'lib_milestone_1st',
    category: 'milestones',
    name: '1st class — welcome to the family',
    description: 'Celebrates a contact\'s first completed class and invites them to join.',
    tags: ['milestone', 'first class', 'welcome', 'conversion'],
    requires_plan: 'studio',
    template: {
      name: 'You did it — first class done!',
      body_mode: 'markdown',
      translations: {
        en: {
          subject: 'Your first class at {{teamName}} — {{firstname}}, you did it!',
          body: `Hi {{firstname}},

You showed up, and that is the hardest part. Welcome to **{{teamName}}**!

We hope your first class was a great experience. Every journey starts with one session, and you have just taken yours.

If you would like to keep training with us, joining is easy:

📝 **[Become a member ↗]({{membershipUrl}})**

And if you enjoyed your time, we would love a quick review — it means a lot to a small team like ours:

⭐ **[Leave a review ↗]({{reviewUrl}})**

See you next time!

The {{teamName}} team`,
        },
        de: {
          subject: 'Dein erstes Training bei {{teamName}} — {{firstname}}, du hast es geschafft!',
          body: `Hallo {{firstname}},

du bist erschienen — das ist das Schwierigste. Willkommen bei **{{teamName}}**!

Wir hoffen, dein erstes Training war ein tolles Erlebnis. Jede Reise beginnt mit einer Einheit, und du hast gerade deine erste absolviert.

Wenn du weiter mit uns trainieren möchtest, ist der Beitritt ganz einfach:

📝 **[Mitglied werden ↗]({{membershipUrl}})**

Und wenn dir die Zeit bei uns gefallen hat, würden wir uns über eine kurze Bewertung freuen:

⭐ **[Bewertung hinterlassen ↗]({{reviewUrl}})**

Bis zum nächsten Mal!

Das {{teamName}}-Team`,
        },
        fr: {
          subject: 'Votre premier cours chez {{teamName}} — {{firstname}}, vous l\'avez fait !',
          body: `Bonjour {{firstname}},

Vous êtes venu·e, et c'est la partie la plus difficile. Bienvenue chez **{{teamName}}** !

Nous espérons que votre premier cours a été une belle expérience. Chaque aventure commence par une séance, et vous venez d'accomplir la vôtre.

Si vous souhaitez continuer à vous entraîner avec nous, rejoindre le club est simple :

📝 **[Devenir membre ↗]({{membershipUrl}})**

Et si vous avez apprécié votre expérience, un avis rapide nous aiderait beaucoup :

⭐ **[Laisser un avis ↗]({{reviewUrl}})**

À bientôt !

L'équipe {{teamName}}`,
        },
        it: {
          subject: 'Il tuo primo allenamento a {{teamName}} — {{firstname}}, ce l\'hai fatta!',
          body: `Ciao {{firstname}},

Sei venuto/a — ed è la parte più difficile. Benvenuto/a a **{{teamName}}**!

Speriamo che il tuo primo allenamento sia stata un'esperienza meravigliosa. Ogni viaggio inizia con una sessione, e tu hai appena completato la tua.

Se vuoi continuare ad allenarti con noi, diventare membro è semplice:

📝 **[Diventa membro ↗]({{membershipUrl}})**

E se hai apprezzato la tua esperienza, una breve recensione per noi vale moltissimo:

⭐ **[Lascia una recensione ↗]({{reviewUrl}})**

A presto!

Il team {{teamName}}`,
        },
      },
    },
    rule: {
      trigger: { type: 'schedule_daily' },
      conditions: [{ type: 'sessions_attended_exactly', value: 1 }],
      actions: [{ type: 'send_email', template_key: 'lib_milestone_1st' }],
    },
  },

  {
    library_key: 'lib_milestone_5',
    category: 'milestones',
    name: '5 classes — finding your rhythm',
    description: 'Sends a congratulatory email after a contact completes 5 classes.',
    tags: ['milestone', '5 classes', 'congratulations'],
    requires_plan: 'studio',
    template: {
      name: '5 classes — you\'re finding your rhythm!',
      body_mode: 'markdown',
      translations: {
        en: {
          subject: '5 classes at {{teamName}}, {{firstname}} — you\'re finding your rhythm!',
          body: `Hi {{firstname}},

Five classes in — you are officially finding your rhythm at **{{teamName}}** and we could not be happier to have you with us!

Consistency is everything in training, and you are already building it. Keep it up!

If you have a spare moment, sharing your experience helps others find a place like ours:

⭐ **[Leave a review ↗]({{reviewUrl}})**

See you on the mat,
The {{teamName}} team`,
        },
        de: {
          subject: '5 Trainingseinheiten bei {{teamName}}, {{firstname}} — du findest deinen Rhythmus!',
          body: `Hallo {{firstname}},

Fünf Trainingseinheiten absolviert — du findest deinen Rhythmus bei **{{teamName}}** und wir freuen uns sehr, dich dabei zu haben!

Regelmässigkeit ist alles im Training, und du baust sie bereits auf. Weiter so!

Wenn du einen Moment Zeit hast, hilft deine Erfahrung anderen dabei, einen Platz wie unseren zu finden:

⭐ **[Bewertung hinterlassen ↗]({{reviewUrl}})**

Bis zum nächsten Training,
Das {{teamName}}-Team`,
        },
        fr: {
          subject: '5 cours chez {{teamName}}, {{firstname}} — vous trouvez votre rythme !',
          body: `Bonjour {{firstname}},

Cinq cours au compteur — vous trouvez votre rythme chez **{{teamName}}** et nous sommes ravis de vous avoir parmi nous !

La régularité est la clé de la progression, et vous êtes déjà en train de la construire. Continuez comme ça !

Si vous avez un moment, votre avis aide d'autres personnes à nous trouver :

⭐ **[Laisser un avis ↗]({{reviewUrl}})**

À bientôt sur le tatami,
L'équipe {{teamName}}`,
        },
        it: {
          subject: '5 allenamenti a {{teamName}}, {{firstname}} — stai trovando il tuo ritmo!',
          body: `Ciao {{firstname}},

Cinque allenamenti completati — stai trovando il tuo ritmo a **{{teamName}}** e siamo molto felici di averti con noi!

La costanza è tutto nell'allenamento, e tu la stai già costruendo. Continua così!

Se hai un momento, condividere la tua esperienza aiuta altri a trovare un posto come il nostro:

⭐ **[Lascia una recensione ↗]({{reviewUrl}})**

A presto,
Il team {{teamName}}`,
        },
      },
    },
    rule: {
      trigger: { type: 'schedule_daily' },
      conditions: [{ type: 'sessions_attended_exactly', value: 5 }],
      actions: [{ type: 'send_email', template_key: 'lib_milestone_5' }],
    },
  },

  {
    library_key: 'sys_rule_milestone_10',
    category: 'milestones',
    name: '10 classes — thank you!',
    description: 'Celebrates 10 completed classes and requests a review.',
    tags: ['milestone', '10 classes', 'thank you', 'review'],
    requires_plan: 'studio',
    rule: {
      trigger: { type: 'schedule_daily' },
      conditions: [{ type: 'sessions_attended_exactly', value: 10 }],
      actions: [{ type: 'send_email', template_key: 'sys_milestone_10' }],
    },
  },

  {
    library_key: 'lib_milestone_25',
    category: 'milestones',
    name: '25 classes — committed!',
    description: 'Recognises the dedication of reaching 25 classes.',
    tags: ['milestone', '25 classes', 'committed', 'congratulations'],
    requires_plan: 'studio',
    template: {
      name: '25 classes — you\'re committed!',
      body_mode: 'markdown',
      translations: {
        en: {
          subject: '25 classes, {{firstname}} — you\'re truly committed!',
          body: `Hi {{firstname}},

**25 classes** at **{{teamName}}** — that is no accident. It takes real commitment to show up consistently, and you have it.

You are an important part of what makes our community special. Thank you for being here.

If you have not shared your experience yet, this is a great moment — your story could inspire someone who is still on the fence:

⭐ **[Share your journey ↗]({{reviewUrl}})**

Keep going — you are doing great.

The {{teamName}} team`,
        },
        de: {
          subject: '25 Trainingseinheiten, {{firstname}} — du bist wirklich dran!',
          body: `Hallo {{firstname}},

**25 Trainingseinheiten** bei **{{teamName}}** — das passiert nicht zufällig. Es braucht echte Disziplin, um regelmässig zu erscheinen, und du hast sie.

Du bist ein wichtiger Teil von dem, was unsere Gemeinschaft besonders macht. Danke, dass du dabei bist.

Falls du deine Erfahrung noch nicht geteilt hast, ist jetzt ein guter Moment — deine Geschichte könnte jemanden inspirieren, der noch zögert:

⭐ **[Teile deinen Weg ↗]({{reviewUrl}})**

Weiter so — du machst das grossartig.

Das {{teamName}}-Team`,
        },
        fr: {
          subject: '25 cours, {{firstname}} — vous êtes vraiment engagé·e !',
          body: `Bonjour {{firstname}},

**25 cours** chez **{{teamName}}** — ce n'est pas un hasard. Il faut un vrai engagement pour se présenter régulièrement, et vous l'avez.

Vous faites partie intégrante de ce qui rend notre communauté spéciale. Merci d'être là.

Si vous n'avez pas encore partagé votre expérience, c'est le bon moment — votre témoignage pourrait inspirer quelqu'un qui hésite encore :

⭐ **[Partagez votre parcours ↗]({{reviewUrl}})**

Continuez — vous faites du très bon travail.

L'équipe {{teamName}}`,
        },
        it: {
          subject: '25 allenamenti, {{firstname}} — sei davvero determinato/a!',
          body: `Ciao {{firstname}},

**25 allenamenti** a **{{teamName}}** — non è un caso. Ci vuole vera dedizione per presentarsi con costanza, e tu ce l'hai.

Sei una parte importante di ciò che rende speciale la nostra comunità. Grazie per essere qui.

Se non hai ancora condiviso la tua esperienza, questo è il momento giusto — la tua storia potrebbe ispirare qualcuno che è ancora indeciso:

⭐ **[Condividi il tuo percorso ↗]({{reviewUrl}})**

Continua così — stai facendo un lavoro straordinario.

Il team {{teamName}}`,
        },
      },
    },
    rule: {
      trigger: { type: 'schedule_daily' },
      conditions: [{ type: 'sessions_attended_exactly', value: 25 }],
      actions: [{ type: 'send_email', template_key: 'lib_milestone_25' }],
    },
  },

  {
    library_key: 'lib_milestone_50',
    category: 'milestones',
    name: '50 classes — legend status',
    description: 'A major celebration for contacts who reach 50 classes.',
    tags: ['milestone', '50 classes', 'legend', 'congratulations'],
    requires_plan: 'studio',
    template: {
      name: '50 classes — legend status!',
      body_mode: 'markdown',
      translations: {
        en: {
          subject: '50 classes, {{firstname}} — you\'re a legend at {{teamName}}!',
          body: `Hi {{firstname}},

**50 classes.** Let that sink in.

You have shown up fifty times, pushed through fifty sessions, and you have become a true part of the **{{teamName}}** family. That is something to be genuinely proud of.

Thank you for the energy you bring every time you walk through the door. You make this place better for everyone.

If you feel like celebrating this milestone with a quick review, we would be honoured:

⭐ **[Share your 50-class story ↗]({{reviewUrl}})**

Here is to the next fifty!

The {{teamName}} team`,
        },
        de: {
          subject: '50 Trainingseinheiten, {{firstname}} — du bist eine Legende bei {{teamName}}!',
          body: `Hallo {{firstname}},

**50 Trainingseinheiten.** Lass das kurz wirken.

Du bist fünfzigmal erschienen, hast fünfzig Einheiten durchgezogen und bist zu einem echten Teil der **{{teamName}}**-Familie geworden. Das ist etwas, worauf du wirklich stolz sein kannst.

Danke für die Energie, die du jedes Mal mitbringst, wenn du durch unsere Tür trittst. Du machst diesen Ort für alle besser.

Wenn du diesen Meilenstein mit einer kurzen Bewertung feiern möchtest, würden wir uns sehr freuen:

⭐ **[Teile deine 50-Einheiten-Geschichte ↗]({{reviewUrl}})**

Auf die nächsten fünfzig!

Das {{teamName}}-Team`,
        },
        fr: {
          subject: '50 cours, {{firstname}} — vous êtes une légende chez {{teamName}} !',
          body: `Bonjour {{firstname}},

**50 cours.** Laissez ce chiffre résonner.

Vous vous êtes présenté·e cinquante fois, vous avez traversé cinquante séances et vous êtes devenu·e une vraie partie de la famille **{{teamName}}**. C'est quelque chose dont vous pouvez être véritablement fier·fière.

Merci pour l'énergie que vous apportez à chaque fois que vous franchissez notre porte. Vous rendez cet endroit meilleur pour tout le monde.

Si vous souhaitez célébrer ce jalon avec un avis rapide, nous en serions honorés :

⭐ **[Partagez votre histoire en 50 cours ↗]({{reviewUrl}})**

À la prochaine cinquantaine !

L'équipe {{teamName}}`,
        },
        it: {
          subject: '50 allenamenti, {{firstname}} — sei una leggenda a {{teamName}}!',
          body: `Ciao {{firstname}},

**50 allenamenti.** Lascia che questo numero entri dentro.

Ti sei presentato/a cinquanta volte, hai completato cinquanta sessioni e sei diventato/a una vera parte della famiglia **{{teamName}}**. È qualcosa di cui essere genuinamente orgoglioso/a.

Grazie per l'energia che porti ogni volta che varchi la nostra porta. Rendi questo posto migliore per tutti.

Se vuoi celebrare questo traguardo con una breve recensione, ne saremmo onorati:

⭐ **[Condividi la tua storia da 50 allenamenti ↗]({{reviewUrl}})**

Ai prossimi cinquanta!

Il team {{teamName}}`,
        },
      },
    },
    rule: {
      trigger: { type: 'schedule_daily' },
      conditions: [{ type: 'sessions_attended_exactly', value: 50 }],
      actions: [{ type: 'send_email', template_key: 'lib_milestone_50' }],
    },
  },

  // ── COACHING ──────────────────────────────────────────────────────────────

  {
    library_key: 'lib_session_feedback',
    category: 'coaching',
    name: 'Post-session feedback request',
    description: 'Sends a feedback request to participants 60 minutes after a session ends.',
    tags: ['feedback', 'review', 'session', 'coaching'],
    requires_plan: 'studio',
    template: {
      name: 'How was your session?',
      body_mode: 'markdown',
      translations: {
        en: {
          subject: 'How was your session at {{teamName}}, {{firstname}}?',
          body: `Hi {{firstname}},

Thanks for joining us today at **{{teamName}}**! We hope you had a great session.

Your feedback helps us keep improving. If you have a minute, we would love to hear how it went:

⭐ **[Share your experience ↗]({{reviewUrl}})**

See you next time!

The {{teamName}} team`,
        },
        de: {
          subject: 'Wie war dein Training bei {{teamName}}, {{firstname}}?',
          body: `Hallo {{firstname}},

danke, dass du heute bei **{{teamName}}** dabei warst! Wir hoffen, das Training hat dir Spass gemacht.

Dein Feedback hilft uns, uns stetig zu verbessern. Wenn du einen Moment Zeit hast, würden wir uns sehr über deine Rückmeldung freuen:

⭐ **[Teile deine Erfahrung ↗]({{reviewUrl}})**

Bis zum nächsten Mal!

Das {{teamName}}-Team`,
        },
        fr: {
          subject: 'Comment s\'est passé votre cours chez {{teamName}}, {{firstname}} ?',
          body: `Bonjour {{firstname}},

Merci d'avoir participé à notre cours aujourd'hui chez **{{teamName}}** ! Nous espérons que la séance s'est bien passée.

Votre avis nous aide à nous améliorer en permanence. Si vous avez une minute, nous serions ravis de connaître votre ressenti :

⭐ **[Partagez votre expérience ↗]({{reviewUrl}})**

À bientôt !

L'équipe {{teamName}}`,
        },
        it: {
          subject: 'Come è andata la tua sessione a {{teamName}}, {{firstname}}?',
          body: `Ciao {{firstname}},

Grazie per aver partecipato oggi a **{{teamName}}**! Speriamo che la sessione sia stata ottima.

Il tuo feedback ci aiuta a migliorare continuamente. Se hai un minuto, ci farebbe molto piacere sapere come è andata:

⭐ **[Condividi la tua esperienza ↗]({{reviewUrl}})**

A presto!

Il team {{teamName}}`,
        },
      },
    },
    rule: {
      trigger: { type: 'session_ended', delayMinutes: 60 },
      conditions: [],
      actions: [{ type: 'send_email', template_key: 'lib_session_feedback' }],
    },
  },

  // ── ADMIN / INTERNAL ──────────────────────────────────────────────────────

  {
    library_key: 'lib_notify_new_trial',
    category: 'admin',
    name: 'Notify team: new trial registered',
    description: 'Sends an internal alert to the team email when a new trial contact is created.',
    tags: ['admin', 'trial', 'internal', 'notification'],
    requires_plan: 'studio',
    // No email template — uses notify_team action (sends to team email address)
    rule: {
      trigger: { type: 'contact_created' },
      conditions: [{ type: 'contact_type', value: 'trial' }],
      actions: [{
        type: 'notify_team',
        subject: 'New trial registration: {{firstname}} {{lastname}}',
        body: `A new trial contact has registered at **{{teamName}}**.

**Name:** {{firstname}} {{lastname}}

Check the contact in your Linyup dashboard to follow up.`,
      }],
    },
  },

]

// ---------------------------------------------------------------------------
// Starter bundle — subset of library items to install in one click
// Keeps the same library_keys as the old SYSTEM_RULES for backward compat.
// ---------------------------------------------------------------------------

export const STARTER_BUNDLE_KEYS: string[] = [
  'sys_rule_noshow_1d',
  'sys_rule_noshow_5d',
  'sys_rule_trial_day1',
  'sys_rule_trial_7d',
  'sys_rule_trial_21d',
  'sys_rule_winback_30d',
  'sys_rule_winback_60d',
  'sys_rule_milestone_10',
]
