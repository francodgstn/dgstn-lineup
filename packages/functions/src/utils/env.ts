import { defineString } from 'firebase-functions/params'

export const HOSTING_URL = defineString('HOSTING_URL', {
  description: 'Base URL for hosting (used in links)',
  default: 'https://lineup.app',
})

export function getHostingUrl(): string {
  return HOSTING_URL.value()
}
