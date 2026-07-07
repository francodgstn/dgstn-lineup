/* eslint-disable no-console */
import * as admin from 'firebase-admin'
import { Timestamp, FieldValue } from 'firebase-admin/firestore'
import { HttpsError, onCall } from 'firebase-functions/v2/https'
import { getSecret } from '../utils/secrets'
import { getHostingUrl, resolveBaseUrl } from '../utils/env'
import { sendEmail, buildEmailTemplate } from '../utils/email'
import { ctaButton } from '../utils/emailLayout'
import { getTeam } from '../utils/teams'
import { StripeAdapter } from '../utils/gateway/stripe'
import type { OrgRole } from '@linyup/shared'
import { NOTIFICATIONS_SUBCOLLECTION } from '@linyup/shared'

// ─── helpers ──────────────────────────────────────────────────────────────────

async function getPlatformStripeAdapter(): Promise<StripeAdapter> {
  const secretKey = await getSecret('stripe-secret-key')
  return StripeAdapter.withSecretKey(
    { type: 'stripe', publishable_key: '', currency: 'chf' },
    secretKey,
  )
}

async function assertOrgAdmin(uid: string, orgId: string): Promise<void> {
  const memberDoc = await admin.firestore()
    .collection('organizations').doc(orgId)
    .collection('org_members').doc(uid)
    .get()
  if (!memberDoc.exists || memberDoc.data()?.role !== 'org_admin') {
    throw new HttpsError('permission-denied', 'Organization admin access required')
  }
}

function generateSlug(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 50)
}

// ─────────────────────────────────────────────────────────────────────────────
// createOrganization — any authenticated user can create an org
// ─────────────────────────────────────────────────────────────────────────────

export const createOrganization = onCall(async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Authentication required')

  const data = request.data as { name?: string; description?: string }
  if (!data?.name?.trim()) throw new HttpsError('invalid-argument', 'Organization name is required')

  const uid = request.auth.uid
  const name = data.name.trim()
  const db = admin.firestore()

  // Generate a slug, append random suffix if taken
  let slug = generateSlug(name)
  const existing = await db.collection('organizations').where('slug', '==', slug).limit(1).get()
  if (!existing.empty) {
    slug = `${slug}-${Math.random().toString(36).slice(2, 6)}`
  }

  const now = FieldValue.serverTimestamp()
  const trialEndsAt = Timestamp.fromDate(new Date(Date.now() + 14 * 24 * 60 * 60 * 1000))

  const orgRef = db.collection('organizations').doc()
  const batch = db.batch()

  // Org entity
  batch.set(orgRef, {
    name,
    slug,
    description: data.description?.trim() ?? '',
    plan: 'organization',
    plan_status: 'trial',
    trial_ends_at: trialEndsAt,
    created: now,
    createdBy: uid,
  })

  // Creator as org_admin
  batch.set(orgRef.collection('org_members').doc(uid), {
    userId: uid,
    orgId: orgRef.id,
    role: 'org_admin',
    joined: now,
    addedBy: uid,
  })

  // Record orgId on the user profile so the sidebar can find it without a collectionGroup query
  batch.update(db.collection('users').doc(uid), {
    orgIds: FieldValue.arrayUnion(orgRef.id),
  })

  // SaaS subscription record
  batch.set(db.collection('saas_subscriptions').doc(orgRef.id), {
    entity_type: 'org',
    entity_id: orgRef.id,
    teamId: orgRef.id, // backwards compat field
    plan: 'organization',
    status: 'trial',
    trial_ends_at: trialEndsAt,
    current_period_start: null,
    current_period_end: null,
    cancel_at_period_end: false,
    gateway_type: null,
    gateway_data: null,
    created_at: now,
    updated_at: now,
  })

  await batch.commit()
  return { orgId: orgRef.id, slug }
})

// ─────────────────────────────────────────────────────────────────────────────
// inviteTeamToOrg — org admin sends invitation to a team owner
// ─────────────────────────────────────────────────────────────────────────────

