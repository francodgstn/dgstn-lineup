// Usage limits for the Documents plugin. Single seam for a future operator
// override (remote config / installed-plugin.config), mirroring
// online-courses/limits.ts and custom-forms/limits.ts.

import { MAX_WAIVER_BODY_CHARS } from '@linyup/shared'

export const DOCUMENTS_DEFAULT_LIMITS = {
  maxDocumentsPerTeam: 20,
  maxImageSizeMB: 5,
  // DELEGATED, not duplicated. This number and the public mirror's clamp were
  // two independent literals; a version snapshot is frozen at that clamp, so a
  // drift between them would freeze a truncation the editor never showed.
  maxBodyChars: MAX_WAIVER_BODY_CHARS,
} as const

export type DocumentsLimits = typeof DOCUMENTS_DEFAULT_LIMITS

// MVP: returns the hard defaults. Later: merge a central/admin override here, e.g.
//   getDocumentsLimits(teamId, installedPlugin?.config)
export function getDocumentsLimits(): DocumentsLimits {
  return DOCUMENTS_DEFAULT_LIMITS
}
