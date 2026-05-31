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

let sourceApp: App
let targetApp: App

export function initApps(cfg: MigrationConfig) {
  sourceApp = initializeApp({ credential: cert(cfg.sourceCredsPath) }, 'source')

  if (cfg.targetEmulator) {
    // Must be set before initializeApp so the Admin SDK routes to the emulator
    process.env.FIRESTORE_EMULATOR_HOST = EMULATOR_FIRESTORE_HOST
    targetApp = initializeApp({ projectId: EMULATOR_PROJECT_ID }, 'target')
    console.log(`Target: Firestore emulator at ${EMULATOR_FIRESTORE_HOST} (project ${EMULATOR_PROJECT_ID})`)
  } else {
    targetApp = initializeApp({ credential: cert(cfg.targetCredsPath!) }, 'target')
  }
}

// sourceDb() returns a read-only proxy — write methods throw at runtime,
// and the return type exposes only the query surface for compile-time safety.
export function sourceDb(): ReadonlyFirestore { return asReadonly(getFirestore(getApp('source'))) }
export function targetDb(): Firestore         { return getFirestore(getApp('target')) }
