'use client'

// Goals, grouped with their steps via the shared `groupGoalsWithSteps` — the
// same grouping the admin tab and the mobile app (once it catches up) use, so
// a step's home never depends on which surface is reading it. One
// `useConfirm()` instance for the whole section, passed down to every
// GoalCard/StepRow, rather than one per row — a member can only act on one
// row at a time anyway.

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { Plus } from 'lucide-react'
import { groupGoalsWithSteps } from '@linyup/shared'
import type { PerformanceIndicator } from '@linyup/shared'
import { Skeleton } from '@/components/ui/skeleton'
import { QueryErrorState } from '@/components/ui/query-error'
import { loadFailureDetail } from '@/lib/publicQueryError'
import { useConfirm } from '@/components/ui/confirm-dialog'
import { useSpaceTheme } from '../useSpaceTheme'
import { GoalCard } from './GoalCard'
import { StepRow } from './StepRow'
import { GoalFormDialog } from './GoalFormDialog'
import type { SpaceGoalsState } from './useSpaceGoals'

export function GoalsSection({ state, dimensions }: { state: SpaceGoalsState; dimensions: PerformanceIndicator[] }) {
  const t = useTranslations('SpaceCoaching')
  const { accent, textMain, textMuted, cardBg, cardBorder } = useSpaceTheme()
  const { confirm, confirmDialog } = useConfirm()
  const [addingGoal, setAddingGoal] = useState(false)
  const [addingGeneralStep, setAddingGeneralStep] = useState(false)

  const { goals, isLoading, isError, error, refetch, createGoal, updateGoal, deleteGoal, setStepDone } = state
  const { goals: grouped, generalSteps } = groupGoalsWithSteps(goals)
  const cardStyle = { background: cardBg, border: `1px solid ${cardBorder}` }

  return (
    <section className="rounded-2xl p-4" style={cardStyle}>
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold uppercase tracking-wide" style={{ color: textMuted }}>
          {t('goalsSectionTitle')}
        </h2>
        <button
          type="button"
          onClick={() => setAddingGoal(true)}
          className="inline-flex items-center gap-1 text-xs font-medium"
          style={{ color: accent }}
        >
          <Plus className="h-3.5 w-3.5" /> {t('addGoal')}
        </button>
      </div>

      {isError ? (
        <QueryErrorState
          onRetry={() => void refetch()}
          title={t('goalsLoadFailed')}
          detail={loadFailureDetail(error)}
          theme={{ textMain, textMuted, accent, border: cardBorder }}
        />
      ) : isLoading ? (
        <div className="space-y-2">
          <Skeleton className="h-16 w-full rounded-xl" />
          <Skeleton className="h-16 w-full rounded-xl" />
        </div>
      ) : (
        <div className="space-y-3">
          {grouped.length === 0 && generalSteps.length === 0 && (
            <p className="py-4 text-sm" style={{ color: textMuted }}>
              {t('goalsEmpty')}
            </p>
          )}

          {grouped.map(({ goal, steps }) => (
            <GoalCard
              key={goal.id}
              goal={goal}
              steps={steps}
              dimensions={dimensions}
              createGoal={createGoal}
              updateGoal={updateGoal}
              deleteGoal={deleteGoal}
              setStepDone={setStepDone}
              confirm={confirm}
            />
          ))}

          {generalSteps.length > 0 && (
            <div className="rounded-xl p-3" style={{ background: `${accent}0d` }}>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide" style={{ color: textMuted }}>
                {t('generalStepsTitle')}
              </p>
              <div className="space-y-2">
                {generalSteps.map((step) => (
                  <StepRow key={step.id} step={step} setStepDone={setStepDone} deleteGoal={deleteGoal} confirm={confirm} />
                ))}
              </div>
            </div>
          )}

          <button
            type="button"
            onClick={() => setAddingGeneralStep(true)}
            className="inline-flex items-center gap-1 text-xs font-medium"
            style={{ color: accent }}
          >
            <Plus className="h-3.5 w-3.5" /> {t('addTask')}
          </button>
        </div>
      )}

      <GoalFormDialog
        open={addingGoal}
        onOpenChange={setAddingGoal}
        kind="goal"
        dimensions={dimensions}
        onSubmit={async (values) => {
          await createGoal.mutateAsync({ type: 'goal', ...values })
          setAddingGoal(false)
        }}
      />
      <GoalFormDialog
        open={addingGeneralStep}
        onOpenChange={setAddingGeneralStep}
        kind="task"
        dimensions={dimensions}
        onSubmit={async (values) => {
          await createGoal.mutateAsync({ type: 'task', parentGoalId: null, ...values })
          setAddingGeneralStep(false)
        }}
      />

      {confirmDialog}
    </section>
  )
}
