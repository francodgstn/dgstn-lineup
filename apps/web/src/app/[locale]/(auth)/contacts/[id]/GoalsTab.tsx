'use client'

import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import {
  collection, query, orderBy, getDocs, addDoc, updateDoc, deleteDoc,
  doc, serverTimestamp, Timestamp, writeBatch,
} from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { CONTACTS_COLLECTION, CONTACT_GOALS_SUBCOLLECTION, resolveCoachingDimensions, dimensionLabel, groupGoalsWithSteps, goalIsOverdue, CONTACT_GOAL_EVALUATIONS_SUBCOLLECTION } from '@linyup/shared'
import type { Contact, Team, Goal, GoalEvaluation, GoalStatus, GoalType, PerformanceIndicator } from '@linyup/shared'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { DatePicker } from '@/components/ui/date-picker'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import {
  Flag, CheckSquare, Circle, ChevronDown, ChevronUp, Plus, Trash2,
  Star, Info, CheckCircle2, AlertTriangle,
} from 'lucide-react'
import { CoachAssignment } from './CoachAssignment'
import { PerformanceProfilePanel } from './PerformanceProfilePanel'

// ─── constants ────────────────────────────────────────────────────────────────
// Categories used to be a fixed technique/attitude/attendance/physical/mental
// list, separate from the check-in axes. They are the SAME team-configurable
// list now (`resolveCoachingDimensions`, `@linyup/shared`) — see the header of
// `packages/shared/src/types/goal.ts` ("ONE VOCABULARY").

const ALL_STATUSES: GoalStatus[] = ['open', 'in_progress', 'achieved', 'abandoned']

const STATUS_STYLES: Record<GoalStatus, string> = {
  open: 'bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300',
  in_progress: 'bg-orange-100 text-orange-700 dark:bg-orange-950 dark:text-orange-300',
  achieved: 'bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-300',
  abandoned: 'bg-muted text-muted-foreground',
}

// Sentinel for the Select's "no parent" option — Radix Select rejects an
// empty-string item value, and `undefined`/`null` aren't valid values either.
const NO_PARENT = '__general__'


// ─── helpers ──────────────────────────────────────────────────────────────────

function tsToDate(ts: unknown): Date | undefined {
  if (!ts) return undefined
  if (ts instanceof Timestamp) return ts.toDate()
  if (ts instanceof Date) return ts
  if (typeof ts === 'object' && ts !== null && 'toDate' in ts) return (ts as { toDate(): Date }).toDate()
  return undefined
}

function formatDate(ts: unknown): string {
  const d = tsToDate(ts)
  if (!d) return ''
  return d.toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' })
}

// ─── data hooks ───────────────────────────────────────────────────────────────

function useGoals(contactId: string) {
  return useQuery<Goal[]>({
    queryKey: ['contact-goals', contactId],
    queryFn: async () => {
      const snap = await getDocs(
        query(
          collection(db, CONTACTS_COLLECTION, contactId, CONTACT_GOALS_SUBCOLLECTION),
          orderBy('created_at', 'desc'),
        ),
      )
      return snap.docs.map((d) => ({ ...d.data(), id: d.id } as Goal))
    },
  })
}

async function fetchEvaluations(contactId: string, goalId: string): Promise<GoalEvaluation[]> {
  const snap = await getDocs(
    query(
      collection(db, CONTACTS_COLLECTION, contactId, CONTACT_GOALS_SUBCOLLECTION, goalId, CONTACT_GOAL_EVALUATIONS_SUBCOLLECTION),
      orderBy('evaluated_at', 'desc'),
    ),
  )
  return snap.docs.map((d) => ({ ...d.data(), id: d.id } as GoalEvaluation))
}

// ─── StarDisplay + StarInput ───────────────────────────────────────────────────

