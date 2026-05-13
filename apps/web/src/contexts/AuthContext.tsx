'use client'

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { onAuthStateChanged, type User } from 'firebase/auth'
import { doc, getDoc, onSnapshot } from 'firebase/firestore'
import { auth } from '@/lib/firebase-auth'
import { db } from '@/lib/firebase'
import type { UserProfile, Team } from '@lineup/shared'

interface AuthContextValue {
  user: User | null
  profile: UserProfile | null
  team: Team | null
  loading: boolean
  currentTeamId: string | null
}

const AuthContext = createContext<AuthContextValue>({
  user: null,
  profile: null,
  team: null,
  loading: true,
  currentTeamId: null,
})

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [profile, setProfile] = useState<UserProfile | null>(null)
  const [team, setTeam] = useState<Team | null>(null)
  const [loading, setLoading] = useState(true)

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
      return
    }
    const unsub = onSnapshot(doc(db, 'teams', currentTeamId), (snap) => {
      if (snap.exists()) {
        setTeam({ id: snap.id, ...snap.data() } as Team)
      } else {
        setTeam(null)
      }
    })
    return unsub
  }, [currentTeamId])

  return (
    <AuthContext.Provider value={{ user, profile, team, loading, currentTeamId }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  return useContext(AuthContext)
}