export const inviteTeamToOrg = onCall(async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Authentication required')

  const data = request.data as { orgId?: string; teamId?: string; inviteeEmail?: string }
  if (!data?.orgId) throw new HttpsError('invalid-argument', 'orgId is required')
  if (!data.teamId && !data.inviteeEmail) {
    throw new HttpsError('invalid-argument', 'Either teamId or inviteeEmail is required')
  }

  await assertOrgAdmin(request.auth.uid, data.orgId)

  const db = admin.firestore()
  const orgDoc = await db.collection('organizations').doc(data.orgId).get()
  if (!orgDoc.exists) throw new HttpsError('not-found', 'Organization not found')

  const org = orgDoc.data()!
  const expiresAt = Timestamp.fromDate(new Date(Date.now() + 7 * 24 * 60 * 60 * 1000))

  // If inviting by teamId, verify team exists and get owner email
  let inviteeEmail = data.inviteeEmail?.toLowerCase().trim()
  let teamName: string | undefined

  if (data.teamId) {
    const team = await getTeam(data.teamId)
    if (!team) throw new HttpsError('not-found', 'Team not found')
    teamName = team.name

    // Check if already in an org
    if (team.org_id) {
      throw new HttpsError('failed-precondition', 'This team is already part of an organization')
    }

    // Get owner email for invitation
    if (!inviteeEmail) {
      const ownerSnap = await db.collection('teams').doc(data.teamId)
        .collection('team_members').where('role', '==', 'owner').limit(1).get()
      if (!ownerSnap.empty) {
        const ownerDoc = await db.collection('users').doc(ownerSnap.docs[0].id).get()
        inviteeEmail = ownerDoc.data()?.email ?? undefined
      }
    }
  }

  if (!inviteeEmail) {
    throw new HttpsError('invalid-argument', 'Could not determine invitee email address')
  }

  const invRef = await db.collection('organizations').doc(data.orgId)
    .collection('org_invitations').add({
      orgId: data.orgId,
      teamId: data.teamId ?? null,
      inviteeEmail,
      status: 'pending',
      invitedBy: request.auth.uid,
      created: FieldValue.serverTimestamp(),
      expires_at: expiresAt,
    })

  const hostingUrl = getHostingUrl()
  const acceptUrl = `${hostingUrl}/org-invite/${data.orgId}/${invRef.id}`
  const teamLabel = teamName ? `<strong>${teamName}</strong>` : 'your team'

  const { html, text } = buildEmailTemplate({
    title: `Invitation to join ${org.name} on Linyup`,
    body: `
      <p>You have been invited to join ${teamLabel} to the organization <strong>${org.name}</strong> on Linyup.</p>
      <p>By accepting, your team's billing will be managed by the organization and you'll get access to all organization plan features.</p>
      <p style="margin:16px 0;">${ctaButton(acceptUrl, 'Accept Invitation')}</p>
      <p>This invitation expires in 7 days. If you did not expect this, you can safely ignore this email.</p>
    `,
  })

  await sendEmail({
    to: inviteeEmail,
    subject: `Invitation to join ${org.name} on Linyup`,
    html,
    text,
  })

  return { invitationId: invRef.id }
})

// ─────────────────────────────────────────────────────────────────────────────
// acceptOrgInvitation — team owner accepts an org invitation
// ─────────────────────────────────────────────────────────────────────────────

