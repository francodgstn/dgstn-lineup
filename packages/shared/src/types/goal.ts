import type { Timestamp } from './common'

export type GoalType = 'goal' | 'task'
export type GoalStatus = 'open' | 'in_progress' | 'achieved' | 'abandoned'
export type GoalCreatedBy = 'coach' | 'student'

export interface PerformanceIndicator {
  key: string
  label: string
}

export interface Goal {
  id: string
  type: GoalType           // 'goal' = long-term with evaluations; 'task' = boolean homework
  title: string
  description?: string | null
  status: GoalStatus
  categories: string[]     // team-configured indicator keys; empty for tasks
  created_by: GoalCreatedBy
  created_at: Timestamp
  target_date?: Timestamp | null
  completed_at?: Timestamp | null  // set when task is marked done (status → 'achieved')
}

export interface GoalEvaluation {
  id: string
  evaluated_at: Timestamp
  evaluated_by: GoalCreatedBy
  score: number            // 1–5
  notes?: string | null
  status_after: GoalStatus
  edited?: boolean
}
