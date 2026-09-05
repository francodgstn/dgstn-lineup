// The ONE seam between `sendPush` and whatever delivery vendor backs it —
// mirrors packages/functions/src/translate/types.ts. A second provider (or a
// mock, in tests) only ever has to implement this.
import type { PushTokenKind } from '@linyup/shared'

/** One outbound push message — vendor-agnostic. */
export interface PushMessage {
  title: string
  body: string
  /** Arbitrary payload the client's notification handler reads. */
  data?: Record<string, string>
}

export type PushSendStatus =
  | 'ok'
  // The vendor says this token will NEVER deliver again (unregistered /
  // invalid) — the ONLY status `sendPush` prunes on.
  | 'dead'
  // Anything else: a transient vendor error, a malformed request, a timeout.
  // Left alone — the token might still be good on the next send.
  | 'error'

export interface PushSendReceipt {
  token: string
  status: PushSendStatus
  /** Present when status is 'error' or 'dead' — descriptive only, never decided on. */
  error?: string
}

/**
 * The ONE seam between `sendPush` and whatever delivery vendor backs it. A
 * provider addresses exactly one `PushTokenKind` (see `provider.ts`) and
 * reports one receipt per input message, same order in, same order out.
 */
export interface PushProvider {
  readonly kind: PushTokenKind
  send(messages: { token: string; message: PushMessage }[]): Promise<PushSendReceipt[]>
}
