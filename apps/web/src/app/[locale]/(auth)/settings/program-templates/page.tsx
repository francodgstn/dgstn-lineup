'use client'

import { useTranslations } from 'next-intl'
import { useAuth } from '@/contexts/AuthContext'
import { useCapabilities } from '@/hooks/useCapabilities'
import { PageHeader } from '@/components/layout/PageHeader'
import { ProgramTemplatesManager } from '@/components/events/program/ProgramTemplatesManager'
import type { Team } from '@linyup/shared'

// Reusable event programmes for this studio, plus any inherited from the parent
// organisation (read-only). Templates are authored on an event and saved from
// there; this page is the list/rename/delete surface.

export default function ProgramTemplatesSettingsPage() {
  const t = useTranslations('EventProgram')
  const { currentTeamId, team } = useAuth()
  const { can } = useCapabilities()

  return (
    <div className="space-y-6">
      <PageHeader title={t('templatesTitle')} subtitle={t('templatesSubtitle')} />
      <ProgramTemplatesManager
        scope="team"
        ownerId={currentTeamId}
        inheritedOrgId={(team as Team & { org_id?: string })?.org_id ?? null}
        canEdit={can('events.manage')}
      />
    </div>
  )
}
