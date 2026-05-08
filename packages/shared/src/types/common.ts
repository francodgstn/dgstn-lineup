// Firestore Timestamp shape (compatible with both admin SDK and client SDK)
export interface Timestamp {
  toDate(): Date
  toMillis(): number
  seconds: number
  nanoseconds: number
}
