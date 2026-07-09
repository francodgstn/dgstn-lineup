'use client'

// Searchable contact combobox for the payment dialogs. Collapsed by default —
// the list drops down from the search box on focus/typing, and the selected
// contact shows in the field when closed. Value is a contactId ('' = none).

import { useMemo, useState } from 'react'
import { useTranslations } from 'next-intl'
import { Check, Search, UserX } from 'lucide-react'
import { useActiveContacts } from '@/hooks/useActiveContacts'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'

export function contactDisplayName(c: {
  firstname?: string
  lastname?: string
  email?: string
  id: string
}): string {
  const name = `${c.firstname ?? ''} ${c.lastname ?? ''}`.trim()
  return name || c.email || c.id
}

export function ContactPicker({
  teamId,
  value,
  onChange,
  allowUnassign = true,
}: {
  teamId: string
  value: string
  onChange: (contactId: string) => void
  allowUnassign?: boolean
}) {
  const t = useTranslations('PaymentsDashboard')
  const { data: contacts = [] } = useActiveContacts(teamId)
  const [search, setSearch] = useState('')
  const [open, setOpen] = useState(false)

  const selected = contacts.find((c) => c.id === value)

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    const list = q
      ? contacts.filter((c) => `${contactDisplayName(c)} ${c.email ?? ''}`.toLowerCase().includes(q))
      : contacts
    return list.slice(0, 50)
  }, [contacts, search])

  // While open the field shows the typed query; when closed it shows the selection.
  const inputValue = open ? search : selected ? contactDisplayName(selected) : ''

  function pick(id: string) {
    onChange(id)
    setSearch('')
    setOpen(false)
  }

  return (
    <div className="relative">
      <div className="relative">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          value={inputValue}
          onFocus={() => {
            setSearch('')
            setOpen(true)
          }}
          onChange={(e) => {
            setSearch(e.target.value)
            setOpen(true)
          }}
          onBlur={() => setOpen(false)}
          placeholder={t('assignSearchPlaceholder')}
          className="pl-8"
        />
      </div>

      {open && (
        <div className="absolute z-50 mt-1 w-full max-h-56 overflow-auto rounded-lg border bg-popover shadow-md divide-y">
          {allowUnassign && (
            <button
              type="button"
              // preventDefault keeps focus so the click registers before onBlur.
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => pick('')}
              className={cn(
                'flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-muted',
                value === '' && 'bg-muted'
              )}
            >
              <UserX className="h-4 w-4 text-muted-foreground" />
              <span className="flex-1">{t('assignUnassigned')}</span>
              {value === '' && <Check className="h-4 w-4 text-primary" />}
            </button>
          )}
          {filtered.map((c) => (
            <button
              key={c.id}
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => pick(c.id)}
              className={cn(
                'flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-muted',
                value === c.id && 'bg-muted'
              )}
            >
              <span className="flex-1 min-w-0">
                <span className="block truncate font-medium">{contactDisplayName(c)}</span>
                {c.email && (
                  <span className="block truncate text-xs text-muted-foreground">{c.email}</span>
                )}
              </span>
              {value === c.id && <Check className="h-4 w-4 text-primary" />}
            </button>
          ))}
          {filtered.length === 0 && (
            <p className="px-3 py-4 text-center text-sm text-muted-foreground">
              {t('assignNoContacts')}
            </p>
          )}
        </div>
      )}
    </div>
  )
}
