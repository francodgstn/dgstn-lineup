'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  collection, doc, getDoc, getDocs, query, updateDoc, where, orderBy,
} from 'firebase/firestore'
import { httpsCallable } from 'firebase/functions'
import { db, functions } from '@/lib/firebase'
import { useAuth } from '@/contexts/AuthContext'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import { toast } from 'sonner'
import { Gift, RefreshCw, Info } from 'lucide-react'
import {
  TEAMS_COLLECTION, CONTACTS_COLLECTION, REFERRALS_COLLECTION,
} from '@linyup/shared'

// ─── Types ────────────────────────────────────────────────────────────────────

type ReferralStatus = 'friend_booked' | 'friend_signed_up' | 'pending_reward' | 'rewarded'
type ReferralAction = 'confirm_membership' | 'mark_rewarded'

interface Referral {
  id: string
  referrer_contact_id: string
  referred_contact_id: string
  team_id: string
  status: ReferralStatus
  reward: { reward_type: string; reward_amount: number } | null
  reward_notes: string | null
  created_at: { toDate: () => Date } | null
}

interface Contact {
  id: string
  firstname: string
  lastname: string
}

const STATUS_FILTERS: { label: string; value: ReferralStatus | null }[] = [
  { label: 'All', value: null },
  { label: 'Friend Booked', value: 'friend_booked' },
  { label: 'Friend Signed Up', value: 'friend_signed_up' },
  { label: 'Pending Reward', value: 'pending_reward' },
  { label: 'Rewarded', value: 'rewarded' },
]

const STATUS_CONFIG: Record<ReferralStatus, { label: string; className: string }> = {
  friend_booked:    { label: 'Friend Booked',    className: 'bg-muted text-muted-foreground' },
  friend_signed_up: { label: 'Friend Signed Up', className: 'bg-blue-100 text-blue-700' },
  pending_reward:   { label: 'Pending Reward',   className: 'bg-amber-100 text-amber-700' },
  rewarded:         { label: 'Rewarded',         className: 'bg-green-100 text-green-700' },
}

