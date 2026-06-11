// Website plugin usage limits. Single seam for future operator overrides
// (remote config / installed-plugin.config), mirroring online-courses/limits.ts.

export const WEBSITE_DEFAULT_LIMITS = {
  maxSections: 12,
  maxGalleryImages: 24,
  maxImageSizeMB: 5,
} as const

export type WebsiteLimits = typeof WEBSITE_DEFAULT_LIMITS

export function getWebsiteLimits(): WebsiteLimits {
  return WEBSITE_DEFAULT_LIMITS
}
