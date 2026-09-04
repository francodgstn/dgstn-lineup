/* eslint-disable no-console */
// The ONE place a push delivery vendor is CHOSEN. `sendPush.ts` resolves its
// provider here, per token `kind` — the vendor modules (expoProvider.ts,
// fcmProvider.ts) never decide anything, mirroring translate/provider.ts.
//
// LIVE: Expo's push service (expoProvider.ts) — the documented delivery path
// for `expo-notifications`, which is what apps/mobile (an Expo/EAS app; see
// the EAS project + staging Firebase sender id wired in PR #204) will use once
// its own push-registration half lands. Expo fronts BOTH platforms — one
// `ExponentPushToken…` routes to APNs or FCM for you and comes back with a
// per-token delivery ticket — so shipping it needs no APNs certificate and no
// FCM service-account credential of our own to manage.
//
// DECLARED, NOT LIVE: FCM direct via `admin.messaging()` (fcmProvider.ts) —
// for a raw FCM/APNs device token bypassing Expo's relay. It throws if ever
// reached (see its own header) rather than pretending to send.
//
// Selection is by `PushToken.kind`, not a single env switch like translate's
// `TRANSLATION_PROVIDER` — a fleet can hold tokens of more than one kind at
// once (a future 'fcm' registration path would add to, not replace, today's
// 'expo' tokens), and the kind decides the wire format, not a runtime
// preference. `PUSH_PROVIDER=none` (deployed functions env / emulator
// `.env.local`) is the one escape hatch — an explicit, deliberate "send
// nothing" for an environment that should never actually deliver — read here
// and nowhere else.
//
// Whatever is picked, a null provider or a failing send can only ever drop
// that batch — `sendPush.ts` never lets a push failure escape into a caller's
// transaction or booking, same rule `translateSite.ts` follows for publishes.
import type { PushTokenKind } from '@linyup/shared'
import type { PushProvider } from './types'
import { getExpoPushProvider } from './expoProvider'
import { getFcmPushProvider } from './fcmProvider'

export function getPushProvider(kind: PushTokenKind): PushProvider | null {
  if ((process.env.PUSH_PROVIDER ?? '').trim().toLowerCase() === 'none') return null

  switch (kind) {
    case 'expo':
      return getExpoPushProvider()
    case 'fcm':
      return getFcmPushProvider()
    default:
      return null
  }
}
