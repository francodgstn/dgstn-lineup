'use client'

// Gift cards (E3) admin surface — lives on the Payments dashboard (like the
// partner-visits card). Two blocks:
//  • Settings — enabled switch + the purchasable face-value list, persisted to
//    teams/{id}.settings.giftCards (owner-only team-doc write, same pattern as
//    BookingInstructionsCard). syncTeamPublicProfile mirrors it (enabled +
//    amounts only, never balances) so the public shop can offer it.
//  • Recent gift cards — teams/{id}/gift_cards, manager read via firestore.rules.
//    Codes are shown in full (managers can already read the doc), with a Void
//    action (confirm dialog) for lost/fraudulent cards.

import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { doc, updateDoc } from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { TEAMS_COLLECTION, type GiftCardSettings } from '@linyup/shared'
import { useAuth } from '@/contexts/AuthContext'
import { useTeamGiftCards, useVoidGiftCard } from '@/hooks/useGiftCards'
import { formatMoneyMajor, formatPaymentDate } from '@/lib/payments'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Gift, Loader2, X } from 'lucide-react'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'

function getGiftCardSettings(settings: Record<string, unknown> | undefined): GiftCardSettings {
  const raw = (settings?.giftCards ?? null) as Partial<GiftCardSettings> | null
  return {
    enabled: raw?.enabled === true,
    amounts: Array.isArray(raw?.amounts) ? (raw!.amounts as number[]) : [],
  }
}

