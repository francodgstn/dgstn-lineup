'use client'

// One goal, with its steps nested underneath (see `groupGoalsWithSteps` in
// GoalsSection). Edit/delete and the status control inside the evaluation
// dialog are all gated on `goal.created_by === 'student'` — a coach-created
// GOAL is read-only here, matching what firestore.rules actually enforces
// (see the module note in useSpaceGoals.ts). A STEP is different — see
// StepRow, which lets a member tick a coach-created one done too.

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { ChevronDown, ChevronUp, Info, Pencil, Plus, Star, Trash2 } from 'lucide-react'
import { dimensionLabel, goalCategoryLabel, goalIsOverdue } from '@linyup/shared'
import type { Goal, GoalStatus, PerformanceIndicator } from '@linyup/shared'
import type { ConfirmOptions } from '@/components/ui/confirm-dialog'
import { QueryErrorState } from '@/components/ui/query-error'
import { loadFailureDetail } from '@/lib/publicQueryError'
import { useSpaceTheme } from '../useSpaceTheme'
import { RatingStars } from './RatingStars'
import { StepRow } from './StepRow'
import { GoalFormDialog } from './GoalFormDialog'
import { EvaluationFormDialog } from './EvaluationFormDialog'
import { useAddGoalEvaluation, useGoalEvaluations } from './useSpaceGoals'
import type { SpaceGoalsState } from './useSpaceGoals'
import { Tip } from '@/components/ui/tip'

const STATUS_KEYS: Record<GoalStatus, string> = {
  open: 'statusOpen',
  in_progress: 'statusInProgress',
  achieved: 'statusAchieved',
  abandoned: 'statusAbandoned',
}

interface Props {
  goal: Goal
  steps: Goal[]
  /** What a goal is ABOUT — labels the category chips and fills the picker. */
  categories: PerformanceIndicator[]
  /** Check-in axes — used ONLY to label the `from_dimension` provenance chip. */
  dimensions: PerformanceIndicator[]
  createGoal: SpaceGoalsState['createGoal']
  updateGoal: SpaceGoalsState['updateGoal']
  deleteGoal: SpaceGoalsState['deleteGoal']
  setStepDone: SpaceGoalsState['setStepDone']
  confirm: (options: ConfirmOptions) => Promise<boolean>
}

