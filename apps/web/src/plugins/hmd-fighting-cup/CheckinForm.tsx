'use client'

import { useState, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { collection, getDocs, orderBy, query } from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { EVENT_CATEGORIES_SUBCOLLECTION, EVENTS_COLLECTION } from '@lineup/shared'
import type { EventCategory, Contact } from '@lineup/shared'

function useFightingCupCategories(eventId: string) {
  return useQuery<EventCategory[]>({
    queryKey: ['event-categories', eventId],
    queryFn: async () => {
      const snap = await getDocs(
        query(
          collection(db, EVENTS_COLLECTION, eventId, EVENT_CATEGORIES_SUBCOLLECTION),
          orderBy('sort_order'),
        ),
      )
      return snap.docs.map((d) => ({ id: d.id, ...d.data() }) as EventCategory)
    },
  })
}

function contactAge(contact: Contact): number | null {
  if (!contact.birthdate) return null
  const dob = (contact.birthdate as { toDate(): Date }).toDate()
  const now = new Date()
  let age = now.getFullYear() - dob.getFullYear()
  if (
    now.getMonth() < dob.getMonth() ||
    (now.getMonth() === dob.getMonth() && now.getDate() < dob.getDate())
  ) age--
  return age
}

function filterCategories(categories: EventCategory[], contact: Contact, weight: number | null): EventCategory[] {
  const age = contactAge(contact)
  const gender = contact.gender

  return categories.filter((cat) => {
    if (cat.gender && cat.gender !== 'both' && gender && cat.gender !== gender) return false
    if (age !== null) {
      if (cat.min_age != null && age < cat.min_age) return false
      if (cat.max_age != null && age > cat.max_age) return false
    }
    if (weight !== null) {
      if (cat.min_weight != null && weight < cat.min_weight) return false
      if (cat.max_weight != null && weight > cat.max_weight) return false
    }
    // Rank filtering: if category defines ranking_system_id + range, check contact rank
    if (cat.ranking_system_id && contact.ranks) {
      const rank = (contact.ranks as Record<string, number>)[cat.ranking_system_id]
      if (rank !== undefined) {
        if (cat.min_rank != null && rank < cat.min_rank) return false
        if (cat.max_rank != null && rank > cat.max_rank) return false
      }
    }
    return true
  })
}

export function CheckinForm({
  contact,
  eventId,
  existing,
  onSubmit,
  onCancel,
  busy,
}: {
  contact: Contact
  eventId: string
  existing?: Record<string, unknown>
  onSubmit: (data: Record<string, unknown>) => void
  onCancel: () => void
  busy?: boolean
}) {
  const { data: allCategories = [], isLoading } = useFightingCupCategories(eventId)
  const [weight, setWeight] = useState<string>(
    String((existing?.weight as number | undefined) ?? contact.weight ?? ''),
  )
  const [selectedCats, setSelectedCats] = useState<Set<string>>(
    new Set((existing?.categories as string[] | undefined) ?? []),
  )

  const weightNum = weight ? parseFloat(weight) : null

  const eligibleCategories = useMemo(
    () => filterCategories(allCategories, contact, weightNum),
    [allCategories, contact, weightNum],
  )

  function toggleCat(id: string) {
    setSelectedCats((prev) => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  function handleSubmit() {
    onSubmit({
      categories: Array.from(selectedCats),
      weight: weightNum ?? undefined,
    })
  }

  if (isLoading) {
    return (
      <div className="space-y-3">
        {[1, 2, 3].map((i) => <Skeleton key={i} className="h-10 rounded-lg" />)}
      </div>
    )
  }

  return (
    <div className="space-y-5">
      <p className="text-sm font-medium">{contact.firstname} {contact.lastname}</p>

      {/* Weight input */}
      <div className="space-y-1.5">
        <Label>Weight (kg)</Label>
        <Input
          type="number"
          step="0.1"
          min="0"
          value={weight}
          onChange={(e) => { setWeight(e.target.value); setSelectedCats(new Set()) }}
          placeholder="e.g. 67.5"
        />
        <p className="text-xs text-muted-foreground">
          Entering weight filters eligible categories automatically.
        </p>
      </div>

      {/* Category selection */}
      <div className="space-y-2">
        <Label>
          Categories{' '}
          <span className="font-normal text-muted-foreground text-xs">
            ({eligibleCategories.length} eligible)
          </span>
        </Label>

        {allCategories.length === 0 && (
          <p className="text-sm text-muted-foreground italic">
            No categories configured for this event. Add categories in the Categories tab.
          </p>
        )}

        <div className="space-y-1.5">
          {eligibleCategories.map((cat) => {
            const selected = selectedCats.has(cat.id)
            return (
              <button
                key={cat.id}
                onClick={() => toggleCat(cat.id)}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg border text-sm text-left transition-colors ${
                  selected
                    ? 'border-primary bg-primary/10 font-medium'
                    : 'border-border hover:bg-muted'
                }`}
              >
                {cat.color && (
                  <span className="w-3 h-3 rounded-full shrink-0" style={{ background: cat.color }} />
                )}
                <span className="flex-1">{cat.name}</span>
                {cat.min_weight != null && cat.max_weight != null && (
                  <span className="text-xs text-muted-foreground">
                    {cat.min_weight}–{cat.max_weight} kg
                  </span>
                )}
                {selected && <span className="text-primary text-xs font-bold">✓</span>}
              </button>
            )
          })}
        </div>

        {allCategories.length > 0 && eligibleCategories.length === 0 && (
          <p className="text-xs text-amber-600">
            No categories match this competitor's profile. Check weight, age, gender, and rank.
          </p>
        )}
      </div>

      {selectedCats.size === 0 && allCategories.length > 0 && (
        <p className="text-xs text-amber-600">Select at least one category.</p>
      )}

      <div className="flex gap-2 justify-end pt-2">
        <Button variant="outline" onClick={onCancel} disabled={busy}>Cancel</Button>
        <Button
          onClick={handleSubmit}
          disabled={busy || (allCategories.length > 0 && selectedCats.size === 0)}
        >
          {existing ? 'Update' : 'Check in'}
        </Button>
      </div>
    </div>
  )
}
