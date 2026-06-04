'use client'

import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { collection, getDocs, query, where, orderBy } from 'firebase/firestore'
import { httpsCallable } from 'firebase/functions'
import { db, functions } from '@/lib/firebase'
import { useAuth } from '@/contexts/AuthContext'
import { useTranslations } from 'next-intl'
import {
  MoreHorizontal,
  UserPlus,
  Mail,
  Shield,
  Crown,
  Eye,
  Clock,
  CheckCircle2,
  X,
} from 'lucide-react'
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { TEAMS_COLLECTION, TEAM_MEMBERS_SUBCOLLECTION, TEAM_INVITATIONS_SUBCOLLECTION } from '@linyup/shared'
import type { TeamMember, TeamInvitation, TeamRole } from '@linyup/shared'

// ----- types ----------------------------------------------------------------

interface MemberDoc extends TeamMember {
  id: string
  email?: string
  displayName?: string
}

interface InvitationDoc extends TeamInvitation {
  id: string
  status?: string
}

// ----- helpers --------------------------------------------------------------

function formatDate(ts: { seconds: number } | Date | null | undefined): string {
  if (!ts) return ''
  const d = ts instanceof Date ? ts : new Date((ts as { seconds: number }).seconds * 1000)
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
}

function roleIcon(role: TeamRole) {
  if (role === 'owner') return <Crown className="h-3.5 w-3.5" />
  if (role === 'manager') return <Shield className="h-3.5 w-3.5" />
  return <Eye className="h-3.5 w-3.5" />
}

function roleBadgeVariant(role: TeamRole): 'default' | 'secondary' | 'outline' {
  if (role === 'owner') return 'default'
  if (role === 'manager') return 'secondary'
  return 'outline'
}

// ----- InviteDialog ---------------------------------------------------------

interface InviteDialogProps {
  open: boolean
  onClose: () => void
  onSuccess: () => void
}

