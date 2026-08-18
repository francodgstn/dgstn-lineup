'use client'

/**
 * "Did my rule fire, and what happened?" — the studio-facing read of
 * `teams/{teamId}/automation_logs`.
 *
 * That collection has been written by every trigger path since the port —
 * `runRule`'s event tier, `runScheduledRules`' daily sweep, the `Run now`
 * callable, and `executeDelayedRule` — and until this file it had no reader in
 * the app at all. It is NOT dead data: `executeDelayedRule` queries it by
 * `idempotency_key` as its dedup guard, so a delayed task that already ran is a
 * no-op precisely because a row is here. Deleting or trimming it would re-send
 * mail. The problem was never that it was written; it was that the only person
 * who could not see it was the studio whose rule it was (UX-48).
 *
 * WHY IT MATTERS MORE NOW: a delayed rule fires HOURS OR DAYS after the thing
 * that triggered it, from a Cloud Task nobody watches. The rule card's
 * `last_run_at` says only "something happened once"; this says which runs
 * happened, in which tier, and how many people each one reached.
 *
 * WHAT IT HONESTLY CANNOT ANSWER: "to whom". `AutomationLogData` records
 * COUNTS — matched / executed / failed — and no recipient list, so this dialog
 * states counts and points at the preview (which answers "who does this hit"
 * for the rule as it stands right now) rather than inventing a roster it does
 * not have.
 */

import { useTranslations, useMessages } from 'next-intl'
import { useQuery } from '@tanstack/react-query'
import { collection, getDocs, limit, orderBy, query, where } from 'firebase/firestore'
import type { Timestamp } from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { TEAMS_COLLECTION, AUTOMATION_LOGS_SUBCOLLECTION } from '@linyup/shared'
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { QueryErrorState } from '@/components/ui/query-error'
import { AlertTriangle, History } from 'lucide-react'

/** How many runs are fetched. A busy team fires several a day; a few weeks of
 *  history is what makes "did last Tuesday's reminder go out?" answerable, and
 *  more than that belongs in an export nobody has asked for yet. */
const HISTORY_LIMIT = 100

interface AutomationLogRow {
  id: string
  rule_id: string
  rule_name: string
  trigger_type: string
  trigger_tier: string
  contacts_matched: number
  actions_executed: number
  actions_failed: number
  error?: string
  triggered_at?: Timestamp | null
  session_id?: string
}

function toRow(id: string, data: Record<string, unknown>): AutomationLogRow {
  return {
    id,
    rule_id: (data.rule_id as string) ?? '',
    rule_name: (data.rule_name as string) ?? '',
    trigger_type: (data.trigger_type as string) ?? '',
    trigger_tier: (data.trigger_tier as string) ?? '',
    contacts_matched: (data.contacts_matched as number) ?? 0,
    actions_executed: (data.actions_executed as number) ?? 0,
    actions_failed: (data.actions_failed as number) ?? 0,
    error: (data.error as string) || undefined,
    triggered_at: (data.triggered_at as Timestamp | undefined) ?? null,
    session_id: (data.session_id as string) || undefined,
  }
}

/**
 * Reads the log rows. Scoped to ONE rule when `ruleId` is given — the rule menu's
 * entry — and otherwise the whole team's recent runs. The scoped shape needs the
 * (rule_id, triggered_at desc) composite index in `firestore.index.json`;
 * filtering the unscoped page in memory instead would silently lose a quiet
 * rule's runs behind a noisy one's.
 */
function useAutomationLogs(teamId: string | null, ruleId: string | null) {
  return useQuery<AutomationLogRow[]>({
    queryKey: ['automation_logs', teamId, ruleId],
    enabled: !!teamId,
    queryFn: async () => {
      if (!teamId) return []
      const col = collection(db, TEAMS_COLLECTION, teamId, AUTOMATION_LOGS_SUBCOLLECTION)
      const q = ruleId
        ? query(
            col,
            where('rule_id', '==', ruleId),
            orderBy('triggered_at', 'desc'),
            limit(HISTORY_LIMIT)
          )
        : query(col, orderBy('triggered_at', 'desc'), limit(HISTORY_LIMIT))
      const snap = await getDocs(q)
      return snap.docs.map((d) => toRow(d.id, d.data()))
    },
  })
}

