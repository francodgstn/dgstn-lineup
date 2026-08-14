import crypto from 'crypto'

// Verification-code hashing + secure token generation. (Reversible mail-credential
// encryption was removed with the SMTP→Brevo migration — Linyup stores no
// reversible mail credentials for anyone.)

export function hashVerificationCode(code: string, salt: string): string {
  return crypto.createHash('sha256').update(`${code}:${salt}`).digest('hex')
}

export function verifyCode(code: string, salt: string, hash: string): boolean {
  const computedHash = hashVerificationCode(code, salt)
  return crypto.timingSafeEqual(
    Buffer.from(computedHash, 'hex'),
    Buffer.from(hash, 'hex'),
  )
}

export function generateSecureToken(bytes = 32): string {
  return crypto.randomBytes(bytes).toString('hex')
}

/**
 * THE hex SHA-256 for derived, non-secret keys — promo identity keys and promo
 * reservation keys (see shared/types/promoCode.ts, which takes this as an
 * argument so that module stays crypto-free and browser-safe).
 *
 * Exactly one implementation, because both of those derivations are DOC IDS and
 * MAP KEYS: two hashers that disagree by so much as an encoding would turn a
 * retry into a second redemption and a per-person cap into no cap at all.
 */
export function sha256Hex(input: string): string {
  return crypto.createHash('sha256').update(input, 'utf8').digest('hex')
}

// Alphabet excludes visually ambiguous characters (0/O, 1/I/L) — this is a
// human-read-aloud reference for phone/desk lookups, not a security token
// (booking_token remains the unguessable identity for manage-booking links).
const BOOKING_REFERENCE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'

/** Short human-readable booking reference, e.g. "BK-7F3K9Q". Collisions are not
 *  checked — this is a lookup aid for staff, not a unique key. */
export function generateBookingReference(): string {
  const bytes = crypto.randomBytes(6)
  let code = ''
  for (const b of bytes) {
    code += BOOKING_REFERENCE_ALPHABET[b % BOOKING_REFERENCE_ALPHABET.length]
  }
  return `BK-${code}`
}
