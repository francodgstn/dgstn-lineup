'use client'

import { useQuery } from '@tanstack/react-query'
import { collection, getDocs, query, orderBy } from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { TEAMS_COLLECTION, EVENT_TYPES_SUBCOLLECTION, BUILTIN_EVENT_TYPES } from '@lineup/shared'
import type { EventTypeConfig } from '@lineup/shared'
import { PLUGIN_REGISTRY } from '@/plugins/registry'

export interface SelectableEventType {
  id: string       // used as event.type in Firestore
  name: string
  source: 'builtin' | 'plugin' | 'team'
  color?: string
}

const BUILTIN_LABELS: Record<string, string> = {
  competition: 'Competition',
  camp: 'Camp',
  exam: 'Exam',
  seminar: 'Seminar',
  workshop: 'Workshop',
}

export function useEventTypes(teamId: string | null): {
  types: SelectableEventType[]
  isLoading: boolean
} {
  const { data: customTypes = [], isLoading } = useQuery<EventTypeConfig[]>({
    queryKey: ['event-types', teamId],
    enabled: !!teamId,
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      if (!teamId) return []
      const snap = await getDocs(
        query(collection(db, TEAMS_COLLECTION, teamId, EVENT_TYPES_SUBCOLLECTION), orderBy('name')),
      )
      return snap.docs.map((d) => ({ ...d.data(), id: d.id }) as EventTypeConfig)
    },
  })

  const builtins: SelectableEventType[] = BUILTIN_EVENT_TYPES.map((id) => ({
    id,
    name: BUILTIN_LABELS[id] ?? id,
    source: 'builtin',
  }))

  const pluginTypes: SelectableEventType[] = PLUGIN_REGISTRY
    .filter((p) => p.eventType)
    .map((p) => ({
      id: p.eventType!.id,
      name: p.eventType!.id.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
      source: 'plugin',
    }))

  const teamTypes: SelectableEventType[] = customTypes.map((t) => ({
    id: t.id,
    name: t.name,
    source: 'team',
    color: t.color,
  }))

  return {
    types: [...builtins, ...pluginTypes, ...teamTypes],
    isLoading,
  }
}
