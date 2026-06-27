/* eslint-disable no-console */
import * as admin from 'firebase-admin'
import { Timestamp, FieldValue } from 'firebase-admin/firestore'
import { onCall, HttpsError } from 'firebase-functions/v2/https'
import { getTeam } from '../utils/teams'
import { sendEmail, buildEmailTemplate } from '../utils/email'
import { assertVerifiableCode } from './verificationCode'
import { to } from '../utils/async'
import {
  CONTACTS_COLLECTION,
  CONTACT_AFFILIATIONS_SUBCOLLECTION,
  AFFILIATION_TYPES_SUBCOLLECTION,
  TEAMS_COLLECTION,
  planSupportsAffiliations,
  normalizeEmail,
  type AffiliationType,
} from '@linyup/shared'


// ─────────────────────────────────────────────────────────────────────────────
// verifyMembershipCode
// ─────────────────────────────────────────────────────────────────────────────

export const verifyMembershipCode = onCall(async (request) => {
  const data = request.data as { codeId?: string; code?: string }

  if (!data?.codeId || !data?.code) {
    throw new HttpsError('invalid-argument', 'codeId and code are required')
  }

  if (!/^\d{6}$/.test(data.code)) {
    throw new HttpsError('invalid-argument', 'Code must be 6 digits')
  }

  const codeRef = admin.firestore().collection('verification_codes').doc(data.codeId)
  const codeData = await assertVerifiableCode(codeRef, data.code)

  return { verified: true, email: codeData.email, teamId: codeData.team_id }
})

// ─────────────────────────────────────────────────────────────────────────────
// completeMembershipSignup
// ─────────────────────────────────────────────────────────────────────────────

