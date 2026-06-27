import SpaceShell from './SpaceShell'
import SpaceHome from './SpaceHome'

export const dynamic = 'force-dynamic'

// Team is resolved client-side by SpaceAuthProvider; the shell provides the portal
// chrome (theme, header, module nav) and SpaceHome renders the course library + band.
export default function SpacePage() {
  return (
    <SpaceShell>
      <SpaceHome />
    </SpaceShell>
  )
}