export const acceptOrgInvitation = onCall(async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Authentication required')

  const data = request.data as { invitationId?: string; teamId?: string }
  if (!data?.invitationId || !data?.teamId) {
    throw new HttpsError('invalid-argument', 'invitationId and teamId are required')
  }

  const db = admin.firestore()

  // Load invitation
  const invQuery = await db.collectionGroup('org_invitations')
    .where(admin.firestore.FieldPath.documentId(), '==', data.invitationId)
    .limit(1)
    .get()

  // Fallback: try finding it by path structure
  // (collectionGroup on a known-path subcollection requires a composite index)
  // Instead, search within the orgs the user could be invited to — safer to
  // require orgId in the URL and fetch directly.
  // For now, accept invitationId + orgId as context from the client (passed via the accept page).
  if (invQuery.empty) {
    throw new HttpsError('not-found', 'Invitation not found')
  }

  const invDoc = invQuery.docs[0]
  const inv = invDoc.data()

  if (inv.status !== 'pending') {
    throw new HttpsError('failed-precondition', `Invitation is already ${inv.status}`)
  }
  if (inv.expires_at.toDate() < new Date()) {
    await invDoc.ref.update({ status: 'expired' })
    throw new HttpsError('deadline-exceeded', 'Invitation has expired')
  }

  // Validate caller is owner of the team
  const teamMemberDoc = await db.collection('teams').doc(data.teamId)
    .collection('team_members').doc(request.auth.uid).get()
  if (!teamMemberDoc.exists || teamMemberDoc.data()?.role !== 'owner') {
    throw new HttpsError('permission-denied', 'Only the team owner can accept this invitation')
  }

  const orgId = inv.orgId

  // Load org subscription to propagate plan_status
  const subDoc = await db.collection('saas_subscriptions').doc(orgId).get()
  const orgPlanStatus = subDoc.exists ? (subDoc.data()?.status ?? 'trial') : 'trial'

  const now = FieldValue.serverTimestamp()
  const batch = db.batch()

  // Mark invitation accepted
  batch.update(invDoc.ref, { status: 'accepted', accepted_at: now })

  // Create org_teams entry
  batch.set(
    db.collection('organizations').doc(orgId).collection('org_teams').doc(data.teamId),
    {
      teamId: data.teamId,
      orgId,
      status: 'active',
      joined: now,
      addedBy: request.auth.uid,
    }
  )

  // Link team to org and upgrade its plan
  batch.update(db.collection('teams').doc(data.teamId), {
    org_id: orgId,
    plan: 'organization',
    plan_status: orgPlanStatus,
    updated_at: now,
  })

  await batch.commit()
  return { orgId, teamId: data.teamId }
})

// ─────────────────────────────────────────────────────────────────────────────
// declineOrgInvitation — team owner declines an org invitation
// ─────────────────────────────────────────────────────────────────────────────

export const declineOrgInvitation = onCall(async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Authentication required')

  const data = request.data as { invitationId?: string; orgId?: string }
  if (!data?.invitationId || !data?.orgId) {
    throw new HttpsError('invalid-argument', 'invitationId and orgId are required')
  }

  const invDoc = await admin.firestore()
    .collection('organizations').doc(data.orgId)
    .collection('org_invitations').doc(data.invitationId)
    .get()

  if (!invDoc.exists) throw new HttpsError('not-found', 'Invitation not found')
  if (invDoc.data()?.status !== 'pending') {
    throw new HttpsError('failed-precondition', `Invitation is already ${invDoc.data()?.status}`)
  }

  await invDoc.ref.update({ status: 'declined', declined_at: FieldValue.serverTimestamp() })
  return { success: true }
})

// ─────────────────────────────────────────────────────────────────────────────
// removeTeamFromOrg — org admin removes a team from the organization
// ─────────────────────────────────────────────────────────────────────────────

export const removeTeamFromOrg = onCall(async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Authentication required')

  const data = request.data as { orgId?: string; teamId?: string }
  if (!data?.orgId || !data?.teamId) {
    throw new HttpsError('invalid-argument', 'orgId and teamId are required')
  }

  await assertOrgAdmin(request.auth.uid, data.orgId)

  const db = admin.firestore()
  const orgTeamRef = db.collection('organizations').doc(data.orgId)
    .collection('org_teams').doc(data.teamId)

  const orgTeamDoc = await orgTeamRef.get()
  if (!orgTeamDoc.exists || orgTeamDoc.data()?.status !== 'active') {
    throw new HttpsError('not-found', 'Team is not an active member of this organization')
  }

  const now = FieldValue.serverTimestamp()
  const trialEndsAt = Timestamp.fromDate(new Date(Date.now() + 14 * 24 * 60 * 60 * 1000))

  const batch = db.batch()

  // Mark org_teams entry as removed
  batch.update(orgTeamRef, { status: 'removed', removed_at: now })

  // Reset team to a 14-day grace trial so they can subscribe independently
  batch.update(db.collection('teams').doc(data.teamId), {
    org_id: FieldValue.delete(),
    plan: 'studio',
    plan_status: 'trial',
    trial_ends_at: trialEndsAt,
    updated_at: now,
  })

  await batch.commit()
  return { success: true }
})

// ─────────────────────────────────────────────────────────────────────────────
// createOrgCheckoutSession — org admin initiates Stripe checkout for org plan
// ─────────────────────────────────────────────────────────────────────────────

