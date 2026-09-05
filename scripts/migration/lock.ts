import { openSync, writeSync, closeSync, readFileSync, unlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// ONE MIGRATION PER TARGET, AT A TIME.
//
// Two `migrate:hmd` runs against the same target interleave silently, and the
// result looks exactly like a successful import: every id is derived from the
// source, so the writes collide instead of erroring, and the passes print their
// usual counts. It happened here — a run started with one `--teams` list was
// still alive when a second started with a corrected one, the second's `--reset`
// wiped the first's work mid-flight, and both carried on writing into the same
// database for twenty minutes. The teams collection afterwards held three clubs
// and looked right.
//
// A lock FILE rather than a doc in the target, for one reason: `--reset` deletes
// every document, so a lock kept in the target would delete itself at the exact
// moment it is doing its job. Everything that can reach a given emulator runs on
// this machine, so the temp dir is the right scope — and it catches a run
// launched from a DIFFERENT worktree, which is how this one arrived.

interface LockBody {
  pid: number
  argv: string
  cwd: string
  startedAt: string
}

/** A lock nobody released, whose pid is gone — or that is simply ancient. */
const STALE_AFTER_HOURS = 6

/** `--target-emulator` at :38080 and `--target-creds linyup-prod` are different targets. */
export function migrationLockPath(target: string): string {
  return join(tmpdir(), `linyup-migration-${target.replace(/[^a-zA-Z0-9._-]/g, '_')}.lock`)
}

function processIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (err) {
    // EPERM = it exists and belongs to somebody else. Still alive.
    return (err as NodeJS.ErrnoException).code === 'EPERM'
  }
}

function describe(body: LockBody, path: string): string {
  return (
    `\n❌ Another migration is already running against this target.\n\n` +
    `     pid       ${body.pid}\n` +
    `     started   ${body.startedAt}\n` +
    `     from      ${body.cwd}\n` +
    `     command   ${body.argv}\n\n` +
    `   Two runs against one target interleave silently and the result looks fine.\n` +
    `   Wait for it, or stop it and try again.\n\n` +
    `   If you are certain that process is gone, delete the lock:\n` +
    `     ${path}\n`
  )
}

/**
 * Take the lock for `target`, or exit(1) naming the run that holds it.
 *
 * Returns a release function; it is also wired to process exit, because the
 * common way to end a migration is Ctrl+C and a lock that outlives its run is
 * its own small trap.
 */
export function acquireMigrationLock(target: string): () => void {
  const path = migrationLockPath(target)
  const body: LockBody = {
    pid: process.pid,
    argv: process.argv.slice(1).join(' '),
    cwd: process.cwd(),
    startedAt: new Date().toISOString(),
  }

  const write = () => {
    // 'wx' fails if the file exists — the check and the claim are one syscall,
    // so two runs starting together cannot both believe they won.
    const fd = openSync(path, 'wx')
    writeSync(fd, JSON.stringify(body, null, 2))
    closeSync(fd)
  }

  try {
    write()
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err

    let held: LockBody | null = null
    try {
      held = JSON.parse(readFileSync(path, 'utf-8')) as LockBody
    } catch {
      held = null // truncated or hand-edited — treat as stale
    }

    const ageHours = held ? (Date.now() - Date.parse(held.startedAt)) / 3_600_000 : Infinity
    // The age ceiling exists because pids are REUSED: without it, a crashed run
    // whose pid was later handed to some unrelated process would read as alive
    // and refuse every migration until somebody deleted the file by hand.
    const stale = !held || !processIsAlive(held.pid) || !(ageHours < STALE_AFTER_HOURS)

    if (!stale) {
      console.error(describe(held!, path))
      process.exit(1)
    }

    console.warn(
      `⚠️  Taking over a stale migration lock (pid ${held?.pid ?? '?'}, ` +
        `${held ? `${ageHours.toFixed(1)}h old` : 'unreadable'}) — ${path}`
    )
    unlinkSync(path)
    write()
  }

  let released = false
  const release = () => {
    if (released) return
    released = true
    try {
      // Only ever remove OUR lock. A run that already lost the file to a
      // takeover must not delete the lock its successor is holding.
      const current = JSON.parse(readFileSync(path, 'utf-8')) as LockBody
      if (current.pid === process.pid) unlinkSync(path)
    } catch {
      /* already gone */
    }
  }

  process.on('exit', release)
  for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) {
    process.on(sig, () => {
      release()
      process.exit(130)
    })
  }

  return release
}
