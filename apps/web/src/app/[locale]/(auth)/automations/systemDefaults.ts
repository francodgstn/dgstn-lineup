// System-default outreach templates and automation rules.
// Load them into a team's Firestore with the "Load starter kit" button on the Automations page.
//
// Rules are always seeded as active: false so managers review and enable them deliberately.
// system_key is a stable identifier — if a document with the same key already exists it is
// skipped, so the seeder is safe to call multiple times without creating duplicates.

export interface SystemTemplate {
  system_key: string
  name: string
  subject: string
  body: string
  body_mode: 'markdown'
  language: string
  active: true
}

export interface SystemRule {
  system_key: string
  /** References SystemTemplate.system_key — resolved to a real templateId at seed time */
  template_system_key: string
  name: string
  conditions: Array<
    | { type: 'bio_link_booking_no_show'; delay_days: number }
    | { type: 'sessions_attended_exactly'; value: number }
    | { type: 'sessions_attended_min'; value: number }
    | { type: 'sessions_attended_max'; value: number }
    | { type: 'inactivity_days'; value: number }
    | { type: 'acquisition_stage'; value: string }
    | { type: 'subscription'; value: string }
  >
  active: false
}

// ─── Templates ────────────────────────────────────────────────────────────────

export const SYSTEM_TEMPLATES: SystemTemplate[] = [
  {
    system_key: 'sys_rebook_nudge',
    name: "We missed you — let's reschedule",
    language: 'en',
    active: true,
    body_mode: 'markdown',
    subject: 'We missed you, {{firstname}} — want to find a new time?',
    body: `Hi {{firstname}},

We noticed you had a trial booked at **{{teamName}}** but did not make it in. No worries — life happens!

We would love to meet you. If you would like to find a new time, you can rebook here:

**[Book your trial ↗]({{bookingUrl}})**

Any questions? Just reply to this email.

The {{teamName}} team`,
  },

  {
    system_key: 'sys_trial_followup',
    name: 'Great to meet you',
    language: 'en',
    active: true,
    body_mode: 'markdown',
    subject: 'Great to meet you, {{firstname}}!',
    body: `Hi {{firstname}},

It was wonderful having you at **{{teamName}}** for your first session!

If you would like to continue with us, becoming a member is easy:

**[Complete your membership ↗]({{membershipUrl}})**

And if you have a moment, we would love to hear your first impression. Your review helps others find us and means a lot to our team:

**[Leave a review ↗]({{reviewUrl}})**

Any questions? Just hit reply and we will be happy to help.

See you soon,
The {{teamName}} team`,
  },

  {
    system_key: 'sys_winback',
    name: 'We miss you',
    language: 'en',
    active: true,
    body_mode: 'markdown',
    subject: 'We have been missing you, {{firstname}}',
    body: `Hi {{firstname}},

It has been a while since we have seen you at **{{teamName}}** and we just wanted to check in.

Life gets busy — we get it. Whenever you are ready to come back, we will be here.

**[Book a session ↗]({{bookingUrl}})**

If you enjoyed your time with us, a quick review makes a real difference for a small team:

**[Leave a review ↗]({{reviewUrl}})**

See you soon,
The {{teamName}} team`,
  },

  {
    system_key: 'sys_milestone_10',
    name: '10 sessions — thank you!',
    language: 'en',
    active: true,
    body_mode: 'markdown',
    subject: '10 sessions at {{teamName}}, {{firstname}} — thank you!',
    body: `Hi {{firstname}},

You have just completed your **10th session** at {{teamName}} — thank you for being part of our community!

Your commitment and energy make a difference every time you show up.

If you have not left us a review yet, this is a great moment. People looking for a place like ours really do read experiences like yours:

**[Share your experience ↗]({{reviewUrl}})**

Keep it up and see you soon!

The {{teamName}} team`,
  },
]

// ─── Rules ────────────────────────────────────────────────────────────────────
// All use trigger.type: 'schedule_daily'.
// The bio_link_booking_no_show condition is handled by the engine's booking scan path
// (runBookingRule) — it is not a different trigger type.

export const SYSTEM_RULES: SystemRule[] = [
  {
    system_key: 'sys_rule_noshow_1d',
    template_system_key: 'sys_rebook_nudge',
    name: 'Trial no-show — 1-day follow-up',
    conditions: [
      { type: 'bio_link_booking_no_show', delay_days: 1 },
      { type: 'sessions_attended_exactly', value: 0 },
      { type: 'acquisition_stage', value: 'trial_booked' },
    ],
    active: false,
  },
  {
    system_key: 'sys_rule_noshow_5d',
    template_system_key: 'sys_rebook_nudge',
    name: 'Trial no-show — 5-day reminder',
    conditions: [
      { type: 'bio_link_booking_no_show', delay_days: 5 },
      { type: 'sessions_attended_exactly', value: 0 },
      { type: 'acquisition_stage', value: 'trial_booked' },
    ],
    active: false,
  },
  {
    system_key: 'sys_rule_trial_day1',
    template_system_key: 'sys_trial_followup',
    name: 'Trial attended — day 1 follow-up',
    conditions: [
      { type: 'sessions_attended_exactly', value: 1 },
      { type: 'acquisition_stage', value: 'trial_attended' },
      { type: 'subscription', value: 'none' },
    ],
    active: false,
  },
  {
    system_key: 'sys_rule_trial_7d',
    template_system_key: 'sys_trial_followup',
    name: 'Trial attended — 7-day nudge',
    conditions: [
      { type: 'sessions_attended_exactly', value: 1 },
      { type: 'acquisition_stage', value: 'trial_attended' },
      { type: 'subscription', value: 'none' },
      { type: 'inactivity_days', value: 7 },
    ],
    active: false,
  },
  {
    system_key: 'sys_rule_trial_21d',
    template_system_key: 'sys_trial_followup',
    name: 'Trial attended — 21-day final',
    conditions: [
      { type: 'sessions_attended_exactly', value: 1 },
      { type: 'acquisition_stage', value: 'trial_attended' },
      { type: 'inactivity_days', value: 21 },
    ],
    active: false,
  },
  {
    system_key: 'sys_rule_winback_30d',
    template_system_key: 'sys_winback',
    name: 'Member inactive — 30 days',
    conditions: [
      { type: 'sessions_attended_min', value: 2 },
      { type: 'acquisition_stage', value: 'joined' },
      { type: 'inactivity_days', value: 30 },
    ],
    active: false,
  },
  {
    system_key: 'sys_rule_winback_60d',
    template_system_key: 'sys_winback',
    name: 'Member inactive — 60 days',
    conditions: [
      { type: 'sessions_attended_min', value: 2 },
      { type: 'acquisition_stage', value: 'joined' },
      { type: 'inactivity_days', value: 60 },
    ],
    active: false,
  },
  {
    system_key: 'sys_rule_milestone_10',
    template_system_key: 'sys_milestone_10',
    name: '10 sessions milestone',
    conditions: [{ type: 'sessions_attended_exactly', value: 10 }],
    active: false,
  },
]
