/**
 * Platform notices — Linyup writing to its Customers, with a record of it.
 *
 * WHY THIS IS NOT JUST A MAIL MERGE. The DPA (§4.5) commits us to giving 20
 * days' notice before adding or replacing a sub-processor. A commitment whose
 * only evidence is "somebody remembers sending an email" is not a commitment, so
 * the RECORD is the point and the sending is the easy half.
 *
 * THE RECIPIENT LIST IS RESOLVED ONCE, AT SEND TIME, AND STORED. It is never
 * re-derived. "Everyone on the Studio plan" answers a different question next
 * year than it did today — a team changed plan, another was deleted — and the
 * question an audit asks is "who did you actually notify", not "who would match
 * that rule now". Each resolved recipient is written to
 * `platform_notices/{id}/recipients/{teamId}` with the address used and the
 * `mail_sends` row that carries its delivery state.
 *
 * IT IS SYSTEM MAIL, not studio mail: it goes out as Linyup
 * (`sendSystemMail`, hello@linyup.com), so the `owner_email_verified` gate that
 * governs a studio mailing its own members does not apply and cannot silence a
 * legal notice. It still passes the messaging policy and the suppression list —
 * an operator sending from a `silent` environment gets a recorded skip, not a
 * surprise.
 */

import type { SaasPlan } from './team'
import type { Timestamp } from './common'

/**
 * WHO a notice goes to.
 *
 * `plans` and `teamIds` are the two axes that exist today; `createdBefore` /
 * `createdAfter` narrow either of them by when the studio signed up, which is
 * how "everyone who was already on the platform when X changed" gets asked. All
 * of them compose: an empty audience of kind `plans` with no plans selected
 * resolves to nobody, and the send refuses rather than treating it as "all".
 */
export interface PlatformNoticeAudience {
  kind: 'all' | 'plans' | 'teams'
  /** Required and non-empty when `kind === 'plans'`. */
  plans?: SaasPlan[]
  /** Required and non-empty when `kind === 'teams'`. */
  teamIds?: string[]
  /** Only studios created strictly before this instant. Epoch ms. */
  createdBefore?: number | null
  /** Only studios created at or after this instant. Epoch ms. */
  createdAfter?: number | null
}

/** The built-in starting points. The operator edits subject and body freely
 *  after picking one — a template is a head start, never a constraint. */
export type PlatformNoticeTemplateId =
  | 'blank'
  | 'sub_processor_change'
  | 'terms_update'
  | 'maintenance'
  | 'incident'

export interface PlatformNoticeTemplate {
  id: PlatformNoticeTemplateId
  label: string
  subject: string
  body: string
  /** Notices with a contractual notice period say so on the compose screen, so
   *  the operator is reminded BEFORE choosing a date rather than after. */
  noticeDays?: number
}

/**
 * The templates.
 *
 * `sub_processor_change` carries `noticeDays: 20` because that is what the DPA
 * promises — the number lives here so the compose screen can say it, and beside
 * the clause it comes from so the two are edited together.
 */
export const PLATFORM_NOTICE_TEMPLATES: PlatformNoticeTemplate[] = [
  {
    id: 'blank',
    label: 'Blank',
    subject: '',
    body: '',
  },
  {
    id: 'sub_processor_change',
    label: 'Sub-processor change',
    noticeDays: 20,
    subject: 'A change to the providers we use',
    body: [
      'Hello,',
      '',
      'We are writing to let you know that we are changing one of the sub-processors we use to run Linyup.',
      '',
      'What is changing: {{change}}',
      'When it takes effect: {{effective_date}}',
      'Why: {{reason}}',
      '',
      'Our current list of sub-processors is always in our Data Processing Agreement at https://linyup.com/dpa.',
      '',
      'If you object to this change on reasonable data-protection grounds, reply to this email within 20 days and we will discuss it with you.',
      '',
      '— Linyup',
    ].join('\n'),
  },
  {
    id: 'terms_update',
    label: 'Terms or DPA update',
    noticeDays: 42,
    subject: 'An update to our terms',
    body: [
      'Hello,',
      '',
      'We are updating our terms. The new version takes effect on {{effective_date}}.',
      '',
      'What is changing: {{change}}',
      '',
      'You can read the full terms at https://linyup.com/terms and the Data Processing Agreement at https://linyup.com/dpa.',
      '',
      'If you object to the change, reply to this email before it takes effect and we will discuss it with you.',
      '',
      '— Linyup',
    ].join('\n'),
  },
  {
    id: 'maintenance',
    label: 'Planned maintenance',
    subject: 'Planned maintenance on {{effective_date}}',
    body: [
      'Hello,',
      '',
      'We have planned maintenance on {{effective_date}}.',
      '',
      'What to expect: {{change}}',
      '',
      'We are sorry for the interruption, and we have picked the quietest window we could.',
      '',
      '— Linyup',
    ].join('\n'),
  },
  {
    id: 'incident',
    label: 'Incident notice',
    subject: 'An issue affecting your studio',
    body: [
      'Hello,',
      '',
      '{{change}}',
      '',
      'What we have done: {{reason}}',
      '',
      'If you have questions, reply to this email and we will answer.',
      '',
      '— Linyup',
    ].join('\n'),
  },
]

export type PlatformNoticeStatus = 'draft' | 'sending' | 'sent' | 'failed'

export interface PlatformNotice {
  id?: string
  subject: string
  /** Plain text. Rendered into the shared branded layout at send time. */
  body: string
  templateId: PlatformNoticeTemplateId
  audience: PlatformNoticeAudience
  /**
   * Owners always receive it — the DPA says "notice by email to the account
   * owner", so owner-only is what satisfies the commitment. Managers are opt-in
   * per notice, because a maintenance window concerns whoever runs the day and
   * a contract change concerns whoever signed it, and those are not the same
   * people.
   */
  includeManagers: boolean
  status: PlatformNoticeStatus
  created_by: string
  created_at: Timestamp
  sent_at?: Timestamp | null
  /** Teams resolved into the audience. */
  team_count?: number
  /** Individual addresses mailed — higher than `team_count` when managers are
   *  included, lower when a team has no reachable address. */
  recipient_count?: number
  /** Addresses the mail rail declined (suppressed, policy, synthetic guard). */
  skipped_count?: number
  failed_count?: number
}

/** One resolved recipient. Doc id is the teamId; a team with several recipients
 *  carries them all on one row, because the unit an audit asks about is the
 *  STUDIO that was notified, not the individual inbox. */
export interface PlatformNoticeRecipient {
  teamId: string
  teamName: string
  plan: SaasPlan | null
  /** Every address mailed for this team, owner first. */
  emails: string[]
  /** `mail_sends` ids, aligned with `emails` by index where one exists. */
  mailSendIds: string[]
  outcome: 'sent' | 'skipped' | 'failed' | 'no_recipient'
  error?: string | null
  resolved_at: Timestamp
}

/**
 * Is this audience answerable? Returns the reason it is not, or null.
 *
 * A send with an empty selection must REFUSE rather than fall back to "all" —
 * the failure mode of guessing here is mailing every customer by accident.
 */
export function platformNoticeAudienceProblem(a: PlatformNoticeAudience): string | null {
  if (a.kind === 'plans' && !(a.plans && a.plans.length > 0)) return 'Select at least one plan.'
  if (a.kind === 'teams' && !(a.teamIds && a.teamIds.length > 0)) return 'Select at least one studio.'
  if (
    a.createdBefore != null &&
    a.createdAfter != null &&
    a.createdBefore <= a.createdAfter
  ) {
    return 'The "created before" date must be after the "created after" date.'
  }
  return null
}
