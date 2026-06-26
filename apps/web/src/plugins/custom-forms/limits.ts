// Custom Forms usage limits. Single seam for future operator overrides
// (remote config / installed-plugin.config), mirroring online-courses/limits.ts.
//
// MAX_FORMS_PER_TEAM is a single flat safeguard cap, identical for every plan —
// purely an abuse/runaway guard, NOT a monetization lever (the plugin itself is
// gated by plan via pluginAccessForPlan).

export const CUSTOM_FORMS_DEFAULT_LIMITS = {
  maxFormsPerTeam: 50,
  maxFieldsPerForm: 50,
  maxOptionsPerField: 30,
} as const

export type CustomFormsLimits = typeof CUSTOM_FORMS_DEFAULT_LIMITS

export function getCustomFormsLimits(): CustomFormsLimits {
  return CUSTOM_FORMS_DEFAULT_LIMITS
}

export const MAX_FORMS_PER_TEAM = CUSTOM_FORMS_DEFAULT_LIMITS.maxFormsPerTeam