export const createOrgCheckoutSession = onCall(async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Authentication required')

  const data = request.data as { orgId?: string; locale?: string; origin?: string }
  if (!data?.orgId) throw new HttpsError('invalid-argument', 'orgId is required')

  await assertOrgAdmin(request.auth.uid, data.orgId)

  const { orgId, locale = 'en' } = data

  // Rate limit: max 3 checkout session requests per org per hour
  const oneHourAgo = Timestamp.fromMillis(Date.now() - 60 * 60 * 1000)
  const recentAttempts = await admin.firestore()
    .collection('saas_checkout_attempts')
    .where('teamId', '==', orgId)
    .where('created_at', '>', oneHourAgo)
    .get()
  if (recentAttempts.size >= 3) {
    throw new HttpsError('resource-exhausted', 'Too many checkout requests. Please try again in an hour.')
  }

  const ownerDoc = await admin.firestore().collection('users').doc(request.auth.uid).get()
  const customerEmail: string = ownerDoc.exists ? (ownerDoc.data()!.email ?? '') : ''

  const adapter = await getPlatformStripeAdapter()
  // Same-session redirect → prefer the caller's origin (so local dev returns to
  // localhost), falling back to the env-configured hosting URL.
  const hostingUrl = resolveBaseUrl(data.origin)
  const idempotencyKey = `org-checkout:${orgId}:organization:${Math.floor(Date.now() / 60000)}`

  let session: { url: string; sessionId: string }
  try {
    session = await adapter.createCheckoutSession({
      orgId,
      plan: 'organization',
      customerEmail,
      successUrl: `${hostingUrl}/${locale}/org/${orgId}/billing?checkout=success`,
      cancelUrl: `${hostingUrl}/${locale}/org/${orgId}/billing?checkout=cancelled`,
      idempotencyKey,
    })
  } catch (err) {
    console.error('Org checkout session creation failed:', err)
    throw new HttpsError('internal', 'Failed to create checkout session')
  }

  admin.firestore().collection('saas_checkout_attempts').add({
    teamId: orgId, // reusing field for rate limiting
    plan: 'organization',
    sessionId: session.sessionId,
    created_at: FieldValue.serverTimestamp(),
  }).catch((err) => console.error('Failed to log org checkout attempt:', err))

  return { url: session.url }
})

// ─────────────────────────────────────────────────────────────────────────────
// requestTeamAccess — org admin requests view/manage access to a member team
// ─────────────────────────────────────────────────────────────────────────────

