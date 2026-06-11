// Usage limits for the Online Courses plugin.
//
// These are hard defaults today. `getOnlineCoursesLimits` is the single seam through
// which a future Linyup operator/admin console can supply per-tenant overrides
// (e.g. from a remote config doc or the installed-plugin config) without touching
// any call site. Enforcement in the MVP is client-side, using the denormalised
// counters we already maintain on the course docs.

export const ONLINE_COURSES_DEFAULT_LIMITS = {
  maxCoursesPerTeam: 20,
  maxModulesPerCourse: 30,
  maxLessonsPerCourse: 100,
  maxAttachmentsPerLesson: 10,
  maxAttachmentSizeMB: 25,
  maxImageSizeMB: 5,
} as const

export type OnlineCoursesLimits = typeof ONLINE_COURSES_DEFAULT_LIMITS

// MVP: returns the hard defaults. Later: merge a central/admin override here, e.g.
//   getOnlineCoursesLimits(teamId, installedPlugin?.config)
export function getOnlineCoursesLimits(): OnlineCoursesLimits {
  return ONLINE_COURSES_DEFAULT_LIMITS
}
