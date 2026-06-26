import type { Timestamp } from './common'

// ─── Custom Forms plugin ──────────────────────────────────────────────────────
//
// A lightweight, essential-but-complete form builder. A team designs a form,
// publishes it, shares the public link (/public/{slug}/forms/{slug}), and reviews
// the answers in the admin backend. Top-level `forms/{formId}` collection,
// team-scoped via `teamId` (mirrors the Online Courses `courses` collection).

export type FormStatus = 'draft' | 'published' | 'archived'

// Access gating, enforced by Firestore rules + the submitForm callable:
//  - 'public'   → anyone can open + submit, no login
//  - 'contacts' → only a signed-in contact of the team (passwordless
//                 contact-session login, same mechanism as the public Space)
export type FormAccess = 'public' | 'contacts'

export type FormFieldType =
  | 'short_text'
  | 'long_text'
  | 'email'
  | 'phone'
  | 'number'
  | 'single_choice'
  | 'multiple_choice'
  | 'dropdown'
  | 'checkbox'
  | 'date'

// Field types whose answer is constrained to `options`.
export const CHOICE_FIELD_TYPES: FormFieldType[] = [
  'single_choice',
  'multiple_choice',
  'dropdown',
]

export interface FormField {
  id: string // stable key — used verbatim as a key in FormSubmission.answers
  type: FormFieldType
  label: string
  placeholder?: string
  required?: boolean
  options?: string[] // for choice/dropdown types
  order: number
}

// Per-form notification config — both flags independent.
export interface FormNotifications {
  notifyStaff?: boolean // team_alert + staff email on new submission (default true)
  confirmSubmitter?: boolean // thank-you email to the submitter (default false)
}

// On-screen success message + (optional) submitter confirmation email body.
export interface FormConfirmation {
  message?: string // shown after a successful submit
  emailSubject?: string // used when notifications.confirmSubmitter
  emailBody?: string
}

export interface Form {
  id: string
  teamId: string
  title: string
  slug: string
  description?: string
  status: FormStatus
  access: FormAccess // 'public' | 'contacts'
  fields: FormField[] // embedded — forms are small; no subcollection
  createContact?: boolean // lead-capture toggle (default true)
  emailFieldId?: string | null // which field holds the email (linking + confirmation)
  notifications?: FormNotifications
  confirmation?: FormConfirmation
  submissionCount?: number // denormalised counter (maintained by submitForm)
  created_at: Timestamp
  updated_at: Timestamp
  createdBy: string
  archived_at?: Timestamp | null
}

export type FormSubmissionStatus = 'new' | 'reviewed' | 'archived'

// Subcollection: forms/{formId}/submissions/{submissionId}
//
// Written ONLY by the submitForm Cloud Function (Admin SDK) — clients never write
// directly. Team members read them back for the admin Responses backend.
export interface FormSubmission {
  id: string
  formId: string
  teamId: string
  answers: Record<string, unknown> // keyed by FormField.id
  contactId?: string | null // set when linked/created (lead capture)
  submittedByContact?: boolean // true when an authenticated contact submitted
  submitterEmail?: string | null
  status?: FormSubmissionStatus
  submitted_at: Timestamp
  source_ip?: string
}

// Mirrored to forms/{formId}/public_profile/{formId} by syncFormPublicProfile.
// World-readable summary that the public form page renders from — the public
// route never reads the root `forms` collection.
export interface FormPublicProfile {
  type: 'form'
  teamId: string
  slug: string
  title: string
  description?: string
  access: FormAccess
  fields: FormField[] // needed to render the public form
}
