import { readFileSync } from 'node:fs'
import { getApp } from 'firebase-admin/app'
import type { UserImportRecord, HashAlgorithmType } from 'firebase-admin/auth'
import type { MigrationConfig } from '../config'
import { sourceAuth, targetAuth } from '../config'

const PAGE_SIZE = 1000

// ─── Identity Toolkit API types ───────────────────────────────────────────────

interface IdentityUser {
  localId:          string
  email?:           string
  emailVerified?:   boolean
  displayName?:     string
  phoneNumber?:     string
  photoUrl?:        string
  passwordHash?:    string   // base64
  salt?:            string   // base64
  providerUserInfo?: Array<{
    providerId:   string
    rawId:        string
    email?:       string
    displayName?: string
    photoUrl?:    string
  }>
  customAttributes?: string
  disabled?:        boolean
}

interface HashConfig {
  algorithm:     string
  signerKey:     string   // base64
  saltSeparator: string   // base64
  rounds:        number
  memoryCost:    number
}

interface BatchGetResponse {
  users?:         IdentityUser[]
  nextPageToken?: string
  hashConfig?:    HashConfig
}

// ─── helpers ─────────────────────────────────────────────────────────────────

async function fetchSourceUsers(sourceCredsPath: string): Promise<{
  users: IdentityUser[]
  hashConfig: HashConfig | undefined
}> {
  const creds     = JSON.parse(readFileSync(sourceCredsPath, 'utf8')) as { project_id: string }
  const projectId = creds.project_id

  // Borrow the access token from the already-initialised source app credential
  const credential = getApp('source').options.credential as {
    getAccessToken(): Promise<{ access_token: string }>
  }

  const allUsers: IdentityUser[]   = []
  let hashConfig: HashConfig | undefined
  let pageToken:  string | undefined

  do {
    const { access_token } = await credential.getAccessToken()

    const res = await fetch('https://identitytoolkit.googleapis.com/v1/accounts:batchGet', {
      method: 'POST',
      headers: {
        Authorization:  `Bearer ${access_token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        targetProjectId: projectId,
        maxResults:      PAGE_SIZE,
        ...(pageToken ? { nextPageToken: pageToken } : {}),
      }),
    })

    if (!res.ok) {
      throw new Error(`Identity Toolkit API ${res.status}: ${await res.text()}`)
    }

    const data = (await res.json()) as BatchGetResponse
    allUsers.push(...(data.users ?? []))
    if (data.hashConfig) hashConfig = data.hashConfig
    pageToken = data.nextPageToken
  } while (pageToken)

  return { users: allUsers, hashConfig }
}

// ─── pass ─────────────────────────────────────────────────────────────────────

export async function pass00AuthUsers(cfg: MigrationConfig): Promise<void> {
  console.log('Pass 0b: auth users')

  if (cfg.dryRun) {
    console.log('  [dry-run] skipping Identity Toolkit API call')
    return
  }

  const { users: sourceUsers, hashConfig } = await fetchSourceUsers(cfg.sourceCredsPath)
  const active = sourceUsers.filter((u) => !u.disabled)
  console.log(`  fetched ${active.length} active users from source (hashes: ${!!hashConfig})`)

  const tgt = targetAuth()
  let totalImported = 0
  let totalSkipped  = 0
  let totalErrored  = 0

  // Chunk into batches of 1000 (importUsers limit)
  for (let i = 0; i < active.length; i += PAGE_SIZE) {
    const chunk = active.slice(i, i + PAGE_SIZE)

    if (hashConfig) {
      // Full import with SCRYPT hashes — preserves original passwords
      const records: UserImportRecord[] = chunk.map((u) => ({
        uid:           u.localId,
        email:         u.email,
        emailVerified: u.emailVerified ?? false,
        displayName:   u.displayName,
        phoneNumber:   u.phoneNumber,
        photoURL:      u.photoUrl,
        disabled:      false,
        customClaims:  u.customAttributes ? JSON.parse(u.customAttributes) : undefined,
        providerData:  u.providerUserInfo?.map((p) => ({
          uid:         p.rawId,
          providerId:  p.providerId,
          email:       p.email,
          displayName: p.displayName,
          photoURL:    p.photoUrl,
        })),
        ...(u.passwordHash ? { passwordHash: Buffer.from(u.passwordHash, 'base64') } : {}),
        ...(u.salt         ? { passwordSalt: Buffer.from(u.salt,         'base64') } : {}),
      }))

      const result = await tgt.importUsers(records, {
        hash: {
          algorithm:     hashConfig.algorithm as HashAlgorithmType,
          key:           Buffer.from(hashConfig.signerKey,     'base64'),
          saltSeparator: Buffer.from(hashConfig.saltSeparator, 'base64'),
          rounds:        hashConfig.rounds,
          memoryCost:    hashConfig.memoryCost,
        },
      })
      totalImported += records.length - result.errors.length
      totalErrored  += result.errors.length
      for (const e of result.errors) {
        console.warn(`  WARN uid=${records[e.index]?.uid}: ${e.error.message}`)
      }
    } else {
      // No hash config returned — fall back to createUser() without password
      for (const u of chunk) {
        try {
          await tgt.createUser({
            uid:           u.localId,
            email:         u.email,
            emailVerified: u.emailVerified ?? false,
            displayName:   u.displayName,
            phoneNumber:   u.phoneNumber,
            photoURL:      u.photoUrl,
          })
          totalImported++
        } catch (e: unknown) {
          const code = (e as { code?: string }).code
          if (code === 'auth/uid-already-exists' || code === 'auth/email-already-exists') {
            totalSkipped++
          } else {
            console.warn(`  WARN uid=${u.localId}: ${(e as Error).message}`)
            totalErrored++
          }
        }
      }
    }
  }

  console.log(`  → imported ${totalImported}, skipped ${totalSkipped}, errored ${totalErrored}`)
  if (!hashConfig) {
    console.warn('  WARN: source returned no hash config — users have no password and cannot sign in with email/password')
  }
}
