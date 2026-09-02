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
/**
 * EVERY RETURN PATH IS TRIMMED, and that is load-bearing rather than tidy.
 *
 * A secret is an opaque token — an API key, a webhook signing secret, a
 * password. None of them has meaningful leading or trailing whitespace, so
 * trimming can only ever remove damage. What it removes is the damage a human
 * does when storing one: `gcloud secrets versions add` stores the bytes it is
 * given, so a value pasted or piped from a Windows editor arrives with a
 * trailing CRLF and looks perfectly correct in every console that renders it.
 *
 * The failure that follows is silent and reads as something else entirely. A
 * key with a `\r` in it is fed to `new Stripe(key)`, becomes the
 * `Authorization: Bearer …` header, and Node's ClientRequest refuses it —
 * `ERR_INVALID_CHAR`, thrown from the HTTP layer with no mention of secrets.
 * On 2026-08-31 that was every Stripe call in the sandbox: Settings → Payments
 * rendered its "Start setup" state (getConnectStatus caught the throw), and
 * every checkout would have died at the callable, while the public shop kept
 * showing prices because it reads the Firestore mirror and calls no API. A
 * whole environment could not take a payment, and the surface looked healthy.
 *
 * Trim here rather than at each call site: this is the ONE door every secret
 * comes through, and a per-consumer trim is a rule that only holds until the
 * next consumer forgets it.
 */
export async function getSecret(secretName: string, version = 'latest'): Promise<string> {
  // ── emulator fallback ────────────────────────────────────────────────────────
  if (process.env.FUNCTIONS_EMULATOR === 'true') {
    const envKey = secretName.replace(/-/g, '_').toUpperCase()
    // Trimmed for the same reason as the Secret Manager path below — a value
    // pasted into packages/functions/.env.local carries whatever the editor
    // put there, and a trailing CR breaks the emulator identically.
    const value = process.env[envKey]?.trim()
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
    // Trim BEFORE caching, so a warm instance cannot serve the damaged value
    // for the rest of the cache window.
    const secretValue = accessResponse.payload!.data!.toString().trim()
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
