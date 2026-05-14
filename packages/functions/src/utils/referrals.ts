import * as admin from 'firebase-admin'
import crypto from 'crypto'

const REFERRAL_CODE_LENGTH = 7
const REFERRAL_CODE_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
const MAX_COLLISION_RETRIES = 5

export async function generateReferralCode(): Promise<string> {
  const db = admin.firestore()
  for (let attempt = 0; attempt < MAX_COLLISION_RETRIES; attempt++) {
    const bytes = crypto.randomBytes(REFERRAL_CODE_LENGTH)
    let code = ''
    for (let i = 0; i < REFERRAL_CODE_LENGTH; i++) {
      code += REFERRAL_CODE_CHARS[bytes[i] % REFERRAL_CODE_CHARS.length]
    }
    const existing = await db.collection('referral_codes').doc(code).get()
    if (!existing.exists) return code
  }
  throw new Error('Failed to generate unique referral code after max retries')
}

export async function ensureReferralCode(contactId: string, teamId: string): Promise<string> {
  const db = admin.firestore()
  const contactRef = db.collection('contacts').doc(contactId)
  const contactSnap = await contactRef.get()
  if (!contactSnap.exists) throw new Error(`Contact ${contactId} not found`)
  const existingCode: string | undefined = contactSnap.data()!.referral_code
  if (existingCode) return existingCode
  const code = await generateReferralCode()
  const batch = db.batch()
  batch.update(contactRef, { referral_code: code })
  batch.set(db.collection('referral_codes').doc(code), {
    contactId,
    teamId,
    created_at: admin.firestore.FieldValue.serverTimestamp(),
  })
  await batch.commit()
  return code
}

export async function resolveReferralCode(code: string): Promise<{ contactId: string; teamId: string } | null> {
  const db = admin.firestore()
  const doc = await db.collection('referral_codes').doc(code).get()
  if (!doc.exists) return null
  const data = doc.data()!
  return { contactId: data.contactId as string, teamId: data.teamId as string }
}

export async function createReferral(referrerContactId: string, referredContactId: string, teamId: string): Promise<string> {
  const db = admin.firestore()
  const now = admin.firestore.FieldValue.serverTimestamp()
  const referralRef = db.collection('referrals').doc()
  await referralRef.set({
    referrer_contact_id: referrerContactId,
    referred_contact_id: referredContactId,
    team_id: teamId,
    status: 'friend_booked',
    reward: null,
    reward_notes: null,
    created_at: now,
    updated_at: now,
    status_history: [{ status: 'friend_booked', changed_at: new Date().toISOString(), changed_by: 'system' }],
  })
  return referralRef.id
}

export async function updateReferralStatus(
  referralId: string,
  newStatus: string,
  changedBy: string,
  rewardData: { reward_type: string; reward_amount: number } | null = null,
  rewardNotes: string | null = null,
): Promise<void> {
  const db = admin.firestore()
  const update: Record<string, unknown> = {
    status: newStatus,
    updated_at: admin.firestore.FieldValue.serverTimestamp(),
    status_history: admin.firestore.FieldValue.arrayUnion({
      status: newStatus,
      changed_at: new Date().toISOString(),
      changed_by: changedBy,
    }),
  }
  if (rewardData) update.reward = rewardData
  if (rewardNotes !== null) update.reward_notes = rewardNotes
  await db.collection('referrals').doc(referralId).update(update)
}
