'use client'

// The performance check-in radar + named profile badge.
//
// Lives in the Coaching tab (moved from Stats, 2026-08-27): the check-ins feed
// straight into the goals right below them, so splitting the two across tabs
// was the split the coaching story never needed. The plan gate is unchanged —
// still `advanced_dashboard` — only the location moved.
//
// `profile_key` used to be computed and stored (`detectPerformanceProfile`,
// `@linyup/shared`) but never read back into any web UI — a member could be
// told on their phone "you're at burnout risk, talk to your coach" while the
// coach's own screen showed nothing. The badge below is that read-back.
// Colours are ported from `apps/mobile/src/components/profile/
// PerformanceProfileSection.tsx` (`PROFILE_DISPLAY`) so the two surfaces agree
// visually; the labels and message copy are new and DELIBERATELY third-person
// (coach-facing) rather than the mobile copy's second-person member directive.

import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import {
  collection,
  query,
  orderBy,
  limit,
  getDocs,
  addDoc,
  serverTimestamp,
} from 'firebase/firestore'
import { db } from '@/lib/firebase'
import {
  CONTACTS_COLLECTION,
  CONTACT_PERFORMANCE_CHECKINS_SUBCOLLECTION,
  resolveCoachingDimensions,
  detectPerformanceProfile,
} from '@linyup/shared'
import type { Contact, Team, PerformanceCheckin, ProfileKey } from '@linyup/shared'
import { usePlan } from '@/hooks/usePlan'
import { useUpgradeModal } from '@/contexts/UpgradeModalContext'
import { Textarea } from '@/components/ui/textarea'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Plus, Lock } from 'lucide-react'
import {
  RadarChart,
  PolarGrid,
  PolarAngleAxis,
  Radar,
  Legend,
  Tooltip,
  ResponsiveContainer,
} from 'recharts'

// ─── profile display metadata ─────────────────────────────────────────────────
// Colours ONLY are ported from the mobile PROFILE_DISPLAY map — labels/messages
// are new i18n keys (see module header).


const PROFILE_COLORS: Record<ProfileKey, string> = {
  burnout_risk: '#EF4444',
  overreaching: '#F97316',
  stuck: '#EAB308',
  coasting: '#8B5CF6',
  inconsistent: '#06B6D4',
  balanced: '#22C55E',
  default: '#6B7280',
}

function ProfileBadge({
  profileKey,
  primaryLever,
  anchor,
  dimensions,
}: {
  profileKey: ProfileKey
  primaryLever?: string | null
  anchor?: string | null
  dimensions: { key: string; label: string }[]
}) {
  const t = useTranslations('Contacts')
  const color = PROFILE_COLORS[profileKey]
  const labelFor = (key?: string | null) =>
    key ? (dimensions.find((d) => d.key === key)?.label ?? key) : ''
  const message =
    profileKey === 'default'
      ? t('profileBadgeMessage_default', { anchor: labelFor(anchor), lever: labelFor(primaryLever) })
      : t(`profileBadgeMessage_${profileKey}` as Parameters<typeof t>[0])

  return (
    <div
      className="rounded-lg p-3 space-y-1"
      style={{ backgroundColor: `${color}18` }}
    >
      <div className="flex items-center gap-1.5">
        <span className="h-2.5 w-2.5 rounded-full shrink-0" style={{ backgroundColor: color }} />
        <span className="text-xs font-semibold" style={{ color }}>
          {t(`profileBadgeLabel_${profileKey}` as Parameters<typeof t>[0])}
        </span>
      </div>
      {message && <p className="text-xs text-muted-foreground">{message}</p>}
    </div>
  )
}

// ─── chart helpers (CSS vars don't resolve in SVG presentation attrs) ─────────

function RadarAngleTick({
  x,
  y,
  cx,
  payload,
}: {
  x?: number
  y?: number
  cx?: number
  payload?: { value: string }
}) {
  if (!payload?.value) return null
  const textAnchor =
    (x ?? 0) > (cx ?? 0) + 4 ? 'start' : (x ?? 0) < (cx ?? 0) - 4 ? 'end' : 'middle'
  return (
    <text
      fill="currentColor"
      x={x}
      y={y}
      textAnchor={textAnchor}
      dy={4}
      style={{ fontSize: 9, color: 'hsl(var(--muted-foreground))', fontFamily: 'inherit' }}
    >
      {payload.value}
    </text>
  )
}

// ─── data hook ────────────────────────────────────────────────────────────────