function StatusBadge({ status }: { status: ReferralStatus }) {
  const cfg = STATUS_CONFIG[status] ?? { label: status, className: 'bg-muted text-muted-foreground' }
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${cfg.className}`}>
      {cfg.label}
    </span>
  )
}

function formatDate(ts: Referral['created_at']) {
  if (!ts) return '—'
  return ts.toDate().toLocaleDateString()
}

function getActionForStatus(status: ReferralStatus): ReferralAction | null {
  if (status === 'friend_signed_up') return 'confirm_membership'
  if (status === 'pending_reward') return 'mark_rewarded'
  return null
}

// ─── Action dialog ────────────────────────────────────────────────────────────

function ActionDialog({
  open,
  action,
  referral,
  referrerName,
  referredName,
  onConfirm,
  onClose,
}: {
  open: boolean
  action: ReferralAction | null
  referral: Referral | null
  referrerName: string
  referredName: string
  onConfirm: (payload: {
    action: ReferralAction
    reward?: { reward_type: string; reward_amount: number }
    reward_notes?: string
  }) => Promise<void>
  onClose: () => void
}) {
  const [rewardType, setRewardType] = useState('')
  const [rewardAmount, setRewardAmount] = useState('')
  const [rewardNotes, setRewardNotes] = useState('')
  const [loading, setLoading] = useState(false)

  if (!action || !referral) return null

  const isMarkRewarded = action === 'mark_rewarded'

  async function handleConfirm() {
    setLoading(true)
    try {
      const payload: Parameters<typeof onConfirm>[0] = { action: action! }
      if (isMarkRewarded) {
        payload.reward = { reward_type: rewardType.trim(), reward_amount: parseFloat(rewardAmount) }
        if (rewardNotes.trim()) payload.reward_notes = rewardNotes.trim()
      }
      await onConfirm(payload)
      setRewardType(''); setRewardAmount(''); setRewardNotes('')
      onClose()
    } finally {
      setLoading(false)
    }
  }

  const confirmDisabled = loading || (isMarkRewarded && (
    !rewardType.trim() || !rewardAmount || isNaN(parseFloat(rewardAmount)) || parseFloat(rewardAmount) <= 0
  ))

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose() }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{isMarkRewarded ? 'Mark as Rewarded' : 'Confirm Membership'}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="text-sm text-muted-foreground">
            <span>Referrer: </span><strong className="text-foreground">{referrerName}</strong>
            <br />
            <span>Referred: </span><strong className="text-foreground">{referredName}</strong>
          </div>
          {isMarkRewarded ? (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">Enter the reward details for the referrer.</p>
              <div className="space-y-1">
                <Label htmlFor="reward-type">Reward Type</Label>
                <Input
                  id="reward-type"
                  placeholder="e.g. Free Month, Discount, Gift Card"
                  value={rewardType}
                  onChange={(e) => setRewardType(e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="reward-amount">Reward Amount</Label>
                <Input
                  id="reward-amount"
                  type="number"
                  min={0}
                  step={0.01}
                  placeholder="e.g. 1, 50, 100"
                  value={rewardAmount}
                  onChange={(e) => setRewardAmount(e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="reward-notes">Notes (optional)</Label>
                <Textarea
                  id="reward-notes"
                  rows={2}
                  value={rewardNotes}
                  onChange={(e) => setRewardNotes(e.target.value)}
                />
              </div>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              Confirm that <strong className="text-foreground">{referredName}</strong> has completed
              membership. This will mark the referral as pending reward for{' '}
              <strong className="text-foreground">{referrerName}</strong>.
            </p>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={loading}>Cancel</Button>
          <Button onClick={handleConfirm} disabled={confirmDisabled}>
            {loading ? (isMarkRewarded ? 'Saving…' : 'Confirming…') : (isMarkRewarded ? 'Mark Rewarded' : 'Confirm Membership')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ─── Settings tab ─────────────────────────────────────────────────────────────

function SettingsTab({
  enabled,
  teamId,
  onToggle,
}: {
  enabled: boolean
  teamId: string
  onToggle: (v: boolean) => Promise<void>
}) {
  const [localEnabled, setLocalEnabled] = useState(enabled)
  const [saving, setSaving] = useState(false)
  const [generating, setGenerating] = useState(false)
  const isDirty = localEnabled !== enabled

  async function handleSave() {
    setSaving(true)
    try {
      await onToggle(localEnabled)
      toast.success('Referral settings saved')
    } catch {
      toast.error('Could not save settings')
    } finally {
      setSaving(false)
    }
  }

  async function handleGenerateCodes() {
    setGenerating(true)
    try {
      const fn = httpsCallable<{ teamId: string }, { generated: number }>(functions, 'generateReferralCodes')
      const result = await fn({ teamId })
      toast.success(`Generated ${result.data.generated} new referral codes`)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Could not generate referral codes'
      toast.error(msg)
    } finally {
      setGenerating(false)
    }
  }

  return (
    <div className="max-w-lg space-y-6">
      <div>
        <h2 className="text-base font-semibold">Referral Program Settings</h2>
        <p className="text-sm text-muted-foreground mt-1">
          When enabled, students can share a personal referral link with friends.
          The referral is tracked through the full lifecycle until you manually reward the referrer.
        </p>
      </div>

      <div className="flex items-center gap-3">
        <Switch
          id="referral-enabled"
          checked={localEnabled}
          onCheckedChange={setLocalEnabled}
        />
        <Label htmlFor="referral-enabled">Enable Referral Program</Label>
      </div>

      <div className="flex gap-2">
        <Button onClick={handleSave} disabled={!isDirty || saving}>
          {saving ? 'Saving…' : 'Save Settings'}
        </Button>
        <Button
          variant="outline"
          onClick={handleGenerateCodes}
          disabled={generating || !localEnabled}
          title="Generate referral codes for contacts that don't have one yet"
        >
          <RefreshCw className={`h-4 w-4 mr-2 ${generating ? 'animate-spin' : ''}`} />
          {generating ? 'Generating…' : 'Generate Codes'}
        </Button>
      </div>
    </div>
  )
}

// ─── Referrals list tab ───────────────────────────────────────────────────────

function ReferralsTab({
  teamId,
  referralEnabled,
}: {
  teamId: string
  referralEnabled: boolean
}) {
  const queryClient = useQueryClient()
  const [statusFilter, setStatusFilter] = useState<ReferralStatus | null>(null)
  const [selectedReferral, setSelectedReferral] = useState<Referral | null>(null)
  const [selectedAction, setSelectedAction] = useState<ReferralAction | null>(null)
  const [infoOpen, setInfoOpen] = useState(false)

  const { data: contacts = [] } = useQuery<Contact[]>({
    queryKey: ['referral-contacts', teamId],
    queryFn: async () => {
      const snap = await getDocs(
        query(collection(db, CONTACTS_COLLECTION), where('teamId', '==', teamId))
      )
      return snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Contact, 'id'>) }))
    },
  })

  const { data: referrals = [], isLoading } = useQuery<Referral[]>({
    queryKey: ['referrals', teamId],
    queryFn: async () => {
      const snap = await getDocs(
        query(
          collection(db, REFERRALS_COLLECTION),
          where('team_id', '==', teamId),
          orderBy('created_at', 'desc')
        )
      )
      return snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Referral, 'id'>) }))
    },
  })

  const contactNames: Record<string, string> = {}
  for (const c of contacts) {
    contactNames[c.id] = `${c.firstname || ''} ${c.lastname || ''}`.trim()
  }

  const visible = statusFilter ? referrals.filter((r) => r.status === statusFilter) : referrals

  async function handleConfirm(payload: {
    action: ReferralAction
    reward?: { reward_type: string; reward_amount: number }
    reward_notes?: string
  }) {
    if (!selectedReferral) return
    const fn = httpsCallable<
      { referralId: string; action: ReferralAction; reward?: { reward_type: string; reward_amount: number }; reward_notes?: string },
      { success: boolean; newStatus: string }
    >(functions, 'confirmReferral')
    await fn({ referralId: selectedReferral.id, ...payload })
    toast.success('Referral updated successfully')
    queryClient.invalidateQueries({ queryKey: ['referrals', teamId] })
  }

  const referrerName = selectedReferral ? (contactNames[selectedReferral.referrer_contact_id] ?? selectedReferral.referrer_contact_id) : ''
  const referredName = selectedReferral ? (contactNames[selectedReferral.referred_contact_id] ?? selectedReferral.referred_contact_id) : ''

  return (
    <div className="space-y-4">
      {!referralEnabled && (
        <div className="rounded-md bg-muted px-4 py-3 text-sm text-muted-foreground">
          The referral program is currently disabled. Enable it in the Settings tab to allow students to share referral links.
        </div>
      )}

      {/* Status filters + info */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="flex gap-1.5 flex-wrap flex-1">
          {STATUS_FILTERS.map((f) => (
            <Button
              key={String(f.value)}
              size="sm"
              variant={statusFilter === f.value ? 'secondary' : 'ghost'}
              onClick={() => setStatusFilter(f.value)}
            >
              {f.label}
            </Button>
          ))}
        </div>
        <Button size="sm" variant="ghost" onClick={() => setInfoOpen(true)} title="Status guide">
          <Info className="h-4 w-4" />
        </Button>
      </div>

      {/* Table */}
      {isLoading ? (
        <div className="space-y-2">
          {[1, 2, 3].map((i) => <Skeleton key={i} className="h-10 rounded" />)}
        </div>
      ) : visible.length === 0 ? (
        <p className="text-center text-sm text-muted-foreground py-12">No referrals found.</p>
      ) : (
        <div className="rounded-md border overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Referrer</TableHead>
                <TableHead>Friend (Referred)</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Date</TableHead>
                <TableHead>Reward</TableHead>
                <TableHead className="text-right">Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visible.map((r) => {
                const action = getActionForStatus(r.status)
                return (
                  <TableRow key={r.id}>
                    <TableCell>{contactNames[r.referrer_contact_id] ?? r.referrer_contact_id}</TableCell>
                    <TableCell>{contactNames[r.referred_contact_id] ?? r.referred_contact_id}</TableCell>
                    <TableCell><StatusBadge status={r.status} /></TableCell>
                    <TableCell>{formatDate(r.created_at)}</TableCell>
                    <TableCell>
                      {r.reward
                        ? <span className="text-sm">{r.reward.reward_type} × {r.reward.reward_amount}</span>
                        : <span className="text-muted-foreground">—</span>}
                    </TableCell>
                    <TableCell className="text-right">
                      {action && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => { setSelectedReferral(r); setSelectedAction(action) }}
                        >
                          {action === 'confirm_membership' ? 'Confirm Membership' : 'Mark Rewarded'}
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </div>
      )}

      <ActionDialog
        open={!!selectedReferral && !!selectedAction}
        action={selectedAction}
        referral={selectedReferral}
        referrerName={referrerName}
        referredName={referredName}
        onConfirm={handleConfirm}
        onClose={() => { setSelectedReferral(null); setSelectedAction(null) }}
      />

      {/* Status info dialog */}
      <Dialog open={infoOpen} onOpenChange={setInfoOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Referral Statuses</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 text-sm">
            <p className="text-muted-foreground">Referrals progress through the following statuses as you take action on them.</p>
            {([
              { status: 'friend_booked' as ReferralStatus, description: "A referred friend has booked a trial session using the referrer's personal link. No action needed yet." },
              { status: 'friend_signed_up' as ReferralStatus, description: 'The friend attended and expressed interest in signing up. Confirm their membership to advance the referral.' },
              { status: 'pending_reward' as ReferralStatus, description: 'Membership is confirmed. The referrer is owed a reward — mark it as rewarded once delivered.' },
              { status: 'rewarded' as ReferralStatus, description: 'The referrer has received their reward. This referral is complete.' },
            ]).map(({ status, description }) => (
              <div key={status} className="space-y-1">
                <StatusBadge status={status} />
                <p className="text-muted-foreground text-xs">{description}</p>
              </div>
            ))}
            <p className="text-muted-foreground text-xs pt-1">
              <strong>Flow:</strong> Friend Booked → Friend Signed Up → Pending Reward → Rewarded
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setInfoOpen(false)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function ReferralsPluginPage() {
  const { currentTeamId } = useAuth()
  const queryClient = useQueryClient()
  const [activeTab, setActiveTab] = useState<'settings' | 'referrals'>('referrals')

  const { data: team, isLoading } = useQuery({
    queryKey: ['team-referral-settings', currentTeamId],
    enabled: !!currentTeamId,
    queryFn: async () => {
      const snap = await getDoc(doc(db, TEAMS_COLLECTION, currentTeamId!))
      return snap.data() as { settings?: { referral?: { enabled?: boolean } } } | undefined
    },
  })

  const referralEnabled = !!team?.settings?.referral?.enabled

  const saveSettingsMutation = useMutation({
    mutationFn: async (enabled: boolean) => {
      if (!currentTeamId) throw new Error('Not authenticated')
      await updateDoc(doc(db, TEAMS_COLLECTION, currentTeamId), {
        'settings.referral.enabled': enabled,
      })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['team-referral-settings', currentTeamId] })
    },
    onError: () => toast.error('Could not save referral settings'),
  })

  if (isLoading || !currentTeamId) {
    return (
      <div className="max-w-3xl space-y-6">
        <Skeleton className="h-7 w-40" />
        <Skeleton className="h-4 w-64" />
        <Skeleton className="h-40 rounded-lg" />
      </div>
    )
  }

  return (
    <div className="max-w-3xl space-y-6">
      {/* Header */}
      <div className="flex items-center gap-2">
        <Gift className="h-5 w-5 text-muted-foreground" />
        <div>
          <h1 className="text-2xl font-semibold">Referral Program</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Track member referrals and manage rewards.
          </p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b">
        {(['referrals', 'settings'] as const).map((tab) => (
          <button
            key={tab}
            type="button"
            onClick={() => setActiveTab(tab)}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
              activeTab === tab
                ? 'border-primary text-primary'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            {tab === 'referrals' ? 'Referrals' : 'Settings'}
          </button>
        ))}
      </div>

      {activeTab === 'settings' && (
        <SettingsTab
          enabled={referralEnabled}
          teamId={currentTeamId}
          onToggle={(v) => saveSettingsMutation.mutateAsync(v)}
        />
      )}
      {activeTab === 'referrals' && (
        <ReferralsTab teamId={currentTeamId} referralEnabled={referralEnabled} />
      )}
    </div>
  )
}
