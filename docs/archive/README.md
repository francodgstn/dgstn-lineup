# Archive — closed records

Documents here are **finished**. They record work that shipped, an audit that was
run, or a plan that was completed. Nothing in this folder describes work still to
do, and nothing in it should be used to decide what to build next.

## Why this folder exists

`docs/` in this repo is a **LOG, not a status board** — and the failure mode that
comes with that is specific and has bitten repeatedly: a reader finds a plan
written in the imperative, cannot tell it was completed months ago, and funds work
that was already done. A single readiness pass hit three such stale claims (UX-1
open, rate limiting missing, a sandbox Stripe endpoint missing); every one was
wrong against the code, and each nearly bought work nobody needed.

The fix is not deletion — the history is worth keeping, and a closed plan is often
the only place a decision's *reasoning* survives. The fix is making "closed"
impossible to miss. So:

- Every file here opens with a **CLOSED banner** stating the date and what
  superseded it.
- A document moves here when the work it describes is done, not when it stops
  being interesting.
- **Verify against the code before acting on anything in this folder.** These are
  records of what was true on a date, not claims about today.

Living architecture docs, runbooks and open registers stay in `docs/`.
