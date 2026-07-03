import * as crypto from 'crypto'

// Constant-time string comparison for shared secrets / bearer tokens.
//
// A plain `a === b` short-circuits on the first differing byte, leaking timing
// information an attacker can use to recover a secret byte-by-byte. We hash both
// inputs to a fixed 32-byte digest first (so the comparison length never depends
// on the secret) and then compare with crypto.timingSafeEqual.
export function timingSafeEqualStr(a: string | undefined | null, b: string | undefined | null): boolean {
  const ah = crypto.createHash('sha256').update(String(a ?? '')).digest()
  const bh = crypto.createHash('sha256').update(String(b ?? '')).digest()
  return crypto.timingSafeEqual(ah, bh)
}
