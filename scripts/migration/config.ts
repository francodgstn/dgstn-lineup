import type { App } from 'firebase-admin/app'
import { initializeApp, cert, getApp } from 'firebase-admin/app'
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
}

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

export function sourceDb() { return getFirestore(getApp('source')) }
export function targetDb() { return getFirestore(getApp('target')) }
