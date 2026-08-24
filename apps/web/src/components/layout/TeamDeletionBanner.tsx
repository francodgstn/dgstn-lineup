'use client'

/**
 * THIS STUDIO IS SCHEDULED TO BE ERASED — a full-width strip above every page.
 *
 * ── WHY IT IS NOT ENOUGH TO SHOW IT ON THE SETTINGS PAGE ────────────────────
 * `requestTeamDeletion` writes `deletion_scheduled_for` and the tenant is wiped
 * thirty days later by the `purgeScheduledTeams` sweep. Before this strip
 * existed, the pending state reached the screen through `DeleteAccountCard` on
 * Settings → Team, which returns null for anyone who is not the owner. So a
 * coach or a manager in a studio a fortnight from erasure saw nothing,
 * anywhere, and the owner saw it only by navigating back to the screen they had
 * just used to schedule it.
 *
 * ── IT IS SHOWN TO EVERY ROLE, AND ONLY THE CTA IS GATED ────────────────────
 * A coach is precisely the person who most needs the warning and has no other
 * way to get it (Franco, 2026-08-24). What IS owner-only is the way to stop it:
 * a non-owner gets the fact without a button that would refuse them.
 *
 * ── IT IS NOT DISMISSIBLE ───────────────────────────────────────────────────
 * `FreeDowngradeBanner` hides itself behind a localStorage key and that is the
 * right shape for a downgrade nobody can undo. A scheduled erasure is undoable
 * right up to the last day, so hiding it would hide the window in which the
 * decision can still be reversed.
 *
 * ── IT STATES THE DATE, NOT THE FACT ────────────────────────────────────────
 * "This studio will be deleted" is not actionable; "…on 21 September" is. The
 * date comes off `deletion_scheduled_for`, which is what `purgeScheduledTeams`
 * actually reads, rather than off `deletion_requested_at` — the two are thirty
 * days apart and only one of them answers "how long have I got?".
 *
 * No query of its own: `useAuth().team` is a live snapshot of the team
 * document, so this appears the moment the callable writes the field and
 * disappears within seconds of `cancelTeamDeletion` deleting it. Deliberately
 * no local copy of the state — a second source could disagree with the
 * snapshot, and this is the one banner that must never be stale in either
 * direction.
 */

import { useTranslations } from 'next-intl'
import { AlertTriangle } from 'lucide-react'
import type { Route } from 'next'
import { Link } from '@/i18n/navigation'
import { useAuth } from '@/contexts/AuthContext'

export function TeamDeletionBanner() {
  const t = useTranslations('DeleteAccount')
  const { team, teamRole } = useAuth()

  const scheduledMs = team?.deletion_scheduled_for?.toMillis?.() ?? null
  if (scheduledMs === null) return null

  const date = new Date(scheduledMs).toLocaleDateString()

  return (
    // `role="alert"` rather than `status`: this is the one strip in the shell
    // that announces the product removing itself.
    <div
      role="alert"
      className="border-b border-destructive/40 bg-destructive/10 px-4 py-2.5"
    >
      <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-x-3 gap-y-1.5">
        {/* Same glyph as DeleteAccountCard, so the strip and the card that can
            stop it read as one thing. */}
        <AlertTriangle className="h-4 w-4 shrink-0 text-destructive" />
        <p className="min-w-0 flex-1 text-sm">
          <span className="font-medium text-destructive">{t('bannerTitle', { date })}</span>{' '}
          <span className="text-destructive/80">{t('bannerBody')}</span>
        </p>
        {teamRole === 'owner' && (
          <Link
            href={'/settings/team' as Route}
            className="shrink-0 rounded-md border border-destructive/40 px-2.5 py-1 text-xs font-medium text-destructive transition-colors hover:bg-destructive/15"
          >
            {/* The EXISTING key the card's own cancel button uses. A separate
                near-identical string would be one more thing to keep in step
                across four locales, and this link leads to exactly that
                button. */}
            {t('cancelAction')}
          </Link>
        )}
      </div>
    </div>
  )
}
