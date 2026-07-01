// Shared plugin teardown helpers.
// Called from onInstalledPluginStatusChange (trigger) and downgradeTeamToFree
// (saas-billing) so teardown logic is never duplicated.
import * as admin from 'firebase-admin'
import { FieldValue } from 'firebase-admin/firestore'
import {
  SITE_PUBLISHED_COLLECTION,
  SITE_DRAFTS_COLLECTION,
  COURSES_COLLECTION,
  DOCUMENTS_COLLECTION,
} from '@linyup/shared'

/**
 * Removes the public site snapshot and flags the site draft as disabled.
 * Mirrors the core of unpublishWebsite callable (website/index.ts) without
 * the auth/RBAC guards that are only relevant for the user-facing callable.
 */
export async function unpublishSiteForTeam(teamId: string): Promise<void> {
  const db = admin.firestore()
  await db.doc(`${SITE_PUBLISHED_COLLECTION}/${teamId}`).delete()
  await db.doc(`${SITE_DRAFTS_COLLECTION}/${teamId}`).set(
    { enabled: false, updated_at: FieldValue.serverTimestamp() },
    { merge: true }
  )
}

/**
 * Batch-deletes every courses/{courseId}/public_profile/{courseId} summary
 * belonging to the team, effectively unpublishing all course listings.
 * Mirrors what syncCoursePublicProfile does for a single course on delete/
 * unpublish, applied to all courses of the team at once.
 */
export async function deleteAllCoursePublicProfiles(teamId: string): Promise<void> {
  const db = admin.firestore()
  // Fetch all courses for the team (no status filter — removes all summaries
  // regardless of current status, since the plugin is no longer active).
  const coursesSnap = await db
    .collection(COURSES_COLLECTION)
    .where('teamId', '==', teamId)
    .get()

  if (coursesSnap.empty) return

  // Firestore batches are capped at 500 ops. Split into chunks.
  const BATCH_SIZE = 400
  const docs = coursesSnap.docs
  for (let i = 0; i < docs.length; i += BATCH_SIZE) {
    const batch = db.batch()
    for (const courseDoc of docs.slice(i, i + BATCH_SIZE)) {
      const profileRef = courseDoc.ref.collection('public_profile').doc(courseDoc.id)
      batch.delete(profileRef)
    }
    await batch.commit()
  }
}

/**
 * Batch-deletes every documents/{documentId}/public_profile/{documentId} summary
 * belonging to the team, effectively unpublishing all public documents. Mirrors
 * what syncDocumentPublicProfile does for a single document on delete/unpublish,
 * applied to all of the team's documents at once when the plugin is removed.
 */
export async function deleteAllDocumentPublicProfiles(teamId: string): Promise<void> {
  const db = admin.firestore()
  const docsSnap = await db
    .collection(DOCUMENTS_COLLECTION)
    .where('teamId', '==', teamId)
    .get()

  if (docsSnap.empty) return

  const BATCH_SIZE = 400
  const docs = docsSnap.docs
  for (let i = 0; i < docs.length; i += BATCH_SIZE) {
    const batch = db.batch()
    for (const docDoc of docs.slice(i, i + BATCH_SIZE)) {
      const profileRef = docDoc.ref.collection('public_profile').doc(docDoc.id)
      batch.delete(profileRef)
    }
    await batch.commit()
  }
}
