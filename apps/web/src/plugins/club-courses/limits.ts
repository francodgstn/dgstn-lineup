// Usage limits for the Club Courses plugin.
//
// These are hard defaults today. `getClubCoursesLimits` is the single seam through
// which a future Linyup operator/admin console can supply per-tenant overrides
// (e.g. from a remote config doc or the installed-plugin config) without touching
// any call site. Enforcement in the MVP is client-side, using the denormalised
// counters we already maintain on the course docs.

export const CLUB_COURSES_DEFAULT_LIMITS = {
  maxCoursesPerTeam: 20,
  maxModulesPerCourse: 30,
  maxLessonsPerCourse: 100,
} as const

export type ClubCoursesLimits = typeof CLUB_COURSES_DEFAULT_LIMITS

// MVP: returns the hard defaults. Later: merge a central/admin override here, e.g.
//   getClubCoursesLimits(teamId, installedPlugin?.config)
export function getClubCoursesLimits(): ClubCoursesLimits {
  return CLUB_COURSES_DEFAULT_LIMITS
}
