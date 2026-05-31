import type { App } from 'firebase-admin/app'
import { initializeApp, cert, getApp } from 'firebase-admin/app'
import type { CollectionReference, CollectionGroup, DocumentReference, Query, Firestore } from 'firebase-admin/firestore'
import { getFirestore } from 'firebase-admin/firestore'

export const ORG_ID = 'hmd'
export const ORG_NAME = 'HMD'

// Ranking system IDs used in dgstn-lineup
export const RANKING_HMD = 'hmd'   // Hwal Moo Do
export const RANKING_KD  = 'kd'    // Korean Dragon

export const EMULATOR_FIRESTORE_HOST = 'localhost:8080'
export const EMULATOR_PROJECT_ID     = 'demo-lineup'

export const DEFAULT_ORG_ADMIN_EMAIL = 'franco.dgstn@gmail.com'

export interface MigrationConfig {
  sourceCredsPath: string
  targetCredsPath?: string   // omitted when targetEmulator is true
  targetEmulator: boolean
  dryRun: boolean
  only?: string
  fromTeam?: string
  orgAdminEmail: string      // email of the user who becomes org creator + org_admin
}

// ─── read-only source type ────────────────────────────────────────────────────
// Exposes only the Firestore query surface — no batch, no runTransaction, no writes.
// This makes misuse a compile-time error and ensures no accidental writes to source.

export interface ReadonlyFirestore {
  collection(path: string): CollectionReference
  collectionGroup(id: string): CollectionGroup
  doc(path: string): DocumentReference
  getAll(...refs: DocumentReference[]): Promise<FirebaseFirestore.DocumentSnapshot[]>
}

const WRITE_METHODS = ['batch', 'bulkWriter', 'runTransaction', 'recursiveDelete'] as const

function asReadonly(db: Firestore): ReadonlyFirestore {
  return new Proxy(db, {
    get(target, prop) {
      if (WRITE_METHODS.includes(prop as typeof WRITE_METHODS[number])) {
        throw new Error(`[source] write operation '${String(prop)}' is not allowed on the source database`)
      }
      const value = target[prop as keyof Firestore]
      return typeof value === 'function' ? value.bind(target) : value
    },
  }) as unknown as ReadonlyFirestore
}

// ─── app init ─────────────────────────────────────────────────────────────────
// Firestore instances are cached eagerly at init time.
// The source instance MUST be obtained before FIRESTORE_EMULATOR_HOST is set,
// otherwise the Admin SDK lazily picks up the env var and routes source reads
// to the local emulator instead of the real Firebase project.

let _sourceDb: ReadonlyFirestore
let _targetDb: Firestore

export function initApps(cfg: MigrationConfig) {
  // 1. Init source app and immediately obtain its Firestore instance,
  //    while FIRESTORE_EMULATOR_HOST is still unset.
  const sourceApp = initializeApp({ credential: cert(cfg.sourceCredsPath) }, 'source')
  _sourceDb = asReadonly(getFirestore(sourceApp))

  // 2. Now it is safe to configure the emulator env var for the target.
  if (cfg.targetEmulator) {
    process.env.FIRESTORE_EMULATOR_HOST = EMULATOR_FIRESTORE_HOST
    const targetApp = initializeApp({ projectId: EMULATOR_PROJECT_ID }, 'target')
    _targetDb = getFirestore(targetApp)
    console.log(`Target: Firestore emulator at ${EMULATOR_FIRESTORE_HOST} (project ${EMULATOR_PROJECT_ID})`)
  } else {
    const targetApp = initializeApp({ credential: cert(cfg.targetCredsPath!) }, 'target')
    _targetDb = getFirestore(targetApp)
  }
}

// sourceDb() returns a read-only proxy — write methods throw at runtime,
// and the return type exposes only the query surface for compile-time safety.
export function sourceDb(): ReadonlyFirestore { return _sourceDb }
export function targetDb(): Firestore         { return _targetDb }
