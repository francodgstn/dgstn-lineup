import { redirect } from 'next/navigation'
import type { Route } from 'next'

// Affiliations now lives as a tab of the Plans & affiliations hub.
export default function AffiliationsRedirect() {
  redirect('/offer/plans?tab=affiliations' as Route)
}
