/**
 * Pass 0: Firebase Auth migration (manual — cannot be done via Admin SDK alone)
 *
 * Run these commands BEFORE running any Firestore passes:
 *
 *   # 1. Export users from source project
 *   firebase --project hmd-lineup auth:export hmd-users.json
 *
 *   # 2. Get hash params from Firebase Console → Authentication → Users → Export
 *   #    (salt separator, signer key, rounds, mem cost)
 *
 *   # 3. Import into target project
 *   firebase --project linyup-staging auth:import hmd-users.json \
 *     --hash-algo=SCRYPT \
 *     --hash-key=<signerKey> \
 *     --salt-separator=<saltSeparator> \
 *     --rounds=<rounds> \
 *     --mem-cost=<memCost>
 *
 * UIDs must match between source and target — that's why Auth is migrated first.
 */
export async function pass00Auth(): Promise<void> {
  console.log('Pass 0 (auth): manual step — see comments in passes/00-auth.ts')
}
