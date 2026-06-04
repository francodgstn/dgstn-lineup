'use client'

import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { collection, getDocs, query as firestoreQuery } from 'firebase/firestore'
import { httpsCallable } from 'firebase/functions'
import { db, functions } from '@/lib/firebase'
import { useTranslations } from 'next-intl'
import { useAuth } from '@/contexts/AuthContext'
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
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
import { UserPlus, Trash2 } from 'lucide-react'
import { useParams } from 'next/navigation'
import { ORGANIZATIONS_COLLECTION, ORG_MEMBERS_SUBCOLLECTION } from '@linyup/shared'
import type { OrgMember, OrgRole } from '@linyup/shared'

interface OrgMemberRow extends OrgMember {
  id: string
  displayName?: string
  email?: string
}

function useOrgMembers(orgId: string) {
  return useQuery<OrgMemberRow[]>({
    queryKey: ['org-members', orgId],
    queryFn: async () => {
      const snap = await getDocs(
        firestoreQuery(collection(db, ORGANIZATIONS_COLLECTION, orgId, ORG_MEMBERS_SUBCOLLECTION))
      )
      return snap.docs.map((d) => ({ ...d.data(), id: d.id } as OrgMemberRow))
    },
  })
}

// ─── AddMemberDialog ──────────────────────────────────────────────────────────

function AddMemberDialog({
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
  const t = useTranslations('OrgMembers')
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<OrgRole>('org_admin')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!email.trim()) return
    setLoading(true)
    setError(null)
    try {
      // No dedicated addOrgMember function yet — this would call a future function.
      // For now, show a placeholder.
      const fn = httpsCallable(functions, 'addOrgMember')
      await fn({ orgId, email: email.trim(), role })
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
          <DialogTitle>{t('addTitle')}</DialogTitle>
          <DialogDescription>{t('addDescription')}</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 pt-2">
          <div className="space-y-1.5">
            <Label htmlFor="add-email">{t('addEmail')}</Label>
            <Input
              id="add-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="admin@example.com"
              required
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="add-role">{t('addRole')}</Label>
            <Select value={role} onValueChange={(v) => setRole(v as OrgRole)}>
              <SelectTrigger id="add-role">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="org_admin">{t('role_org_admin')}</SelectItem>
                <SelectItem value="org_viewer">{t('role_org_viewer')}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={loading}>
              {t('cancel')}
            </Button>
            <Button type="submit" disabled={loading || !email.trim()}>
              {loading ? t('sending') : t('addSubmit')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function OrgMembersPage() {
  const { orgId } = useParams<{ orgId: string }>()
  const t = useTranslations('OrgMembers')
  const { user } = useAuth()
  const { isAdmin } = useOrg()
  const qc = useQueryClient()
  const { data: members, isLoading } = useOrgMembers(orgId)

  const [addOpen, setAddOpen] = useState(false)
  const [removeTarget, setRemoveTarget] = useState<OrgMemberRow | null>(null)
  const [actionLoading, setActionLoading] = useState(false)
  const [toast, setToast] = useState<string | null>(null)

  function showToast(msg: string) {
    setToast(msg)
    setTimeout(() => setToast(null), 3500)
  }

  function invalidate() {
    qc.invalidateQueries({ queryKey: ['org-members', orgId] })
  }

  async function handleRemove() {
    if (!removeTarget) return
    setActionLoading(true)
    try {
      const fn = httpsCallable(functions, 'removeOrgMember')
      await fn({ orgId: orgId, userId: removeTarget.userId })
      showToast(t('removedSuccess'))
      invalidate()
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Error')
    } finally {
      setActionLoading(false)
      setRemoveTarget(null)
    }
  }

  function roleLabel(role: OrgRole) {
    return role === 'org_admin' ? t('role_org_admin') : t('role_org_viewer')
  }

  function formatDate(ts: { seconds: number } | null | undefined) {
    if (!ts) return ''
    return new Date(ts.seconds * 1000).toLocaleDateString(undefined, {
      year: 'numeric', month: 'short', day: 'numeric',
    })
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">{t('title')}</h2>
        {isAdmin && (
          <Button onClick={() => setAddOpen(true)} size="sm">
            <UserPlus className="h-4 w-4 mr-1.5" />
            {t('addButton')}
          </Button>
        )}
      </div>

      <div className="rounded-md border">
        {isLoading ? (
          <div className="p-4 space-y-3">
            {[1, 2].map((i) => <Skeleton key={i} className="h-12 w-full" />)}
          </div>
        ) : !members || members.length === 0 ? (
          <div className="p-8 text-center text-muted-foreground text-sm">{t('noMembers')}</div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/40">
                <th className="text-left font-medium text-muted-foreground px-4 py-3">{t('colMember')}</th>
                <th className="text-left font-medium text-muted-foreground px-4 py-3">{t('colRole')}</th>
                <th className="text-left font-medium text-muted-foreground px-4 py-3 hidden sm:table-cell">{t('colAdded')}</th>
                {isAdmin && <th className="px-4 py-3 w-12" />}
              </tr>
            </thead>
            <tbody className="divide-y">
              {members.map((m) => {
                const isSelf = m.userId === user?.uid
                return (
                  <tr key={m.id} className="hover:bg-muted/20 transition-colors">
                    <td className="px-4 py-3">
                      <div className="font-medium">{m.displayName ?? m.email ?? m.userId}</div>
                      {isSelf && <span className="text-xs text-muted-foreground">({t('you')})</span>}
                    </td>
                    <td className="px-4 py-3">
                      <Badge variant={m.role === 'org_admin' ? 'default' : 'secondary'}>
                        {roleLabel(m.role)}
                      </Badge>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground hidden sm:table-cell">
                      {formatDate(m.joined as { seconds: number } | null | undefined)}
                    </td>
                    {isAdmin && (
                      <td className="px-4 py-3">
                        {!isSelf && (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-muted-foreground hover:text-destructive"
                            onClick={() => setRemoveTarget(m)}
                            title={t('removeButton')}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        )}
                      </td>
                    )}
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>

      <AddMemberDialog
        open={addOpen}
        orgId={orgId}
        onClose={() => setAddOpen(false)}
        onSuccess={() => { invalidate(); showToast(t('addSuccess')) }}
      />

      <AlertDialog open={!!removeTarget} onOpenChange={(v) => !v && setRemoveTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('confirmRemoveTitle')}</AlertDialogTitle>
            <AlertDialogDescription>{t('confirmRemoveMessage')}</AlertDialogDescription>
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
