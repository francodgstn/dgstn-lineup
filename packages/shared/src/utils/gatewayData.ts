import type { SaasSubscription } from '../types/saas'

/** The nested map every reader wants. Never null — an absent gateway is `{}`. */
export type SaasGatewayData = NonNullable<SaasSubscription['gateway_data']>

/**
 * ── A saas_subscriptions doc stores `gateway_data` in TWO shapes ─────────────
 *
 * `set()` takes a dotted key LITERALLY; only `update()` reads it as a field
 * path. The SaaS webhook persists with `set(…, { merge: true })`, so until this
 * was fixed every event it wrote stored TOP-LEVEL fields *named*
 * `"gateway_data.subscription_id"` and never built the map — while eleven
 * readers (the webhook's own idempotency check, the portal / cancel /
 * reactivate / invoices callables, both add-on writers, and three in the ops
 * console) all read the map. Verified against the running emulator, and
 * confirmed on live data: `saas_subscriptions/hmd`, written from event
 * evt_1U4wq0Gz6xwscm1ePB35od9E, carries
 * `"gateway_data.subscription_id": "sub_1Tl8NiGz6xwscm1esVGryAv2"` as a literal
 * field with no map beside it.
 *
 * A genuine nested map exists too — `activatePluginAddon` /
 * `deactivatePluginAddon` write `{ gateway_data: { activeAddOns } }` as a real
 * object, and the seeders and `createOrganization` write `gateway_data: null` —
 * so a single document can carry both halves at once. Reading one shape is how
 * this stayed invisible: the miss returns `undefined`, never an error.
 *
 * ── WHY EVERY READ GOES THROUGH HERE ────────────────────────────────────────
 * The writer now emits the nested map and `scripts/backfill-gateway-data.ts`
 * converges stored docs, but the two land at different moments. Routing reads
 * through one function means correctness never depends on that ordering, and a
 * doc that somehow keeps a literal is read rather than silently ignored.
 *
 * The NESTED value wins per key: it is what the fixed writer produces, so once
 * a document is healed the legacy literal beside it is stale by definition.
 */
export function readGatewayData(
  data: Record<string, unknown> | null | undefined
): SaasGatewayData {
  if (!data) return {}
  const nested = (data.gateway_data ?? {}) as Record<string, unknown>
  const merged: Record<string, unknown> = {}
  const prefix = 'gateway_data.'
  for (const [key, value] of Object.entries(data)) {
    if (key.startsWith(prefix) && value !== undefined) merged[key.slice(prefix.length)] = value
  }
  for (const [key, value] of Object.entries(nested)) {
    if (value !== undefined) merged[key] = value
  }
  return merged as SaasGatewayData
}

/**
 * The legacy dotted-literal keys present on a doc, as full field names ready to
 * hand to `FieldValue.delete()`. Empty for a doc that is already converged.
 */
export function legacyGatewayDataFields(
  data: Record<string, unknown> | null | undefined
): string[] {
  if (!data) return []
  return Object.keys(data).filter((key) => key.startsWith('gateway_data.'))
}
