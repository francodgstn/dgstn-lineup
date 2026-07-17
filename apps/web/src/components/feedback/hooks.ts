'use client'

import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { collection, doc, getDoc, getDocs, query, where } from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { useAuth } from '@/contexts/AuthContext'
import {
  APP_SETTINGS_COLLECTION,
  PUBLIC_SETTINGS_DOC,
  FEEDBACK_PROMPTS_COLLECTION,
  type FeedbackPrompt,
  type FeedbackPublicSettings,
} from '@linyup/shared'

/** Global widget on/off switch — ops-controlled flag on app_settings/public. */
export function useFeedbackEnabled(): boolean {
  const { data } = useQuery({
    queryKey: ['public-settings-feedback'],
    staleTime: 60_000,
    queryFn: async () => {
      const snap = await getDoc(doc(db, APP_SETTINGS_COLLECTION, PUBLIC_SETTINGS_DOC))
      return snap.exists() ? (snap.data() as FeedbackPublicSettings) : null
    },
  })
  return data?.feedback_enabled === true
}

export interface ActivePrompt extends FeedbackPrompt {
  id: string
}

/** Ops-pushed prompt questions currently active. */
export function useActivePrompts(enabled: boolean): ActivePrompt[] {
  const { data } = useQuery({
    queryKey: ['feedback-active-prompts'],
    enabled,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const snap = await getDocs(
        query(collection(db, FEEDBACK_PROMPTS_COLLECTION), where('status', '==', 'active'))
      )
      return snap.docs.map((d) => ({ id: d.id, ...(d.data() as FeedbackPrompt) }))
    },
  })
  return data ?? []
}

export interface PromptBuckets {
  /** Active prompts the user has neither answered nor muted (badge source). */
  open: ActivePrompt[]
  answered: ActivePrompt[]
  muted: ActivePrompt[]
}

/** Splits active prompts by the user's per-profile answered/muted state. */
export function usePromptBuckets(prompts: ActivePrompt[]): PromptBuckets {
  const { profile } = useAuth()
  const answeredIds = profile?.feedback?.answeredPrompts
  const mutedIds = profile?.feedback?.mutedPrompts
  return useMemo(() => {
    const answeredSet = new Set(answeredIds ?? [])
    const mutedSet = new Set(mutedIds ?? [])
    const open: ActivePrompt[] = []
    const answered: ActivePrompt[] = []
    const muted: ActivePrompt[] = []
    for (const p of prompts) {
      if (answeredSet.has(p.id)) answered.push(p)
      else if (mutedSet.has(p.id)) muted.push(p)
      else open.push(p)
    }
    return { open, answered, muted }
  }, [prompts, answeredIds, mutedIds])
}
