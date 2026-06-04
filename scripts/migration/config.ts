import type { App } from 'firebase-admin/app'
import { initializeApp, cert } from 'firebase-admin/app'
import type { CollectionReference, CollectionGroup, DocumentReference, Firestore } from 'firebase-admin/firestore'
import { getFirestore } from 'firebase-admin/firestore'
import type { Auth } from 'firebase-admin/auth'
import { getAuth } from 'firebase-admin/auth'

export const ORG_ID = 'hmd'
export const ORG_NAME = 'HMD'

// Ranking system IDs used in dgstn-lineup
export const RANKING_HMD = 'hmd'   // Hwal Moo Do
export const RANKING_KD  = 'kd'    // Korean Dragon

// Belt levels — same scale for both HMD and KD disciplines (hardcoded in hmd-lineup)
const HMD_BELT_LEVELS = [
  { value:  0, label: 'No belt',       color: '#AAAAAA' },
  { value:  1, label: 'White',         color: '#DDDDDD' },
  { value:  2, label: 'Yellow',        color: '#FFDC00' },
  { value:  3, label: 'Orange',        color: '#FF851B' },
  { value:  4, label: 'Orange/Green',  color: '#FF851B' },
  { value:  5, label: 'Green',         color: '#1c9c2b' },
  { value:  6, label: 'Green/Blue',    color: '#1c9c2b' },
  { value:  7, label: 'Blue',          color: '#0074D9' },
  { value:  8, label: 'Blue/Red',      color: '#0074D9' },
  { value:  9, label: 'Red',           color: '#d41010' },
  { value: 10, label: 'Red/Black',     color: '#d41010' },
  { value: 11, label: 'Black I Dan',   color: '#111111' },
  { value: 12, label: 'Black II Dan',  color: '#111111' },
  { value: 13, label: 'Black III Dan', color: '#111111' },
  { value: 14, label: 'Master',        color: '#111111' },
]

// Ranking systems to write to organizations/hmd — hardcoded because hmd-lineup
// never persisted these to Firestore; they lived only in the JS app config.
export const HMD_ORG_RANKING_SYSTEMS = [
  { id: RANKING_HMD, name: 'Hwal Moo Do',    is_primary: true,  levels: HMD_BELT_LEVELS },
  { id: RANKING_KD,  name: 'Korean Dragon',  is_primary: false, levels: HMD_BELT_LEVELS },
]

export const EMULATOR_FIRESTORE_HOST = 'localhost:8080'
export const EMULATOR_AUTH_HOST      = 'localhost:9099'
export const EMULATOR_PROJECT_ID     = 'demo-linyup'

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
// Auth and Firestore instances are cached eagerly at init time.
// Source instances MUST be obtained before emulator env vars are set — the
// Admin SDK reads those vars lazily (on first connection), so setting them
// first would silently route source reads to the local emulator.

let _sourceDb:   ReadonlyFirestore
let _targetDb:   Firestore
let _sourceAuth: Auth
let _targetAuth: Auth

export function initApps(cfg: MigrationConfig) {
  // 1. Init source app and immediately lock in its Firestore + Auth instances
  //    while emulator env vars are still unset.
  const sourceApp = initializeApp({ credential: cert(cfg.sourceCredsPath) }, 'source')
  _sourceDb   = asReadonly(getFirestore(sourceApp))
  _sourceAuth = getAuth(sourceApp)

  // 2. Set emulator env vars, then init the target app.
  if (cfg.targetEmulator) {
    process.env.FIRESTORE_EMULATOR_HOST  = EMULATOR_FIRESTORE_HOST
    process.env.FIREBASE_AUTH_EMULATOR_HOST = EMULATOR_AUTH_HOST
    const targetApp = initializeApp({ projectId: EMULATOR_PROJECT_ID }, 'target')
    _targetDb   = getFirestore(targetApp)
    _targetAuth = getAuth(targetApp)
    console.log(`Target: emulator — Firestore ${EMULATOR_FIRESTORE_HOST}, Auth ${EMULATOR_AUTH_HOST}`)
  } else {
    const targetApp = initializeApp({ credential: cert(cfg.targetCredsPath!) }, 'target')
    _targetDb   = getFirestore(targetApp)
    _targetAuth = getAuth(targetApp)
  }

  // Silently drop undefined fields from source docs rather than throwing.
  _targetDb.settings({ ignoreUndefinedProperties: true })
}

export function sourceDb():   ReadonlyFirestore { return _sourceDb }
export function targetDb():   Firestore         { return _targetDb }
export function sourceAuth(): Auth              { return _sourceAuth }
export function targetAuth(): Auth              { return _targetAuth }
