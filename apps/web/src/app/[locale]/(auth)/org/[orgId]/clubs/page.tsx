'use client'

import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { collection, getDocs, query, where } from 'firebase/firestore'
import { httpsCallable } from 'firebase/functions'
import { db, functions } from '@/lib/firebase'
import { useTranslations } from 'next-intl'
import { useOrg } from '@/contexts/OrgContext'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
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
import { Building2, Plus, Trash2 } from 'lucide-react'
import { useParams } from 'next/navigation'
import { ORGANIZATIONS_COLLECTION, ORG_TEAMS_SUBCOLLECTION } from '@lineup/shared'
import type { OrgTeam } from '@lineup/shared'

interface OrgTeamRow extends OrgTeam {
  id: string
  teamName?: string
}

function useOrgTeams(orgId: string) {
  return useQuery<OrgTeamRow[]>({
    queryKey: ['org-teams', orgId],
    queryFn: async () => {
      const snap = await getDocs(
        query(
          collection(db, ORGANIZATIONS_COLLECTION, orgId, ORG_TEAMS_SUBCOLLECTION),
          where('status', 'in', ['active', 'invited'])
        )
      )
      const rows = snap.docs.map((d) => ({ id: d.id, ...d.data() } as OrgTeamRow))

      // Enrich with team names
      await Promise.all(
        rows.map(async (row) => {
          const teamSnap = await getDocs(
            query(collection(db, 'teams'), where('__name__', '==', row.teamId))
          )
          if (!teamSnap.empty) {
            row.teamName = teamSnap.docs[0].data().name
          }
        })
      )
      return rows
    },
  })
}

// ─── InviteDialog ─────────────────────────────────────────────────────────────

function InviteDialog({
  open,
  orgId,
  onClose,
  onSuccess,
}: {
  open: boolean
  orgId: string
  onClose: () => void
  onSuccess: () => void
}) {
  const t = useTranslations('OrgClubs')
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!email.trim()) return
    setLoading(true)
    setError(null)
    try {
      const fn = httpsCallable(functions, 'inviteClubToOrg')
      await fn({ orgId, inviteeEmail: email.trim() })
      setEmail('')
      onSuccess()
      onClose()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t('inviteTitle')}</DialogTitle>
          <DialogDescription>{t('inviteDescription')}</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 pt-2">
          <div className="space-y-1.5">
            <Label htmlFor="invite-email">{t('inviteEmail')}</Label>
            <Input
              id="invite-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="owner@club.example.com"
              required
            />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={loading}>
              {t('cancel')}
            </Button>
            <Button type="submit" disabled={loading || !email.trim()}>
              {loading ? t('sending') : t('inviteSubmit')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function OrgClubsPage() {
  const { orgId } = useParams<{ orgId: string }>()
  const t = useTranslations('OrgClubs')
  const { isAdmin } = useOrg()
  const qc = useQueryClient()
  const { data: teams, isLoading } = useOrgTeams(orgId)

  const [inviteOpen, setInviteOpen] = useState(false)
  const [removeTarget, setRemoveTarget] = useState<OrgTeamRow | null>(null)
  const [actionLoading, setActionLoading] = useState(false)
  const [toast, setToast] = useState<string | null>(null)

  function showToast(msg: string) {
    setToast(msg)
    setTimeout(() => setToast(null), 3500)
  }

  function invalidate() {
    qc.invalidateQueries({ queryKey: ['org-teams', orgId] })
  }

  async function handleRemove() {
    if (!removeTarget) return
    setActionLoading(true)
    try {
      const fn = httpsCallable(functions, 'removeClubFromOrg')
      await fn({ orgId: orgId, teamId: removeTarget.teamId })
      showToast(t('removedSuccess'))
      invalidate()
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Error')
    } finally {
      setActionLoading(false)
      setRemoveTarget(null)
    }
  }

  function statusVariant(status: string) {
    if (status === 'active') return 'default' as const
    if (status === 'invited') return 'secondary' as const
    return 'outline' as const
  }

  function statusLabel(status: string) {
    if (status === 'active') return t('statusActive')
    if (status === 'invited') return t('statusInvited')
    return t('statusRemoved')
  }

  function formatDate(ts: { seconds: number } | null | undefined) {
    if (!ts) return ''
    return new Date(ts.seconds * 1000).toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    })
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">{t('title')}</h2>
        {isAdmin && (
          <Button onClick={() => setInviteOpen(true)} size="sm">
            <Plus className="h-4 w-4 mr-1.5" />
            {t('inviteButton')}
          </Button>
        )}
      </div>

      <div className="rounded-md border">
        {isLoading ? (
          <div className="p-4 space-y-3">
            {[1, 2, 3].map((i) => <Skeleton key={i} className="h-12 w-full" />)}
          </div>
        ) : !teams || teams.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center gap-3">
            <Building2 className="h-10 w-10 text-muted-foreground/40" />
            <p className="text-muted-foreground text-sm">{t('noClubs')}</p>
            {isAdmin && (
              <Button variant="outline" size="sm" onClick={() => setInviteOpen(true)}>
                <Plus className="h-4 w-4 mr-1.5" />
                {t('inviteButton')}
              </Button>
            )}
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/40">
                <th className="text-left font-medium text-muted-foreground px-4 py-3">{t('colClub')}</th>
                <th className="text-left font-medium text-muted-foreground px-4 py-3 hidden sm:table-cell">{t('colJoined')}</th>
                <th className="text-left font-medium text-muted-foreground px-4 py-3">{t('colStatus')}</th>
                {isAdmin && <th className="px-4 py-3 w-12" />}
              </tr>
            </thead>
            <tbody className="divide-y">
              {teams.map((row) => (
                <tr key={row.id} className="hover:bg-muted/20 transition-colors">
                  <td className="px-4 py-3 font-medium">{row.teamName ?? row.teamId}</td>
                  <td className="px-4 py-3 text-muted-foreground hidden sm:table-cell">
                    {formatDate(row.joined as { seconds: number } | null | undefined)}
                  </td>
                  <td className="px-4 py-3">
                    <Badge variant={statusVariant(row.status)}>{statusLabel(row.status)}</Badge>
                  </td>
                  {isAdmin && (
                    <td className="px-4 py-3">
                      {row.status === 'active' && (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-muted-foreground hover:text-destructive"
                          onClick={() => setRemoveTarget(row)}
                          title={t('removeButton')}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      )}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <InviteDialog
        open={inviteOpen}
        orgId={orgId}
        onClose={() => setInviteOpen(false)}
        onSuccess={() => { invalidate(); showToast(t('inviteSentSuccess')) }}
      />

      <AlertDialog open={!!removeTarget} onOpenChange={(v) => !v && setRemoveTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('confirmRemoveTitle')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('confirmRemoveMessage', { name: removeTarget?.teamName ?? removeTarget?.teamId ?? '' })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={actionLoading}>{t('cancel')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleRemove}
              disabled={actionLoading}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {actionLoading ? t('processing') : t('removeButton')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {toast && (
        <div className="fixed bottom-4 right-4 px-4 py-2.5 rounded-lg shadow-lg text-sm text-white bg-green-600 z-50">
          {toast}
        </div>
      )}
    </div>
  )
}