export const requestTeamAccess = onCall(async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Authentication required')

  const data = request.data as { orgId?: string; teamId?: string; accessType?: string }
  if (!data?.orgId || !data?.teamId) throw new HttpsError('invalid-argument', 'orgId and teamId are required')
  if (data.accessType !== 'view' && data.accessType !== 'manage') {
    throw new HttpsError('invalid-argument', 'accessType must be "view" or "manage"')
  }

  await assertOrgAdmin(request.auth.uid, data.orgId)

  const db = admin.firestore()

  // Verify the team is in this org
  const orgTeamDoc = await db.collection('organizations').doc(data.orgId)
    .collection('org_teams').doc(data.teamId).get()
  if (!orgTeamDoc.exists || orgTeamDoc.data()?.status !== 'active') {
    throw new HttpsError('not-found', 'Team is not an active member of this organization')
  }

  const now = FieldValue.serverTimestamp()
  const requestPayload = {
    teamId: data.teamId,
    orgId: data.orgId,
    requestedBy: request.auth.uid,
    requestedAt: now,
    accessType: data.accessType,
    status: 'pending',
  }

  // Write to both sides atomically so the team can see the request in their own settings
  // and the org admin can see it in the org's teams view.
  const batch = db.batch()

  // Org side: one doc per team, idempotent (org admin view)
  batch.set(
    db.collection('organizations').doc(data.orgId).collection('team_access_requests').doc(data.teamId),
    requestPayload,
    { merge: false }
  )

  // Team side: one doc per org, so team managers/owners can discover and approve it
  batch.set(
    db.collection('teams').doc(data.teamId).collection('org_access_requests').doc(data.orgId),
    requestPayload,
    { merge: false }
  )

  await batch.commit()

  // Notifications (in-app + email) are best-effort — failures must not roll back
  // the access request that was already committed above.
  try {
    const [orgDoc, ownerSnap] = await Promise.all([
      db.collection('organizations').doc(data.orgId).get(),
      db.collection('teams').doc(data.teamId)
        .collection('team_members').where('role', '==', 'owner').limit(1).get(),
    ])

    const orgName = (orgDoc.data()?.name ?? data.orgId) as string

    const [requesterDoc, team] = await Promise.all([
      db.collection('users').doc(request.auth.uid).get(),
      getTeam(data.teamId),
    ])
    const requesterName = (requesterDoc.data()?.displayName || requesterDoc.data()?.email || 'An org admin') as string
    const teamName = team?.name ?? data.teamId
    const accessLabel = data.accessType === 'manage' ? 'manage (admin)' : 'view'
    const hostingUrl = getHostingUrl()

    // ── In-app notification (teams/{teamId}/notifications/{id}) ───────────────
    // Written via Admin SDK so Firestore rules for this subcollection deny client
    // writes ("allow write: if false"). All team managers/owners can read via the
    // "allow read: if hasTeamRole(teamId, 'manager')" rule added to firestore.rules.
    const notificationTitle = `Access request from ${orgName}`
    const notificationBody = `${requesterName} (${orgName}) has requested ${accessLabel} access to your studio.`
    await db.collection('teams').doc(data.teamId)
      .collection(NOTIFICATIONS_SUBCOLLECTION).add({
        type: 'org_access_request',
        orgId: data.orgId,
        orgName,
        title: notificationTitle,
        body: notificationBody,
        status: 'unread',
        // requestId: the org-side doc (organizations/{orgId}/team_access_requests/{teamId})
        // and the team-side doc (teams/{teamId}/org_access_requests/{orgId}) both use
        // teamId / orgId as their doc id, so no separate requestId field is needed.
        link: '/settings?tab=org',
        created_at: FieldValue.serverTimestamp(),
      })

    // ── Email notification ────────────────────────────────────────────────────
    if (!ownerSnap.empty) {
      const ownerUserDoc = await db.collection('users').doc(ownerSnap.docs[0].id).get()
      const ownerEmail = ownerUserDoc.data()?.email as string | undefined

      if (ownerEmail) {
        const { html, text } = buildEmailTemplate({
          title: `Access request for ${teamName} on Linyup`,
          body: `
            <p><strong>${requesterName}</strong>, an admin of the organization <strong>${orgName}</strong>,
            has requested <strong>${accessLabel}</strong> access to your team <strong>${teamName}</strong> on Linyup.</p>
            <p>You can review and approve or deny this request in your team's settings.</p>
            <p style="margin:16px 0;">${ctaButton(`${hostingUrl}/settings?tab=org`, 'Review Request')}</p>
          `,
        })

        await sendEmail({ to: ownerEmail, subject: `Access request for ${teamName} on Linyup`, html, text })
      }
    }
  } catch (err) {
    console.error('requestTeamAccess: notification failed (non-fatal):', err)
  }

  return { success: true }
})

// ─────────────────────────────────────────────────────────────────────────────
// getOrgInvitationDetails — public: load invitation for the accept page
// ─────────────────────────────────────────────────────────────────────────────

export const getOrgInvitationDetails = onCall(async (request) => {
  const data = request.data as { invitationId?: string; orgId?: string }
  if (!data?.invitationId || !data?.orgId) {
    throw new HttpsError('invalid-argument', 'invitationId and orgId are required')
  }

  const invDoc = await admin.firestore()
    .collection('organizations').doc(data.orgId)
    .collection('org_invitations').doc(data.invitationId)
    .get()

  if (!invDoc.exists) throw new HttpsError('not-found', 'Invitation not found')

  const inv = invDoc.data()!
  if (inv.status !== 'pending') {
    throw new HttpsError('failed-precondition', `Invitation is already ${inv.status}`)
  }

  const orgDoc = await admin.firestore().collection('organizations').doc(data.orgId).get()
  if (!orgDoc.exists) throw new HttpsError('not-found', 'Organization not found')

  const org = orgDoc.data()!

  let teamName: string | undefined
  if (inv.teamId) {
    const teamDoc = await admin.firestore().collection('teams').doc(inv.teamId).get()
    if (teamDoc.exists) teamName = teamDoc.data()?.name
  }

  return {
    orgId: data.orgId,
    orgName: org.name,
    teamId: inv.teamId ?? null,
    teamName: teamName ?? null,
    inviteeEmail: inv.inviteeEmail,
    expiresAt: inv.expires_at.toDate().toISOString(),
  }
})
