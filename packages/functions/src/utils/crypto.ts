import crypto, { createCipheriv, createDecipheriv, randomBytes } from 'crypto'
import { getSecret } from './secrets'

// ─── AES-256-GCM symmetric encryption ────────────────────────────────────────

const AES_ALGO = 'aes-256-gcm'

async function getMasterKey(): Promise<Buffer> {
  const hex = await getSecret('smtp-encryption-key')
  return Buffer.from(hex, 'hex')
}

/**
 * Encrypts a plaintext string with AES-256-GCM.
 * Output format (base64): iv(12 bytes) + authTag(16 bytes) + ciphertext
 */
export async function encryptPassword(plaintext: string): Promise<string> {
  const key = await getMasterKey()
  const iv = randomBytes(12)
  const cipher = createCipheriv(AES_ALGO, key, iv)
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return Buffer.concat([iv, tag, encrypted]).toString('base64')
}

/**
 * Decrypts a base64-encoded AES-256-GCM ciphertext produced by encryptPassword.
 */
export async function decryptPassword(enc: string): Promise<string> {
  const key = await getMasterKey()
  const buf = Buffer.from(enc, 'base64')
  const iv = buf.subarray(0, 12)
  const tag = buf.subarray(12, 28)
  const ciphertext = buf.subarray(28)
  const decipher = createDecipheriv(AES_ALGO, key, iv)
  decipher.setAuthTag(tag)
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8')
}

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
