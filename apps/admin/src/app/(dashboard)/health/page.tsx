import Link from 'next/link'
import { ExternalLink, AlertTriangle } from 'lucide-react'
import { Card } from '@/components/ui/card'
import { buttonVariants } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import {
  OPS_ENVIRONMENTS,
  OPS_LINK_GROUP_ORDER,
  currentOpsEnvironment,
  opsEnvironmentById,
  opsLinksFor,
  opsProviderLinksFor,
  type OpsEnvironment,
  type OpsLink,
} from '@/lib/opsLinks'

export const metadata = { title: 'Health · Linyup Ops' }

function LinkRow({ link }: { link: OpsLink }) {
  return (
    <div className="flex items-center justify-between gap-4 px-4 py-3">
      <div className="min-w-0">
        <div className="flex items-center gap-2 font-medium">
          {link.label}
          {link.primary && (
            <span className="rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-primary">
              start here
            </span>
          )}
        </div>
        <div className="text-xs text-muted-foreground">{link.hint}</div>
      </div>
      <a
        href={link.href}
        target="_blank"
        rel="noopener noreferrer"
        className={cn(
          buttonVariants({ variant: link.primary ? 'default' : 'ghost', size: 'sm' }),
          'shrink-0'
        )}
      >
        <ExternalLink />
        Open
      </a>
    </div>
  )
}

function EnvironmentSection({ env }: { env: OpsEnvironment }) {
  const links = [...opsLinksFor(env), ...opsProviderLinksFor(env)]
  const groups = OPS_LINK_GROUP_ORDER.map((group) => ({
    group,
    links: links.filter((l) => l.group === group),
  })).filter((g) => g.links.length > 0)

  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 className="text-lg font-semibold">{env.name}</h2>
        <code className="rounded bg-muted px-1.5 py-0.5 text-xs">{env.projectId}</code>
        {env.isProduction && (
          <span className="inline-flex items-center gap-1 rounded bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-600 dark:text-amber-400">
            <AlertTriangle className="size-3" />
            live customers
          </span>
        )}
        {env.appUrl && (
          <a
            href={env.appUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
          >
            {env.appUrl.replace('https://', '')}
          </a>
        )}
      </div>
      <p className="-mt-2 text-sm text-muted-foreground">{env.description}</p>

      {groups.map(({ group, links: groupLinks }) => (
        <div key={group} className="flex flex-col gap-1.5">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {group}
          </h3>
          <Card className="gap-0 divide-y py-0">
            {groupLinks.map((l) => (
              <LinkRow key={l.id} link={l} />
            ))}
          </Card>
        </div>
      ))}
    </section>
  )
}


/**
 * Plain links rather than a `<select>`: three options, no client JavaScript, the
 * choice is shareable as a URL, and it matches `SettingsTabs` next door instead
 * of introducing a second navigation idiom in the same console.
 */
function EnvironmentPicker({ selected }: { selected: OpsEnvironment }) {
  const here = currentOpsEnvironment()
  return (
    <div className="flex flex-wrap items-center gap-1">
      {OPS_ENVIRONMENTS.map((env) => {
        const active = env.id === selected.id
        return (
          <Link
            key={env.id}
            href={`/health?env=${env.id}`}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'rounded-md px-2.5 py-1 text-xs font-medium transition-colors',
              active
                ? 'bg-primary text-primary-foreground'
                : 'text-muted-foreground hover:bg-muted hover:text-foreground'
            )}
          >
            {env.name}
            {env.id === here.id && (
              <span className={cn('ml-1.5', active ? 'opacity-70' : 'opacity-60')}>· you</span>
            )}
          </Link>
        )
      })}
    </div>
  )
}

export default async function HealthPage({
  searchParams,
}: {
  searchParams: Promise<{ env?: string }>
}) {
  const { env } = await searchParams
  // An unrecognised ?env= falls back to this console's own environment rather
  // than erroring — a stale bookmark should still land somewhere useful.
  const selected = opsEnvironmentById(env) ?? currentOpsEnvironment()

  return (
    <div className="flex max-w-3xl flex-col gap-10">
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-xl font-semibold">Health</h1>
          <EnvironmentPicker selected={selected} />
        </div>
        <p className="text-sm text-muted-foreground">
          Where a production problem is looked at. Errors are reported to Google Cloud Error
          Reporting — there is no separate inbox to check, so these are the pre-filtered links into
          it, per environment.
        </p>
        <Card className="border-amber-500/30 bg-amber-500/5 p-4 text-sm">
          <p className="font-medium">During an incident, in order:</p>
          <ol className="mt-1.5 list-decimal space-y-0.5 pl-5 text-muted-foreground">
            <li>
              <span className="font-medium text-foreground">Error Reporting</span> — is something
              throwing, and since when?
            </li>
            <li>
              <span className="font-medium text-foreground">App Hosting rollouts</span> — did it
              start with a deploy? Roll back to the previous commit if so.
            </li>
            <li>
              <span className="font-medium text-foreground">Stripe webhooks</span> — if money is
              involved, check delivery before anything else. A failed delivery is silent everywhere
              else.
            </li>
            <li>
              <span className="font-medium text-foreground">Firestore indexes</span> — after a
              release, an index still building makes a new query return an empty list rather than an
              error.
            </li>
          </ol>
        </Card>
      </div>

      {/* ONE environment, not all three. Stacked, they are near-identical walls
          of deep links, and the failure mode is opening the wrong project's
          Error Reporting mid-incident and concluding nothing is wrong. */}
      <EnvironmentSection env={selected} />

      <p className="text-xs text-muted-foreground">
        These are deep links, not credentials — whether one opens depends on your Google
        account&apos;s access to that project. Runbooks for release, hotfix, rollback and restore
        live in{' '}
        <code className="rounded bg-muted px-1 py-0.5">.claude/agents/ops-agent/AGENT.md</code>.
      </p>
    </div>
  )
}