export const completeMembershipSignup = onCall(async (request) => {
  const data = request.data as {
    codeId?: string
    contactDetails?: {
      firstname: string
      lastname: string
      phone?: string
      birthdate?: string
      notes?: string
      privacyConsent: boolean
    }
  }

  if (!data?.codeId || !data?.contactDetails) {
    throw new HttpsError('invalid-argument', 'codeId and contactDetails are required')
  }

  const { contactDetails } = data

  if (!contactDetails.firstname || !contactDetails.lastname) {
    throw new HttpsError('invalid-argument', 'firstname and lastname are required')
  }

  if (!contactDetails.privacyConsent) {
    throw new HttpsError('failed-precondition', 'Privacy consent is required')
  }

  const codeRef = admin.firestore().collection('verification_codes').doc(data.codeId)
  const codeDoc = await codeRef.get()
  if (!codeDoc.exists) throw new HttpsError('not-found', 'Invalid verification code')

  const codeData = codeDoc.data()!

  if (!codeData.verified) {
    throw new HttpsError('failed-precondition', 'Email not verified. Please verify your email first.')
  }
  if (codeData.used) {
    throw new HttpsError('already-exists', 'This verification code has already been used')
  }

  const email: string = codeData.email
  const teamId: string = codeData.team_id

  const team = await getTeam(teamId)
  if (!team) throw new HttpsError('not-found', 'Team not found')

  const teamName = team.name || 'Team'

  // Get owner emails for notification
  const ownersSnap = await admin.firestore().collection('teams').doc(teamId).collection('team_members').where('role', '==', 'owner').get()
  const ownerEmails: string[] = []
  for (const memberDoc of ownersSnap.docs) {
    const userDoc = await admin.firestore().collection('users').doc(memberDoc.id).get()
    if (userDoc.exists) {
      const ownerEmail = userDoc.get('email')
      if (ownerEmail) ownerEmails.push(ownerEmail)
    }
  }

  const sanitized = {
    firstname: contactDetails.firstname.trim(),
    lastname: contactDetails.lastname.trim(),
    phone: contactDetails.phone?.trim() || null,
    birthdate: contactDetails.birthdate ? Timestamp.fromDate(new Date(contactDetails.birthdate)) : null,
    notes: contactDetails.notes?.trim() || null,
  }

  // Resolve-or-create. A 'full'-mode shop purchase already created a pending-signup
  // contact (the Connect webhook); finalizing must UPDATE that contact, not fork a
  // duplicate. Email is NOT unique in Linyup (a parent address may control several
  // child contacts), so match all active contacts by team+email and pick deliberately.
  const db = admin.firestore()
  const normEmail = normalizeEmail(email)
  const matchSnap = await db
    .collection(CONTACTS_COLLECTION)
    .where('teamId', '==', teamId)
    .where('email', '==', normEmail)
    .get()
  const activeMatches = matchSnap.docs.filter((d) => {
    const c = d.data()
    return c.archived_at == null && c.deleted_at == null
  })

  // The profile fields the buyer just filled — written on both finalize and create.
  // pending_signup/signup_completed_at flip the contact from "paid, awaiting signup"
  // to fully signed.
  const profile = {
    firstname: sanitized.firstname,
    lastname: sanitized.lastname,
    email: normEmail,
    phone: sanitized.phone,
    birthdate: sanitized.birthdate,
    notes: sanitized.notes,
    pending_signup: false,
    signup_completed_at: FieldValue.serverTimestamp(),
  }

  let contactRef: admin.firestore.DocumentReference
  if (activeMatches.length === 0) {
    // No prior contact (minimal/off purchase, or signup without a purchase) — create.
    contactRef = db.collection(CONTACTS_COLLECTION).doc()
    await contactRef.set({
      ...profile,
      // Birth facts set on CREATE only; a finalize of an existing contact preserves
      // whatever stage/entry it already carries. The approval pipeline (requested →
      // active) lives on the affiliation axis, not here.
      acquisition_stage: 'joined',
      acquisition_stage_updated_at: FieldValue.serverTimestamp(),
      converted_at: FieldValue.serverTimestamp(),
      entry: 'signup',
      teamId,
      archived_at: null,
      deleted_at: null,
      created_at: FieldValue.serverTimestamp(),
    })
  } else {
    // Finalize the existing contact. >1 active match (shared family email) → newest;
    // never overwrite the birth facts (acquisition_stage/entry/converted_at) it holds.
    if (activeMatches.length > 1) {
      activeMatches.sort(
        (a, b) => (b.data().created_at?.toMillis?.() ?? 0) - (a.data().created_at?.toMillis?.() ?? 0),
      )
      console.log(
        `[completeMembershipSignup] ${activeMatches.length} contacts share ${normEmail} (team=${teamId}) — finalizing newest ${activeMatches[0].id}`,
      )
    }
    contactRef = activeMatches[0].ref
    await contactRef.set(profile, { merge: true })
  }
  const contactId = contactRef.id

  // ── Create a PENDING affiliation (if affiliations are enabled + plan allows) ──
  // Best-effort: signup must not fail if the affiliation catalog is missing.
  try {
    if (team.affiliations_enabled && planSupportsAffiliations(team.plan ?? null)) {
      // Find the first active affiliation type in the team's catalog.
      // Prefer org-issued types if the team belongs to an org; else team-local.
      let affiliationTypeId: string | null = null
      let affiliationIssuer: 'team' | 'org' = 'team'
      let affiliationOrgId: string | undefined

      if (team.org_id) {
        const [, orgTypesSnap] = await to(
          db
            .collection('organizations')
            .doc(team.org_id)
            .collection(AFFILIATION_TYPES_SUBCOLLECTION)
            .where('active', '!=', false)
            .limit(1)
            .get(),
        )
        if (orgTypesSnap && !orgTypesSnap.empty) {
          const t = orgTypesSnap.docs[0].data() as AffiliationType
          affiliationTypeId = orgTypesSnap.docs[0].id
          affiliationIssuer = 'org'
          affiliationOrgId = team.org_id
          void t // used above for type narrowing
        }
      }

      if (!affiliationTypeId) {
        const [, teamTypesSnap] = await to(
          db
            .collection(TEAMS_COLLECTION)
            .doc(teamId)
            .collection(AFFILIATION_TYPES_SUBCOLLECTION)
            .where('active', '!=', false)
            .limit(1)
            .get(),
        )
        if (teamTypesSnap && !teamTypesSnap.empty) {
          affiliationTypeId = teamTypesSnap.docs[0].id
          affiliationIssuer = 'team'
        }
      }

      if (affiliationTypeId) {
        // Idempotent: when finalizing an existing contact, don't stack a second pending
        // affiliation of the same type if one is already active or requested.
        const [, existingAffSnap] = await to(
          contactRef
            .collection(CONTACT_AFFILIATIONS_SUBCOLLECTION)
            .where('affiliation_type_id', '==', affiliationTypeId)
            .where('status_id', 'in', ['requested', 'active'])
            .limit(1)
            .get(),
        )
        if (existingAffSnap && !existingAffSnap.empty) {
          console.log(
            `[completeMembershipSignup] affiliation of type ${affiliationTypeId} already present for contact ${contactId}, skipping`,
          )
        } else {
          const affRef = contactRef.collection(CONTACT_AFFILIATIONS_SUBCOLLECTION).doc()
          await affRef.set({
            id: affRef.id,
            teamId,
            affiliation_type_id: affiliationTypeId,
            issuer: affiliationIssuer,
            ...(affiliationOrgId ? { org_id: affiliationOrgId } : {}),
            status_id: 'requested',
            active: false, // 'requested' countsAsActive=false
            created_by: null,
            created_at: FieldValue.serverTimestamp(),
            updated_at: FieldValue.serverTimestamp(),
          })
          console.log(`[completeMembershipSignup] created pending affiliation for contact ${contactId}`)
        }
      } else {
        console.log(`[completeMembershipSignup] no affiliation types found for team ${teamId}, skipping`)
      }
    }
  } catch (err) {
    // Non-fatal: contact is already created; affiliation is best-effort
    console.error('[completeMembershipSignup] affiliation creation failed (non-fatal):', err)
  }

  // Mark code as used
  await codeRef.update({ used: true, usedAt: FieldValue.serverTimestamp(), contactId })

  // Send welcome email
  try {
    const { html, text } = buildEmailTemplate({
      title: `Welcome to ${teamName}!`,
      body: `<p>Hi ${sanitized.firstname},</p><p>Thanks for signing up with <strong>${teamName}</strong>. Your membership request has been received and is under review.</p><p>We'll be in touch soon.</p>`,
    })
    await sendEmail({ to: email, subject: `Welcome to ${teamName}!`, html, text, teamId })
    console.log(`Welcome email sent to ${email}`)
  } catch (err) {
    console.error('Error sending welcome email:', err)
  }

  // Notify owners
  for (const ownerEmail of ownerEmails) {
    try {
      const { html, text } = buildEmailTemplate({
        title: `New Member Signup: ${sanitized.firstname} ${sanitized.lastname}`,
        body: `<p>A new membership request has been submitted.</p><p><strong>Name:</strong> ${sanitized.firstname} ${sanitized.lastname}</p><p><strong>Email:</strong> ${email}</p>${sanitized.phone ? `<p><strong>Phone:</strong> ${sanitized.phone}</p>` : ''}`,
      })
      await sendEmail({ to: ownerEmail, subject: `New Member Signup: ${sanitized.firstname} ${sanitized.lastname}`, html, text, teamId })
    } catch (err) {
      console.error('Error sending owner notification:', err)
    }
  }

  return { success: true, contactId }
})
