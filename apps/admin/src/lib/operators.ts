import 'server-only'

// Built-in operator allowlist. Override / extend via the OPERATOR_EMAILS env
// var (comma-separated). This is the single authorization gate for cycle 1 —
// any authenticated Firebase user whose verified email is on this list is an
// operator; everyone else is rejected server-side.
const DEFAULT_OPERATORS = ['franco.dgstn@gmail.com']

// Seeded emulator owners — convenient sign-in when running against demo data.
const DEMO_OPERATORS = ['coach@linyup.com', 'club@linyup.com', 'org@linyup.com']

const isDemo =
  process.env.USE_FIREBASE_EMULATORS === 'true' ||
  !!process.env.FIRESTORE_EMULATOR_HOST

function allowlist(): Set<string> {
  const fromEnv = (process.env.OPERATOR_EMAILS ?? '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean)
  const base = fromEnv.length ? fromEnv : DEFAULT_OPERATORS
  const all = isDemo ? [...base, ...DEMO_OPERATORS] : base
  return new Set(all.map((e) => e.toLowerCase()))
}

export function isOperatorEmail(email: string | undefined | null): boolean {
  if (!email) return false
  return allowlist().has(email.toLowerCase())
}
