import 'server-only'

// Operator authorization.
//
// An authenticated Firebase user is an operator if EITHER:
//   1. their token carries the `saas_operator` custom claim (the durable
//      mechanism — provisioned out of band on the user record), OR
//   2. their verified email is on the OPERATOR_EMAILS allowlist (bootstrap /
//      break-glass, set via app-hosting config).
//
// No operator identity is hardcoded in source (it would otherwise sit in git
// history forever). Deployed environments set OPERATOR_EMAILS; the emulator adds
// the seeded demo owners below for convenient local sign-in.
const DEMO_OPERATORS = ['coach@linyup.com', 'studio@linyup.com', 'org@linyup.com']

const isDemo =
  process.env.USE_FIREBASE_EMULATORS === 'true' ||
  !!process.env.FIRESTORE_EMULATOR_HOST

function allowlist(): Set<string> {
  const fromEnv = (process.env.OPERATOR_EMAILS ?? '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean)
  const all = isDemo ? [...fromEnv, ...DEMO_OPERATORS] : fromEnv
  return new Set(all)
}

export function isOperatorEmail(email: string | undefined | null): boolean {
  if (!email) return false
  return allowlist().has(email.toLowerCase())
}

// Preferred check against a decoded Firebase token: the custom claim wins;
// otherwise fall back to the verified-email allowlist.
export function isOperatorToken(decoded: {
  saas_operator?: unknown
  email?: string | null
}): boolean {
  if (decoded.saas_operator === true) return true
  return isOperatorEmail(decoded.email ?? null)
}
