'use client'

// Gift cards (E3) admin surface — lives on the Payments dashboard (like the
// partner-visits card). Three blocks:
//  • Settings — enabled switch + the purchasable face-value list, persisted to
//    teams/{id}.settings.giftCards (owner-only team-doc write, same pattern as
//    BookingInstructionsCard). syncTeamPublicProfile mirrors it (enabled +
//    amounts only, never balances) so the public shop can offer it.
//  • Issue — the manager mint (issueGiftCard): a card sold at the counter for
//    cash, or comped. Deliberately NOT gated on the settings switch above or on
//    its amount list: that switch is the public shop tab, and the front desk
//    sells CHF 73 whether or not the shop offers a 73 tile.
//  • Recent gift cards — teams/{id}/gift_cards, manager read via firestore.rules.
//    Codes are shown in full (managers can already read the doc), with a Void
//    action (confirm dialog) for lost/fraudulent cards.

import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { doc, updateDoc } from 'firebase/firestore'
import { db } from '@/lib/firebase'
import {
  DEFAULT_PAYMENT_MODES,
  TEAMS_COLLECTION,
  type GiftCardIssueKind,
  type GiftCardSettings,
} from '@linyup/shared'
import { useAuth } from '@/contexts/AuthContext'
import { useIssueGiftCard, useTeamGiftCards, useVoidGiftCard } from '@/hooks/useGiftCards'
import { formatMoneyMajor, formatPaymentDate } from '@/lib/payments'
import { ContactPicker } from '@/components/payments/ContactPicker'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { toast } from 'sonner'
import { Gift, Loader2, Plus, X } from 'lucide-react'
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

/**
 * The manager mint. Two kinds, and the difference is a bookkeeping one the
 * dialog states out loud rather than hiding behind a toggle:
 *  • paid — money came in over the counter, so a manual payment row is written
 *    and the studio's books show the sale.
 *  • comp — nothing came in, so NOTHING is written to the books (this ledger is
 *    cash-basis). The reason is required instead, and lands on the card.
 */