function StarDisplay({ score }: { score: number }) {
  return (
    <span className="flex gap-0.5">
      {[1, 2, 3, 4, 5].map((i) => (
        <Star
          key={i}
          className={`h-3.5 w-3.5 ${i <= score ? 'fill-amber-400 text-amber-400' : 'text-muted-foreground'}`}
        />
      ))}
    </span>
  )
}

// `value` starts (and can stay) unset — see EvalDialog: a rating that was never
// touched must not be indistinguishable from a deliberate "3".
function StarInput({ value, onChange }: { value: number | null; onChange: (v: number) => void }) {
  return (
    <span className="flex gap-1.5">
      {[1, 2, 3, 4, 5].map((i) => (
        <button key={i} type="button" onClick={() => onChange(i)}>
          <Star
            className={`h-7 w-7 transition-colors ${value !== null && i <= value ? 'fill-amber-400 text-amber-400' : 'text-muted-foreground hover:text-amber-300'}`}
          />
        </button>
      ))}
    </span>
  )
}

// ─── EvalDialog ───────────────────────────────────────────────────────────────

interface EvalDialogProps {
  open: boolean
  goalStatus: GoalStatus
  initial?: GoalEvaluation
  onClose: () => void
  onSubmit: (score: number, notes: string, statusAfter: GoalStatus) => Promise<void>
}

