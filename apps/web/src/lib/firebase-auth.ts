import { getAuth, connectAuthEmulator } from 'firebase/auth'
import app, { emulatorEndpoint } from './firebase'

export const auth = getAuth(app)

if (
  process.env.NEXT_PUBLIC_USE_EMULATORS === 'true' &&
  typeof window !== 'undefined' &&
  !(globalThis as { _authEmulatorConnected?: boolean })._authEmulatorConnected
) {
  const { host, port, ssl } = emulatorEndpoint(9099)
  connectAuthEmulator(auth, `${ssl ? 'https' : 'http'}://${host}:${port}`, {
    disableWarnings: true,
  })
  ;(globalThis as { _authEmulatorConnected?: boolean })._authEmulatorConnected = true
}
