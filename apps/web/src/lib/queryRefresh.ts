import type { QueryClient, QueryKey } from '@tanstack/react-query'

/**
 * Mark queries stale and DO NOT WAIT for them to refetch.
 *
 * `invalidateQueries` does two things: it marks matching queries stale
 * (synchronously) and it returns a promise that resolves when the resulting
 * refetches finish. Awaiting that promise looks harmless and is not:
 *
 * A key like `['activities']` is a PREFIX. It matches the real query
 * `['activities', 'active', teamId]` and it also matches the DISABLED variants
 * this app keeps mounted while an id is still null — `['activities', 'active',
 * null]`, `['subscription-types', null]`, `['sessions', 'by-activity', team,
 * null]`. A disabled query has an observer but can never fetch, so the promise
 * never settles. Everything after the `await` is then dead code: the toast, the
 * `onClose()`, the `setSaving(false)`.
 *
 * That is not hypothetical. On `/manage/offer` an awaited
 * `invalidateQueries({ queryKey: ['activities'] })` was measured hanging
 * indefinitely, leaving Save stuck on "Saving…" after a transaction that had
 * already committed, and leaving the activity dialog open after a successful
 * save (Franco, 2026-09-02).
 *
 * A write is complete when the write commits. Refreshing the cache is a
 * separate concern that settles itself — the marking is what triggers the
 * refetch, and lists re-render when it lands. So: mark, and move on.
 *
 * Await an invalidation only if you must READ the refreshed data on the very
 * next line, and then scope the key fully (include the teamId) so it cannot
 * match a disabled sibling.
 */
export function refreshQueries(qc: QueryClient, ...keys: QueryKey[]): void {
  for (const queryKey of keys) void qc.invalidateQueries({ queryKey })
}
