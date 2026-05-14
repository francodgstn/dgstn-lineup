import type { NextConfig } from 'next'
import createNextIntlPlugin from 'next-intl/plugin'

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts')

// When running against the Firebase emulators, proxy the emulator API paths
// through this dev server. In a browser-based Codespace the emulators aren't
// reachable on localhost and their forwarded ports would need to be made
// public; routing through the (already-authenticated) app origin avoids that.
// All three paths contain dots, so the next-intl middleware matcher
// (which excludes `.*\..*`) leaves them alone.
const emulatorRewrites = async () => {
  if (process.env.NEXT_PUBLIC_USE_EMULATORS !== 'true') return []
  const auth = 'http://127.0.0.1:9099'
  const firestore = 'http://127.0.0.1:8080'
  return {
    beforeFiles: [
      {
        source: '/identitytoolkit.googleapis.com/:path*',
        destination: `${auth}/identitytoolkit.googleapis.com/:path*`,
      },
      {
        source: '/securetoken.googleapis.com/:path*',
        destination: `${auth}/securetoken.googleapis.com/:path*`,
      },
      {
        source: '/google.firestore.v1.Firestore/:path*',
        destination: `${firestore}/google.firestore.v1.Firestore/:path*`,
      },
    ],
  }
}

const nextConfig: NextConfig = {
  reactStrictMode: true,
  typedRoutes: true,
  rewrites: emulatorRewrites,
}

export default withNextIntl(nextConfig)
