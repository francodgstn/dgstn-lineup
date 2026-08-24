import * as admin from 'firebase-admin'
import { isReservedSlug } from '@linyup/shared'
import { onCall, HttpsError } from 'firebase-functions/v2/https'

export const validateTeamSlug = onCall(async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Not authenticated')

  const { slug, teamId } = request.data as { slug: string; teamId?: string }
  if (!slug) throw new HttpsError('invalid-argument', 'Slug is required')

  const normalized = slug.toLowerCase().trim().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '')

  if (normalized.length < 3) return { available: false, reason: 'Slug must be at least 3 characters' }
  if (normalized.length > 50) return { available: false, reason: 'Slug must be at most 50 characters' }

  // Reject reserved route segments that would collide with public URL structure
  if (isReservedSlug(normalized)) {
    return { available: false, reason: 'This URL is reserved and cannot be used' }
  }

  const snap = await admin.firestore().collection('teams').where('slug', '==', normalized).limit(1).get()

  if (!snap.empty && snap.docs[0].id !== teamId) {
    return { available: false, reason: 'This URL is already taken' }
  }

  return { available: true, normalizedSlug: normalized }
})
