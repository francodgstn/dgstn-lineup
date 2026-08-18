'use client'

// "Save current filters as a group" — the shortcut from an ad-hoc query to a
// first-class, nestable group.
//
// The mode choice is the whole point of the dialog:
//   • SNAPSHOT — evaluate the filter once and copy today's matches into
//     Contact.group_ids. Editorial groups ("this season's competition squad")
//     want this: membership is a decision someone made, and it must not drift
//     when the underlying data moves.
//   • DYNAMIC  — store the filter and derive membership on every read. Nothing
//     is materialized, so nothing can go stale. Time-derived criteria (age)
//     REQUIRE this: a contact aging out writes nothing, so no snapshot and no
//     event trigger could ever notice.

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger } from '@/components/ui/select'
import { Check, FolderTree, Zap } from 'lucide-react'
import { flattenGroupTree, filterContacts, toGroupRule, ruleWouldDropGroups } from '@linyup/shared'
import type { ContactFilter, ContactFilterContext, ContactGroup, Contact } from '@linyup/shared'

/** Sentinel: the Select needs a non-empty value for "no parent". */
const NO_PARENT = '__none__'

export function SaveAsGroupDialog({
  open, onOpenChange, filter, groups, matches, allContacts, filterContext, onCreate,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  filter: ContactFilter
  groups: ContactGroup[]
  /** Exactly the rows the user is looking at — the snapshot is what they see,
   *  not a re-derived set, so the count in the dialog can never disagree with
   *  the list behind it. */
  matches: Contact[]
  /** The tab's UNFILTERED rows. The dynamic rule drops `groups` and therefore
   *  resolves WIDER than `matches`; re-filtering the already-narrowed list
   *  would understate it. */
  allContacts: Contact[]
  filterContext: ContactFilterContext
  onCreate: (args: {
    name: string
    parentId: string | null
    mode: 'snapshot' | 'dynamic'
    /** The rule to store — already stripped for dynamic mode. */
    rule: ContactFilter
    memberIds: string[]
  }) => Promise<void>
}) {
  const t = useTranslations('ContactGroups')
  const [name, setName] = useState('')
  const [parentId, setParentId] = useState<string>('')
  const [mode, setMode] = useState<'snapshot' | 'dynamic'>('dynamic')
  const [saving, setSaving] = useState(false)

  // An age/birth-year window is the case a snapshot cannot express: nothing is
  // written when someone ages out, so a copied membership silently goes wrong.
  const timeDerived = !!filter.age && (filter.age.min != null || filter.age.max != null)

  // A dynamic rule cannot keep the `groups` dimension (it could recurse), so a
  // filter built on top of another group resolves WIDER than the list behind
  // this dialog. Preview the rule that will actually run, and say so — a silent
  // count that disagrees with the saved group is worse than no preview.
  const dropsGroups = ruleWouldDropGroups(filter)
  const dynamicRule = toGroupRule(filter)
  const dynamicMatches = dropsGroups
    ? filterContacts(allContacts, dynamicRule, filterContext)
    : matches
  const shownMatches = mode === 'dynamic' ? dynamicMatches : matches

  async function submit() {
    if (!name.trim() || saving) return
    setSaving(true)
    try {
      await onCreate({
        name: name.trim(),
        parentId: parentId || null,
        mode,
        rule: mode === 'dynamic' ? dynamicRule : filter,
        memberIds: mode === 'snapshot' ? matches.map((c) => c.id) : [],
      })
      setName(''); setParentId(''); setMode('dynamic')
      onOpenChange(false)
    } finally {
      setSaving(false)
    }
  }

  const MODES = [
    {
      value: 'dynamic' as const,
      icon: Zap,
      title: t('modeDynamicTitle'),
      body: t('modeDynamicBody'),
    },
    {
      value: 'snapshot' as const,
      icon: FolderTree,
      title: t('modeSnapshotTitle'),
      body: t('modeSnapshotBody', { count: matches.length }),
    },
  ]

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader><DialogTitle>{t('saveAsGroupTitle')}</DialogTitle></DialogHeader>

        <div className="space-y-3">
          <Input autoFocus placeholder={t('groupNamePlaceholder')} value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') submit() }} />

          <div className="space-y-1.5">
            {MODES.map((m) => {
              const selected = mode === m.value
              return (
                <button key={m.value} type="button" onClick={() => setMode(m.value)}
                  className={`flex w-full items-start gap-2.5 rounded-lg border p-2.5 text-left transition-colors ${
                    selected ? 'border-primary bg-primary/5' : 'border-border hover:border-border/80 hover:bg-muted/40'
                  }`}>
                  <m.icon className={`h-4 w-4 mt-0.5 shrink-0 ${selected ? 'text-primary' : 'text-muted-foreground'}`} />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5 text-sm font-medium">
                      {m.title}
                      {selected && <Check className="h-3 w-3 text-primary" />}
                    </span>
                    <span className="block text-xs text-muted-foreground mt-0.5">{m.body}</span>
                  </span>
                </button>
              )
            })}
          </div>

          {timeDerived && mode === 'snapshot' && (
            <p className="rounded-md bg-amber-500/10 border border-amber-500/30 px-2.5 py-2 text-xs text-amber-700 dark:text-amber-400">
              {t('snapshotAgeWarning')}
            </p>
          )}

          {dropsGroups && mode === 'dynamic' && (
            <p className="rounded-md bg-amber-500/10 border border-amber-500/30 px-2.5 py-2 text-xs text-amber-700 dark:text-amber-400">
              {t('dynamicDropsGroupsWarning', { count: shownMatches.length })}
            </p>
          )}

          {groups.length > 0 && (
            <label className="block space-y-1">
              <span className="text-xs font-medium text-muted-foreground">{t('parentGroup')}</span>
              <Select value={parentId || NO_PARENT}
                onValueChange={(v) => setParentId(v === NO_PARENT ? '' : (v ?? ''))}>
                <SelectTrigger className="h-9 w-full text-sm">
                  <span className="flex flex-1 text-left text-sm truncate">
                    {groups.find((g) => g.id === parentId)?.name ?? t('noParent')}
                  </span>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_PARENT}>{t('noParent')}</SelectItem>
                  {flattenGroupTree(groups).map(({ group, depth }) => (
                    <SelectItem key={group.id} value={group.id} textValue={group.name}>
                      <span style={{ paddingLeft: `${depth * 12}px` }}>{group.name}</span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </label>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>{t('cancel')}</Button>
          <Button onClick={submit} disabled={!name.trim() || saving}>{t('createGroup')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
