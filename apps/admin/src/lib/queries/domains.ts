import 'server-only'
import {
  ORGANIZATIONS_COLLECTION,
  PUBLIC_DOMAINS_COLLECTION,
  PUBLIC_DOMAIN_INTEGRATION_DOC,
  TEAMS_COLLECTION,
  TEAM_INTEGRATIONS_SUBCOLLECTION,
  type PublicDomainConfig,
  type PublicDomainStatus,
} from '@linyup/shared'
import { adminDb } from '@/lib/firebase-admin'
import { secretExists, SecretManagerUnavailableError } from '@/lib/secret-manager'

// Custom public domains (Cloudflare for SaaS). Platform-level configuration —
// ONE Cloudflare token and ONE zone serve every tenant, so this is operator
// territory, not per-studio settings. See docs/custom-domains.md.

/** Secret Manager name, matching what the Cloud Functions read via getSecret(). */
export const CLOUDFLARE_API_TOKEN_SECRET = 'cloudflare-api-token'

export interface CustomDomainPlatformStatus {
  tokenConfigured: boolean
  zoneId: string | null
  cnameTarget: string | null
}

async function isSecretConfigured(secretName: string): Promise<boolean> {
  try {
    return await secretExists(secretName)
  } catch (err) {
    if (err instanceof SecretManagerUnavailableError) return false
    throw err
  }
}

/**
 * Whether the platform is wired up to register domains at all.
 *
 * The zone id and CNAME target are Cloud Functions params, not console config —
 * they are read here from the console's own env only so an operator can SEE
 * what is configured. A blank value means "not set for this console", which is
 * not the same as "not set for the functions"; the copy says so rather than
 * implying a fault.
 */
export async function getCustomDomainPlatformStatus(): Promise<CustomDomainPlatformStatus> {
  const tokenConfigured = await isSecretConfigured(CLOUDFLARE_API_TOKEN_SECRET)
  return {
    tokenConfigured,
    zoneId: process.env.CLOUDFLARE_ZONE_ID || null,
    cnameTarget: process.env.CLOUDFLARE_CNAME_TARGET || null,
  }
}

export interface CustomDomainRow {
  hostname: string
  scope: 'team' | 'org'
  entityId: string
  entityName: string | null
  status: PublicDomainStatus | 'unknown'
  sslStatus: string | null
  error: string | null
  lastCheckedAt: string | null
}

function toIso(value: unknown): string | null {
  const ts = value as { toDate?: () => Date } | undefined
  return ts?.toDate ? ts.toDate().toISOString() : null
}

/**
 * Every custom domain across every tenant, newest claim first.
 *
 * Driven off the `public_domains` registry rather than a collection-group query
 * over `integrations`: the registry is the one place that is guaranteed to hold
 * a row per claimed hostname, it needs no composite index, and a hostname that
 * appears here with NO matching tenant config is itself worth seeing — that is
 * a stranded claim, and it is exactly the state that stops a studio re-adding
 * their own domain.
 */
export async function listCustomDomains(limit = 200): Promise<CustomDomainRow[]> {
  const claims = await adminDb
    .collection(PUBLIC_DOMAINS_COLLECTION)
    .orderBy('created_at', 'desc')
    .limit(limit)
    .get()

  if (claims.empty) return []

  const rows = await Promise.all(
    claims.docs.map(async (claim) => {
      const data = claim.data() as { hostname?: string; scope?: 'team' | 'org'; entityId?: string }
      const scope = data.scope === 'org' ? 'org' : 'team'
      const entityId = data.entityId ?? ''
      const collection = scope === 'team' ? TEAMS_COLLECTION : ORGANIZATIONS_COLLECTION

      const [configSnap, entitySnap] = await Promise.all([
        entityId
          ? adminDb
              .collection(collection)
              .doc(entityId)
              .collection(TEAM_INTEGRATIONS_SUBCOLLECTION)
              .doc(PUBLIC_DOMAIN_INTEGRATION_DOC)
              .get()
          : null,
        entityId ? adminDb.collection(collection).doc(entityId).get() : null,
      ])

      const config = configSnap?.exists ? (configSnap.data() as PublicDomainConfig) : null

      return {
        hostname: data.hostname ?? claim.id,
        scope,
        entityId,
        entityName: (entitySnap?.data()?.name as string | undefined) ?? null,
        status: config?.status ?? 'unknown',
        sslStatus: config?.ssl_status ?? null,
        error: config?.error ?? null,
        lastCheckedAt: toIso(config?.last_checked_at),
      } satisfies CustomDomainRow
    }),
  )

  return rows
}
