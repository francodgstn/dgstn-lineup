// Single source of truth for normalizing an email before comparison or use as a
// Firestore doc id. Used by the signup blocking function, the operator console's
// allowlist actions, and the allowlist doc id — they MUST agree, otherwise an
// allowlisted address won't match the address Firebase Auth presents at signup.
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase()
}
