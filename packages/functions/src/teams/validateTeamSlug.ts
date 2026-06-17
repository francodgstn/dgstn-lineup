import * as admin from 'firebase-admin'
import { isReservedSlug } from '@linyup/shared'
import { regionalFunctions } from '../utils/functions'

export const validateTeamSlug = regionalFunctions.https.onCall(
  async (data: { slug: string; teamId?: string }, context) => {
    if (!context.auth) throw new (await import('firebase-functions')).https.HttpsError('unauthenticated', 'Not authenticated')

    const { slug, teamId } = data
    if (!slug) throw new (await import('firebase-functions')).https.HttpsError('invalid-argument', 'Slug is required')

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
  }
)
