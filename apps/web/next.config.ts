import type { NextConfig } from 'next'
import createNextIntlPlugin from 'next-intl/plugin'

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts')

// When running against the Firebase emulators, proxy the emulator API paths
// through this dev server. In a browser-based Codespace the emulators aren't
// reachable on localhost; routing through the (already-authenticated) app
// origin avoids having to make ports public. The auth paths use a benign
// `/__fb.auth/...` prefix because GitHub's tunnel 401s any path containing
// `googleapis.com` — see the fetch shim in src/lib/firebase-auth.ts that
// rewrites the SDK's outgoing URLs to match. All paths contain dots, so the
// next-intl middleware matcher (which excludes `.*\..*`) leaves them alone.
const emulatorRewrites = async () => {
  if (process.env.NEXT_PUBLIC_USE_EMULATORS !== 'true') return []
  const auth = 'http://127.0.0.1:9099'
  const firestore = 'http://127.0.0.1:8080'
  return {
    beforeFiles: [
      {
        source: '/__fb.auth/it/:path*',
        destination: `${auth}/identitytoolkit.googleapis.com/:path*`,
      },
      {
        source: '/__fb.auth/st/:path*',
        destination: `${auth}/securetoken.googleapis.com/:path*`,
      },
      {
        source: '/google.firestore.v1.Firestore/:path*',
        destination: `${firestore}/google.firestore.v1.Firestore/:path*`,
      },
    ],
  }
}

const securityHeaders = [
  // Framing headers (X-Frame-Options / frame-ancestors) are set per-path in
  // src/proxy.ts so the public /embed/* widget routes can be framed by a studio's
  // own website while the rest of the app stays frame-denied.
  // Stop browsers from MIME-sniffing
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  // Control referrer in cross-origin requests
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  // Enforce HTTPS for 2 years (preload-eligible)
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
  // Note: CSP is deferred — Firebase SDK + next-intl require careful inline-script handling
]

const nextConfig: NextConfig = {
  reactStrictMode: true,
  typedRoutes: true,
  rewrites: emulatorRewrites,
  async redirects() {
    // The app has no marketing root (the landing site is separate), so a bare
    // root would 404. Send it to the login entry — on the demo (demo.linyup.com)
    // this lands visitors in the sandbox sign-in instead of a dead page; on the
    // real app the login page forwards already-authenticated users on to their
    // dashboard. Config redirects run before the next-intl middleware.
    return [{ source: '/', destination: '/login', permanent: false }]
  },
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }]
  },
}

export default withNextIntl(nextConfig)
