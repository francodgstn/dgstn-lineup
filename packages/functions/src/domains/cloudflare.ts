/**
 * Thin Cloudflare for SaaS client — custom hostnames only.
 *
 * The platform's Cloudflare credential is ONE token for all tenants, held in
 * Secret Manager as `cloudflare-api-token` and scoped to
 * `Zone → SSL and Certificates → Write` on the `linyup.com` zone alone. It
 * deliberately has NO `DNS: Edit`: nothing in this feature writes a DNS record,
 * and withholding that permission is what keeps the zone's MX and DKIM out of
 * reach of anything reachable from a callable. Verified against the live zone —
 * `dns_records` returns "Authentication error" with this token.
 *
 * Design: docs/custom-domains.md. Operator setup: infra/README.md §5d.
 */

import { defineString } from 'firebase-functions/params'
import { getSecret } from '../utils/secrets'

const API = 'https://api.cloudflare.com/client/v4'

export const CLOUDFLARE_ZONE_ID = defineString('CLOUDFLARE_ZONE_ID', {
  description: 'Cloudflare zone id for the SaaS zone (linyup.com) — Overview page, right sidebar',
  default: '',
})

/**
 * The hostname studios point their CNAME at. NOT the fallback origin itself:
 * publishing a stable name in front of it means the origin can be re-pointed,
 * re-regioned or re-architected without asking every studio to edit DNS. Once
 * this string is in tenants' zones it can never change, so it is configuration
 * rather than a constant only to let a non-prod environment differ.
 */
export const CLOUDFLARE_CNAME_TARGET = defineString('CLOUDFLARE_CNAME_TARGET', {
  description: 'Public CNAME target tenants point at (e.g. connect.linyup.com)',
  default: 'connect.linyup.com',
})

export interface CloudflareCustomHostname {
  id: string
  hostname: string
  status: string
  ssl?: { status?: string; validation_errors?: { message: string }[] }
  verification_errors?: string[]
}

interface CloudflareEnvelope<T> {
  success: boolean
  result: T
  errors?: { code: number; message: string }[]
}

export class CloudflareError extends Error {
  constructor(message: string, readonly code?: number) {
    super(message)
    this.name = 'CloudflareError'
  }
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const zoneId = CLOUDFLARE_ZONE_ID.value()
  if (!zoneId) {
    throw new CloudflareError('CLOUDFLARE_ZONE_ID is not configured for this environment')
  }
  const token = await getSecret('cloudflare-api-token')

  const res = await fetch(`${API}/zones/${zoneId}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
  })

  const body = (await res.json()) as CloudflareEnvelope<T>
  if (!body.success) {
    const first = body.errors?.[0]
    throw new CloudflareError(first?.message ?? `Cloudflare request failed (${res.status})`, first?.code)
  }
  return body.result
}

/**
 * Registers a tenant hostname. `method: 'http'` on purpose — with HTTP
 * validation both ownership and certificate issuance fall out of the studio's
 * single CNAME resolving, so the studio adds ONE record instead of a CNAME plus
 * a TXT they have to be walked through.
 *
 * NOTE there is deliberately no `custom_metadata` here. Carrying `{teamId, slug}`
 * on the hostname record would be the tidiest way to tell the edge which tenant
 * a request belongs to, but it is an ENTERPRISE feature — on our plan the create
 * fails outright with code 1413. See docs/custom-domains.md for what replaces it.
 */
export function createCustomHostname(hostname: string): Promise<CloudflareCustomHostname> {
  return call<CloudflareCustomHostname>('/custom_hostnames', {
    method: 'POST',
    body: JSON.stringify({
      hostname,
      ssl: { method: 'http', type: 'dv', settings: { min_tls_version: '1.2' } },
    }),
  })
}

export function getCustomHostname(id: string): Promise<CloudflareCustomHostname> {
  return call<CloudflareCustomHostname>(`/custom_hostnames/${id}`)
}

export function deleteCustomHostname(id: string): Promise<unknown> {
  return call(`/custom_hostnames/${id}`, { method: 'DELETE' })
}

/**
 * Cloudflare's hostname + SSL states, collapsed to the four a studio can act on.
 *
 * The hostname going `active` is NOT the finish line — that only means ownership
 * was verified. Until the certificate is issued the domain still fails to load,
 * so reporting `active` off the hostname alone would tell a studio their domain
 * is live while their visitors see a TLS error.
 */
export function toPublicDomainStatus(
  cf: CloudflareCustomHostname,
): 'pending' | 'verifying' | 'active' | 'error' {
  const ssl = cf.ssl?.status
  if (cf.status === 'active' && ssl === 'active') return 'active'
  if (cf.status === 'active' || ssl === 'pending_validation' || ssl === 'initializing' || ssl === 'pending_issuance' || ssl === 'pending_deployment') {
    return 'verifying'
  }
  if (cf.status === 'pending' || cf.status === 'pending_validation') return 'pending'
  if (cf.status.startsWith('deleted') || cf.status.includes('timed_out') || cf.status === 'moved') return 'error'
  return 'pending'
}

/** The first human-readable problem Cloudflare reports, or null. */
export function firstError(cf: CloudflareCustomHostname): string | null {
  return cf.verification_errors?.[0] ?? cf.ssl?.validation_errors?.[0]?.message ?? null
}
