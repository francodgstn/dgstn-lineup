import { notFound } from 'next/navigation'
import { parsePublicFrom } from '@linyup/shared'
import ContactUpdateForm from './ContactUpdateForm'

export const dynamic = 'force-dynamic'

interface Props {
  params: Promise<{ slug: string }>
  searchParams: Promise<{ contactId?: string; from?: string }>
}

export default async function ContactUpdatePage({ params, searchParams }: Props) {
  const { slug } = await params
  const { contactId, from } = await searchParams

  if (!contactId) notFound()

  return <ContactUpdateForm slug={slug} contactId={contactId} from={parsePublicFrom(from)} />
}