function useContactPerformanceCheckins(contactId: string) {
  return useQuery<PerformanceCheckin[]>({
    queryKey: ['contact-performance-checkins', contactId],
    queryFn: async () => {
      const snap = await getDocs(
        query(
          collection(db, CONTACTS_COLLECTION, contactId, CONTACT_PERFORMANCE_CHECKINS_SUBCOLLECTION),
          orderBy('taken_at', 'desc'),
          limit(20)
        )
      )
      return snap.docs.map((d) => ({ ...d.data(), id: d.id }) as PerformanceCheckin)
    },
  })
}

// ─── add check-in dialog ─────────────────────────────────────────────────────
// Every axis starts UNSET — a stray double-click used to write a permanent,
// dated rating of 3/5 across the board, indistinguishable from a deliberate
// neutral. Save stays disabled until every dimension has an explicit score.

function AddCheckinDialog({
  open,
  onOpenChange,
  contactId,
  dimensions,
  onSaved,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  contactId: string
  dimensions: { key: string; label: string }[]
  onSaved: () => void
}) {
  const t = useTranslations('Contacts')
  const tCommon = useTranslations('Common')
  const emptyScores = (): Record<string, number | null> =>
    Object.fromEntries(dimensions.map((d) => [d.key, null]))
  const [scores, setScores] = useState<Record<string, number | null>>(emptyScores)
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)

  const allTouched = dimensions.length > 0 && dimensions.every((d) => scores[d.key] != null)

  const save = async () => {
    if (!allTouched) return
    setSaving(true)
    try {
      const finalScores = Object.fromEntries(
        Object.entries(scores).filter((entry): entry is [string, number] => entry[1] != null)
      )
      const profile = detectPerformanceProfile(finalScores)
      await addDoc(
        collection(db, CONTACTS_COLLECTION, contactId, CONTACT_PERFORMANCE_CHECKINS_SUBCOLLECTION),
        {
          scores: finalScores,
          notes: notes.trim() || null,
          filled_by: 'coach',
          context: '1to1',
          taken_at: serverTimestamp(),
          ...profile,
        }
      )
      onSaved()
      onOpenChange(false)
      setScores(emptyScores())
      setNotes('')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{t('performanceCheckinTitle')}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          {dimensions.map((ind) => (
            <div key={ind.key} className="space-y-1.5">
              <div className="flex items-center justify-between">
                <label className="text-sm font-medium">{ind.label}</label>
                <span className="text-sm font-bold tabular-nums">
                  {scores[ind.key] != null ? `${scores[ind.key]}/5` : t('goalScoreUnset')}
                </span>
              </div>
              <div className="flex gap-1">
                {[1, 2, 3, 4, 5].map((v) => (
                  <button
                    key={v}
                    type="button"
                    onClick={() => setScores((prev) => ({ ...prev, [ind.key]: v }))}
                    className={`flex-1 py-1.5 rounded-md text-xs font-medium border transition-colors ${
                      scores[ind.key] === v
                        ? 'bg-primary text-primary-foreground border-primary'
                        : 'text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    {v}
                  </button>
                ))}
              </div>
            </div>
          ))}
          <div className="space-y-1">
            <label className="text-sm font-medium">{t('performanceCheckinNotes')}</label>
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
          </div>
        </div>
        <DialogFooter>
          <button
            onClick={() => onOpenChange(false)}
            className="px-4 py-2 rounded-lg border text-sm font-medium hover:bg-muted transition-colors"
          >
            {t('cancel')}
          </button>
          <button
            onClick={save}
            disabled={saving || !allTouched}
            className="px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 disabled:opacity-50 transition-colors"
          >
            {saving ? tCommon('loading') : t('saveChanges')}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ─── panel ────────────────────────────────────────────────────────────────────

export function PerformanceProfilePanel({
  contact,
  team,
}: {
  contact: Contact
  team: Team | null
}) {
  const t = useTranslations('Contacts')
  const [addCheckinOpen, setAddCheckinOpen] = useState(false)
  const { data: checkins = [], isLoading: checkinsLoading } = useContactPerformanceCheckins(
    contact.id
  )
  const { hasFeature } = usePlan()
  const { openUpgradeModal } = useUpgradeModal()
  const qc = useQueryClient()

  const dimensions = resolveCoachingDimensions(team)

  const latestCoach = checkins.find((c) => c.filled_by === 'coach') ?? null
  const latestStudent = checkins.find((c) => c.filled_by === 'student') ?? null
  const hasBoth = !!latestCoach && !!latestStudent

  const radarData = dimensions.map((ind) =>
    hasBoth
      ? {
          subject: ind.label,
          coach: latestCoach?.scores?.[ind.key] ?? 0,
          student: latestStudent?.scores?.[ind.key] ?? 0,
        }
      : {
          subject: ind.label,
          value: (latestCoach || latestStudent)?.scores?.[ind.key] ?? 0,
        }
  )

  const performanceUnlocked = hasFeature('advanced_dashboard')

  // Tooltip style — inline style prop resolves CSS vars; SVG attrs do not
  const tooltipStyle = {
    fontSize: 12,
    padding: '6px 10px',
    borderRadius: 8,
    border: '1px solid hsl(var(--border))',
    backgroundColor: 'hsl(var(--card))',
    color: 'hsl(var(--card-foreground))',
  }

  // The badge mirrors the member's own phone (mobile derives it from the
  // latest SELF check-in specifically, not "whoever filled in last") — so the
  // coach sees exactly what the member saw, never a coach-filled substitute.
  const badgeProfileKey = latestStudent?.profile_key ?? null

  return (
    <div className="rounded-xl border bg-card p-5 space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          {t('statsPanelPerformance')}
        </p>
        {performanceUnlocked && checkins.length > 0 && (
          <button
            type="button"
            onClick={() => setAddCheckinOpen(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-medium hover:bg-muted transition-colors"
          >
            <Plus className="h-3.5 w-3.5" />
            {t('addPerformanceCheckin')}
          </button>
        )}
      </div>

      {!performanceUnlocked ? (
        <div className="flex flex-col items-center gap-3 py-8 text-center">
          <div className="h-10 w-10 rounded-full bg-muted flex items-center justify-center">
            <Lock className="h-5 w-5 text-muted-foreground" />
          </div>
          <div>
            <p className="text-sm font-medium">{t('performanceProfileLockedTitle')}</p>
            <p className="text-xs text-muted-foreground mt-1 max-w-xs mx-auto">
              {t('performanceProfileLockedDesc')}
            </p>
          </div>
          <button
            type="button"
            onClick={() => openUpgradeModal({ feature: 'advanced_dashboard' })}
            className="px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 transition-colors"
          >
            {t('upgradeToStudio')}
          </button>
        </div>
      ) : checkinsLoading ? (
        <div className="h-[260px] rounded-lg bg-muted animate-pulse" />
      ) : checkins.length === 0 ? (
        <div className="flex flex-col items-center gap-3 py-10 text-center rounded-lg border border-dashed">
          <p className="text-sm text-muted-foreground max-w-xs">{t('noPerformanceCheckins')}</p>
          <button
            type="button"
            onClick={() => setAddCheckinOpen(true)}
            className="flex items-center gap-1.5 px-4 py-2 rounded-lg border text-sm font-medium hover:bg-muted transition-colors"
          >
            <Plus className="h-4 w-4" />
            {t('addPerformanceCheckin')}
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          {badgeProfileKey && (
            <ProfileBadge
              profileKey={badgeProfileKey}
              primaryLever={latestStudent?.primary_lever}
              anchor={latestStudent?.anchor}
              dimensions={dimensions}
            />
          )}
          <div className="h-[260px]">
            <ResponsiveContainer width="99%" height="100%">
              <RadarChart data={radarData} margin={{ top: 16, right: 36, left: 36, bottom: 16 }}>
                {/* stroke as rgba so it works on both themes without CSS vars in SVG attr */}
                <PolarGrid stroke="rgba(128,128,128,0.25)" />
                <PolarAngleAxis dataKey="subject" tick={<RadarAngleTick />} />
                {hasBoth ? (
                  <>
                    <Radar
                      name="Coach"
                      dataKey="coach"
                      stroke="#6366f1"
                      fill="#6366f1"
                      fillOpacity={0.35}
                    />
                    <Radar
                      name="Student"
                      dataKey="student"
                      stroke="#22c55e"
                      fill="#22c55e"
                      fillOpacity={0.25}
                    />
                    <Legend
                      iconSize={10}
                      wrapperStyle={{
                        fontSize: 11,
                        paddingTop: 8,
                        color: 'hsl(var(--foreground))',
                      }}
                    />
                  </>
                ) : (
                  <Radar dataKey="value" stroke="#6366f1" fill="#6366f1" fillOpacity={0.4} />
                )}
                <Tooltip contentStyle={tooltipStyle} />
              </RadarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      <AddCheckinDialog
        open={addCheckinOpen}
        onOpenChange={setAddCheckinOpen}
        contactId={contact.id}
        dimensions={dimensions}
        onSaved={() =>
          qc.invalidateQueries({ queryKey: ['contact-performance-checkins', contact.id] })
        }
      />
    </div>
  )
}
