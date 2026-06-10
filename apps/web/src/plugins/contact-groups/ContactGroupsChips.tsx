'use client'

// Compact group chips for the contact detail header. Self-contained: loads the
// team's groups itself and toggles membership directly on the contact doc.

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { doc, updateDoc, arrayUnion, arrayRemove } from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { useAuth } from '@/contexts/AuthContext'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Check, FolderTree, Plus } from 'lucide-react'
import { Link } from '@/i18n/navigation'
import type { Route } from 'next'
import { CONTACTS_COLLECTION } from '@linyup/shared'
import type { Contact } from '@linyup/shared'
import { useContactGroups, flattenGroupTree } from './hooks'

export function ContactGroupsChips({ contact, onChanged }: { contact: Contact; onChanged: () => void }) {
  const t = useTranslations('ContactGroups')
  const { currentTeamId } = useAuth()
  const { data: groups = [] } = useContactGroups(currentTeamId)
  const [busy, setBusy] = useState(false)

  const memberIds = new Set(contact.group_ids ?? [])
  const memberGroups = groups.filter((g) => memberIds.has(g.id))
  const flat = flattenGroupTree(groups)

  const toggle = async (groupId: string) => {
    if (busy) return
    setBusy(true)
    try {
      await updateDoc(doc(db, CONTACTS_COLLECTION, contact.id), {
        group_ids: memberIds.has(groupId) ? arrayRemove(groupId) : arrayUnion(groupId),
      })
      onChanged()
    } finally {
      setBusy(false)
    }
  }

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
      <Popover>
        <PopoverTrigger
          className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[11px] font-medium border border-dashed border-border text-muted-foreground hover:text-foreground hover:border-foreground/40 transition-colors"
        >
          <Plus className="h-3 w-3" />
          {memberGroups.length === 0 && t('addToGroup')}
        </PopoverTrigger>
        <PopoverContent align="start" className="w-56 p-1.5">
          {flat.map(({ group, depth }) => (
            <button key={group.id} type="button" onClick={() => toggle(group.id)} disabled={busy}
              style={{ paddingLeft: `${8 + depth * 14}px` }}
              className="flex items-center gap-2 w-full pr-2 py-1.5 text-sm rounded hover:bg-accent transition-colors text-left disabled:opacity-50"
            >
              <span className={`h-4 w-4 rounded border flex items-center justify-center shrink-0 transition-colors ${
                memberIds.has(group.id) ? 'bg-primary border-primary' : 'border-input'
              }`}>
                {memberIds.has(group.id) && <Check className="h-2.5 w-2.5 text-primary-foreground" />}
              </span>
              {group.color && <span className="h-2.5 w-2.5 rounded-full shrink-0" style={{ background: group.color }} />}
              <span className="truncate">{group.name}</span>
            </button>
          ))}
          {flat.length === 0 && (
            <div className="text-xs text-muted-foreground text-center py-3 px-2">
              {t('noGroupsYet')}{' '}
              <Link href={'/plugins/contact-groups' as Route} className="text-primary hover:underline">
                {t('manageGroups')}
              </Link>
            </div>
          )}
        </PopoverContent>
      </Popover>
    </div>
  )
}
