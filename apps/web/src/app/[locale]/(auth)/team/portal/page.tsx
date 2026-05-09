'use client'

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { doc, getDoc } from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { useAuth } from '@/contexts/AuthContext'
import { Skeleton } from '@/components/ui/skeleton'
import { Badge } from '@/components/ui/badge'
import { TEAMS_COLLECTION } from '@lineup/shared'
import type { Team } from '@lineup/shared'
import { Copy, Check, ExternalLink, Globe } from 'lucide-react'

// ─── data hook ───────────────────────────────────────────────────────────────

function useTeam(teamId: string | null) {
  return useQuery<Team | null>({
    queryKey: ['team', teamId],
    enabled: !!teamId,
    queryFn: async () => {
      if (!teamId) return null
      const d = await getDoc(doc(db, TEAMS_COLLECTION, teamId))
      if (!d.exists()) return null
      return { id: d.id, ...d.data() } as Team
    },
  })
}

// ─── copy button ──────────────────────────────────────────────────────────────

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)

  const handleCopy = async () => {
    await navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <button
      onClick={handleCopy}
      className="p-1.5 rounded hover:bg-muted transition-colors text-muted-foreground hover:text-foreground"
    >
      {copied ? <Check className="h-3.5 w-3.5 text-green-600" /> : <Copy className="h-3.5 w-3.5" />}
    </button>
  )
}

// ─── link row ─────────────────────────────────────────────────────────────────

function LinkRow({ label, url, badge }: { label: string; url: string; badge?: string }) {
  return (
    <div className="flex items-center gap-3 py-3 border-b last:border-0">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">{label}</span>
          {badge && <Badge variant="secondary" className="text-xs">{badge}</Badge>}
        </div>
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs text-primary hover:underline truncate block mt-0.5"
        >
          {url}
        </a>
      </div>
      <div className="flex items-center gap-1 shrink-0">
        <CopyButton text={url} />
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="p-1.5 rounded hover:bg-muted transition-colors text-muted-foreground hover:text-foreground"
        >
          <ExternalLink className="h-3.5 w-3.5" />
        </a>
      </div>
    </div>
  )
}

// ─── page ─────────────────────────────────────────────────────────────────────

export default function TeamPortalPage() {
  const { currentTeamId } = useAuth()
  const { data: team, isLoading } = useTeam(currentTeamId)
  const t = useTranslations('TeamPortal')

  const slug = team?.slug
  const origin = typeof window !== 'undefined' ? window.location.origin : ''
  const portalBase = slug ? `${origin}/portal/${slug}` : null
  const bookingUrl = portalBase ? `${portalBase}/trial-booking` : null
  const membershipUrl = portalBase ? `${portalBase}/membership-signup` : null

  const customLinks = (team?.links ?? []).filter((l) => !l.isBookingLink && !l.isMembershipLink)

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-48" />
        <div className="space-y-3">
          <Skeleton className="h-20 rounded-xl" />
          <Skeleton className="h-20 rounded-xl" />
        </div>
      </div>
    )
  }

  if (!team) {
    return <p className="text-muted-foreground">{t('noTeam')}</p>
  }

  if (!slug) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-bold tracking-tight">{t('title')}</h1>
        <div className="rounded-xl border bg-muted/30 p-8 text-center space-y-2">
          <Globe className="h-8 w-8 text-muted-foreground mx-auto" />
          <p className="font-medium">{t('noSlugTitle')}</p>
          <p className="text-sm text-muted-foreground">{t('noSlugDesc')}</p>
          <a href="../settings?tab=portal" className="text-sm text-primary hover:underline">
            {t('goToSettings')} →
          </a>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{t('title')}</h1>
          <p className="text-sm text-muted-foreground mt-0.5">{t('subtitle', { slug })}</p>
        </div>
        <a
          href={portalBase!}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border text-sm font-medium hover:bg-muted transition-colors"
        >
          <ExternalLink className="h-4 w-4" />
          {t('openPortal')}
        </a>
      </div>

      {/* Portal URL card */}
      <div className="rounded-xl border bg-card p-5 space-y-1">
        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{t('portalUrl')}</p>
        <div className="flex items-center gap-2">
          <a href={portalBase!} target="_blank" rel="noopener noreferrer" className="text-lg font-semibold text-primary hover:underline truncate">
            {portalBase}
          </a>
          <CopyButton text={portalBase!} />
        </div>
      </div>

      {/* Links */}
      <div className="rounded-xl border bg-card">
        <div className="px-5 py-4 border-b">
          <h2 className="text-sm font-semibold">{t('portalLinks')}</h2>
        </div>
        <div className="px-5">
          {bookingUrl && <LinkRow label={t('bookingLink')} url={bookingUrl} badge={t('trial')} />}
          {membershipUrl && <LinkRow label={t('membershipLink')} url={membershipUrl} />}
          {customLinks.filter((l) => l.showInPortal).map((l, i) => (
            <LinkRow key={i} label={l.label} url={l.url || ''} />
          ))}
        </div>
      </div>

      {/* Portal preview iframe */}
      <div className="rounded-xl border overflow-hidden">
        <div className="px-5 py-4 border-b flex items-center justify-between">
          <h2 className="text-sm font-semibold">{t('preview')}</h2>
          <Badge variant="outline" className="text-xs">{t('livePreview')}</Badge>
        </div>
        <div className="relative bg-muted/30" style={{ height: 480 }}>
          <iframe
            src={portalBase ?? undefined}
            className="w-full h-full border-0"
            title="Portal preview"
          />
        </div>
      </div>
    </div>
  )
}
