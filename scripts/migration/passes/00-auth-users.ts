import type { UserImportRecord } from 'firebase-admin/auth'
import type { MigrationConfig } from '../config'
import { sourceAuth, targetAuth, EMULATOR_TEST_PASSWORD } from '../config'

const PAGE_SIZE = 1000

export async function pass00AuthUsers(cfg: MigrationConfig): Promise<void> {
  console.log('Pass 0b: auth users')
  const src = sourceAuth()
  const tgt = targetAuth()

  let pageToken: string | undefined
  let totalImported = 0
  let totalErrored  = 0

  do {
    const page = await src.listUsers(PAGE_SIZE, pageToken)
    const active = page.users.filter((u) => !u.disabled)

    const records: UserImportRecord[] = active.map((u) => ({
      uid:           u.uid,
      email:         u.email,
      emailVerified: u.emailVerified,
      displayName:   u.displayName,
      phoneNumber:   u.phoneNumber,
      photoURL:      u.photoURL,
      disabled:      false,
      customClaims:  u.customClaims,
      // providerData carries Google / Apple sign-in links
      providerData:  u.providerData,
    }))

    if (cfg.dryRun) {
      console.log(`  [dry-run] would import ${records.length} auth users`)
      totalImported += records.length
    } else if (records.length > 0) {
      const result = await tgt.importUsers(records)
      const imported = records.length - result.errors.length
      totalImported += imported
      totalErrored  += result.errors.length
      for (const e of result.errors) {
        console.warn(`  WARN uid=${records[e.index]?.uid}: ${e.error.message}`)
      }

      // Emulator only: set a known test password so accounts are actually usable.
      // Production passwords are preserved by importUsers when the source export
      // includes SCRYPT hashes (CLI flow: firebase auth:export / auth:import).
      if (cfg.targetEmulator) {
        for (const r of records) {
          if (!r.uid || !r.email) continue
          try {
            await tgt.updateUser(r.uid, { password: EMULATOR_TEST_PASSWORD })
          } catch {
            // non-fatal — user may not support email/password sign-in
          }
        }
      }
    }

    pageToken = page.pageToken
  } while (pageToken)

  console.log(`  → imported ${totalImported}, errored ${totalErrored}`)
  if (cfg.targetEmulator) {
    console.log(`  All accounts usable with password: "${EMULATOR_TEST_PASSWORD}"`)
  } else {
    console.log('  NOTE: passwords not migrated via Admin SDK. To preserve them, run:')
    console.log('    firebase --project hmd-lineup auth:export hmd-users.json')
    console.log('    firebase --project <target> auth:import hmd-users.json --hash-algo=SCRYPT ...')
  }
}
