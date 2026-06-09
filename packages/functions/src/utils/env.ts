import { defineString, defineBoolean } from 'firebase-functions/params'

export const HOSTING_URL = defineString('HOSTING_URL', {
  description: 'Base URL for hosting (used in links)',
  default: 'https://linyup.com',
})

export function getHostingUrl(): string {
  return HOSTING_URL.value()
}

// Safety switch for the irreversible 90-day trial purge. Defaults TRUE → the
// purge job only LOGS what it would delete. Flip to false in .env.<alias> once
// verified in an environment.
export const TRIAL_PURGE_DRY_RUN = defineBoolean('TRIAL_PURGE_DRY_RUN', {
  description: 'When true, the 90-day trial purge logs what it would delete but does not delete.',
  default: true,
})

export function isTrialPurgeDryRun(): boolean {
  return TRIAL_PURGE_DRY_RUN.value()
}
