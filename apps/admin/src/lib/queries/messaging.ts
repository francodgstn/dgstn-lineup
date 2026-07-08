import 'server-only'
import {
  MESSAGING_POLICIES_COLLECTION,
  MAIL_SENDS_COLLECTION,
  APP_SETTINGS_COLLECTION,
  type MessagingPolicy,
} from '@linyup/shared'
import { adminDb } from '@/lib/firebase-admin'

// Operator view of a tenant's outbound-messaging state: the (operator-only)
// delivery policy + the tenant's recent mail_sends ledger entries, including
// 'suppressed' ones — so "why didn't X get that email?" is answerable at a
// glance. See packages/functions/src/mail/README.md → "Per-tenant delivery policy".

export interface MailSendRow {
  id: string
  status: string
  suppressReason: string | null
  stream: string
  channel: string // 'email' | 'sms'
  updatedMs: number | null
}

// The policy handed to the (client) card — plain JSON only: Firestore Timestamps
// can't cross the server→client component boundary.
export type SerializablePolicy = Omit<MessagingPolicy, 'updated_at' | 'updated_by'>

// The functions deployment's messaging ENV params (kill switches, TEST_MODE,
// default mode), published hourly by the functions runtime to
// app_settings/messaging_env — see packages/functions/src/mail/messagingEnvStatus.ts.
// null = never published (functions not deployed / first hour after rollout).
export interface MessagingEnvStatus {
  mailEnabled: boolean
  smsEnabled: boolean
  testMode: boolean
  testEmail: string | null
  defaultMode: string
  updatedMs: number | null
}

export interface MessagingInfo {
  policy: SerializablePolicy | null
  recentSends: MailSendRow[]
  env: MessagingEnvStatus | null
}

export async function getMessagingInfo(entityId: string): Promise<MessagingInfo> {
  const [policySnap, sendsSnap, envSnap] = await Promise.all([
    adminDb.collection(MESSAGING_POLICIES_COLLECTION).doc(entityId).get(),
    adminDb
      .collection(MAIL_SENDS_COLLECTION)
      .where('team_id', '==', entityId)
      .orderBy('updated_at', 'desc')
      .limit(20)
      .get()
      // Ledger reads are best-effort — a missing index must not 500 the page.
      .catch(() => null),
    adminDb.collection(APP_SETTINGS_COLLECTION).doc('messaging_env').get().catch(() => null),
  ])

  let policy: SerializablePolicy | null = null
  if (policySnap.exists) {
    const d = policySnap.data() as MessagingPolicy
    policy = {
      entityId: d.entityId ?? entityId,
      mode: d.mode,
      ...(d.allowEmails ? { allowEmails: d.allowEmails } : {}),
      ...(d.allowPhones ? { allowPhones: d.allowPhones } : {}),
      ...(d.redirectEmail ? { redirectEmail: d.redirectEmail } : {}),
      ...(d.redirectPhone ? { redirectPhone: d.redirectPhone } : {}),
      ...(d.note ? { note: d.note } : {}),
    }
  }
  const recentSends: MailSendRow[] = (sendsSnap?.docs ?? []).map((d) => {
    const data = d.data()
    return {
      id: d.id,
      status: (data.status as string) ?? '—',
      suppressReason: (data.suppress_reason as string) ?? null,
      stream: (data.stream as string) ?? '—',
      channel: (data.channel as string) ?? 'email',
      updatedMs: data.updated_at?.toMillis?.() ?? null,
    }
  })

  let env: MessagingEnvStatus | null = null
  if (envSnap?.exists) {
    const d = envSnap.data()!
    env = {
      mailEnabled: d.mail_enabled !== false,
      smsEnabled: d.sms_enabled === true,
      testMode: d.test_mode === true,
      testEmail: (d.test_email as string) ?? null,
      defaultMode: (d.default_mode as string) ?? 'live',
      updatedMs: d.updated_at?.toMillis?.() ?? null,
    }
  }

  return { policy, recentSends, env }
}