function InviteDialog({ open, onClose, onSuccess }: InviteDialogProps) {
  const t = useTranslations('TeamMembers')
  const { currentTeamId: teamId } = useAuth()
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<TeamRole>('manager')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!teamId || !email.trim()) return
    setLoading(true)
    setError(null)
    try {
      const fn = httpsCallable(functions, 'sendTeamInvitation')
      await fn({ teamId, email: email.trim(), role })
      setEmail('')
      setRole('manager')
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
              placeholder="colleague@example.com"
              required
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="invite-role">{t('inviteRole')}</Label>
            <Select value={role} onValueChange={(v) => setRole(v as TeamRole)}>
              <SelectTrigger id="invite-role">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="manager">{t('role_manager')}</SelectItem>
                <SelectItem value="viewer">{t('role_viewer')}</SelectItem>
              </SelectContent>
            </Select>
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

// ----- ConfirmDialog --------------------------------------------------------

interface ConfirmDialogProps {
  open: boolean
  title: string
  message: string
  confirmLabel: string
  destructive?: boolean
  onConfirm: () => void
  onClose: () => void
  loading?: boolean
}

function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel,
  destructive,
  onConfirm,
  onClose,
  loading,
}: ConfirmDialogProps) {
  const t = useTranslations('TeamMembers')
  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{message}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={loading}>
            {t('cancel')}
          </Button>
          <Button
            variant={destructive ? 'destructive' : 'default'}
            onClick={onConfirm}
            disabled={loading}
          >
            {loading ? t('processing') : confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ----- ChangeRoleDialog -----------------------------------------------------

interface ChangeRoleDialogProps {
  open: boolean
  member: MemberDoc | null
  onClose: () => void
  onSuccess: () => void
}

function ChangeRoleDialog({ open, member, onClose, onSuccess }: ChangeRoleDialogProps) {
  const t = useTranslations('TeamMembers')
  const { currentTeamId: teamId } = useAuth()
  const [role, setRole] = useState<TeamRole>(member?.role ?? 'manager')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!teamId || !member) return
    setLoading(true)
    setError(null)
    try {
      const fn = httpsCallable(functions, 'manageTeamMember')
      await fn({ teamId, userId: member.userId, action: 'updateRole', role })
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
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{t('changeRole')}</DialogTitle>
          <DialogDescription>
            {member?.displayName || member?.email || member?.userId}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 pt-2">
          <Select value={role} onValueChange={(v) => setRole(v as TeamRole)}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="manager">{t('role_manager')}</SelectItem>
              <SelectItem value="viewer">{t('role_viewer')}</SelectItem>
            </SelectContent>
          </Select>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={loading}>
              {t('cancel')}
            </Button>
            <Button type="submit" disabled={loading}>
              {loading ? t('processing') : t('saveRole')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

// ----- Toast helper ---------------------------------------------------------

interface Toast {
  id: number
  message: string
  type: 'success' | 'error'
}

// ----- Main page ------------------------------------------------------------

export default function TeamMembersPage() {
  const t = useTranslations('TeamMembers')
  const { currentTeamId: teamId, user } = useAuth()
  const qc = useQueryClient()

  // toast
  const [toasts, setToasts] = useState<Toast[]>([])
  const addToast = (message: string, type: Toast['type'] = 'success') => {
    const id = Date.now()
    setToasts((prev) => [...prev, { id, message, type }])
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 3500)
  }

  // dialogs
  const [inviteOpen, setInviteOpen] = useState(false)
  const [removeTarget, setRemoveTarget] = useState<MemberDoc | null>(null)
  const [changeRoleTarget, setChangeRoleTarget] = useState<MemberDoc | null>(null)
  const [cancelInviteTarget, setCancelInviteTarget] = useState<InvitationDoc | null>(null)
  const [actionLoading, setActionLoading] = useState(false)

  // data — members
  const { data: members, isLoading: membersLoading } = useQuery<MemberDoc[]>({
    queryKey: ['team-members', teamId],
    enabled: !!teamId,
    queryFn: async () => {
      const snap = await getDocs(
        query(
          collection(db, TEAMS_COLLECTION, teamId!, TEAM_MEMBERS_SUBCOLLECTION),
          orderBy('joined', 'asc')
        )
      )
      return snap.docs.map((d) => ({ ...d.data(), id: d.id } as MemberDoc))
    },
  })

  // data — pending invitations
  const { data: invitations, isLoading: invitesLoading } = useQuery<InvitationDoc[]>({
    queryKey: ['team-invitations', teamId],
    enabled: !!teamId,
    queryFn: async () => {
      const snap = await getDocs(
        query(
          collection(db, TEAMS_COLLECTION, teamId!, TEAM_INVITATIONS_SUBCOLLECTION),
          where('status', 'in', ['pending', 'sent']),
          orderBy('created', 'desc')
        )
      )
      return snap.docs.map((d) => ({ ...d.data(), id: d.id } as InvitationDoc))
    },
  })

  // current user's role
  const myRole = members?.find((m) => m.userId === user?.uid)?.role
  const isOwner = myRole === 'owner'
  const canManage = myRole === 'owner' || myRole === 'manager'

  // role labels lookup (avoids dynamic key that TypeScript can't type-check)
  const roleLabel: Record<TeamRole, string> = {
    owner: t('role_owner'),
    manager: t('role_manager'),
    viewer: t('role_viewer'),
  }

  function invalidate() {
    qc.invalidateQueries({ queryKey: ['team-members', teamId] })
    qc.invalidateQueries({ queryKey: ['team-invitations', teamId] })
  }

  // remove member
  async function handleRemoveMember() {
    if (!removeTarget || !teamId) return
    setActionLoading(true)
    try {
      const fn = httpsCallable(functions, 'manageTeamMember')
      await fn({ teamId, userId: removeTarget.userId, action: 'remove' })
      addToast(t('removedSuccess'))
      invalidate()
    } catch (err: unknown) {
      addToast(err instanceof Error ? err.message : 'Error', 'error')
    } finally {
      setActionLoading(false)
      setRemoveTarget(null)
    }
  }

  // cancel invitation
  async function handleCancelInvite() {
    if (!cancelInviteTarget || !teamId) return
    setActionLoading(true)
    try {
      const fn = httpsCallable(functions, 'manageTeamInvitation')
      await fn({ teamId, invitationId: cancelInviteTarget.id, action: 'cancel' })
      addToast(t('inviteCancelledSuccess'))
      invalidate()
    } catch (err: unknown) {
      addToast(err instanceof Error ? err.message : 'Error', 'error')
    } finally {
      setActionLoading(false)
      setCancelInviteTarget(null)
    }
  }

  const isLoading = membersLoading || invitesLoading

  // sort: owner first, then managers, then viewers
  const roleOrder: Record<TeamRole, number> = { owner: 0, manager: 1, viewer: 2 }
  const sortedMembers = [...(members ?? [])].sort(
    (a, b) => roleOrder[a.role] - roleOrder[b.role]
  )

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">{t('title')}</h1>
        </div>
        {canManage && (
          <Button onClick={() => setInviteOpen(true)}>
            <UserPlus className="h-4 w-4 mr-2" />
            {t('inviteButton')}
          </Button>
        )}
      </div>

      {/* Members list */}
      <div className="rounded-md border">
        <div className="p-4 border-b bg-muted/40">
          <h2 className="font-semibold text-sm">
            {t('membersTitle')} ({sortedMembers.length})
          </h2>
        </div>
        {isLoading ? (
          <div className="p-4 space-y-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="flex items-center gap-3">
                <Skeleton className="h-9 w-9 rounded-full" />
                <div className="space-y-1 flex-1">
                  <Skeleton className="h-4 w-40" />
                  <Skeleton className="h-3 w-24" />
                </div>
              </div>
            ))}
          </div>
        ) : sortedMembers.length === 0 ? (
          <div className="p-8 text-center text-muted-foreground text-sm">
            {t('noMembers')}
          </div>
        ) : (
          <ul className="divide-y">
            {sortedMembers.map((m) => {
              const isSelf = m.userId === user?.uid
              return (
                <li key={m.id} className="flex items-center gap-3 px-4 py-3">
                  {/* Avatar placeholder */}
                  <div className="h-9 w-9 rounded-full bg-muted flex items-center justify-center text-sm font-medium shrink-0">
                    {(m.displayName ?? m.email ?? m.userId).charAt(0).toUpperCase()}
                  </div>
                  {/* Info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium text-sm truncate">
                        {m.displayName ?? m.email ?? m.userId}
                      </span>
                      {isSelf && (
                        <span className="text-xs text-muted-foreground">({t('you')})</span>
                      )}
                    </div>
                    <div className="text-xs text-muted-foreground mt-0.5">
                      {t('joinedOn', { date: formatDate(m.joined as Parameters<typeof formatDate>[0]) })}
                    </div>
                  </div>
                  {/* Role badge */}
                  <Badge variant={roleBadgeVariant(m.role)} className="flex items-center gap-1 shrink-0">
                    {roleIcon(m.role)}
                    {roleLabel[m.role]}
                  </Badge>
                  {/* Actions */}
                  {canManage && !isSelf && m.role !== 'owner' && (
                    <DropdownMenu>
                      <DropdownMenuTrigger className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md hover:bg-accent">
                        <MoreHorizontal className="h-4 w-4" />
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => setChangeRoleTarget(m)}>
                          <Shield className="h-4 w-4 mr-2" />
                          {t('changeRole')}
                        </DropdownMenuItem>
                        {isOwner && (
                          <>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              className="text-destructive"
                              onClick={() => setRemoveTarget(m)}
                            >
                              <X className="h-4 w-4 mr-2" />
                              {t('removeMember')}
                            </DropdownMenuItem>
                          </>
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </div>

      {/* Pending invitations */}
      {((invitations && invitations.length > 0) || invitesLoading) && (
        <div className="rounded-md border">
          <div className="p-4 border-b bg-muted/40">
            <h2 className="font-semibold text-sm flex items-center gap-2">
              <Clock className="h-4 w-4 text-muted-foreground" />
              {t('pendingTitle')} ({invitations?.length ?? 0})
            </h2>
          </div>
          {invitesLoading ? (
            <div className="p-4 space-y-3">
              {[1, 2].map((i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : (
            <ul className="divide-y">
              {(invitations ?? []).map((inv) => (
                <li key={inv.id} className="flex items-center gap-3 px-4 py-3">
                  <div className="h-9 w-9 rounded-full bg-muted flex items-center justify-center shrink-0">
                    <Mail className="h-4 w-4 text-muted-foreground" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-sm truncate">{inv.email}</div>
                    <div className="text-xs text-muted-foreground mt-0.5">
                      {t('invitedOn', { date: formatDate(inv.created as Parameters<typeof formatDate>[0]) })}
                    </div>
                  </div>
                  <Badge variant={roleBadgeVariant(inv.role)} className="flex items-center gap-1 shrink-0">
                    {roleIcon(inv.role)}
                    {roleLabel[inv.role]}
                  </Badge>
                  <div className="flex items-center gap-1 shrink-0">
                    <Badge variant="outline" className="text-xs">
                      <Clock className="h-3 w-3 mr-1" />
                      {t('statusPending')}
                    </Badge>
                    {canManage && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-muted-foreground hover:text-destructive"
                        onClick={() => setCancelInviteTarget(inv)}
                        title={t('cancelInvite')}
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* Dialogs */}
      <InviteDialog
        open={inviteOpen}
        onClose={() => setInviteOpen(false)}
        onSuccess={() => {
          invalidate()
          addToast(t('inviteSentSuccess'))
        }}
      />

      <ChangeRoleDialog
        open={!!changeRoleTarget}
        member={changeRoleTarget}
        onClose={() => setChangeRoleTarget(null)}
        onSuccess={() => {
          invalidate()
          addToast(t('roleUpdatedSuccess'))
        }}
      />

      <ConfirmDialog
        open={!!removeTarget}
        title={t('confirmRemoveTitle')}
        message={t('confirmRemoveMessage', {
          name: removeTarget?.displayName ?? removeTarget?.email ?? removeTarget?.userId ?? '',
        })}
        confirmLabel={t('removeMember')}
        destructive
        onConfirm={handleRemoveMember}
        onClose={() => setRemoveTarget(null)}
        loading={actionLoading}
      />

      <ConfirmDialog
        open={!!cancelInviteTarget}
        title={t('confirmCancelInviteTitle')}
        message={t('confirmCancelInviteMessage', {
          email: cancelInviteTarget?.email ?? '',
        })}
        confirmLabel={t('cancelInvite')}
        onConfirm={handleCancelInvite}
        onClose={() => setCancelInviteTarget(null)}
        loading={actionLoading}
      />

      {/* Toasts */}
      <div className="fixed bottom-4 right-4 space-y-2 z-50">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-lg shadow-lg text-sm text-white ${
              toast.type === 'error' ? 'bg-destructive' : 'bg-green-600'
            }`}
          >
            {toast.type === 'success' ? (
              <CheckCircle2 className="h-4 w-4 shrink-0" />
            ) : (
              <X className="h-4 w-4 shrink-0" />
            )}
            {toast.message}
          </div>
        ))}
      </div>
    </div>
  )
}
