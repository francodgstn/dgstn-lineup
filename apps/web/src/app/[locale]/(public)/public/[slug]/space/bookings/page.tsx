import SpaceShell from '../SpaceShell'
import BookingsHome from './BookingsHome'

export const dynamic = 'force-dynamic'

export default function SpaceBookingsPage() {
  return (
    <SpaceShell>
      <BookingsHome />
    </SpaceShell>
  )
}
