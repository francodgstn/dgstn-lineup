import { FieldValue } from 'firebase-admin/firestore'
import type { MigrationConfig } from '../config'
import { sourceDb, targetDb, ORG_ID, ORG_NAME } from '../config'

export async function pass00Setup(cfg: MigrationConfig): Promise<void> {
  console.log('Pass 0: org setup')
  const src = sourceDb()
  const tgt = targetDb()

  // Resolve the admin user UID from their email in the source users collection
  const userSnap = await src.collection('users')
    .where('email', '==', cfg.orgAdminEmail)
    .limit(1)
    .get()

  if (userSnap.empty) {
    console.warn(`  WARN: no user found with email ${cfg.orgAdminEmail} — org will be created without a createdBy UID`)
  }

  const adminUid = userSnap.empty ? null : userSnap.docs[0].id
  console.log(`  org admin: ${cfg.orgAdminEmail} → uid=${adminUid ?? 'unknown'}`)

  if (cfg.dryRun) {
    console.log(`  [dry-run] would create organizations/${ORG_ID} and org_members/${adminUid}`)
    return
  }

  // Create the org document (idempotent — skip if already exists)
  const orgRef = tgt.collection('organizations').doc(ORG_ID)
  const orgSnap = await orgRef.get()
  if (orgSnap.exists) {
    console.log(`  organizations/${ORG_ID} already exists — skipping`)
  } else {
    await orgRef.set({
      name:      ORG_NAME,
      slug:      ORG_ID,
      createdBy: adminUid,
      created:   FieldValue.serverTimestamp(),
    })
    console.log(`  created organizations/${ORG_ID}`)
  }

  // Create the org_admin member doc (idempotent)
  if (adminUid) {
    const memberRef = orgRef.collection('org_members').doc(adminUid)
    const memberSnap = await memberRef.get()
    if (memberSnap.exists) {
      console.log(`  org_members/${adminUid} already exists — skipping`)
    } else {
      await memberRef.set({
        userId:  adminUid,
        email:   cfg.orgAdminEmail,
        role:    'org_admin',
        joined:  FieldValue.serverTimestamp(),
      })
      console.log(`  created org_members/${adminUid} (org_admin)`)
    }
  }
}
