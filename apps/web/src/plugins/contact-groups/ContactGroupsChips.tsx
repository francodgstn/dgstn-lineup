'use client'

// Compact group chips for the contact detail header. Shows the groups a contact
// is in; the "+" opens the shared picker (GroupPickerPopover), which is the same
// control the groups page uses for quick-assign.

import { useTranslations } from 'next-intl'
import { useAuth } from '@/contexts/AuthContext'
import { FolderTree, Plus } from 'lucide-react'
import type { Contact } from '@linyup/shared'
import { useContactGroups } from './hooks'
import { GroupPickerPopover } from './GroupPickerPopover'

export function ContactGroupsChips({ contact, onChanged }: { contact: Contact; onChanged: () => void }) {
  const t = useTranslations('ContactGroups')
  const { currentTeamId } = useAuth()
  const { data: groups = [] } = useContactGroups(currentTeamId)

  const memberIds = new Set(contact.group_ids ?? [])
  const memberGroups = groups.filter((g) => memberIds.has(g.id))

  return (
    <div className="flex flex-wrap items-center gap-1.5 mt-2">
      <FolderTree className="h-3 w-3 text-muted-foreground shrink-0" />
      {memberGroups.map((g) => (
        <span key={g.id}
          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-muted text-muted-foreground"
        >
          {g.color && <span className="h-2 w-2 rounded-full shrink-0" style={{ background: g.color }} />}
          {g.name}
        </span>
      ))}
      <GroupPickerPopover
        contactId={contact.id}
        groupIds={contact.group_ids ?? []}
        onChanged={onChanged}
        align="start"
        triggerClassName="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[11px] font-medium border border-dashed border-border text-muted-foreground hover:text-foreground hover:border-foreground/40 transition-colors"
      >
        <Plus className="h-3 w-3" />
        {memberGroups.length === 0 && t('addToGroup')}
      </GroupPickerPopover>
    </div>
  )
}
