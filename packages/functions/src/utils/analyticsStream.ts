// Server-side analytics stream via PostHog Node SDK.
// Usage analytics events are NOT stored in Firestore; this is a separate stream
// from the operational audit log at teams/{teamId}/activity_log.
//
// The POSTHOG_API_KEY env var must be set in Firebase Secret Manager (or .env.local for emulator).
// If the key is absent the function is a no-op — telemetry is optional.

import { PostHog } from 'posthog-node'
import type { AnalyticsEvent } from '@linyup/shared'

let _client: PostHog | null = null

function getClient(): PostHog | null {
  const key = process.env.POSTHOG_API_KEY
  if (!key) return null

  if (!_client) {
    _client = new PostHog(key, {
      host: process.env.POSTHOG_HOST ?? 'https://eu.i.posthog.com',
      // Flush immediately — Cloud Functions may not live long enough for batching
      flushAt: 1,
      flushInterval: 0,
    })
  }
  return _client
}

/**
 * Emit a product analytics event from a Cloud Function.
 *
 * @param distinctId  Firebase UID of the user performing the action (or 'system' for automated events)
 * @param event       Event name + properties
 */
export async function emitAnalyticsEvent(
  distinctId: string,
  event: AnalyticsEvent,
): Promise<void> {
  const client = getClient()
  if (!client) return   // telemetry not configured — no-op

  try {
    client.capture({
      distinctId,
      event: event.name,
      properties: event.properties,
    })
    await client.flush()
  } catch (err) {
    // Analytics errors must never break core business logic
    console.warn('[analyticsStream] Failed to emit event:', (err as Error).message)
  }
}
