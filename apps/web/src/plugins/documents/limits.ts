// Usage limits for the Documents plugin. Single seam for a future operator
// override (remote config / installed-plugin.config), mirroring
// online-courses/limits.ts and custom-forms/limits.ts.

export const DOCUMENTS_DEFAULT_LIMITS = {
  maxDocumentsPerTeam: 20,
  maxImageSizeMB: 5,
  maxBodyChars: 50000,
} as const

export type DocumentsLimits = typeof DOCUMENTS_DEFAULT_LIMITS

// MVP: returns the hard defaults. Later: merge a central/admin override here, e.g.
//   getDocumentsLimits(teamId, installedPlugin?.config)
export function getDocumentsLimits(): DocumentsLimits {
  return DOCUMENTS_DEFAULT_LIMITS
}
