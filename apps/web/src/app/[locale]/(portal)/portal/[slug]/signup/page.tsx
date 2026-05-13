import SignupForm from './SignupForm'

export const dynamic = 'force-dynamic'

interface Props {
  params: Promise<{ slug: string }>
}

export default async function SignupPage({ params }: Props) {
  const { slug } = await params
  return <SignupForm slug={slug} />
}
