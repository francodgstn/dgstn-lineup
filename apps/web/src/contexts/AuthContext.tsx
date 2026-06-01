'use client'

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { onAuthStateChanged, type User } from 'firebase/auth'
import { doc, getDoc, onSnapshot } from 'firebase/firestore'
import { auth } from '@/lib/firebase-auth'
import { db } from '@/lib/firebase'
import type { UserProfile, Team, TeamRole } from '@lineup/shared'

interface AuthContextValue {
  user: User | null
  profile: UserProfile | null
  team: Team | null
  teamRole: TeamRole | null
  loading: boolean
  currentTeamId: string | null
  isOrgAdmin: boolean
}

const AuthContext = createContext<AuthContextValue>({
  user: null,
  profile: null,
  team: null,
  teamRole: null,
  loading: true,
  currentTeamId: null,
  isOrgAdmin: false,
})

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [profile, setProfile] = useState<UserProfile | null>(null)
  const [team, setTeam] = useState<Team | null>(null)
  const [loading, setLoading] = useState(true)
  const [isOrgAdmin, setIsOrgAdmin] = useState(false)
  const [teamRole, setTeamRole] = useState<TeamRole | null>(null)

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      setUser(firebaseUser)

      if (firebaseUser) {
        const profileDoc = await getDoc(doc(db, 'users', firebaseUser.uid))
        if (profileDoc.exists()) {
          setProfile({ id: profileDoc.id, ...profileDoc.data() } as UserProfile)
        }
      } else {
        setProfile(null)
        setTeam(null)
        setTeamRole(null)
      }

      setLoading(false)
    })

    return unsubscribe
  }, [])

  // Subscribe to the team document whenever currentTeamId changes
  const currentTeamId = profile?.currentTeam ?? null
  useEffect(() => {
    if (!currentTeamId) {
      setTeam(null)
      setTeamRole(null)
      return
    }
    const unsub = onSnapshot(doc(db, 'teams', currentTeamId), (snap) => {
      if (snap.exists()) {
        const teamData = { id: snap.id, ...snap.data() } as Team
        setTeam(teamData)
        const orgId = (teamData as unknown as { org_id?: string }).org_id
        const uid = user?.uid
        if (uid) {
          getDoc(doc(db, 'teams', currentTeamId, 'team_members', uid))
            .then((m) => setTeamRole(m.exists() ? (m.data()?.role as TeamRole) : null))
            .catch(() => setTeamRole(null))
          if (orgId) {
            getDoc(doc(db, 'organizations', orgId, 'org_members', uid))
              .then((m) => setIsOrgAdmin(m.exists() && m.data()?.role === 'org_admin'))
              .catch(() => setIsOrgAdmin(false))
          } else {
            setIsOrgAdmin(false)
          }
        }
      } else {
        setTeam(null)
        setTeamRole(null)
        setIsOrgAdmin(false)
      }
    })
    return unsub
  }, [currentTeamId])

  return (
    <AuthContext.Provider value={{ user, profile, team, teamRole, loading, currentTeamId, isOrgAdmin }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  return useContext(AuthContext)
}
