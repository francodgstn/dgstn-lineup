import { parsePublicFrom } from '@linyup/shared'
import SignupForm from './SignupForm'

export const dynamic = 'force-dynamic'

interface Props {
  params: Promise<{ slug: string }>
  searchParams: Promise<{ from?: string }>
}

// Note: SignupForm ALSO reads `?from=checkout` and `?email=` from
// window.location.search for the post-Stripe "finish your registration" reframe.
// `from` is read here too because it doubles as the return-to surface, which the
// server render needs — `parsePublicFrom('checkout')` falls through to the
// team's default surface, which is the right target after a checkout.
export default async function SignupPage({ params, searchParams }: Props) {
  const { slug } = await params
  const { from } = await searchParams
  return <SignupForm slug={slug} from={parsePublicFrom(from)} />
}
