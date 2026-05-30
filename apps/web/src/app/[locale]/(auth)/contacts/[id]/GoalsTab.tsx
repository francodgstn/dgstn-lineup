'use client'

import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import {
  collection, query, orderBy, getDocs, addDoc, updateDoc, deleteDoc,
  doc, serverTimestamp, Timestamp,
} from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { CONTACTS_COLLECTION, CONTACT_GOALS_SUBCOLLECTION } from '@lineup/shared'
import type { Goal, GoalEvaluation, GoalStatus, GoalType, TrainingIndicator } from '@lineup/shared'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { DatePicker } from '@/components/ui/date-picker'
import { Textarea } from '@/components/ui/textarea'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import {
  Flag, CheckSquare, Circle, ChevronDown, ChevronUp, Plus, Trash2,
  Star, Info, CheckCircle2,
} from 'lucide-react'

// ─── constants ────────────────────────────────────────────────────────────────

const DEFAULT_CATEGORIES: TrainingIndicator[] = [
  { key: 'technique', label: 'Technique' },
  { key: 'attitude', label: 'Attitude' },
  { key: 'attendance', label: 'Attendance' },
  { key: 'physical', label: 'Physical' },
  { key: 'mental', label: 'Mental' },
]

const ALL_STATUSES: GoalStatus[] = ['open', 'in_progress', 'achieved', 'abandoned']

const STATUS_STYLES: Record<GoalStatus, string> = {
  open: 'bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300',
  in_progress: 'bg-orange-100 text-orange-700 dark:bg-orange-950 dark:text-orange-300',
  achieved: 'bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-300',
  abandoned: 'bg-muted text-muted-foreground',
}

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
      return snap.docs.map((d) => ({ id: d.id, ...d.data() } as Goal))
    },
  })
}

