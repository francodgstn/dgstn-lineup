import type { Timestamp } from './common'

// 'org' is reserved for a future slice where a parent org publishes courses to all
// member clubs. MVP only writes 'team'.
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

// Subcollection: courses/{courseId}/lessons
export interface Lesson {
  id: string
  courseId: string
  moduleId: string
  teamId: string
  title: string
  type: LessonType
  order: number
  // type === 'text'
  body?: string // markdown
  // type === 'audio' | 'video'
  mediaSource?: MediaSource
  mediaUrl?: string // external URL or Storage download URL
  durationSeconds?: number
  // shared
  attachmentUrls?: string[] // PDFs etc. (Storage)
  isPreview?: boolean // reserved for future gated preview
  created_at: Timestamp
  updated_at: Timestamp
}
