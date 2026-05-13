---
name: migration-checklist
description: View or update the migration checklist. Use to see what's been ported and what's still pending, or to mark items complete after finishing a migration task.
---

Manage the migration checklist at `docs/migration-checklist.md`.

Usage:
- `/migration-checklist` — show a summary of progress (counts per section)
- `/migration-checklist update` — scan the codebase and update checklist items to match actual state
- `/migration-checklist done <item>` — mark a specific item as complete

## For `/migration-checklist` (summary view)

Read `docs/migration-checklist.md` and report:
- Total items: X done / Y total per section
- Any items marked ❌ that look like they may have been completed (cross-check against the codebase)

## For `/migration-checklist update`

1. Read `docs/migration-checklist.md`
2. For each ❌ item, do a quick check (Grep/Glob) to see if it now exists in the codebase
3. Update the file — flip ❌ → ✅ for anything that's been completed
4. Report what changed

## For `/migration-checklist done <item>`

1. Read `docs/migration-checklist.md`
2. Find the line matching `<item>` (fuzzy match on function/feature name)
3. Change its status from ❌ to ✅
4. Save the file
5. Confirm what was updated

## Rules

- Keep the checklist simple — just the markdown file, no extra tooling
- Do not add new sections without user confirmation
- ⏳ means in progress / partially done
- ❌ means not started
- ✅ means complete
- ~~strikethrough~~ means deliberately skipped (HMD-specific, out of scope)
