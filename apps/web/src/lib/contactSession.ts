// ─── The persisted public CONTACT session ────────────────────────────────────
//
// One browser, one stored contact session. The key and the shape are a
// CONTRACT, not an implementation detail: whatever writes it must be readable by
// `PublicContactAuthProvider`, which is what every public surface asks "am I
// signed in?".
//
// THE OTHER HOLDER OF THIS CONTRACT is
// `app/[locale]/(public)/public/[slug]/PublicContactAuthProvider.tsx`, which
// still inlines its own `loadSession` / `saveSession` / `clearSession` against
// the same key. They must stay in step; the provider should be pointed at this
// module the next time it is touched. It was left alone here only because a
// parallel lane held that file.
//
// The Firebase custom token is the AUTHORITY, never this record: the provider
// re-reads `contactId` + `teamId` off the id token before it trusts anything
// stored here. What is persisted is the cached display data plus the fact that
// there is a session worth waiting for.

/** Kept stable from the 'space' era so existing sessions survive. */
export const CONTACT_SESSION_KEY = 'linyup:space:session'

export interface StoredPublicContact {
  id: string
  firstname: string
  lastname: string
  subscription_type_id?: string
  /** `| null` because that is what `buildContactSession` actually returns for a
   *  contact with no address — an explicit null, not a missing key. */
  email?: string | null
}

export interface PersistedContactSession {
  contactId: string
  /** ISO string. The provider drops the record once this is in the past. */
  sessionExpires: string
  contact: StoredPublicContact
}

export function loadContactSession(): PersistedContactSession | null {
  try {
    const raw = localStorage.getItem(CONTACT_SESSION_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as PersistedContactSession
    if (new Date(parsed.sessionExpires) < new Date()) {
      localStorage.removeItem(CONTACT_SESSION_KEY)
      return null
    }
    return parsed
  } catch {
    return null
  }
}

export function saveContactSession(data: PersistedContactSession): void {
  try {
    localStorage.setItem(CONTACT_SESSION_KEY, JSON.stringify(data))
  } catch {
    // Private mode / storage disabled. The Firebase session still stands; the
    // surfaces simply fall back to asking for a sign-in.
  }
}

export function clearContactSession(): void {
  try {
    localStorage.removeItem(CONTACT_SESSION_KEY)
  } catch {
    // ignore
  }
}
