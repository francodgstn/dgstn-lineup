import { readFileSync } from 'node:fs'
import type { UserImportRecord, HashAlgorithmType } from 'firebase-admin/auth'
import type { MigrationConfig } from '../config'
import { sourceAuth, targetAuth } from '../config'

const PAGE_SIZE = 1000

// Shape of a record in the firebase auth:export JSON
interface AuthExportUser {
  localId:      string
  email?:       string
  passwordHash?: string
  salt?:        string
}
interface AuthExport { users?: AuthExportUser[] }

export async function pass00AuthUsers(cfg: MigrationConfig): Promise<void> {
  console.log('Pass 0b: auth users')

  // Build a hash lookup from the export file if provided
  const hashMap = buildHashMap(cfg)
  const hasHashes = hashMap.size > 0

  if (!hasHashes) {
    console.log('  No --source-auth-export provided — users will be created without passwords.')
    console.log('  See MIGRATE-HMD.md for how to preserve original passwords.')
  }

  const src = sourceAuth()
  const tgt = targetAuth()

  let pageToken: string | undefined
  let totalImported = 0
  let totalSkipped  = 0
  let totalErrored  = 0

  do {
    const page = await src.listUsers(PAGE_SIZE, pageToken)
    const active = page.users.filter((u) => !u.disabled)

    if (cfg.dryRun) {
      console.log(`  [dry-run] would import ${active.length} auth users (hashes: ${hasHashes})`)
      totalImported += active.length
      pageToken = page.pageToken
      continue
    }

    if (hasHashes) {
      // importUsers() with SCRYPT — preserves original passwords
      const records: UserImportRecord[] = active.map((u) => {
        const h = hashMap.get(u.uid)
        return {
          uid:           u.uid,
          email:         u.email,
          emailVerified: u.emailVerified,
          displayName:   u.displayName,
          phoneNumber:   u.phoneNumber,
          photoURL:      u.photoURL,
          disabled:      false,
          customClaims:  u.customClaims,
          providerData:  u.providerData,
          ...(h?.passwordHash ? { passwordHash: Buffer.from(h.passwordHash, 'base64') } : {}),
          ...(h?.salt         ? { passwordSalt: Buffer.from(h.salt,         'base64') } : {}),
        }
      })

      const result = await tgt.importUsers(records, {
        hash: {
          algorithm:     'SCRYPT' as HashAlgorithmType,
          key:           Buffer.from(cfg.hashKey!,           'base64'),
          saltSeparator: Buffer.from(cfg.hashSaltSeparator!, 'base64'),
          rounds:        cfg.hashRounds!,
          memoryCost:    cfg.hashMemCost!,
        },
      })
      totalImported += records.length - result.errors.length
      totalErrored  += result.errors.length
      for (const e of result.errors) {
        console.warn(`  WARN uid=${records[e.index]?.uid}: ${e.error.message}`)
      }
    } else {
      // No hashes — createUser() one-by-one (definitely supported by emulator)
      for (const u of active) {
        try {
          await tgt.createUser({
            uid:           u.uid,
            email:         u.email,
            emailVerified: u.emailVerified,
            displayName:   u.displayName,
            phoneNumber:   u.phoneNumber,
            photoURL:      u.photoURL,
          })
          totalImported++
        } catch (e: unknown) {
          const code = (e as { code?: string }).code
          if (code === 'auth/uid-already-exists' || code === 'auth/email-already-exists') {
            totalSkipped++
          } else {
            console.warn(`  WARN uid=${u.uid}: ${(e as Error).message}`)
            totalErrored++
          }
        }
      }
    }

    pageToken = page.pageToken
  } while (pageToken)

  console.log(`  → imported ${totalImported}, skipped ${totalSkipped}, errored ${totalErrored}`)
}

function buildHashMap(cfg: MigrationConfig): Map<string, AuthExportUser> {
  if (!cfg.sourceAuthExport) return new Map()
  const raw  = JSON.parse(readFileSync(cfg.sourceAuthExport, 'utf8')) as AuthExport
  const map  = new Map<string, AuthExportUser>()
  for (const u of raw.users ?? []) map.set(u.localId, u)
  console.log(`  Loaded ${map.size} password hashes from ${cfg.sourceAuthExport}`)
  return map
}
