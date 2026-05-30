import { RANKING_SYSTEM_IDS } from '../config'

export function transformContact(data: Record<string, unknown>): Record<string, unknown> {
  const { residence, disciplines, notes, ...rest } = data as Record<string, unknown> & {
    residence?:   Record<string, unknown>
    disciplines?: { hmd_rank?: number; kd_rank?: number }
    notes?:       unknown
  }

  // residence → address
  const address = residence ?? data.address

  // disciplines.{hmd_rank,kd_rank} → ranks map (omit null/undefined keys)
  const ranks: Record<string, number> = {}
  if (disciplines?.hmd_rank != null) ranks[RANKING_SYSTEM_IDS.hmd] = disciplines.hmd_rank
  if (disciplines?.kd_rank  != null) ranks[RANKING_SYSTEM_IDS.kd]  = disciplines.kd_rank

  return {
    ...rest,
    address,
    tags:   data.tags ?? [],
    // Lifecycle fields — copy if present, fall back to null
    anonymized_at: data.anonymized_at ?? null,
    deleted_at:    data.deleted_at    ?? null,
    archived_at:   data.archived_at   ?? null,
    ...(Object.keys(ranks).length > 0 ? { ranks } : {}),
    // notes intentionally dropped
  }
}

export function transformContactAlert(data: Record<string, unknown>): Record<string, unknown> {
  const { schedule, ...rest } = data as Record<string, unknown> & {
    schedule?: { type?: string; value?: unknown }
  }

  if (!schedule) return data

  return {
    ...rest,
    schedule_type:  schedule.type,
    schedule_value: schedule.value,
  }
}
