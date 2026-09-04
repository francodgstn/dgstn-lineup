// FCM direct via `admin.messaging()` — DECLARED, NOT LIVE. See provider.ts's
// header for why: nothing in this codebase mints a raw FCM/APNs device token
// today (only Expo's `ExponentPushToken…` format is produced, by the
// not-yet-built client half). Implement this — swap in `admin.messaging().sendEach(…)`
// — the day a token of kind 'fcm' actually exists to send to; until then it
// throws rather than silently no-op, so a future caller that reaches it
// during development finds out immediately instead of debugging a "sent" that
// never arrived.
import type { PushProvider } from './types'

export function getFcmPushProvider(): PushProvider {
  return {
    kind: 'fcm',
    async send() {
      throw new Error(
        "[push:fcm] not implemented — no 'fcm' token kind is minted yet; see push/provider.ts's header"
      )
    },
  }
}
