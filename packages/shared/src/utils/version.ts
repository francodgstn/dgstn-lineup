// Version comparison for the member app's minimum-version gate
// (`app_settings/mobile.min_supported_version`, MobileAppSettings). Client-safe,
// dependency-free — the Expo app and the operator console both read it.
//
// Tolerant on purpose: `1.2` reads as 1.2.0, a leading `v` and any prerelease
// or build suffix (`1.2.3-beta.1`, `1.2.3+42`) are ignored, and anything
// unparseable makes `isVersionBelow` answer FALSE — the gate FAILS OPEN. A typo
// in a settings document must never lock every member out of the app; the
// worst case of failing open is that an old build keeps running.

export type VersionTriple = [major: number, minor: number, patch: number]

export function parseVersion(v: string | null | undefined): VersionTriple | null {
  if (typeof v !== 'string') return null
  const m = v.trim().match(/^v?(\d+)(?:\.(\d+))?(?:\.(\d+))?(?:[-+][0-9A-Za-z.-]*)?$/)
  if (!m) return null
  return [Number(m[1]), Number(m[2] ?? 0), Number(m[3] ?? 0)]
}

/** -1 when a < b, 0 when equal, 1 when a > b. Throws on an unparseable input —
 *  callers that must not throw go through `isVersionBelow`. */
export function compareVersions(a: string, b: string): -1 | 0 | 1 {
  const pa = parseVersion(a)
  const pb = parseVersion(b)
  if (!pa || !pb) throw new Error(`compareVersions: unparseable version (${a} vs ${b})`)
  for (let i = 0; i < 3; i++) {
    if (pa[i] < pb[i]) return -1
    if (pa[i] > pb[i]) return 1
  }
  return 0
}

/** True only when BOTH parse and `current` is strictly older than `minimum`.
 *  Every other case — either side missing or malformed — is false (fail open). */
export function isVersionBelow(
  current: string | null | undefined,
  minimum: string | null | undefined
): boolean {
  const c = parseVersion(current)
  const m = parseVersion(minimum)
  if (!c || !m) return false
  for (let i = 0; i < 3; i++) {
    if (c[i] < m[i]) return true
    if (c[i] > m[i]) return false
  }
  return false
}
