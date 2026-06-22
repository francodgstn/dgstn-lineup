/* eslint-disable no-console */
// Stripe Connect — onboarding callables (member → studio payments).
//
// Both onboarding models (BYO full-dashboard, Managed express) flow through here.
// The whole feature is feature-flagged per team (teams/{teamId}.payments.connectEnabled)
// so it can ship dark and be enabled per studio. Money settles on the studio's
// Stripe balance; Linyup never holds member funds.

import * as admin from 'firebase-admin'
import { FieldValue } from 'firebase-admin/firestore'
import { HttpsError, onCall } from 'firebase-functions/v2/https'
import {
  CONNECT_ACCOUNTS_COLLECTION,
  TEAMS_COLLECTION,
  type ConnectOnboardingModel,
} from '@linyup/shared'
import {
  createAccountLink,
  createConnectedAccount,
  retrieveAccountStatus,
  type NormalizedAccountStatus,
} from '../utils/connect/client'
import {
  assertOwner,
  loadEnabledTeam,
  onboardingUrls,
  ownerEmail,
  persistAccountStatus,
} from './access'

const VALID_MODELS: ConnectOnboardingModel[] = ['byo', 'managed']

// ─────────────────────────────────────────────────────────────────────────────
// startConnectOnboarding — create the connected account (once) and return a
// hosted onboarding link. Idempotent: reuses the team's existing account.
// ─────────────────────────────────────────────────────────────────────────────
export const startConnectOnboarding = onCall(async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Authentication required')

  const data = request.data as {
    teamId?: string
    model?: string
    country?: string
    entityType?: 'company' | 'individual'
    locale?: string
    origin?: string
  }
  if (!data?.teamId) throw new HttpsError('invalid-argument', 'teamId is required')
  const teamId = data.teamId
  const locale = data.locale ?? 'en'

  await assertOwner(request.auth.uid, teamId)
  const team = await loadEnabledTeam(teamId)

  // Reuse an existing connected account if one is already linked; the model is
  // fixed at creation, so we keep the stored model and ignore a changed param.
  let accountId = team.payments?.connectAccountId
  let model: ConnectOnboardingModel = team.payments?.connectModel ?? 'managed'

  if (!accountId) {
    if (!data.model || !VALID_MODELS.includes(data.model as ConnectOnboardingModel)) {
      throw new HttpsError('invalid-argument', `model must be one of: ${VALID_MODELS.join(', ')}`)
    }
    model = data.model as ConnectOnboardingModel
    const email = await ownerEmail(request.auth.uid, team)

    try {
      const created = await createConnectedAccount({
        model,
        teamId,
        email,
        country: data.country,
        entityType: data.entityType,
        displayName: team.name ?? email,
        idempotencyKey: `connect-acct:${teamId}`,
      })
      accountId = created.accountId
    } catch (err) {
      console.error('[connect] createConnectedAccount failed:', err)
      throw new HttpsError('internal', 'Failed to create the payment account')
    }

    const now = FieldValue.serverTimestamp()
    await admin
      .firestore()
      .collection(CONNECT_ACCOUNTS_COLLECTION)
      .doc(accountId)
      .set(
        {
          teamId,
          stripeAccountId: accountId,
          model,
          status: 'pending',
          charges_enabled: false,
          payouts_enabled: false,
          details_submitted: false,
          capabilities: {},
          requirements_currently_due: [],
          requirements_disabled_reason: null,
          default_currency: 'chf',
          created_at: now,
          updated_at: now,
        },
        { merge: true }
      )
    await admin
      .firestore()
      .collection(TEAMS_COLLECTION)
      .doc(teamId)
      .set(
        { payments: { connectAccountId: accountId, connectModel: model, connectStatus: 'pending' } },
        { merge: true }
      )
  }

  const { returnUrl, refreshUrl } = onboardingUrls(locale, data.origin)
  let url: string
  try {
    ;({ url } = await createAccountLink({ accountId, refreshUrl, returnUrl }))
  } catch (err) {
    console.error('[connect] createAccountLink failed:', err)
    throw new HttpsError('internal', 'Failed to start onboarding')
  }

  return { accountId, model, url }
})

// ─────────────────────────────────────────────────────────────────────────────
// getConnectStatus — refresh the account status from Stripe, persist, return it.
// Used by the dashboard "finish setup" path and after onboarding return.
// ─────────────────────────────────────────────────────────────────────────────
export const getConnectStatus = onCall(async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Authentication required')

  const data = request.data as { teamId?: string }
  if (!data?.teamId) throw new HttpsError('invalid-argument', 'teamId is required')
  const teamId = data.teamId

  await assertOwner(request.auth.uid, teamId)
  const team = await loadEnabledTeam(teamId)

  const accountId = team.payments?.connectAccountId
  const model: ConnectOnboardingModel = team.payments?.connectModel ?? 'managed'
  if (!accountId) return { connected: false as const }

  let status: NormalizedAccountStatus
  try {
    status = await retrieveAccountStatus(accountId)
  } catch (err) {
    console.error('[connect] retrieveAccountStatus failed:', err)
    throw new HttpsError('internal', 'Failed to fetch payment account status')
  }

  await persistAccountStatus(teamId, accountId, model, status)

  return {
    connected: true as const,
    accountId,
    model,
    status: status.status,
    charges_enabled: status.charges_enabled,
    payouts_enabled: status.payouts_enabled,
    details_submitted: status.details_submitted,
    capabilities: status.capabilities,
    requirements_currently_due: status.requirements_currently_due,
  }
})
