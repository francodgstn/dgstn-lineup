import { getAuth, connectAuthEmulator } from 'firebase/auth'
import app from './firebase'

export const auth = getAuth(app)

if (
  process.env.NEXT_PUBLIC_USE_EMULATORS === 'true' &&
  typeof window !== 'undefined' &&
  !(globalThis as { _authEmulatorConnected?: boolean })._authEmulatorConnected
) {
  connectAuthEmulator(auth, 'http://localhost:9099', { disableWarnings: true })
  ;(globalThis as { _authEmulatorConnected?: boolean })._authEmulatorConnected = true
}