function IssueGiftCardDialog({
  teamId,
  open,
  onClose,
}: {
  teamId: string
  open: boolean
  onClose: () => void
}) {
  const t = useTranslations('PaymentsDashboard')
  const { team } = useAuth()
  const currency = team?.default_currency ?? 'CHF'
  const issue = useIssueGiftCard()

  const modes =
    team?.payment_modes && team.payment_modes.length > 0
      ? team.payment_modes
      : [...DEFAULT_PAYMENT_MODES]

  const [amount, setAmount] = useState('')
  const [kind, setKind] = useState<'paid' | 'comp'>('paid')
  const [mode, setMode] = useState('')
  const [reason, setReason] = useState('')
  const [contactId, setContactId] = useState('')
  const [error, setError] = useState<string | null>(null)
  // The server dedupes on this key, so it is minted ONCE per dialog opening and
  // reused across every submit attempt inside it: a double click, or a retry
  // after a network blip, must resolve to the same card rather than two.
  const [idempotencyKey, setIdempotencyKey] = useState('')

  useEffect(() => {
    if (!open) return
    setAmount('')
    setKind('paid')
    setMode('')
    setReason('')
    setContactId('')
    setError(null)
    setIdempotencyKey(crypto.randomUUID())
  }, [open])

  const amountMajor = Number(amount)
  const amountValid = Number.isFinite(amountMajor) && amountMajor > 0
  const canSubmit = amountValid && (kind === 'paid' || reason.trim().length > 0)

  async function submit() {
    if (!canSubmit || !idempotencyKey) return
    setError(null)
    try {
      const res = await issue.mutateAsync({
        teamId,
        amountMajor,
        issueKind: kind,
        idempotencyKey,
        ...(kind === 'paid' && mode ? { paymentMode: mode } : {}),
        ...(kind === 'comp' ? { issueReason: reason.trim() } : {}),
        ...(contactId ? { purchaserContactId: contactId } : {}),
      })
      toast.success(t('giftCardIssueSuccess', { code: res.code }))
      onClose()
    } catch {
      setError(t('giftCardIssueError'))
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('giftCardIssueTitle')}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="gift-issue-amount">
              {t('giftCardIssueAmountLabel')} ({currency})
            </Label>
            <Input
              id="gift-issue-amount"
              type="number"
              min={1}
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder={t('giftCardAmountPlaceholder')}
            />
          </div>

          <div className="space-y-2">
            <Label>{t('giftCardIssueKindLabel')}</Label>
            <RadioGroup value={kind} onValueChange={(v) => setKind(v as 'paid' | 'comp')}>
              <div className="flex items-start gap-2">
                <RadioGroupItem value="paid" id="gift-issue-paid" className="mt-0.5" />
                <div>
                  <Label htmlFor="gift-issue-paid" className="font-normal">
                    {t('giftCardIssueKindPaid')}
                  </Label>
                  <p className="text-xs text-muted-foreground">{t('giftCardIssueKindPaidHelp')}</p>
                </div>
              </div>
              <div className="flex items-start gap-2">
                <RadioGroupItem value="comp" id="gift-issue-comp" className="mt-0.5" />
                <div>
                  <Label htmlFor="gift-issue-comp" className="font-normal">
                    {t('giftCardIssueKindComp')}
                  </Label>
                  <p className="text-xs text-muted-foreground">{t('giftCardIssueKindCompHelp')}</p>
                </div>
              </div>
            </RadioGroup>
          </div>

          {kind === 'paid' ? (
            <div className="space-y-1.5">
              <Label>{t('giftCardIssueModeLabel')}</Label>
              <Select value={mode} onValueChange={(m) => m && setMode(m)}>
                <SelectTrigger>
                  <SelectValue placeholder={t('giftCardIssueModeLabel')} />
                </SelectTrigger>
                <SelectContent>
                  {modes.map((m) => (
                    <SelectItem key={m} value={m}>
                      {m}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : (
            <div className="space-y-1.5">
              <Label htmlFor="gift-issue-reason">{t('giftCardIssueReasonLabel')}</Label>
              <Input
                id="gift-issue-reason"
                value={reason}
                maxLength={200}
                onChange={(e) => setReason(e.target.value)}
              />
              {!reason.trim() && (
                <p className="text-xs text-muted-foreground">
                  {t('giftCardIssueReasonRequired')}
                </p>
              )}
            </div>
          )}

          <div className="space-y-1.5">
            <Label>{t('giftCardIssuePurchaserLabel')}</Label>
            <ContactPicker teamId={teamId} value={contactId} onChange={setContactId} />
          </div>

          {error && <p className="text-xs text-destructive">{error}</p>}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={issue.isPending}>
            {t('cancel')}
          </Button>
          <Button onClick={submit} disabled={!canSubmit || issue.isPending}>
            {issue.isPending && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
            {t('giftCardIssue')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function GiftCardsListCard() {
  const t = useTranslations('PaymentsDashboard')
  const { currentTeamId, team } = useAuth()
  const currency = team?.default_currency ?? 'CHF'
  const { data: cards = [], isLoading } = useTeamGiftCards(currentTeamId)
  const voidCard = useVoidGiftCard()
  const [voidTarget, setVoidTarget] = useState<string | null>(null)
  const [issueOpen, setIssueOpen] = useState(false)

  async function confirmVoid() {
    if (!currentTeamId || !voidTarget) return
    await voidCard.mutateAsync({ teamId: currentTeamId, code: voidTarget })
    setVoidTarget(null)
  }

  if (isLoading) return <Skeleton className="h-32 rounded" />

  return (
    <>
      <div className="flex justify-end">
        <Button size="sm" variant="outline" onClick={() => setIssueOpen(true)}>
          <Plus className="h-4 w-4 mr-1" />
          {t('giftCardIssue')}
        </Button>
      </div>
      {currentTeamId && (
        <IssueGiftCardDialog
          teamId={currentTeamId}
          open={issueOpen}
          onClose={() => setIssueOpen(false)}
        />
      )}

      <Card>
        <CardContent className="p-0 divide-y">
          {cards.length === 0 ? (
            <p className="text-sm text-muted-foreground py-6 text-center">
              {t('giftCardsEmpty')}
            </p>
          ) : (
            cards.map((c) => {
              // Cards minted before the origin axis existed could only come from
              // the shop, so an absent kind reads as a purchase.
              const origin: GiftCardIssueKind = c.issue_kind ?? 'purchase'
              return (
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
                  {/* An audit field nobody can see is not an audit trail: a comp
                      is value given away, so who did it and why is shown inline. */}
                  {origin === 'admin_comp' && (
                    <p className="text-xs text-muted-foreground truncate">
                      {t('giftCardIssuedByLine', {
                        name: c.issued_by_name || c.issued_by || '—',
                        reason: c.issue_reason || '—',
                      })}
                    </p>
                  )}
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <Badge variant="outline">
                    {t(`giftCardOrigin_${origin}` as Parameters<typeof t>[0])}
                  </Badge>
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
              )
            })
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

/** @param showHeading false when the caller already names the section — e.g.
 *  inside a tab, where the tab label would repeat this heading verbatim. */
export function GiftCardsSection({ showHeading = true }: { showHeading?: boolean }) {
  const t = useTranslations('PaymentsDashboard')
  return (
    <section className="space-y-3">
      {showHeading && <h2 className="text-sm font-medium">{t('giftCardsHeading')}</h2>}
      <GiftCardSettingsCard />
      <GiftCardsListCard />
    </section>
  )
}
