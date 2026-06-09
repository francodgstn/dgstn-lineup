import type { NextConfig } from 'next'

// Operator console. Reads data server-side via the Firebase Admin SDK, so no
// client-side Firestore proxy is needed (unlike apps/web). The only client
// Firebase usage is the login page hitting the Auth emulator / production
// Identity Toolkit directly.
const securityHeaders = [
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
]

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // firebase-admin is server-only; keep it out of any client bundle tracing.
  serverExternalPackages: ['firebase-admin'],
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }]
  },
}

export default nextConfig
