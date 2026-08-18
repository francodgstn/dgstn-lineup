'use client'

/**
 * The roster half of `ContactsOverviewCard`, kept as a named component because
 * `/contacts` renders it beside the demographics one and this pass is a
 * dashboard pass. It is a WRAPPER, not a second implementation: the two cards
 * were the same component twice (identical donut, byte-identical legend, a view
 * `Select` over the same contact list), which is exactly why the dashboard could
 * merge them into one card without inventing anything.
 *
 * A single-group card renders a flat option list and its own title, so nothing
 * on `/contacts` changed.
 */

import { useTranslations } from 'next-intl'
import type { Contact, EngagementThresholds } from '@linyup/shared'
import { ContactsOverviewCard } from '@/components/dashboard/ContactsOverviewCard'

export function RosterCard({
  contacts,
  thresholds,
}: {
  contacts: Contact[]
  thresholds?: EngagementThresholds
}) {
  const t = useTranslations('Contacts')
  return (
    <ContactsOverviewCard
      contacts={contacts}
      thresholds={thresholds}
      groups={['roster']}
      title={t('statsTitle')}
    />
  )
}