export function GoalCard({ goal, steps, categories, dimensions, createGoal, updateGoal, deleteGoal, setStepDone, confirm }: Props) {
  const t = useTranslations('SpaceCoaching')
  const tCommon = useTranslations('Common')
  const { accent, textMain, textMuted, cardBg, cardBorder } = useSpaceTheme()

  const [expanded, setExpanded] = useState(false)
  const [editing, setEditing] = useState(false)
  const [addingStep, setAddingStep] = useState(false)
  const [evaluating, setEvaluating] = useState(false)

  const own = goal.created_by === 'student'
  const canEvaluate = goal.status === 'open' || goal.status === 'in_progress'
  const overdue = goalIsOverdue(goal)
  const deleteFailed = deleteGoal.isError && deleteGoal.variables === goal.id

  const evaluationsQuery = useGoalEvaluations(goal.id, expanded)
  const addEvaluation = useAddGoalEvaluation()

  async function handleDelete() {
    const ok = await confirm({
      title: t('deleteGoalConfirmTitle'),
      description: t('deleteGoalConfirmBody', { title: goal.title }),
      confirmLabel: tCommon('delete'),
    })
    if (ok) deleteGoal.mutate(goal.id)
  }

  return (
    <div className="rounded-xl p-3" style={{ background: cardBg, border: `1px solid ${cardBorder}` }}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold" style={{ color: textMain }}>
            {goal.title}
          </p>
          {goal.description && (
            <p className="mt-0.5 text-xs" style={{ color: textMuted }}>
              {goal.description}
            </p>
          )}
        </div>
        {own ? (
          <div className="flex shrink-0 items-center gap-2">
            <Tip label={t('editGoal')}>
              <button type="button" onClick={() => setEditing(true)} aria-label={t('editGoal')}>
                <Pencil className="h-3.5 w-3.5" style={{ color: textMuted }} />
              </button>
            </Tip>
            <Tip label={t('deleteGoal')}>
              <button type="button" onClick={handleDelete} disabled={deleteGoal.isPending} aria-label={t('deleteGoal')}>
                <Trash2 className="h-3.5 w-3.5" style={{ color: textMuted }} />
              </button>
            </Tip>
          </div>
        ) : (
          <span title={t('goalCoachCreatedNote')} className="shrink-0">
            <Info className="h-3.5 w-3.5" style={{ color: accent }} />
          </span>
        )}
      </div>

      {deleteFailed && (
        <p className="mt-1 text-xs" style={{ color: '#dc2626' }}>
          {t('goalDeleteFailed')}
        </p>
      )}

      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <span className="rounded-full px-2 py-0.5 text-[10px] font-semibold" style={{ background: `${accent}1f`, color: accent }}>
          {t(STATUS_KEYS[goal.status])}
        </span>
        {overdue && (
          <span className="rounded-full px-2 py-0.5 text-[10px] font-semibold" style={{ background: '#fee2e2', color: '#b91c1c' }}>
            {t('overdueBadge')}
          </span>
        )}
        {(goal.categories ?? []).map((cat) => (
          <span key={cat} className="rounded-full px-2 py-0.5 text-[10px]" style={{ background: cardBorder, color: textMuted }}>
            {goalCategoryLabel(cat, categories)}
          </span>
        ))}
        {/* Provenance, not a category — the axis this goal was created FROM.
            Drawn deliberately quieter than the category chips (outline, no
            fill) so the two never read as one list. */}
        {goal.from_dimension && (
          <span
            className="rounded-full border border-dashed px-2 py-0.5 text-[10px]"
            style={{ borderColor: cardBorder, color: textMuted }}
          >
            {t('goalFromDimension', { dimension: dimensionLabel(goal.from_dimension, dimensions) })}
          </span>
        )}
        {goal.target_date && (
          <span className="text-[10px]" style={{ color: textMuted }}>
            {t('targetDateLabel', { date: goal.target_date.toDate().toLocaleDateString() })}
          </span>
        )}
      </div>

      {typeof goal.latest_score === 'number' && (
        <div className="mt-2 flex items-center gap-1.5">
          <RatingStars value={goal.latest_score} readOnly size={14} emptyColor={textMuted} />
          <span className="text-[11px]" style={{ color: textMuted }}>
            {t('latestScoreLabel', { score: goal.latest_score })}
            {goal.last_evaluated_at
              ? ` · ${t('lastEvaluatedOn', { date: goal.last_evaluated_at.toDate().toLocaleDateString() })}`
              : ''}
          </span>
        </div>
      )}

      {steps.length > 0 && (
        <div className="mt-3 space-y-1.5 border-t pt-2" style={{ borderColor: cardBorder }}>
          {steps.map((step) => (
            <StepRow key={step.id} step={step} setStepDone={setStepDone} deleteGoal={deleteGoal} confirm={confirm} />
          ))}
        </div>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => setAddingStep(true)}
          className="inline-flex items-center gap-1 text-xs font-medium"
          style={{ color: accent }}
        >
          <Plus className="h-3.5 w-3.5" /> {t('addStep')}
        </button>
        {canEvaluate && (
          <button
            type="button"
            onClick={() => setEvaluating(true)}
            className="inline-flex items-center gap-1 text-xs font-medium"
            style={{ color: accent }}
          >
            <Star className="h-3.5 w-3.5" /> {t('addEvaluation')}
          </button>
        )}
        <button
          type="button"
          onClick={() => setExpanded((e) => !e)}
          className="ml-auto inline-flex items-center gap-1 text-xs"
          style={{ color: textMuted }}
        >
          {t('evaluationsTitle')}
          {expanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
        </button>
      </div>

      {expanded && (
        <div className="mt-2 space-y-1.5 border-t pt-2" style={{ borderColor: cardBorder }}>
          {evaluationsQuery.isLoading ? (
            <div className="flex justify-center py-2">
              <div
                className="h-4 w-4 rounded-full border-2 border-t-transparent animate-spin"
                style={{ borderColor: accent, borderTopColor: 'transparent' }}
              />
            </div>
          ) : evaluationsQuery.isError ? (
            <QueryErrorState
              onRetry={() => void evaluationsQuery.refetch()}
              title={t('evaluationsLoadFailed')}
              detail={loadFailureDetail(evaluationsQuery.error)}
              theme={{ textMain, textMuted, accent, border: cardBorder }}
            />
          ) : (evaluationsQuery.data ?? []).length === 0 ? (
            <p className="text-xs" style={{ color: textMuted }}>
              {t('evaluationsEmpty')}
            </p>
          ) : (
            (evaluationsQuery.data ?? []).map((ev) => (
              <div key={ev.id} className="flex items-start justify-between gap-2 text-xs">
                <div className="flex min-w-0 items-center gap-1.5">
                  <RatingStars value={ev.score} readOnly size={12} emptyColor={textMuted} />
                  {ev.notes && (
                    <span className="truncate" style={{ color: textMuted }}>
                      {ev.notes}
                    </span>
                  )}
                </div>
                <span className="shrink-0" style={{ color: textMuted }}>
                  {ev.evaluated_at.toDate().toLocaleDateString()} ·{' '}
                  {ev.evaluated_by === 'coach' ? t('evaluatedByCoach') : t('evaluatedBySelf')}
                </span>
              </div>
            ))
          )}
        </div>
      )}

      <GoalFormDialog
        open={editing}
        onOpenChange={setEditing}
        kind="goal"
        categories={categories}
        initialGoal={goal}
        onSubmit={async (values) => {
          await updateGoal.mutateAsync({ goalId: goal.id, ...values })
          setEditing(false)
        }}
      />
      <GoalFormDialog
        open={addingStep}
        onOpenChange={setAddingStep}
        kind="task"
        categories={categories}
        onSubmit={async (values) => {
          await createGoal.mutateAsync({ type: 'task', parentGoalId: goal.id, ...values })
          setAddingStep(false)
        }}
      />
      <EvaluationFormDialog
        open={evaluating}
        onOpenChange={setEvaluating}
        goal={goal}
        onSubmit={async ({ score, notes, statusAfter }) => {
          await addEvaluation.mutateAsync({ goal, score, notes, statusAfter })
          setEvaluating(false)
        }}
      />
    </div>
  )
}
