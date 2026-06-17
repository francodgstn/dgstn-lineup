import { SpaceAuthProvider } from './SpaceAuthProvider'

export const dynamic = 'force-dynamic'

interface Props {
  children: React.ReactNode
  params: Promise<{ slug: string; locale: string }>
}

// Thin wrapper: team resolution happens CLIENT-SIDE inside SpaceAuthProvider
// (the Firebase client SDK is not used for server-side reads — see bio-link).
export default async function SpaceLayout({ children, params }: Props) {
  const { slug } = await params
  return <SpaceAuthProvider slug={slug}>{children}</SpaceAuthProvider>
}
