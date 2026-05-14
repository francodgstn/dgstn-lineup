import { getAuth, connectAuthEmulator } from 'firebase/auth'
import app, { emulatorProxy } from './firebase'

export const auth = getAuth(app)

if (
  process.env.NEXT_PUBLIC_USE_EMULATORS === 'true' &&
  typeof window !== 'undefined' &&
  !(globalThis as { _authEmulatorConnected?: boolean })._authEmulatorConnected
) {
  // In a Codespace the auth emulator is proxied through this app's origin
  // (see next.config.ts); locally it's reached directly.
  const url = emulatorProxy ? emulatorProxy.origin : 'http://localhost:9099'
  connectAuthEmulator(auth, url, { disableWarnings: true })
  ;(globalThis as { _authEmulatorConnected?: boolean })._authEmulatorConnected = true
}
