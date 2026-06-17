import SpaceHome from './SpaceHome'

export const dynamic = 'force-dynamic'

// Team is resolved client-side by SpaceAuthProvider; SpaceHome reads it from context.
export default function SpacePage() {
  return <SpaceHome />
}
