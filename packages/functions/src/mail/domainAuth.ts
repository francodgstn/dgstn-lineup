/* eslint-disable no-console */
import * as admin from 'firebase-admin'
import { HttpsError, onCall } from 'firebase-functions/v2/https'
import { FieldValue } from 'firebase-admin/firestore'
import {
  EMAIL_SENDER_INTEGRATION_DOC,
  ORGANIZATIONS_COLLECTION,
  TEAMS_COLLECTION,
  TEAM_INTEGRATIONS_SUBCOLLECTION,
  type EmailSenderConfig,
  type SaasPlan,
} from '@linyup/shared'
import { hasTeamRole } from '../utils/teams'
import { isByoEligible } from './senderResolution'
import {
  authenticateSenderDomain,
  createSenderDomain,
  deleteSenderDomain,
  getSenderDomainStatus,
} from './brevoDomains'
import { getEmailSenderConfig, writeEmailSenderConfig, type SenderScope } from './senderConfig'

// ─── guards ─────────────────────────────────────────────────────────────────

async function assertTeamOwner(uid: string, teamId: string): Promise<void> {
  if (!(await hasTeamRole(uid, teamId, 'owner'))) {
    throw new HttpsError('permission-denied', 'Team owner access required')
  }
}

async function assertOrgAdmin(uid: string, orgId: string): Promise<void> {
  const memberDoc = await admin
    .firestore()
    .collection(ORGANIZATIONS_COLLECTION)
    .doc(orgId)
    .collection('org_members')
    .doc(uid)
    .get()
  if (!memberDoc.exists || memberDoc.data()?.role !== 'org_admin') {
    throw new HttpsError('permission-denied', 'Organization admin access required')
  }
}

async function assertAccess(uid: string, scope: SenderScope, entityId: string): Promise<void> {
  if (scope === 'team') await assertTeamOwner(uid, entityId)
  else await assertOrgAdmin(uid, entityId)
}

function validateScope(scope: unknown, entityId: unknown): asserts scope is SenderScope {
  if (scope !== 'team' && scope !== 'org') {
    throw new HttpsError('invalid-argument', 'scope must be "team" or "org"')
  }
  if (typeof entityId !== 'string' || !entityId.trim()) {
    throw new HttpsError('invalid-argument', 'entityId is required')
  }
}

// ─── domain validation ──────────────────────────────────────────────────────

const DOMAIN_RE = /^(?!-)[a-z0-9-]+(\.[a-z0-9-]+)+$/i
// Studios on a public mailbox cannot authenticate a domain they don't control.
const PUBLIC_MAILBOX_DOMAINS = new Set([
  'gmail.com', 'googlemail.com', 'outlook.com', 'hotmail.com', 'live.com',
  'yahoo.com', 'ymail.com', 'icloud.com', 'me.com', 'gmx.com', 'gmx.ch',
  'bluewin.ch', 'hispeed.ch', 'proton.me', 'protonmail.com',
])

function normalizeDomain(input: unknown): string {
  if (typeof input !== 'string') throw new HttpsError('invalid-argument', 'domain is required')
  const domain = input.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '')
  if (!DOMAIN_RE.test(domain)) throw new HttpsError('invalid-argument', 'Enter a valid domain (e.g. theirdojo.ch)')
  if (PUBLIC_MAILBOX_DOMAINS.has(domain)) {
    throw new HttpsError('failed-precondition', 'Public mailbox domains cannot be authenticated. Use your own domain or Managed sending.')
  }
  return domain
}

function normalizeLocalPart(input: unknown): string {
  if (input == null || input === '') return 'info'
  if (typeof input !== 'string' || !/^[a-z0-9._-]+$/i.test(input.trim())) {
    throw new HttpsError('invalid-argument', 'Invalid From mailbox name')
  }
  return input.trim().toLowerCase()
}

async function assertByoEligible(scope: SenderScope, entityId: string): Promise<void> {
  // Orgs are inherently a paid tier; teams must be on a paid plan.
  if (scope === 'org') return
  const snap = await admin.firestore().collection(TEAMS_COLLECTION).doc(entityId).get()
  const plan = snap.data()?.plan as SaasPlan | undefined
  if (!isByoEligible(plan)) {
    throw new HttpsError('failed-precondition', 'Custom-domain sending requires a paid plan.')
  }
}

