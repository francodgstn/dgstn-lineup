# Emulator-backed integration checks

Unit tests (`pnpm test`) never execute a trigger, and `test:rules` runs only the
Firestore emulator — so nothing in the default suite proves that a write
actually lands the denormalized state a surface reads. These do: they run
against the **functions** emulator, write real documents, and assert the state
the triggers leave behind.

Worth having because the coaching counters feed `contactAttentionReasons`, and a
counter that is wrong does not throw — it quietly triages a coach toward the
wrong person.

## Running

Needs Java and a built `dist/`:

```bash
cd packages/functions && pnpm run build
pnpm --filter @linyup/functions test:integration
```

`packages/functions/.env.local` must exist (gitignored) supplying the
`defineString` params, or the emulator blocks on an interactive prompt. Mail and
SMS should be `false` there so a run cannot send anything.

## What they cover

`coaching.integration.mjs` — `trackGoals` counters, `trackGoalEvaluations`
newest-wins denormalization (including reverting when the newest is deleted),
`trackPerformanceCheckins`, `trackContactAlerts` (the `alerts_count` writer that
did not exist until recently), and `teardownGoal`'s two halves: evaluations are
cascade-deleted, steps are unparented and kept.

`coachingSweep.integration.mjs` — the real `stampOverdueGoals` job: that it
stamps a goal whose `overdue_at` is ABSENT rather than null (the Firestore
filter trap its header documents), leaves not-yet-due / achieved / undated goals
alone, wakes `trackGoals` through to the contact counter, and is idempotent.
