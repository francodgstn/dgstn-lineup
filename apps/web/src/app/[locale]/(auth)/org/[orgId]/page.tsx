'use client'

import { useEffect } from 'react'
import { useParams } from 'next/navigation'
import { useRouter } from '@/i18n/navigation'
import { useLocale } from 'next-intl'

export default function OrgPage() {
  const { orgId } = useParams<{ orgId: string }>()
  const locale = useLocale()
  const router = useRouter()

  useEffect(() => {
    router.replace(`/org/${orgId}/teams` as Parameters<typeof router.replace>[0])
  }, [orgId, locale, router])

  return null
}
