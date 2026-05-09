'use client'

import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import {
  collection, getDocs, doc, updateDoc, deleteDoc, getDoc,
} from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { useAuth } from '@/contexts/AuthContext'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Button } from '@/components/ui/button'
import { TEAMS_COLLECTION, TEAM_MEMBERS_SUBCOLLECTION } from '@lineup/shared'
import type { TeamMember, TeamRole, UserProfile } from '@lineup/shared'
import { UserPlus, Trash2 } from 'lucide-react'

// ─── types ────────────────────────────────────────────────────────────────────

type MemberWithProfile = TeamMember & {
  displayName: string
  email?: string
}

// ─── helpers ──────────────────────────────────────────────────────────────────

function formatDate(ts: { toDate(): Date } | null | undefined): string {
  if (!ts) return '—'
  return ts.toDate().toLocaleDateString([], { day: '2-digit', month: 'short', year: 'numeric' })
}

function initials(name: string): string {
  return name.split(' ').map((w) => w[0] ?? '').join('').slice(0, 2).toUpperCase()
}

const ROLE_VARIANT: Record<TeamRole, 'default' | 'secondary' | 'outline'> = {
  owner: 'default',
  manager: 'secondary',
  viewer: 'outline',
}

const ROLES: TeamRole[] = ['owner', 'manager', 'viewer']

// ─── data hook ────────────────────────────────────────────────────────────────

function useTeamMembers(teamId: string | null) {
  return useQuery<MemberWithProfile[]>({
    queryKey: ['team-members', teamId],
    enabled: !!teamId,
    queryFn: async () => {
      if (!teamId) return []
      const snap = await getDocs(
        collection(db, TEAMS_COLLECTION, teamId, TEAM_MEMBERS_SUBCOLLECTION),
      )
      const members = snap.docs.map((d) => ({ id: d.id, ...d.data() } as unknown as TeamMember))

      const profiles = await Promise.all(
        members.map((m) =>
          getDoc(doc(db, 'users', m.userId)).then((d) =>
            d.exists() ? (d.data() as UserProfile) : null,
          ),
        ),
      )

      return members.map((m, i) => {
        const p = profiles[i]
        const name =
          p?.firstname && p?.lastname
            ? `${p.firstname} ${p.lastname}`
            : p?.displayName ?? p?.email ?? m.userId
        return { ...m, displayName: name, email: p?.email }
      })
    },
  })
}

// ─── member row ───────────────────────────────────────────────────────────────

function MemberRow({
  member,
  currentUserId,
  currentUserIsOwner,
  teamId,
  onRemoved,
}: {
  member: MemberWithProfile
  currentUserId: string
  currentUserIsOwner: boolean
  teamId: string
  onRemoved: () => void
}) {
  const t = useTranslations('TeamMembers')
  const [updating, setUpdating] = useState(false)
  const isSelf = member.userId === currentUserId
  const canManage = currentUserIsOwner && !isSelf

  async function handleRoleChange(role: TeamRole) {
    setUpdating(true)
    await updateDoc(
      doc(db, TEAMS_COLLECTION, teamId, TEAM_MEMBERS_SUBCOLLECTION, member.userId),
      { role },
    )
    setUpdating(false)
  }

  async function handleRemove() {
    if (!window.confirm(t('removeConfirm', { name: member.displayName }))) return
    await deleteDoc(
      doc(db, TEAMS_COLLECTION, teamId, TEAM_MEMBERS_SUBCOLLECTION, member.userId),
    )
    onRemoved()
  }

  return (
    <tr className="border-b last:border-0 hover:bg-muted/30 transition-colors">
      <td className="px-4 py-3">
        <div className="flex items-center gap-3">
          <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
            <span className="text-xs font-semibold text-primary">
              {initials(member.displayName)}
            </span>
          </div>
          <div>
            <p className="text-sm font-medium">
              {member.displayName}
              {isSelf && (
                <span className="ml-1.5 text-xs text-muted-foreground font-normal">({t('you')})</span>
              )}
            </p>
            {member.email && (
              <p className="text-xs text-muted-foreground">{member.email}</p>
            )}
          </div>
        </div>
      </td>

      <td className="px-4 py-3">
        {canManage ? (
          <select
            value={member.role}
            disabled={updating}
            onChange={(e) => handleRoleChange(e.target.value as TeamRole)}
            className="rounded-md border border-input bg-background px-2 py-1 text-xs ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:opacity-50"
          >
            {ROLES.map((r) => (
              <option key={r} value={r}>{t(`role_${r}`)}</option>
            ))}
          </select>
        ) : (
          <Badge variant={ROLE_VARIANT[member.role]} className="text-xs">
            {t(`role_${member.role}`)}
          </Badge>
        )}
      </td>

      <td className="px-4 py-3 text-sm text-muted-foreground">
        {formatDate(member.joined as Parameters<typeof formatDate>[0])}
      </td>

      <td className="px-4 py-3">
        {canManage && (
          <button
            onClick={handleRemove}
            className="p-1.5 text-muted-foreground hover:text-destructive rounded transition-colors"
            title={t('removeMember')}
          >
            <Trash2 className="h-4 w-4" />
          </button>
        )}
      </td>
    </tr>
  )
}

