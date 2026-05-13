'use client'

import { useState } from 'react'
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from 'recharts'
import { Card, CardContent } from '@/components/ui/card'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { Users } from 'lucide-react'
import type { Contact } from '@lineup/shared'
import type { SubscriptionTypeDoc } from '@/hooks/useDashboardData'

const TYPE_CONFIG = [
  { key: 'student',  label: 'Students', color: '#6366F1' },
  { key: 'trial',    label: 'Trial',    color: '#10B981' },
  { key: 'external', label: 'External', color: '#F59E0B' },
]

const MEMBERSHIP_STATUS_CONFIG = [
  { key: 'active',        label: 'Active',        color: '#10B981' },
  { key: 'almost_ready',  label: 'Almost Ready',  color: '#8B5CF6' },
  { key: 'being_checked', label: 'Being Checked', color: '#3B82F6' },
  { key: 'requested',     label: 'Requested',     color: '#9CA3AF' },
  { key: 'expired',       label: 'Expired',       color: '#EF4444' },
  { key: 'guest',         label: 'Guest',         color: '#F59E0B' },
]

const SUB_COLORS = ['#6366F1','#10B981','#F59E0B','#8B5CF6','#0EA5E9','#EF4444','#84CC16','#6B21A8']

function DonutChart({ data, total }: { data: { name: string; value: number; color: string }[]; total: number }) {
  if (!data.length || total === 0) return null
  return (
    <ResponsiveContainer width="100%" height={160}>
      <PieChart>
        <Pie data={data} cx="50%" cy="50%"
          innerRadius={48} outerRadius={72} dataKey="value"
          paddingAngle={2} startAngle={90} endAngle={-270}>
          {data.map((entry) => <Cell key={entry.name} fill={entry.color} />)}
        </Pie>
        <Tooltip formatter={(value, name) => [
          `${value} (${Math.round((Number(value) / total) * 100)}%)`, name,
        ]} />
      </PieChart>
    </ResponsiveContainer>
  )
}

function Legend({ data, total }: { data: { name: string; value: number; color: string }[]; total: number }) {
  return (
    <div className="flex flex-col gap-1 mt-2">
      {data.map((item) => {
        const pct = total > 0 ? Math.round((item.value / total) * 100) : 0
        return (
          <div key={item.name} className="flex items-center gap-2">
            <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: item.color }} />
            <span className="text-sm flex-1 truncate">{item.name}</span>
            <span className="text-sm text-muted-foreground text-right min-w-[60px]">
              {item.value} ({pct}%)
            </span>
          </div>
        )
      })}
    </div>
  )
}

interface Props {
  contacts: Contact[]
  subscriptionTypes?: SubscriptionTypeDoc[]
}

export function RosterCard({ contacts, subscriptionTypes = [] }: Props) {
  const [view, setView] = useState('type')

  const active = contacts.filter((c) => !c.archived_at)
  const total = active.length

  // Type view
  const typeData = TYPE_CONFIG
    .map((t) => ({ name: t.label, value: active.filter((c) => c.type === t.key).length, color: t.color }))
    .filter((d) => d.value > 0)

  // Membership status view
  const membershipData = MEMBERSHIP_STATUS_CONFIG
    .map((s) => ({ name: s.label, value: active.filter((c) => c.membership_status === s.key).length, color: s.color }))
    .filter((d) => d.value > 0)

  // Subscription view
  const subData = subscriptionTypes.map((st, i) => ({
    name: st.name,
    value: active.filter((c) => (c as { subscription_type_id?: string }).subscription_type_id === st.id).length,
    color: SUB_COLORS[i % SUB_COLORS.length],
  }))
  const unassigned = total - active.filter((c) => (c as { subscription_type_id?: string }).subscription_type_id).length
  if (unassigned > 0 && subData.length > 0) subData.push({ name: 'No subscription', value: unassigned, color: '#D1D5DB' })
  const subDataFiltered = subData.filter((d) => d.value > 0)

  // Billing recurrence view
  const subscribed = active.filter((c) => (c as { subscription_type_id?: string }).subscription_type_id)
  const recCounts: Record<string, number> = {}
  for (const c of subscribed) {
    const key = (c as { subscription_recurrence?: string }).subscription_recurrence ?? 'unset'
    recCounts[key] = (recCounts[key] ?? 0) + 1
  }
  const recurrenceData = Object.entries(recCounts)
    .map(([name, value], i) => ({ name: name === 'unset' ? 'Not set' : name, value, color: SUB_COLORS[i % SUB_COLORS.length] }))
    .filter((d) => d.value > 0)
  const unsubscribed = total - subscribed.length
  if (unsubscribed > 0 && recurrenceData.length > 0)
    recurrenceData.push({ name: 'No subscription', value: unsubscribed, color: '#D1D5DB' })

  const currentData =
    view === 'type'       ? typeData :
    view === 'membership' ? membershipData :
    view === 'recurrence' ? recurrenceData :
    subDataFiltered

  const showEmptySubscriptions = (view === 'subscription' || view === 'recurrence') && subscriptionTypes.length === 0

  return (
    <Card>
      <div className="flex items-center gap-2 px-4 pt-4 pb-2">
        <Users className="h-4 w-4 text-muted-foreground flex-shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-base font-semibold leading-none">Overview</p>
          <p className="text-xs text-muted-foreground mt-0.5">{total} active contacts</p>
        </div>
        <Select value={view} onValueChange={(v) => { if (v) setView(v) }}>
          <SelectTrigger className="h-7 text-xs w-[120px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="type">Type</SelectItem>
            <SelectItem value="membership">Membership</SelectItem>
            <SelectItem value="subscription">Subscription</SelectItem>
            <SelectItem value="recurrence">Billing</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <CardContent className="pt-0 pb-4">
        {showEmptySubscriptions ? (
          <div className="flex flex-col items-center gap-2 py-6 text-center">
            <p className="text-sm text-muted-foreground">No subscription types defined yet.</p>
          </div>
        ) : currentData.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4">No data yet</p>
        ) : (
          <>
            <DonutChart key={view} data={currentData} total={total} />
            <Legend data={currentData} total={total} />
          </>
        )}
      </CardContent>
    </Card>
  )
}