// Score starts UNSET (never a default 3) — a stray double-click on Save used to
// write a permanent, dated rating indistinguishable from a deliberate neutral.
function EvalDialog({ open, goalStatus, initial, onClose, onSubmit }: EvalDialogProps) {
  const t = useTranslations('Contacts')
  const [score, setScore] = useState<number | null>(initial?.score ?? null)
  const [notes, setNotes] = useState(initial?.notes ?? '')
  const [statusAfter, setStatusAfter] = useState<GoalStatus>(initial?.status_after ?? goalStatus)
  const [saving, setSaving] = useState(false)

  const handleOpen = (o: boolean) => {
    if (o) {
      setScore(initial?.score ?? null)
      setNotes(initial?.notes ?? '')
      setStatusAfter(initial?.status_after ?? goalStatus)
    }
  }

  const save = async () => {
    if (score == null) return
    setSaving(true)
    try { await onSubmit(score, notes.trim(), statusAfter) } finally { setSaving(false) }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { handleOpen(o); if (!o) onClose() }}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{initial ? t('goalEditEval') : t('goalAddEval')}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{t('goalScore')}</p>
            <StarInput value={score} onChange={setScore} />
            {score == null && <p className="text-xs text-muted-foreground">{t('goalScoreHint')}</p>}
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-medium">{t('goalNotes')}</label>
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} />
          </div>
          <div className="space-y-2">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{t('goalStatusAfter')}</p>
            <div className="flex flex-wrap gap-2">
              {ALL_STATUSES.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setStatusAfter(s)}
                  className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors ${
                    statusAfter === s
                      ? STATUS_STYLES[s] + ' border-transparent'
                      : 'border-border text-muted-foreground hover:border-foreground'
                  }`}
                >
                  {t(`goalStatus_${s}`)}
                </button>
              ))}
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>{t('cancel')}</Button>
          <Button onClick={save} disabled={saving || score == null}>{saving ? '…' : t('save')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ─── GoalFormDialog ───────────────────────────────────────────────────────────

interface GoalFormDialogProps {
  open: boolean
  type: GoalType
  categories: PerformanceIndicator[]
  initial?: Goal
  /** Steps only: the goals a step can attach to. Absent/empty hides the picker
   *  (there is nothing to parent to yet). */
  parentOptions?: { id: string; title: string }[]
  /** Steps only, new step: pre-filled when opened from a goal card's own "add
   *  step" button; unset (General) when opened from the General section. */
  defaultParentGoalId?: string | null
  onClose: () => void
  onSubmit: (data: { title: string; description: string; categories: string[]; targetDate: Date | null; parentGoalId: string | null }) => Promise<void>
}

function GoalFormDialog({ open, type, categories, initial, parentOptions, defaultParentGoalId, onClose, onSubmit }: GoalFormDialogProps) {
  const t = useTranslations('Contacts')
  const [title, setTitle] = useState(initial?.title ?? '')
  const [description, setDescription] = useState(initial?.description ?? '')
  const [selectedCats, setSelectedCats] = useState<string[]>(initial?.categories ?? [])
  const [targetDate, setTargetDate] = useState<Date | null>(
    tsToDate(initial?.target_date) ?? null,
  )
  const [parentGoalId, setParentGoalId] = useState<string | null>(
    initial ? (initial.parent_goal_id ?? null) : (defaultParentGoalId ?? null),
  )
  const [saving, setSaving] = useState(false)

  const handleOpen = (o: boolean) => {
    if (o) {
      setTitle(initial?.title ?? '')
      setDescription(initial?.description ?? '')
      setSelectedCats(initial?.categories ?? [])
      setTargetDate(tsToDate(initial?.target_date) ?? null)
      setParentGoalId(initial ? (initial.parent_goal_id ?? null) : (defaultParentGoalId ?? null))
    }
  }

  const toggleCat = (key: string) =>
    setSelectedCats((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]))

  const save = async () => {
    if (!title.trim()) return
    setSaving(true)
    try {
      await onSubmit({
        title: title.trim(),
        description: description.trim(),
        categories: selectedCats,
        targetDate: targetDate,
        parentGoalId,
      })
    } finally { setSaving(false) }
  }

  const isGoal = type === 'goal'

  return (
    <Dialog open={open} onOpenChange={(o) => { handleOpen(o); if (!o) onClose() }}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>
            {initial
              ? t(isGoal ? 'goalEditGoal' : 'goalEditTask')
              : t(isGoal ? 'goalsAddGoal' : 'goalsAddTask')}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <div className="space-y-1.5">
            <label className="text-sm font-medium">{t('goalFormTitle')}</label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} autoFocus />
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-medium">{t('goalFormDescription')}</label>
            <Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} />
          </div>
          {isGoal && categories.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{t('goalFormCategories')}</p>
              <div className="flex flex-wrap gap-1.5">
                {categories.map((cat) => (
                  <button
                    key={cat.key}
                    type="button"
                    onClick={() => toggleCat(cat.key)}
                    className={`px-2.5 py-1 rounded-full text-xs font-medium border transition-colors ${
                      selectedCats.includes(cat.key)
                        ? 'bg-primary text-primary-foreground border-transparent'
                        : 'border-border text-muted-foreground hover:border-foreground'
                    }`}
                  >
                    {cat.label}
                  </button>
                ))}
              </div>
            </div>
          )}
          {!isGoal && parentOptions && parentOptions.length > 0 && (
            <div className="space-y-1.5">
              <label className="text-sm font-medium">{t('goalFormParentGoal')}</label>
              <Select
                value={parentGoalId ?? NO_PARENT}
                onValueChange={(v) => setParentGoalId(v === NO_PARENT ? null : v)}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_PARENT}>{t('goalFormParentGoalNone')}</SelectItem>
                  {parentOptions.map((g) => (
                    <SelectItem key={g.id} value={g.id}>{g.title}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          <div className="space-y-1.5">
            <label className="text-sm font-medium">{t('goalFormTargetDate')}</label>
            <DatePicker
              value={targetDate ?? undefined}
              onChange={(d) => setTargetDate(d ?? null)}
              placeholder="No target date"
              fromYear={new Date().getFullYear() - 1}
              toYear={new Date().getFullYear() + 5}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>{t('cancel')}</Button>
          <Button onClick={save} disabled={saving || !title.trim()}>{saving ? '…' : t('save')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ─── shared collapsed-state chips (score, last evaluated, overdue) ────────────

function GoalStateChips({ goal, t }: { goal: Goal; t: ReturnType<typeof useTranslations> }) {
  const overdue = goalIsOverdue(goal)
  if (goal.latest_score == null && !goal.last_evaluated_at && !overdue) return null
  return (
    <div className="flex flex-wrap items-center gap-2">
      {goal.latest_score != null && (
        <span className="inline-flex items-center gap-1">
          <StarDisplay score={goal.latest_score} />
        </span>
      )}
      {goal.last_evaluated_at && (
        <span className="text-xs text-muted-foreground">
          {t('goalLastEvaluatedOn', { date: formatDate(goal.last_evaluated_at) })}
        </span>
      )}
      {overdue && (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300">
          <AlertTriangle className="h-3 w-3" />
          {t('goalOverdueBadge')}
        </span>
      )}
    </div>
  )
}

// ─── GoalCard ─────────────────────────────────────────────────────────────────

interface GoalCardProps {
  goal: Goal
  contactId: string
  categories: PerformanceIndicator[]
  steps: Goal[]
  onChanged: () => void
  onAddStep: (goalId: string) => void
  onEditStep: (step: Goal) => void
}

function GoalCard({ goal, contactId, categories, steps, onChanged, onAddStep, onEditStep }: GoalCardProps) {
  const t = useTranslations('Contacts')
  const qc = useQueryClient()
  const [expanded, setExpanded] = useState(false)
  const [evals, setEvals] = useState<GoalEvaluation[]>([])
  const [loadingEvals, setLoadingEvals] = useState(false)
  const [showEvalDialog, setShowEvalDialog] = useState(false)
  const [editingEval, setEditingEval] = useState<GoalEvaluation | null>(null)
  const [editOpen, setEditOpen] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [deleting, setDeleting] = useState(false)

  const goalRef = doc(db, CONTACTS_COLLECTION, contactId, CONTACT_GOALS_SUBCOLLECTION, goal.id)

  const loadEvals = async () => {
    setLoadingEvals(true)
    try { setEvals(await fetchEvaluations(contactId, goal.id)) } finally { setLoadingEvals(false) }
  }

  const handleExpand = () => {
    if (!expanded) loadEvals()
    setExpanded((e) => !e)
  }

  // ONE BATCH, not two awaits. An evaluation and the status it moves the goal to
  // are a single fact: if the second write never lands, the goal keeps a status
  // its own newest evaluation contradicts, and nothing later reconciles them.
  const handleAddEval = async (score: number, notes: string, statusAfter: GoalStatus) => {
    const batch = writeBatch(db)
    batch.set(doc(collection(goalRef, CONTACT_GOAL_EVALUATIONS_SUBCOLLECTION)), {
      evaluated_at: serverTimestamp(),
      evaluated_by: 'coach',
      score,
      notes: notes || null,
      status_after: statusAfter,
    })
    batch.update(goalRef, { status: statusAfter })
    await batch.commit()
    setShowEvalDialog(false)
    await loadEvals()
    qc.invalidateQueries({ queryKey: ['contact-goals', contactId] })
  }

  const handleEditEval = async (score: number, notes: string, statusAfter: GoalStatus) => {
    if (!editingEval) return
    const batch = writeBatch(db)
    batch.update(doc(collection(goalRef, CONTACT_GOAL_EVALUATIONS_SUBCOLLECTION), editingEval.id), {
      score, notes: notes || null, status_after: statusAfter, edited: true,
    })
    batch.update(goalRef, { status: statusAfter })
    await batch.commit()
    setEditingEval(null)
    await loadEvals()
    qc.invalidateQueries({ queryKey: ['contact-goals', contactId] })
  }

  const handleEdit = async (data: { title: string; description: string; categories: string[]; targetDate: Date | null }) => {
    await updateDoc(goalRef, {
      title: data.title,
      description: data.description || null,
      categories: data.categories,
      target_date: data.targetDate ? Timestamp.fromDate(data.targetDate) : null,
    })
    setEditOpen(false)
    onChanged()
  }

  const handleDelete = async () => {
    setDeleting(true)
    try { await deleteDoc(goalRef); onChanged() } finally { setDeleting(false); setConfirmDelete(false) }
  }

  const canEval = goal.status === 'open' || goal.status === 'in_progress'
  const targetDateStr = formatDate(goal.target_date)
  const doneSteps = steps.filter((s) => s.status === 'achieved').length

  return (
    <>
      <div className="rounded-xl border bg-card overflow-hidden">
        <div className="p-4 space-y-3">
          {/* Header */}
          <div className="flex items-start gap-2">
            <div className="flex-1 min-w-0">
              <p className="font-semibold leading-snug">{goal.title}</p>
              {goal.description && (
                <p className="text-sm text-muted-foreground mt-0.5 line-clamp-2">{goal.description}</p>
              )}
            </div>
            <div className="flex items-center gap-1 shrink-0">
              {goal.created_by !== 'coach' ? (
                // Visible chip, not a hover-only cue — front-desk iPads have no
                // hover state, so a tooltip here explained nothing to anyone.
                <span
                  title={t('goalCoachInfo')}
                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300"
                >
                  <Info className="h-3 w-3" />
                  {t('goalMemberAddedBadge')}
                </span>
              ) : (
                <>
                  <button onClick={() => setEditOpen(true)} className="p-1 rounded hover:bg-muted transition-colors">
                    <Flag className="h-3.5 w-3.5 text-muted-foreground" />
                  </button>
                  <button onClick={() => setConfirmDelete(true)} disabled={deleting} className="p-1 rounded hover:bg-muted transition-colors">
                    <Trash2 className="h-3.5 w-3.5 text-destructive" />
                  </button>
                </>
              )}
            </div>
          </div>

          {/* Chips */}
          <div className="flex flex-wrap gap-1.5">
            <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_STYLES[goal.status]}`}>
              {t(`goalStatus_${goal.status}`)}
            </span>
            {goal.categories.map((key) => (
              <span key={key} className="inline-flex items-center px-2 py-0.5 rounded-full text-xs bg-muted text-muted-foreground">
                {dimensionLabel(key, categories)}
              </span>
            ))}
            {targetDateStr && (
              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs bg-muted text-muted-foreground">
                {t('goalTargetDate')}: {targetDateStr}
              </span>
            )}
            <span className={`ml-auto text-xs ${goal.created_by === 'coach' ? 'text-violet-500' : 'text-muted-foreground'}`}>
              {t(`goalBy_${goal.created_by}`)}
            </span>
          </div>

          {/* Latest score / last evaluated / overdue — so the one stale goal in
              a list is visible WITHOUT expanding every card. */}
          <GoalStateChips goal={goal} t={t} />

          {/* Steps nested under their goal — see groupGoalsWithSteps. */}
          <div className="rounded-lg border bg-muted/20 divide-y">
            <div className="flex items-center justify-between px-3 py-2">
              <p className="text-xs font-medium text-muted-foreground">
                {steps.length > 0
                  ? t('goalStepsCompleted', { done: doneSteps, total: steps.length })
                  : t('goalNoSteps')}
              </p>
              <button
                type="button"
                onClick={() => onAddStep(goal.id)}
                className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                <Plus className="h-3 w-3" />
                {t('goalsAddTask')}
              </button>
            </div>
            {steps.map((s) => (
              <TaskCard key={s.id} goal={s} contactId={contactId} nested onChanged={onChanged} onEdit={() => onEditStep(s)} />
            ))}
          </div>

          {/* Expand toggle */}
          <button
            onClick={handleExpand}
            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors ml-auto"
          >
            {t('goalEvaluations')}
            {expanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
          </button>
        </div>

        {/* Evaluations panel */}
        {expanded && (
          <div className="border-t px-4 py-3 space-y-2 bg-muted/30">
            {loadingEvals ? (
              <p className="text-xs text-muted-foreground py-2">{t('loading')}</p>
            ) : evals.length === 0 ? (
              <p className="text-xs text-muted-foreground py-1">{t('goalNoEvaluations')}</p>
            ) : (
              evals.map((ev) => (
                <div
                  key={ev.id}
                  className="rounded-lg border-l-4 bg-card px-3 py-2 space-y-1"
                  style={{ borderLeftColor: ev.status_after === 'achieved' ? '#22c55e' : ev.status_after === 'in_progress' ? '#f97316' : ev.status_after === 'abandoned' ? '#9ca3af' : '#3b82f6' }}
                >
                  <div className="flex items-center justify-between">
                    <StarDisplay score={ev.score} />
                    <div className="flex items-center gap-1.5">
                      {ev.edited && <span className="text-[10px] text-muted-foreground">edited</span>}
                      <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${ev.evaluated_by === 'coach' ? 'bg-violet-100 text-violet-700 dark:bg-violet-950 dark:text-violet-300' : 'bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300'}`}>
                        {t(`goalBy_${ev.evaluated_by}`)}
                      </span>
                      {ev.evaluated_by === 'coach' && (
                        <button onClick={() => setEditingEval(ev)} className="text-muted-foreground hover:text-foreground transition-colors">
                          <Flag className="h-3 w-3" />
                        </button>
                      )}
                    </div>
                  </div>
                  <p className="text-[10px] text-muted-foreground">
                    {formatDate(ev.evaluated_at)} · {t(`goalStatus_${ev.status_after}`)}
                  </p>
                  {ev.notes && <p className="text-xs text-foreground">{ev.notes}</p>}
                </div>
              ))
            )}
            {canEval && (
              <Button variant="outline" size="sm" onClick={() => setShowEvalDialog(true)} className="mt-1">
                <Plus className="h-3.5 w-3.5 mr-1" />{t('goalAddEval')}
              </Button>
            )}
          </div>
        )}
      </div>

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('goalDeleteTitle')}</AlertDialogTitle>
            <AlertDialogDescription>{t('goalDeleteDesc')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('cancel')}</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} disabled={deleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              {t('delete')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <GoalFormDialog
        open={editOpen}
        type="goal"
        categories={categories}
        initial={goal}
        onClose={() => setEditOpen(false)}
        onSubmit={handleEdit}
      />
      <EvalDialog
        open={showEvalDialog}
        goalStatus={goal.status}
        onClose={() => setShowEvalDialog(false)}
        onSubmit={handleAddEval}
      />
      {editingEval && (
        <EvalDialog
          open={true}
          goalStatus={goal.status}
          initial={editingEval}
          onClose={() => setEditingEval(null)}
          onSubmit={handleEditEval}
        />
      )}
    </>
  )
}

// ─── TaskCard (a "step" — the word "Task" is kept deliberately) ───────────────

interface TaskCardProps {
  goal: Goal
  contactId: string
  onChanged: () => void
  /** Nested inside a GoalCard: tighter, borderless row. Top-level (General):
   *  the fuller standalone card. */
  nested?: boolean
  /** Opens the shared edit dialog (with the parent picker) from the parent —
   *  General-section steps render this inline instead (see GoalsTab). */
  onEdit?: () => void
}

function TaskCard({ goal, contactId, onChanged, nested, onEdit }: TaskCardProps) {
  const t = useTranslations('Contacts')
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [acting, setActing] = useState(false)
  const isDone = goal.status === 'achieved'
  const goalRef = doc(db, CONTACTS_COLLECTION, contactId, CONTACT_GOALS_SUBCOLLECTION, goal.id)

  const toggleDone = async () => {
    setActing(true)
    try {
      await updateDoc(goalRef, isDone
        ? { status: 'open', completed_at: null }
        : { status: 'achieved', completed_at: serverTimestamp() })
      onChanged()
    } finally { setActing(false) }
  }

  const handleDelete = async () => {
    await deleteDoc(goalRef)
    onChanged()
    setConfirmDelete(false)
  }

  return (
    <>
      <div className={`flex items-start gap-3 ${nested ? 'px-3 py-2' : 'rounded-xl border bg-card px-4 py-3'} ${isDone ? 'opacity-60' : ''}`}>
        <button onClick={toggleDone} disabled={acting} className="mt-0.5 shrink-0 text-muted-foreground hover:text-foreground transition-colors">
          {isDone
            ? <CheckCircle2 className="h-5 w-5 text-green-500" />
            : <Circle className="h-5 w-5" />}
        </button>
        <div className="flex-1 min-w-0">
          <p className={`font-medium text-sm leading-snug ${isDone ? 'line-through text-muted-foreground' : ''}`}>
            {goal.title}
          </p>
          {goal.description && (
            <p className="text-xs text-muted-foreground mt-0.5">{goal.description}</p>
          )}
          {goal.target_date && (
            <p className="text-xs text-muted-foreground mt-1">
              {t('goalTargetDate')}: {formatDate(goal.target_date)}
            </p>
          )}
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <button onClick={onEdit} className="p-1 rounded hover:bg-muted transition-colors">
            <CheckSquare className="h-3.5 w-3.5 text-muted-foreground" />
          </button>
          <button onClick={() => setConfirmDelete(true)} className="p-1 rounded hover:bg-muted transition-colors">
            <Trash2 className="h-3.5 w-3.5 text-destructive" />
          </button>
        </div>
      </div>
      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('taskDeleteTitle')}</AlertDialogTitle>
            <AlertDialogDescription>{t('taskDeleteDesc')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('cancel')}</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              {t('delete')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

// ─── GoalsTab ─────────────────────────────────────────────────────────────────

interface Props {
  contact: Contact
  teamId: string | null
  team: Team | null
}

export function GoalsTab({ contact, teamId, team }: Props) {
  const t = useTranslations('Contacts')
  const qc = useQueryClient()
  const { data: goals = [], isLoading } = useGoals(contact.id)
  const [addGoalOpen, setAddGoalOpen] = useState(false)
  // ONE shared "add/edit step" dialog for every entry point: a goal card's own
  // "add step" button (parentGoalId pre-filled), the General section's add
  // button (parentGoalId unset) and editing an existing step from either place.
  const [stepDialog, setStepDialog] = useState<{ open: boolean; editing: Goal | null; defaultParentGoalId: string | null }>(
    { open: false, editing: null, defaultParentGoalId: null },
  )

  const categories = resolveCoachingDimensions(team)

  const { goals: goalsWithSteps, generalSteps } = groupGoalsWithSteps(goals)
  const goalOptions = goalsWithSteps.map(({ goal }) => ({ id: goal.id, title: goal.title }))

  const invalidate = () => qc.invalidateQueries({ queryKey: ['contact-goals', contact.id] })

  const handleAddGoal = async (data: { title: string; description: string; categories: string[]; targetDate: Date | null }) => {
    await addDoc(collection(db, CONTACTS_COLLECTION, contact.id, CONTACT_GOALS_SUBCOLLECTION), {
      type: 'goal',
      title: data.title,
      description: data.description || null,
      status: 'open',
      categories: data.categories,
      parent_goal_id: null,
      created_by: 'coach',
      created_at: serverTimestamp(),
      target_date: data.targetDate ? Timestamp.fromDate(data.targetDate) : null,
    })
    setAddGoalOpen(false)
    invalidate()
  }

  const openAddStep = (goalId: string | null) =>
    setStepDialog({ open: true, editing: null, defaultParentGoalId: goalId })
  const openEditStep = (step: Goal) =>
    setStepDialog({ open: true, editing: step, defaultParentGoalId: step.parent_goal_id ?? null })
  const closeStepDialog = () => setStepDialog({ open: false, editing: null, defaultParentGoalId: null })

  const handleSubmitStep = async (data: { title: string; description: string; targetDate: Date | null; parentGoalId: string | null }) => {
    const payload = {
      title: data.title,
      description: data.description || null,
      target_date: data.targetDate ? Timestamp.fromDate(data.targetDate) : null,
      parent_goal_id: data.parentGoalId,
    }
    if (stepDialog.editing) {
      await updateDoc(
        doc(db, CONTACTS_COLLECTION, contact.id, CONTACT_GOALS_SUBCOLLECTION, stepDialog.editing.id),
        payload,
      )
    } else {
      await addDoc(collection(db, CONTACTS_COLLECTION, contact.id, CONTACT_GOALS_SUBCOLLECTION), {
        ...payload,
        type: 'task',
        status: 'open',
        categories: [],
        created_by: 'coach',
        created_at: serverTimestamp(),
      })
    }
    closeStepDialog()
    invalidate()
  }

  if (isLoading) {
    return <div className="py-12 text-center text-sm text-muted-foreground">{t('loading')}</div>
  }

  return (
    <div className="space-y-6 pb-24">
      <CoachAssignment contact={contact} teamId={teamId} />

      {/* The check-in radar feeds straight into the goals below it — see
          PerformanceProfilePanel's header for why it moved out of Stats. */}
      <PerformanceProfilePanel contact={contact} team={team} goals={goals} />

      {/* One column: every goal card carries its own steps inline (with a
          completion count), and unparented steps fall into a virtual "General"
          heading at the bottom — no document backs it. */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Flag className="h-4 w-4 text-violet-500" />
            <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">{t('goalsTitle')}</h3>
          </div>
          <Button variant="outline" size="sm" onClick={() => setAddGoalOpen(true)}>
            <Plus className="h-3.5 w-3.5 mr-1" />{t('goalsAddGoal')}
          </Button>
        </div>

        {goalsWithSteps.length === 0 ? (
          <div className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">
            {t('goalsEmpty')}
          </div>
        ) : (
          <div className="space-y-3">
            {goalsWithSteps.map(({ goal, steps }) => (
              <GoalCard
                key={goal.id}
                goal={goal}
                contactId={contact.id}
                categories={categories}
                steps={steps}
                onChanged={invalidate}
                onAddStep={openAddStep}
                onEditStep={openEditStep}
              />
            ))}
          </div>
        )}

        {/* General — steps with no parent goal. Virtual: nothing to create,
            migrate, or clean up when the last one leaves it. */}
        <div className="space-y-2 pt-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <CheckSquare className="h-4 w-4 text-orange-500" />
              <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">{t('goalsGeneralHeading')}</h3>
            </div>
            <Button variant="outline" size="sm" onClick={() => openAddStep(null)}>
              <Plus className="h-3.5 w-3.5 mr-1" />{t('goalsAddTask')}
            </Button>
          </div>

          {generalSteps.length === 0 ? (
            <div className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">
              {t('tasksEmpty')}
            </div>
          ) : (
            <div className="space-y-2">
              {generalSteps.map((s) => (
                <TaskCard key={s.id} goal={s} contactId={contact.id} onChanged={invalidate} onEdit={() => openEditStep(s)} />
              ))}
            </div>
          )}
        </div>
      </div>

      <GoalFormDialog
        open={addGoalOpen}
        type="goal"
        categories={categories}
        onClose={() => setAddGoalOpen(false)}
        onSubmit={handleAddGoal}
      />
      <GoalFormDialog
        key={stepDialog.editing?.id ?? stepDialog.defaultParentGoalId ?? 'new'}
        open={stepDialog.open}
        type="task"
        categories={[]}
        initial={stepDialog.editing ?? undefined}
        parentOptions={goalOptions}
        defaultParentGoalId={stepDialog.defaultParentGoalId}
        onClose={closeStepDialog}
        onSubmit={handleSubmitStep}
      />
    </div>
  )
}
