'use client'

// The member's own performance profile: her latest self check-in, named
// (where the heuristic can name it) or, failing that, her weakest and
// strongest axis — which `detectPerformanceProfile` always returns, even for a
// team whose dimensions aren't the canonical five. See CoachingHome for how
// `dimensions` is resolved.

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { Gauge, Plus } from 'lucide-react'
import { dimensionLabel } from '@linyup/shared'
import type { PerformanceIndicator, ProfileKey } from '@linyup/shared'
import { Skeleton } from '@/components/ui/skeleton'
import { QueryErrorState } from '@/components/ui/query-error'
import { loadFailureDetail } from '@/lib/publicQueryError'
import { useSpaceTheme } from '../useSpaceTheme'
import { CheckinFormDialog } from './CheckinFormDialog'
import type { SpaceCheckinsState } from './useSpaceCheckins'

// Covers all seven `ProfileKey` members, including `default` — a check-in
// against the canonical five dimensions that matched no named pattern still
// gets its own (deliberately unexciting) title/description rather than
// falling into the "we can't name a pattern for your studio" copy, which is
// about a DIFFERENT situation (non-canonical dimensions, `profile_key: null`).
const PROFILE_TITLE_KEYS: Record<ProfileKey, string> = {
  burnout_risk: 'profileBurnoutRiskTitle',
  overreaching: 'profileOverreachingTitle',
  stuck: 'profileStuckTitle',
  coasting: 'profileCoastingTitle',
  inconsistent: 'profileInconsistentTitle',
  balanced: 'profileBalancedTitle',
  default: 'profileDefaultTitle',
}
const PROFILE_DESC_KEYS: Record<ProfileKey, string> = {
  burnout_risk: 'profileBurnoutRiskDesc',
  overreaching: 'profileOverreachingDesc',
  stuck: 'profileStuckDesc',
  coasting: 'profileCoastingDesc',
  inconsistent: 'profileInconsistentDesc',
  balanced: 'profileBalancedDesc',
  default: 'profileDefaultDesc',
}

export function CheckinSection({ state, dimensions }: { state: SpaceCheckinsState; dimensions: PerformanceIndicator[] }) {
  const t = useTranslations('SpaceCoaching')
  const { accent, textMain, textMuted, cardBg, cardBorder } = useSpaceTheme()
  const [rating, setRating] = useState(false)
  const cardStyle = { background: cardBg, border: `1px solid ${cardBorder}` }

  const { checkins, isLoading, isError, error, refetch, submitCheckin } = state
  const latestSelf = checkins.find((c) => c.filled_by === 'student') ?? null

  return (
    <section className="rounded-2xl p-4" style={cardStyle}>
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Gauge className="h-4 w-4" style={{ color: accent }} />
          <h2 className="text-sm font-semibold uppercase tracking-wide" style={{ color: textMuted }}>
            {t('checkinSectionTitle')}
          </h2>
        </div>
        {!isError && !isLoading && (
          <button
            type="button"
            onClick={() => setRating(true)}
            className="inline-flex items-center gap-1 text-xs font-medium"
            style={{ color: accent }}
          >
            <Plus className="h-3.5 w-3.5" /> {t('checkinCta')}
          </button>
        )}
      </div>

      {isError ? (
        <QueryErrorState
          onRetry={() => void refetch()}
          title={t('checkinLoadFailed')}
          detail={loadFailureDetail(error)}
          theme={{ textMain, textMuted, accent, border: cardBorder }}
        />
      ) : isLoading ? (
        <Skeleton className="h-12 w-full rounded-xl" />
      ) : !latestSelf ? (
        <p className="text-sm" style={{ color: textMuted }}>
          {t('checkinNone')}
        </p>
      ) : (
        <div>
          <p className="text-xs" style={{ color: textMuted }}>
            {t('checkinLastOn', { date: latestSelf.taken_at.toDate().toLocaleDateString() })}
          </p>

          {latestSelf.profile_key ? (
            <div className="mt-2">
              <p className="text-sm font-semibold" style={{ color: textMain }}>
                {t(PROFILE_TITLE_KEYS[latestSelf.profile_key])}
              </p>
              <p className="mt-0.5 text-xs" style={{ color: textMuted }}>
                {t(PROFILE_DESC_KEYS[latestSelf.profile_key])}
              </p>
            </div>
          ) : (
            <div className="mt-2">
              <p className="text-sm font-semibold" style={{ color: textMain }}>
                {t('profileNoneTitle')}
              </p>
              <p className="mt-0.5 text-xs" style={{ color: textMuted }}>
                {t('profileNoneDesc')}
              </p>
            </div>
          )}

          <div className="mt-2 space-y-1 text-xs" style={{ color: textMain }}>
            {latestSelf.anchor && <p>{t('checkinStrength', { axis: dimensionLabel(latestSelf.anchor, dimensions) })}</p>}
            {latestSelf.primary_lever && (
              <p>{t('checkinFocusArea', { axis: dimensionLabel(latestSelf.primary_lever, dimensions) })}</p>
            )}
          </div>
        </div>
      )}

      <CheckinFormDialog
        open={rating}
        onOpenChange={setRating}
        dimensions={dimensions}
        onSubmit={async (values) => {
          await submitCheckin.mutateAsync(values)
          setRating(false)
        }}
      />
    </section>
  )
}
