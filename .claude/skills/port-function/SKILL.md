---
name: port-function
description: Port a Cloud Function from hmd-lineup to dgstn-lineup. Reads the source, rewrites it as TypeScript v2 gen2, wires the export, and updates the migration checklist.
---

Port a Cloud Function from hmd-lineup. Usage: `/port-function <functionName>`

## Steps

1. **Verify it's not already ported** — check `packages/functions/src/index.ts` for an existing export of `<functionName>`. If it exists (and is not a stub comment), stop and tell the user.

2. **Read the source function**:
   `C:\git\hmd\hmd-lineup\functions\src\<functionName>\index.js`
   Also read any util files it calls from `C:\git\hmd\hmd-lineup\functions\src\utils\`.

3. **Check target utils** — scan `packages/functions/src/utils/` to see if equivalent helpers already exist. Use them instead of re-porting the same logic.

4. **Identify what to omit** — skip or generalise any HMD-specific logic:
   - Swiss QR bill, belt ranks, federation identifiers → remove
   - `teacher` field fallback (`data.teacher || data.teamId`) → keep for now (legacy compat)
   - HMD-specific `regionalFunctions` → replace with v2 pattern

5. **Write the ported function** in `packages/functions/src/<functionName>/index.ts` using:
   - `import { onCall, HttpsError } from 'firebase-functions/v2/https'` (or appropriate v2 trigger)
   - `setGlobalOptions({ region: 'europe-west6' })` at top
   - TypeScript types; no `any` unless unavoidable
   - `to()` helper from `../utils/async` for async error handling

6. **Wire the export** — add to `packages/functions/src/index.ts`:
   ```typescript
   export { <functionName> } from './<functionName>'
   ```
   Remove the stub comment if one existed.

7. **Build check**: `pnpm --filter @lineup/functions run build`
   Fix any type errors before finishing.

8. **Update migration checklist** — mark the function as ✅ in `docs/migration-checklist.md`.

9. **Report** what was ported, what was omitted, and any caveats (e.g. firestore.rules or indexes that may need updating).
