import { notFound } from 'next/navigation'
import ContactUpdateForm from './ContactUpdateForm'

export const dynamic = 'force-dynamic'

interface Props {
  params: Promise<{ slug: string }>
  searchParams: Promise<{ contactId?: string }>
}

export default async function ContactUpdatePage({ params, searchParams }: Props) {
  const { slug } = await params
  const { contactId } = await searchParams

  if (!contactId) notFound()

  return <ContactUpdateForm slug={slug} contactId={contactId} />
}