function formatWhen(ts: Timestamp | null | undefined, locale: string): string {
  if (!ts) return ''
  return ts.toDate().toLocaleString(locale, {
    dateStyle: 'medium',
    timeStyle: 'short',
  })
}

export function RunHistoryDialog({
  open,
  onOpenChange,
  teamId,
  ruleId = null,
  ruleName,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  teamId: string
  /** null → every rule's runs. */
  ruleId?: string | null
  ruleName?: string
}) {
  const t = useTranslations('Automations')
  // Trigger labels live under `Automations.triggers.*`, but a PLUGIN trigger id
  // (`plugin:referrals:referral_created`) has no key there — and a missing key
  // renders the raw id to the user. Reading the message tree lets an unknown id
  // fall back to the stored string instead.
  const messages = useMessages() as unknown as {
    Automations?: { triggers?: Record<string, string> }
  }
  const triggerLabel = (type: string) => messages.Automations?.triggers?.[type] ?? type

  const { data: rows = [], isLoading, error, refetch } = useAutomationLogs(
    open ? teamId : null,
    ruleId
  )

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <History className="h-4 w-4" />
            {t('history.title')}
          </DialogTitle>
          <DialogDescription>
            {ruleName ? t('history.subtitleForRule', { name: ruleName }) : t('history.subtitle')}
          </DialogDescription>
        </DialogHeader>

        <DialogBody className="space-y-3">
          {isLoading ? (
            <div className="space-y-2">
              <Skeleton className="h-14 rounded-lg" />
              <Skeleton className="h-14 rounded-lg" />
              <Skeleton className="h-14 rounded-lg" />
            </div>
          ) : error ? (
            <QueryErrorState
              onRetry={() => void refetch()}
              detail={error instanceof Error ? error.message : null}
            />
          ) : rows.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">{t('history.empty')}</p>
          ) : (
            <div className="divide-y rounded-lg border">
              {rows.map((row) => (
                <RunRow key={row.id} row={row} showRuleName={!ruleId} triggerLabel={triggerLabel} />
              ))}
            </div>
          )}

          {/* The one thing the log does not record. Said plainly rather than
              implied by its absence. */}
          <p className="text-xs text-muted-foreground">{t('history.recipientsNote')}</p>
        </DialogBody>
      </DialogContent>
    </Dialog>
  )
}

function RunRow({
  row,
  showRuleName,
  triggerLabel,
}: {
  row: AutomationLogRow
  showRuleName: boolean
  triggerLabel: (type: string) => string
}) {
  const t = useTranslations('Automations')
  // Dates follow the BROWSER locale — the repo's convention for date formatting
  // (CLAUDE.md), not the message locale.
  const when = formatWhen(
    row.triggered_at,
    typeof navigator !== 'undefined' ? navigator.language : 'en'
  )

  const tierKey = ['event', 'delayed', 'scheduled', 'manual'].includes(row.trigger_tier)
    ? (`history.tier_${row.trigger_tier}` as Parameters<typeof t>[0])
    : null

  return (
    <div className="space-y-1 px-3 py-2.5">
      <div className="flex items-baseline justify-between gap-2">
        <p className="min-w-0 flex-1 truncate text-sm font-medium">
          {showRuleName ? row.rule_name || t('ruleCard.unnamed') : triggerLabel(row.trigger_type)}
        </p>
        <span className="shrink-0 text-xs text-muted-foreground">{when}</span>
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        {tierKey && (
          <Badge variant="secondary" className="text-[11px]">
            {t(tierKey)}
          </Badge>
        )}
        {showRuleName && (
          <span className="text-xs text-muted-foreground">{triggerLabel(row.trigger_type)}</span>
        )}
      </div>

      <p className="text-xs text-muted-foreground">
        {t('history.counts', {
          matched: row.contacts_matched,
          executed: row.actions_executed,
        })}
        {row.actions_failed > 0 && (
          <span className="ml-1 font-medium text-destructive">
            {t('history.failedCount', { count: row.actions_failed })}
          </span>
        )}
      </p>

      {row.error && (
        <p className="flex items-start gap-1.5 text-xs text-destructive">
          <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
          <span className="break-words">{row.error}</span>
        </p>
      )}
    </div>
  )
}
