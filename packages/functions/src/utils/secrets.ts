import { SecretManagerServiceClient } from '@google-cloud/secret-manager'

const client = new SecretManagerServiceClient()

const secretCache = new Map<string, { value: string; timestamp: number }>()
const CACHE_TTL = 5 * 60 * 1000

/**
 * Retrieves a secret value.
 *
 * In production → reads from Google Cloud Secret Manager.
 * In the Firebase Functions emulator (FUNCTIONS_EMULATOR=true) → reads from
 * environment variables instead (Secret Manager is unavailable locally).
 *
 * Env-var name convention: secret name uppercased, hyphens → underscores.
 *   e.g. 'stripe-secret-key'     → STRIPE_SECRET_KEY
 *        'stripe-webhook-secret' → STRIPE_WEBHOOK_SECRET
 *
 * Set these in packages/functions/.env.local (loaded automatically by the
 * Functions emulator; never committed to git).
 */
export async function getSecret(secretName: string, version = 'latest'): Promise<string> {
  // ── emulator fallback ────────────────────────────────────────────────────────
  if (process.env.FUNCTIONS_EMULATOR === 'true') {
    const envKey = secretName.replace(/-/g, '_').toUpperCase()
    const value = process.env[envKey]
    if (value) return value
    throw new Error(
      `[emulator] Secret '${secretName}' not found in env. ` +
      `Add ${envKey}=<value> to packages/functions/.env.local`,
    )
  }

  // ── production: Google Cloud Secret Manager ──────────────────────────────────
  const cacheKey = `${secretName}:${version}`
  const now = Date.now()

  if (secretCache.has(cacheKey)) {
    const cached = secretCache.get(cacheKey)!
    if (now - cached.timestamp < CACHE_TTL) return cached.value
    secretCache.delete(cacheKey)
  }

  const projectId = process.env.GCLOUD_PROJECT || process.env.GCP_PROJECT
  if (!projectId) throw new Error('Project ID not found in environment')

  const name = `projects/${projectId}/secrets/${secretName}/versions/${version}`

  try {
    const [accessResponse] = await client.accessSecretVersion({ name })
    const secretValue = accessResponse.payload!.data!.toString()
    secretCache.set(cacheKey, { value: secretValue, timestamp: now })
    return secretValue
  } catch (error) {
    console.error(`Error accessing secret ${secretName}:`, error) // eslint-disable-line no-console
    // CARRY THE CAUSE. This used to rethrow the name alone, which made
    // PERMISSION_DENIED (the runtime SA lacks secretmanager.versions.access),
    // NOT_FOUND (no such secret in this project) and FAILED_PRECONDITION (the
    // container exists but has no enabled version) read identically — three
    // different fixes behind one sentence. A gen1 leftover running as the App
    // Engine SA hit exactly this and looked like an unset secret for days.
    //
    // The gRPC code and message are metadata about the FAILURE, never the
    // payload, so this leaks nothing: the value is only ever in `payload.data`
    // on the success path.
    const cause = error as { code?: number | string; details?: string; message?: string }
    const detail = cause?.details || cause?.message || String(error)
    throw new Error(
      `Failed to access secret: ${secretName}` +
        (cause?.code !== undefined ? ` [gRPC ${cause.code}]` : '') +
        (detail ? ` — ${detail}` : ''),
      { cause: error },
    )
  }
}
