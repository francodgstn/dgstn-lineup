import { redirect } from 'next/navigation'
import type { Route } from 'next'

export default function TeamMembersPage() {
  redirect('/team/managers' as Route)
}
