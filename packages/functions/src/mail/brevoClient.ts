import { BrevoClient } from '@getbrevo/brevo'
import { getSecret } from '../utils/secrets'

// Single shared Brevo client. The API key is read from Secret Manager
// (`brevo-api-key`; emulator env `BREVO_API_KEY`) — server-side only, never
// exposed to clients and never logged. maxRetries gives transient-error
// resilience on top of the service-level retry.
let cached: BrevoClient | null = null

export async function getBrevoClient(): Promise<BrevoClient> {
  if (cached) return cached
  const apiKey = await getSecret('brevo-api-key')
  cached = new BrevoClient({ apiKey, maxRetries: 2 })
  return cached
}

// Test seam — lets unit tests inject a stub client without a real key.
export function __setBrevoClientForTests(client: BrevoClient | null): void {
  cached = client
}
