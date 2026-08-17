import { getAuth, connectAuthEmulator } from 'firebase/auth'
import app, { emulatorProxy, EMULATOR_PORTS, emulatorHost } from './firebase'

// In a Codespace, GitHub's tunnel layer 401s any same-origin request whose
// path contains `googleapis.com` (apparently an anti-abuse rule preventing
// Codespaces being used as Google API proxies). The Firebase Auth SDK
// always builds URLs containing `identitytoolkit.googleapis.com` and
// `securetoken.googleapis.com`, so before any auth request leaves the page
// we rewrite those substrings to a benign prefix. Next.js then rewrites
// them back to the real emulator paths (see next.config.ts).
// Path uses a dot so the next-intl middleware matcher (which excludes
// `.*\..*`) doesn't try to add a locale prefix.
if (
  emulatorProxy &&
  process.env.NEXT_PUBLIC_USE_EMULATORS === 'true' &&
  !(globalThis as { _fbFetchPatched?: boolean })._fbFetchPatched
) {
  const orig = window.fetch.bind(window)
  const proxyOrigin = emulatorProxy.origin
  const rewriteUrl = (url: string) =>
    url
      .replace('/identitytoolkit.googleapis.com/', '/__fb.auth/it/')
      .replace('/securetoken.googleapis.com/', '/__fb.auth/st/')
  window.fetch = function (input, init) {
    const url =
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.toString()
          : (input as Request).url
    if (
      url.startsWith(proxyOrigin) &&
      (url.includes('/identitytoolkit.googleapis.com/') ||
        url.includes('/securetoken.googleapis.com/'))
    ) {
      const rewritten = rewriteUrl(url)
      if (typeof input === 'string' || input instanceof URL) {
        return orig(rewritten, init)
      }
      return orig(new Request(rewritten, input as Request), init)
    }
    return orig(input, init)
  } as typeof window.fetch
  ;(globalThis as { _fbFetchPatched?: boolean })._fbFetchPatched = true
}

export const auth = getAuth(app)

if (
  process.env.NEXT_PUBLIC_USE_EMULATORS === 'true' &&
  typeof window !== 'undefined' &&
  !(globalThis as { _authEmulatorConnected?: boolean })._authEmulatorConnected
) {
  // In a Codespace the auth emulator is proxied through this app's origin
  // (see next.config.ts); locally it's reached directly.
  const url = emulatorProxy
    ? emulatorProxy.origin
    : `http://${emulatorHost()}:${EMULATOR_PORTS.auth}`
  connectAuthEmulator(auth, url, { disableWarnings: true })
  ;(globalThis as { _authEmulatorConnected?: boolean })._authEmulatorConnected = true
}
