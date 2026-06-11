import type { Timestamp } from './common'

// 'org' is reserved for a future slice where a parent org publishes courses to all
// member teams. MVP only writes 'team'.
export type CourseScope = 'team' | 'org'

export type CourseStatus = 'draft' | 'published' | 'archived'

export type LessonType = 'text' | 'audio' | 'video'

// Where a lesson's media comes from. 'upload' = a Firebase Storage download URL;
// everything else is an external embed/link.
export type MediaSource = 'youtube' | 'vimeo' | 'url' | 'upload'

// Future paid-access hook — modelled now, NOT enforced in the MVP.
// subscriptionTypeIds is an array so it is ready for the planned move to multiple
// concurrent active subscriptions per contact.
export interface CourseAccessRule {
  type: 'free' | 'members' | 'subscription'
  subscriptionTypeIds?: string[] // team subscription_types ids; future gating
}

export interface Course {
  id: string
  scope: CourseScope // 'team' for MVP
  teamId: string // owner team (always set; org courses also carry orgId later)
  orgId?: string // reserved; unset in MVP
  title: string
  slug: string
  summary?: string
  coverImageUrl?: string
  status: CourseStatus
  accessRule: CourseAccessRule // default { type: 'members' }
  // Denormalised counters — maintained client-side, used for usage limits + list UI.
  moduleCount?: number
  lessonCount?: number
  order?: number
  created_at: Timestamp
  updated_at: Timestamp
  createdBy: string
  archived_at?: Timestamp | null
}

// Subcollection: courses/{courseId}/modules
export interface CourseModule {
  id: string
  courseId: string
  teamId: string
  title: string
  summary?: string
  order: number
  created_at: Timestamp
  updated_at: Timestamp
}

// A downloadable resource attached to a lesson (PDF, image, etc.).
export interface LessonAttachment {
  name: string
  url: string
  size?: number // bytes
  contentType?: string
}

// Subcollection: courses/{courseId}/lessons
//
// A lesson is mixed content (as in most LMS): a rich-text body is always
// available, an optional "featured" media clip (video/audio) can sit alongside
// it, and any number of downloadable attachments can be added. `type` is the
// primary format, derived from the featured media — used for the list icon.
export interface Lesson {
  id: string
  courseId: string
  moduleId: string
  teamId: string
  title: string
  type: LessonType
  order: number
  // rich body — always available regardless of type
  body?: string // rich text (HTML, produced by the shared RichTextEditor)
  // optional featured media (when type is 'audio' | 'video')
  mediaSource?: MediaSource
  mediaUrl?: string // external URL or Storage download URL
  durationSeconds?: number
  // downloadable resources
  attachments?: LessonAttachment[]
  isPreview?: boolean // reserved for future gated preview
  created_at: Timestamp
  updated_at: Timestamp
}