async function fetchEvaluations(contactId: string, goalId: string): Promise<GoalEvaluation[]> {
  const snap = await getDocs(
    query(
      collection(db, CONTACTS_COLLECTION, contactId, CONTACT_GOALS_SUBCOLLECTION, goalId, 'evaluations'),
      orderBy('evaluated_at', 'desc'),
    ),
  )
  return snap.docs.map((d) => ({ id: d.id, ...d.data() } as GoalEvaluation))
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

function StarInput({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  return (
    <span className="flex gap-1.5">
      {[1, 2, 3, 4, 5].map((i) => (
        <button key={i} type="button" onClick={() => onChange(i)}>
          <Star
            className={`h-7 w-7 transition-colors ${i <= value ? 'fill-amber-400 text-amber-400' : 'text-muted-foreground hover:text-amber-300'}`}
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

function EvalDialog({ open, goalStatus, initial, onClose, onSubmit }: EvalDialogProps) {
  const t = useTranslations('Contacts')
  const [score, setScore] = useState(initial?.score ?? 3)
  const [notes, setNotes] = useState(initial?.notes ?? '')
  const [statusAfter, setStatusAfter] = useState<GoalStatus>(initial?.status_after ?? goalStatus)
  const [saving, setSaving] = useState(false)

  const handleOpen = (o: boolean) => {
    if (o) {
      setScore(initial?.score ?? 3)
      setNotes(initial?.notes ?? '')
      setStatusAfter(initial?.status_after ?? goalStatus)
    }
  }

  const save = async () => {
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
          <Button onClick={save} disabled={saving}>{saving ? '…' : t('save')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ─── GoalFormDialog ───────────────────────────────────────────────────────────

interface GoalFormDialogProps {
  open: boolean
  type: GoalType
  categories: TrainingIndicator[]
  initial?: Goal
  onClose: () => void
  onSubmit: (data: { title: string; description: string; categories: string[]; targetDate: Date | null }) => Promise<void>
}

function GoalFormDialog({ open, type, categories, initial, onClose, onSubmit }: GoalFormDialogProps) {
  const t = useTranslations('Contacts')
  const [title, setTitle] = useState(initial?.title ?? '')
  const [description, setDescription] = useState(initial?.description ?? '')
  const [selectedCats, setSelectedCats] = useState<string[]>(initial?.categories ?? [])
  const [targetDate, setTargetDate] = useState<Date | null>(
    tsToDate(initial?.target_date) ?? null,
  )
  const [saving, setSaving] = useState(false)

  const handleOpen = (o: boolean) => {
    if (o) {
      setTitle(initial?.title ?? '')
      setDescription(initial?.description ?? '')
      setSelectedCats(initial?.categories ?? [])
      setTargetDate(tsToDate(initial?.target_date) ?? null)
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

// ─── GoalCard ─────────────────────────────────────────────────────────────────

interface GoalCardProps {
  goal: Goal
  contactId: string
  categories: TrainingIndicator[]
  onChanged: () => void
}

function GoalCard({ goal, contactId, categories, onChanged }: GoalCardProps) {
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

  const handleAddEval = async (score: number, notes: string, statusAfter: GoalStatus) => {
    await addDoc(collection(goalRef, 'evaluations'), {
      evaluated_at: serverTimestamp(),
      evaluated_by: 'coach',
      score,
      notes: notes || null,
      status_after: statusAfter,
    })
    await updateDoc(goalRef, { status: statusAfter })
    setShowEvalDialog(false)
    await loadEvals()
    qc.invalidateQueries({ queryKey: ['contact-goals', contactId] })
  }

  const handleEditEval = async (score: number, notes: string, statusAfter: GoalStatus) => {
    if (!editingEval) return
    await updateDoc(doc(collection(goalRef, 'evaluations'), editingEval.id), {
      score, notes: notes || null, status_after: statusAfter, edited: true,
    })
    await updateDoc(goalRef, { status: statusAfter })
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
                <span title={t('goalCoachInfo')}>
                  <Info className="h-4 w-4 text-blue-400" />
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
            {goal.categories.map((key) => {
              const cat = categories.find((c) => c.key === key)
              return (
                <span key={key} className="inline-flex items-center px-2 py-0.5 rounded-full text-xs bg-muted text-muted-foreground">
                  {cat?.label ?? key}
                </span>
              )
            })}
            {targetDateStr && (
              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs bg-muted text-muted-foreground">
                {t('goalTargetDate')}: {targetDateStr}
              </span>
            )}
            <span className={`ml-auto text-xs ${goal.created_by === 'coach' ? 'text-violet-500' : 'text-muted-foreground'}`}>
              {t(`goalBy_${goal.created_by}`)}
            </span>
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

// ─── TaskCard ─────────────────────────────────────────────────────────────────

interface TaskCardProps {
  goal: Goal
  contactId: string
  onChanged: () => void
}

function TaskCard({ goal, contactId, onChanged }: TaskCardProps) {
  const t = useTranslations('Contacts')
  const [editOpen, setEditOpen] = useState(false)
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

  const handleEdit = async (data: { title: string; description: string; categories: string[]; targetDate: Date | null }) => {
    await updateDoc(goalRef, {
      title: data.title,
      description: data.description || null,
      target_date: data.targetDate ? Timestamp.fromDate(data.targetDate) : null,
    })
    setEditOpen(false)
    onChanged()
  }

  const handleDelete = async () => {
    await deleteDoc(goalRef)
    onChanged()
    setConfirmDelete(false)
  }

  return (
    <>
      <div className={`rounded-xl border bg-card px-4 py-3 flex items-start gap-3 ${isDone ? 'opacity-60' : ''}`}>
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
          <button onClick={() => setEditOpen(true)} className="p-1 rounded hover:bg-muted transition-colors">
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
      <GoalFormDialog
        open={editOpen}
        type="task"
        categories={[]}
        initial={goal}
        onClose={() => setEditOpen(false)}
        onSubmit={handleEdit}
      />
    </>
  )
}

// ─── GoalsTab ─────────────────────────────────────────────────────────────────

interface Props {
  contact: { id: string; teamId?: string | null }
  teamId: string | null
}

export function GoalsTab({ contact, teamId }: Props) {
  const t = useTranslations('Contacts')
  const qc = useQueryClient()
  const { data: goals = [], isLoading } = useGoals(contact.id)
  const [addGoalOpen, setAddGoalOpen] = useState(false)
  const [addTaskOpen, setAddTaskOpen] = useState(false)

  // Use default categories for now; team-configured categories could be fetched here
  const categories = DEFAULT_CATEGORIES

  const goalList = goals.filter((g) => g.type === 'goal' || !g.type)
  const taskList = goals.filter((g) => g.type === 'task')

  const invalidate = () => qc.invalidateQueries({ queryKey: ['contact-goals', contact.id] })

  const handleAddGoal = async (data: { title: string; description: string; categories: string[]; targetDate: Date | null }) => {
    await addDoc(collection(db, CONTACTS_COLLECTION, contact.id, CONTACT_GOALS_SUBCOLLECTION), {
      type: 'goal',
      title: data.title,
      description: data.description || null,
      status: 'open',
      categories: data.categories,
      created_by: 'coach',
      created_at: serverTimestamp(),
      target_date: data.targetDate ? Timestamp.fromDate(data.targetDate) : null,
    })
    setAddGoalOpen(false)
    invalidate()
  }

  const handleAddTask = async (data: { title: string; description: string; categories: string[]; targetDate: Date | null }) => {
    await addDoc(collection(db, CONTACTS_COLLECTION, contact.id, CONTACT_GOALS_SUBCOLLECTION), {
      type: 'task',
      title: data.title,
      description: data.description || null,
      status: 'open',
      categories: [],
      created_by: 'coach',
      created_at: serverTimestamp(),
      target_date: data.targetDate ? Timestamp.fromDate(data.targetDate) : null,
    })
    setAddTaskOpen(false)
    invalidate()
  }

  if (isLoading) {
    return <div className="py-12 text-center text-sm text-muted-foreground">{t('loading')}</div>
  }

  return (
    <div className="pb-24">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Goals column */}
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

          {goalList.length === 0 ? (
            <div className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">
              {t('goalsEmpty')}
            </div>
          ) : (
            <div className="space-y-2">
              {goalList.map((g) => (
                <GoalCard key={g.id} goal={g} contactId={contact.id} categories={categories} onChanged={invalidate} />
              ))}
            </div>
          )}
        </div>

        {/* Tasks column */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <CheckSquare className="h-4 w-4 text-orange-500" />
              <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">{t('tasksTitle')}</h3>
            </div>
            <Button variant="outline" size="sm" onClick={() => setAddTaskOpen(true)}>
              <Plus className="h-3.5 w-3.5 mr-1" />{t('goalsAddTask')}
            </Button>
          </div>

          {taskList.length === 0 ? (
            <div className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">
              {t('tasksEmpty')}
            </div>
          ) : (
            <div className="space-y-2">
              {taskList.map((g) => (
                <TaskCard key={g.id} goal={g} contactId={contact.id} onChanged={invalidate} />
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
        open={addTaskOpen}
        type="task"
        categories={[]}
        onClose={() => setAddTaskOpen(false)}
        onSubmit={handleAddTask}
      />
    </div>
  )
}
