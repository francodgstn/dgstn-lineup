/* eslint-disable no-console */
// Expo's push service (https://exp.host/--/api/v2/push/send) — the LIVE
// provider; see provider.ts's header for why. A thin fetch client, same shape
// as translate/deeplProvider.ts: no SDK dependency, one bounded-timeout POST
// per chunk.
import { getSecret } from '../utils/secrets'
import type { PushMessage, PushProvider, PushSendReceipt } from './types'

const SEND_URL = 'https://exp.host/--/api/v2/push/send'
// Expo's documented safe chunk size for one request.
const CHUNK_SIZE = 100

interface ExpoTicket {
  status: 'ok' | 'error'
  id?: string
  message?: string
  // 'DeviceNotRegistered' is the only code that means "never again"; every
  // other one ('MessageTooBig', 'MessageRateExceeded', 'InvalidCredentials',
  // an unrecognised future code) is transient or caller-side.
  details?: { error?: string }
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}

/**
 * Expo's push API works without one — the token only enables "Enhanced
 * Security" (rejects a push claiming to be from an app it is not). Optional,
 * so an unset secret is not a misconfiguration and warns nobody.
 */
async function accessToken(): Promise<string | null> {
  try {
    const token = await getSecret('expo-push-access-token')
    return token || null
  } catch {
    return null
  }
}

/** Pure — exported for `expoProvider.test.ts`. Turns one Expo ticket into a
 *  receipt, applying the dead/error distinction the module header states. */
export function ticketToReceipt(token: string, ticket: ExpoTicket | undefined): PushSendReceipt {
  if (!ticket) return { token, status: 'error', error: 'no ticket returned' }
  if (ticket.status === 'ok') return { token, status: 'ok' }
  const dead = ticket.details?.error === 'DeviceNotRegistered'
  return { token, status: dead ? 'dead' : 'error', error: ticket.message ?? ticket.details?.error }
}

async function sendChunk(
  accessTok: string | null,
  batch: { token: string; message: PushMessage }[]
): Promise<PushSendReceipt[]> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
    'Accept-Encoding': 'gzip, deflate',
  }
  if (accessTok) headers.Authorization = `Bearer ${accessTok}`

  const res = await fetch(SEND_URL, {
    method: 'POST',
    headers,
    body: JSON.stringify(
      batch.map(({ token: to, message }) => ({
        to,
        title: message.title,
        body: message.body,
        data: message.data,
      }))
    ),
    // Bounded — same reasoning as deeplProvider.ts: a hung connection must
    // degrade to a caught error, never hang the caller.
    signal: AbortSignal.timeout(15_000),
  })

  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    throw new Error(`[push:expo] send request failed: ${res.status} ${res.statusText} ${detail}`.trim())
  }

  const json = (await res.json()) as { data?: ExpoTicket[] }
  const tickets = json.data ?? []
  return batch.map((b, i) => ticketToReceipt(b.token, tickets[i]))
}

export function getExpoPushProvider(): PushProvider {
  return {
    kind: 'expo',
    async send(messages) {
      const token = await accessToken()
      const receipts: PushSendReceipt[] = []
      for (const batch of chunk(messages, CHUNK_SIZE)) {
        try {
          receipts.push(...(await sendChunk(token, batch)))
        } catch (err) {
          console.warn('[push:expo] chunk send failed — its tokens are left alone:', (err as Error).message)
          for (const b of batch) {
            receipts.push({ token: b.token, status: 'error', error: (err as Error).message })
          }
        }
      }
      return receipts
    },
  }
}
