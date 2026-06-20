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
