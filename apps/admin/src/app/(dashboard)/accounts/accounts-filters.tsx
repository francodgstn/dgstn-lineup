'use client'

import { useRouter, useSearchParams } from 'next/navigation'
import { useState, useTransition } from 'react'
import { Input } from '@/components/ui/input'

const PLANS = ['', 'free', 'coach', 'studio', 'organization']
const STATUSES = ['', 'trial', 'active', 'past_due', 'cancelled', 'expired']

const selectCls =
  'h-9 rounded-lg border border-input bg-background px-2.5 text-sm capitalize focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none'

export function AccountsFilters() {
  const router = useRouter()
  const params = useSearchParams()
  const [, startTransition] = useTransition()
  const [search, setSearch] = useState(params.get('search') ?? '')

  function apply(next: URLSearchParams) {
    startTransition(() => router.push(`/accounts?${next.toString()}`))
  }

  function setParam(key: string, value: string) {
    const next = new URLSearchParams(params.toString())
    if (value) next.set(key, value)
    else next.delete(key)
    apply(next)
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <form
        className="flex-1 min-w-50"
        onSubmit={(e) => {
          e.preventDefault()
          setParam('search', search)
        }}
      >
        <Input
          placeholder="Search name or owner email…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </form>
      <select
        className={selectCls}
        value={params.get('plan') ?? ''}
        onChange={(e) => setParam('plan', e.target.value)}
      >
        {PLANS.map((p) => (
          <option key={p} value={p}>
            {p || 'All plans'}
          </option>
        ))}
      </select>
      <select
        className={selectCls}
        value={params.get('status') ?? ''}
        onChange={(e) => setParam('status', e.target.value)}
      >
        {STATUSES.map((s) => (
          <option key={s} value={s}>
            {s ? s.replace('_', ' ') : 'All statuses'}
          </option>
        ))}
      </select>
    </div>
  )
}