// ─── callables ──────────────────────────────────────────────────────────────

// Registers the studio's domain as a Brevo sender domain and returns the DNS
// records the studio must add. Persists a 'pending' BYO config. No credentials.
export const registerSenderDomain = onCall(async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Authentication required')
  const { scope, entityId, domain, fromLocalPart } = request.data ?? {}
  validateScope(scope, entityId)
  await assertAccess(request.auth.uid, scope, entityId)
  await assertByoEligible(scope, entityId)

  const normalizedDomain = normalizeDomain(domain)
  const localPart = normalizeLocalPart(fromLocalPart)

  let created
  try {
    created = await createSenderDomain(normalizedDomain)
  } catch (err) {
    console.error('registerSenderDomain: Brevo createDomain failed:', err)
    throw new HttpsError('internal', 'Could not register the domain with the email provider. It may already be registered.')
  }

  await writeEmailSenderConfig(scope, entityId, {
    model: 'byo_domain',
    domain: normalizedDomain,
    from_local_part: localPart,
    brevo_domain_id: created.brevoDomainId,
    dns_records: created.dnsRecords,
    verification_status: 'pending',
    last_checked_at: FieldValue.serverTimestamp() as unknown as EmailSenderConfig['last_checked_at'],
  })

  return { domain: normalizedDomain, fromLocalPart: localPart, dnsRecords: created.dnsRecords, status: 'pending' }
})

// Polls Brevo for the domain's authentication status, updates the stored config,
// and returns the current status + DNS records.
export const checkSenderDomain = onCall(async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Authentication required')
  const { scope, entityId } = request.data ?? {}
  validateScope(scope, entityId)
  await assertAccess(request.auth.uid, scope, entityId)

  const config = await getEmailSenderConfig(scope, entityId)
  if (!config?.domain) throw new HttpsError('failed-precondition', 'No domain registered for this account')

  // Ask Brevo to (re)verify, then read the current configuration.
  try {
    await authenticateSenderDomain(config.domain)
  } catch (err) {
    // Non-fatal — authenticate often 4xxs until records propagate; status read is the source of truth.
    console.warn('checkSenderDomain: authenticate call returned an error (continuing):', err)
  }

  let status
  try {
    status = await getSenderDomainStatus(config.domain)
  } catch (err) {
    console.error('checkSenderDomain: getDomainConfiguration failed:', err)
    throw new HttpsError('internal', 'Could not read domain status from the email provider')
  }

  const verification_status = status.authenticated || status.verified ? 'verified' : 'pending'
  await writeEmailSenderConfig(scope, entityId, {
    verification_status,
    dns_records: status.dnsRecords.length ? status.dnsRecords : config.dns_records,
    last_checked_at: FieldValue.serverTimestamp() as unknown as EmailSenderConfig['last_checked_at'],
  })

  return { status: verification_status, dnsRecords: status.dnsRecords.length ? status.dnsRecords : config.dns_records }
})

// Reverts the studio to Managed sending. Best-effort removes the BYO domain from
// Brevo so it can be re-registered later if needed.
export const useManagedSender = onCall(async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Authentication required')
  const { scope, entityId } = request.data ?? {}
  validateScope(scope, entityId)
  await assertAccess(request.auth.uid, scope, entityId)

  const config = await getEmailSenderConfig(scope, entityId)
  if (config?.domain) {
    try {
      await deleteSenderDomain(config.domain)
    } catch (err) {
      console.warn('useManagedSender: deleteDomain failed (non-fatal):', err)
    }
  }

  const docRef = admin
    .firestore()
    .collection(scope === 'team' ? TEAMS_COLLECTION : ORGANIZATIONS_COLLECTION)
    .doc(entityId)
    .collection(TEAM_INTEGRATIONS_SUBCOLLECTION)
    .doc(EMAIL_SENDER_INTEGRATION_DOC)
  await docRef.set(
    {
      type: 'email_sender',
      model: 'managed',
      domain: FieldValue.delete(),
      from_local_part: FieldValue.delete(),
      brevo_domain_id: FieldValue.delete(),
      dns_records: FieldValue.delete(),
      verification_status: FieldValue.delete(),
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true },
  )

  return { model: 'managed' }
})
