import type { AnalyticsEvent } from '@lineup/shared'

// No-op stub — wire to Mixpanel / PostHog / Amplitude when a platform is chosen.
// Usage analytics events are NOT stored in Firestore; this is a separate stream
// from the operational audit log at teams/{teamId}/activity_log.
export async function emitAnalyticsEvent(_event: AnalyticsEvent): Promise<void> {}
