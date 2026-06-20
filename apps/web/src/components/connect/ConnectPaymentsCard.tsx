'use client'

// Settings → Payments: Stripe Connect onboarding + status (member → studio).
// Renders nothing until an operator flips the per-team feature flag
// (teams/{teamId}.payments.connectEnabled) — the feature ships dark.

import { useState } from 'react'
import { useTranslations, useLocale } from 'next-intl'
import { CreditCard, CheckCircle2, AlertCircle, Loader2, ExternalLink } from 'lucide-react'
import { takeRatePercent, type ConnectOnboardingModel } from '@linyup/shared'
import { useAuth } from '@/contexts/AuthContext'
import { usePlan } from '@/hooks/usePlan'
import { useConnectStatus, useStartConnectOnboarding } from '@/hooks/useConnect'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Separator } from '@/components/ui/separator'

export function ConnectPaymentsCard({ teamId }: { teamId: string }) {
  const t = useTranslations('ConnectPayments')
  const locale = useLocale()
  const { team } = useAuth()
  const { plan } = usePlan()

  // Self-serve: owners can set up payments by default. An operator can disable a
  // team by setting payments.connectEnabled === false (kill-switch).
  const notDisabled = team?.payments?.connectEnabled !== false
  const { data: status, isLoading, refetch, isRefetching } = useConnectStatus(teamId, notDisabled)
  const start = useStartConnectOnboarding()
  const [model, setModel] = useState<ConnectOnboardingModel>('managed')

  if (!notDisabled) return null

  const feePct = plan ? takeRatePercent(plan) : null

  async function beginOnboarding(chosen: ConnectOnboardingModel) {
    const res = await start.mutateAsync({ teamId, model: chosen, locale })
    if (res?.url) window.location.href = res.url
  }

  const isEnabled = status?.status === 'enabled'
  const needsSetup =
    status?.connected && (status.status === 'pending' || status.status === 'restricted')

  return (
    <Card>
      <CardContent className="space-y-4 pt-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <CreditCard className="h-4 w-4 text-muted-foreground" />
          <p className="text-sm font-medium">{t('title')}</p>
        </div>
        {isEnabled ? (
          <Badge variant="secondary" className="bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200">
            <CheckCircle2 className="h-3 w-3 mr-1" />
            {t('statusEnabled')}
          </Badge>
        ) : needsSetup ? (
          <Badge variant="secondary" className="bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200">
            <AlertCircle className="h-3 w-3 mr-1" />
            {t('statusIncomplete')}
          </Badge>
        ) : null}
      </div>

      <p className="text-sm text-muted-foreground">{t('description')}</p>
      {feePct != null && (
        <p className="text-xs text-muted-foreground">{t('feeNote', { pct: feePct })}</p>
      )}

      <Separator />

      {isLoading ? (
        <Skeleton className="h-20 rounded" />
      ) : !status?.connected ? (
        // ── Not connected — choose onboarding model ──────────────────────────────
        <div className="space-y-3">
          <p className="text-sm font-medium">{t('chooseModel')}</p>
          <div className="grid gap-2 sm:grid-cols-2">
            <ModelOption
              active={model === 'managed'}
              onClick={() => setModel('managed')}
              title={t('managedTitle')}
              desc={t('managedDesc')}
            />
            <ModelOption
              active={model === 'byo'}
              onClick={() => setModel('byo')}
              title={t('byoTitle')}
              desc={t('byoDesc')}
            />
          </div>
          <Button onClick={() => beginOnboarding(model)} disabled={start.isPending}>
            {start.isPending ? (
              <Loader2 className="h-4 w-4 mr-1 animate-spin" />
            ) : (
              <ExternalLink className="h-4 w-4 mr-1" />
            )}
            {t('startSetup')}
          </Button>
        </div>
      ) : isEnabled ? (
        // ── Fully onboarded ──────────────────────────────────────────────────────
        <div className="space-y-2 text-sm">
          <p className="text-muted-foreground">{t('readyBody')}</p>
          <div className="flex flex-wrap gap-2">
            <CapabilityBadge ok={status.charges_enabled} label={t('chargesEnabled')} />
            <CapabilityBadge ok={status.payouts_enabled} label={t('payoutsEnabled')} />
          </div>
        </div>
      ) : (
        // ── Onboarding incomplete — finish setup ─────────────────────────────────
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">{t('incompleteBody')}</p>
          {!!status.requirements_currently_due?.length && (
            <ul className="list-disc pl-5 text-xs text-muted-foreground space-y-0.5">
              {status.requirements_currently_due.slice(0, 8).map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
          )}
          <div className="flex gap-2">
            <Button onClick={() => beginOnboarding(status.model ?? model)} disabled={start.isPending}>
              {start.isPending ? (
                <Loader2 className="h-4 w-4 mr-1 animate-spin" />
              ) : (
                <ExternalLink className="h-4 w-4 mr-1" />
              )}
              {t('finishSetup')}
            </Button>
            <Button variant="outline" onClick={() => refetch()} disabled={isRefetching}>
              {isRefetching && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
              {t('refreshStatus')}
            </Button>
          </div>
        </div>
      )}
      </CardContent>
    </Card>
  )
}

function ModelOption({
  active,
  onClick,
  title,
  desc,
}: {
  active: boolean
  onClick: () => void
  title: string
  desc: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`text-left rounded-lg border p-3 transition-colors ${
        active ? 'border-primary ring-1 ring-primary' : 'hover:border-muted-foreground/40'
      }`}
    >
      <p className="text-sm font-medium">{title}</p>
      <p className="text-xs text-muted-foreground mt-0.5">{desc}</p>
    </button>
  )
}

function CapabilityBadge({ ok, label }: { ok?: boolean; label: string }) {
  return (
    <Badge variant={ok ? 'secondary' : 'outline'} className="font-normal">
      {ok ? <CheckCircle2 className="h-3 w-3 mr-1" /> : <AlertCircle className="h-3 w-3 mr-1" />}
      {label}
    </Badge>
  )
}
