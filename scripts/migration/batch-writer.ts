import type { Firestore, DocumentReference, DocumentData, WriteBatch } from 'firebase-admin/firestore'

const BATCH_LIMIT = 499

export class BatchWriter {
  private db: Firestore
  private dryRun: boolean
  private batch: WriteBatch
  private opCount = 0
  totalWritten = 0
  totalSkipped = 0

  constructor(db: Firestore, dryRun: boolean) {
    this.db = db
    this.dryRun = dryRun
    this.batch = db.batch()
  }

  set(ref: DocumentReference, data: DocumentData) {
    if (this.dryRun) { this.totalWritten++; return }
    this.batch.set(ref, data)
    this.opCount++
    if (this.opCount >= BATCH_LIMIT) this.flush()
  }

  skip() { this.totalSkipped++ }

  async flush() {
    if (this.dryRun || this.opCount === 0) return
    await this.batch.commit()
    this.totalWritten += this.opCount
    this.opCount = 0
    this.batch = this.db.batch()
  }

  async done() {
    await this.flush()
    console.log(`  → wrote ${this.totalWritten}, skipped ${this.totalSkipped}`)
  }
}
