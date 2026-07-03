'use client'

// Back-compat shim. The contact-session auth provider was lifted to the team root
// (../PublicContactAuthProvider) so it wraps EVERY public surface, not just Space.
// These aliases keep the existing Space imports (`useSpaceAuth`, the `SpaceContact`
// / `MatchedContact` / `SpaceAuthStep` types) working without touching every
// consumer. New code should import from ../PublicContactAuthProvider directly.

export { usePublicContactAuth as useSpaceAuth } from '../PublicContactAuthProvider'
export type {
  PublicContact as SpaceContact,
  MatchedContact,
  PublicContactAuthStep as SpaceAuthStep,
} from '../PublicContactAuthProvider'