// ─── page ─────────────────────────────────────────────────────────────────────

export default function TeamMembersPage() {
  const { currentTeamId, user } = useAuth()
  const { data: members = [], isLoading, refetch } = useTeamMembers(currentTeamId)
  const t = useTranslations('TeamMembers')
  const tCommon = useTranslations('Common')

  const currentUserIsOwner =
    members.find((m) => m.userId === user?.uid)?.role === 'owner'

  return (
    <div className="space-y-6 max-w-3xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{t('title')}</h1>
          {!isLoading && (
            <p className="text-sm text-muted-foreground mt-0.5">
              {t('subtitle', { count: members.length })}
            </p>
          )}
        </div>
        <Button disabled title={tCommon('comingSoon')}>
          <UserPlus className="h-4 w-4 mr-1.5" />
          {t('invite')}
        </Button>
      </div>

      <div className="rounded-lg border overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 border-b">
            <tr>
              <th className="text-left px-4 py-3 font-medium text-muted-foreground">{t('colMember')}</th>
              <th className="text-left px-4 py-3 font-medium text-muted-foreground">{t('colRole')}</th>
              <th className="text-left px-4 py-3 font-medium text-muted-foreground">{t('colJoined')}</th>
              <th className="w-10 px-4 py-3" />
            </tr>
          </thead>
          <tbody>
            {isLoading &&
              Array.from({ length: 3 }).map((_, i) => (
                <tr key={i} className="border-b last:border-0">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      <Skeleton className="h-8 w-8 rounded-full" />
                      <div className="space-y-1.5">
                        <Skeleton className="h-3.5 w-32" />
                        <Skeleton className="h-3 w-24" />
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3"><Skeleton className="h-5 w-16 rounded-full" /></td>
                  <td className="px-4 py-3"><Skeleton className="h-4 w-24" /></td>
                  <td className="px-4 py-3" />
                </tr>
              ))}

            {!isLoading && members.length === 0 && (
              <tr>
                <td colSpan={4} className="px-4 py-12 text-center text-muted-foreground">
                  {t('empty')}
                </td>
              </tr>
            )}

            {!isLoading &&
              members.map((m) => (
                <MemberRow
                  key={m.userId}
                  member={m}
                  currentUserId={user?.uid ?? ''}
                  currentUserIsOwner={currentUserIsOwner}
                  teamId={currentTeamId ?? ''}
                  onRemoved={() => refetch()}
                />
              ))}
          </tbody>
        </table>
      </div>

      {!currentUserIsOwner && !isLoading && (
        <p className="text-xs text-muted-foreground">{t('ownerOnlyNote')}</p>
      )}
    </div>
  )
}
