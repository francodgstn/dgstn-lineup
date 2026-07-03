export const dynamic = 'force-dynamic'

// The contact-session auth provider now lives at the team root
// (../PublicContactAuthProvider), wrapping every public surface — so Space no
// longer mounts its own. This layout is a passthrough kept only to hold the
// force-dynamic flag for the Space subtree.
export default function SpaceLayout({ children }: { children: React.ReactNode }) {
  return children
}
