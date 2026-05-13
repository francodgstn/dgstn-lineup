'use client'

import { useState } from 'react'
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from 'recharts'
import { Card, CardContent } from '@/components/ui/card'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { BarChart3 } from 'lucide-react'
import { useTranslations } from 'next-intl'
import type { Contact, RankingSystem } from '@lineup/shared'
import { getPrimaryRank } from '@/lib/rank-utils'

const AGE_GROUPS = [
  { key: 'demoAgeKids',    min: 5,  max: 9,   color: '#4ADE80' },
  { key: 'demoAgeYouth',   min: 10, max: 14,  color: '#60A5FA' },
  { key: 'demoAgeTeens',   min: 15, max: 17,  color: '#A78BFA' },
  { key: 'demoAgeAdults',  min: 18, max: 39,  color: '#F59E0B' },
  { key: 'demoAgeMasters', min: 40, max: 999, color: '#F97316' },
] as const

const GENDER_CONFIG = [
  { key: 'F',     tKey: 'gender_F',     color: '#EC4899' },
  { key: 'M',     tKey: 'gender_M',     color: '#3B82F6' },
  { key: 'other', tKey: 'gender_other', color: '#9CA3AF' },
] as const

function calcAge(birthdate: { toDate(): Date } | string | null | undefined): number | null {
  if (!birthdate) return null
  const d = typeof birthdate === 'string' ? new Date(birthdate) : birthdate.toDate()
  return Math.floor((Date.now() - d.getTime()) / (365.25 * 24 * 3600 * 1000))
}

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

export function DemographicsCard({
  contacts,
  rankingSystems = [],
}: {
  contacts: Contact[]
  rankingSystems?: RankingSystem[]
}) {
  const t = useTranslations('Dashboard')
  const tC = useTranslations('Contacts')
  const hasRanking = rankingSystems.length > 0
  const [view, setView] = useState<'age' | 'gender' | 'level'>('age')

  const active = contacts.filter((c) => !c.archived_at)

  const ageData = AGE_GROUPS
    .map((g) => ({
      name: t(g.key), color: g.color,
      value: active.filter((c) => {
        const age = calcAge(c.birthdate as Parameters<typeof calcAge>[0])
        return age !== null && age >= g.min && age <= g.max
      }).length,
    }))
    .filter((d) => d.value > 0)

  const genderData = GENDER_CONFIG
    .map((g) => ({
      name: tC(g.tKey), color: g.color,
      value: active.filter((c) => c.gender === g.key).length,
    }))
    .filter((d) => d.value > 0)

  const levelData = (() => {
    if (!hasRanking) return []
    const primarySystem = rankingSystems.find((s) => s.is_primary) ?? rankingSystems[0]
    const counts: Record<string, number> = {}
    let unranked = 0
    for (const c of active) {
      const result = getPrimaryRank(c, rankingSystems)
      if (!result) { unranked++; continue }
      const key = `${result.system.id}:${result.level.value}`
      counts[key] = (counts[key] ?? 0) + 1
    }
    const systemLevels = primarySystem?.levels ?? []
    const data = systemLevels
      .map((l) => ({
        name: l.label,
        color: l.color ?? '#9CA3AF',
        value: counts[`${primarySystem.id}:${l.value}`] ?? 0,
      }))
      .filter((d) => d.value > 0)
    if (unranked > 0) data.push({ name: tC('rankUnranked'), color: '#E5E7EB', value: unranked })
    return data
  })()

  const currentData = view === 'age' ? ageData : view === 'gender' ? genderData : levelData
  const total = currentData.reduce((s, d) => s + d.value, 0)

  return (
    <Card>
      <div className="flex items-center gap-2 px-4 pt-4 pb-2">
        <BarChart3 className="h-4 w-4 text-muted-foreground flex-shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-base font-semibold leading-none">{t('demoTitle')}</p>
          <p className="text-xs text-muted-foreground mt-0.5">{t('demoSubtitle', { count: active.length })}</p>
        </div>
        <Select value={view} onValueChange={(v) => { if (v) setView(v as 'age' | 'gender' | 'level') }}>
          <SelectTrigger className="h-7 text-xs w-[90px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="age">{t('demoViewAge')}</SelectItem>
            <SelectItem value="gender">{t('demoViewGender')}</SelectItem>
            {hasRanking && <SelectItem value="level">{t('demoViewLevel')}</SelectItem>}
          </SelectContent>
        </Select>
      </div>
      <CardContent className="pt-0 pb-4">
        {currentData.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4">
            {view === 'age' ? t('demoEmptyAge') : view === 'gender' ? t('demoEmptyGender') : t('demoEmptyLevel')}
          </p>
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