function GiftCardSettingsCard() {
  const t = useTranslations('PaymentsDashboard')
  const { currentTeamId, team, teamRole } = useAuth()
  const canEdit = teamRole === 'owner'

  const stored = getGiftCardSettings(team?.settings as Record<string, unknown> | undefined)
  const [enabled, setEnabled] = useState(stored.enabled)
  const [amounts, setAmounts] = useState<number[]>(stored.amounts)
  const [newAmount, setNewAmount] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    setEnabled(stored.enabled)
    setAmounts(stored.amounts)
    // Only re-sync when the team doc itself changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [team?.id, stored.enabled, stored.amounts.join(',')])

  const dirty = enabled !== stored.enabled || amounts.join(',') !== stored.amounts.join(',')

  function addAmount() {
    const n = Number(newAmount)
    if (!Number.isFinite(n) || n <= 0 || amounts.includes(n)) return
    setAmounts([...amounts, n].sort((a, b) => a - b))
    setNewAmount('')
  }

  function removeAmount(n: number) {
    setAmounts(amounts.filter((a) => a !== n))
  }

  async function save() {
    if (!currentTeamId || !canEdit) return
    setSaving(true)
    try {
      await updateDoc(doc(db, TEAMS_COLLECTION, currentTeamId), {
        'settings.giftCards': { enabled, amounts } satisfies GiftCardSettings,
      })
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card>
      <CardContent className="space-y-4 p-4">
        <div className="flex items-start gap-2.5">
          <Gift className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" />
          <div className="min-w-0 flex-1">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-sm font-semibold">{t('giftCardsSettingsTitle')}</h2>
              <Switch checked={enabled} onCheckedChange={setEnabled} disabled={!canEdit} />
            </div>
            <p className="text-xs text-muted-foreground mt-0.5">{t('giftCardsSettingsSubtitle')}</p>
            {!canEdit && (
              <p className="text-xs text-muted-foreground mt-0.5">{t('ownerOnly')}</p>
            )}
          </div>
        </div>

        {enabled && (
          <div className="space-y-2">
            <p className="text-xs font-medium text-muted-foreground">{t('giftCardAmountsLabel')}</p>
            <div className="flex flex-wrap gap-2">
              {amounts.map((a) => (
                <span
                  key={a}
                  className="inline-flex items-center gap-1 rounded-full border bg-muted/40 px-2.5 py-1 text-xs font-medium"
                >
                  {formatMoneyMajor(a, team?.default_currency ?? 'CHF')}
                  {canEdit && (
                    <button
                      type="button"
                      onClick={() => removeAmount(a)}
                      aria-label={t('giftCardRemoveAmount')}
                    >
                      <X className="h-3 w-3 text-muted-foreground" />
                    </button>
                  )}
                </span>
              ))}
              {amounts.length === 0 && (
                <p className="text-xs text-muted-foreground">{t('giftCardNoAmounts')}</p>
              )}
            </div>
            {canEdit && (
              <div className="flex items-center gap-2">
                <Input
                  type="number"
                  min={1}
                  value={newAmount}
                  onChange={(e) => setNewAmount(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault()
                      addAmount()
                    }
                  }}
                  placeholder={t('giftCardAmountPlaceholder')}
                  className="h-8 w-32 text-sm"
                />
                <Button size="sm" variant="outline" onClick={addAmount} disabled={!newAmount}>
                  {t('giftCardAddAmount')}
                </Button>
              </div>
            )}
          </div>
        )}

        {canEdit && (
          <div className="flex justify-end">
            <Button size="sm" onClick={save} disabled={!dirty || saving}>
              {saving && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
              {t('save')}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function GiftCardsListCard() {
  const t = useTranslations('PaymentsDashboard')
  const { currentTeamId, team } = useAuth()
  const currency = team?.default_currency ?? 'CHF'
  const { data: cards = [], isLoading } = useTeamGiftCards(currentTeamId)
  const voidCard = useVoidGiftCard()
  const [voidTarget, setVoidTarget] = useState<string | null>(null)

  async function confirmVoid() {
    if (!currentTeamId || !voidTarget) return
    await voidCard.mutateAsync({ teamId: currentTeamId, code: voidTarget })
    setVoidTarget(null)
  }

  if (isLoading) return <Skeleton className="h-32 rounded" />

  return (
    <>
      <Card>
        <CardContent className="p-0 divide-y">
          {cards.length === 0 ? (
            <p className="text-sm text-muted-foreground py-6 text-center">
              {t('giftCardsEmpty')}
            </p>
          ) : (
            cards.map((c) => (
              <div key={c.code} className="flex items-center gap-3 p-3">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium font-mono truncate">{c.code}</p>
                  <p className="text-xs text-muted-foreground truncate">
                    {t('giftCardBalanceLine', {
                      balance: formatMoneyMajor(c.balance, c.currency || currency),
                      amount: formatMoneyMajor(c.amount, c.currency || currency),
                    })}
                    {c.created_at ? ` · ${formatPaymentDate(c.created_at)}` : ''}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <Badge
                    variant={
                      c.status === 'active'
                        ? 'secondary'
                        : c.status === 'depleted'
                          ? 'outline'
                          : 'destructive'
                    }
                  >
                    {t(`giftCardStatus_${c.status}` as Parameters<typeof t>[0])}
                  </Badge>
                  {c.status === 'active' && (
                    <Button size="sm" variant="outline" onClick={() => setVoidTarget(c.code)}>
                      {t('giftCardVoid')}
                    </Button>
                  )}
                </div>
              </div>
            ))
          )}
        </CardContent>
      </Card>

      <AlertDialog open={!!voidTarget} onOpenChange={(o) => !o && setVoidTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('giftCardVoidConfirmTitle')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('giftCardVoidConfirmBody', { code: voidTarget ?? '' })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('cancel')}</AlertDialogCancel>
            <AlertDialogAction onClick={confirmVoid} disabled={voidCard.isPending}>
              {voidCard.isPending && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
              {t('giftCardVoid')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

export function GiftCardsSection() {
  const t = useTranslations('PaymentsDashboard')
  return (
    <section className="space-y-3">
      <h2 className="text-sm font-medium">{t('giftCardsHeading')}</h2>
      <GiftCardSettingsCard />
      <GiftCardsListCard />
    </section>
  )
}
