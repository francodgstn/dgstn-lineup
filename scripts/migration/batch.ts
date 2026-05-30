import type { Firestore, DocumentReference, WriteBatch } from 'firebase-admin/firestore'

const BATCH_LIMIT = 499

export class AutoBatch {
  private db: Firestore
  private batch: WriteBatch
  private ops = 0
  private totalFlushed = 0
  private dryRun: boolean

  constructor(db: Firestore, dryRun: boolean) {
    this.db = db
    this.dryRun = dryRun
    this.batch = db.batch()
  }

  set(ref: DocumentReference, data: Record<string, unknown>): void {
    this.batch.set(ref, data)
    this.ops++
    if (this.ops >= BATCH_LIMIT) {
      // Caller must await flush() manually at safe points, but we track ops
      // so they can check needsFlush()
    }
  }

  needsFlush(): boolean {
    return this.ops >= BATCH_LIMIT
  }

  async flush(): Promise<void> {
    if (this.ops === 0) return
    if (!this.dryRun) {
      await this.batch.commit()
    }
    this.totalFlushed += this.ops
    this.ops = 0
    this.batch = this.db.batch()
  }

  get pendingOps(): number { return this.ops }
  get flushedTotal(): number { return this.totalFlushed }
}
