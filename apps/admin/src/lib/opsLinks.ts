// Where a production problem is actually looked at.
//
// Linyup reports errors to Google Cloud Error Reporting rather than a
// third-party tracker, which is the cheap and native choice for a stack that is
// already entirely GCP — but it has one real drawback: there is no branded inbox
// to remember the URL of, and the Console's own navigation buries it. This
// module is the answer to "where does that surface?": one page per environment,
// every link that matters, pre-filtered so a click lands on the thing you want
// instead of a project picker.
//
// Same philosophy as `providers.ts`: a static directory today, deliberately
// shaped so live data can be attached later (an error count, an alert state, a
// health-route response) by adding fields to `OpsLink` / `OpsEnvironment` and
// filling them in a server component — without reshaping the UI.
//
// NOTE these are deep links, not credentials. Whether you can open one is
// decided by your Google account's IAM on that project, not by this console.

export type OpsEnvId = 'sandbox' | 'staging' | 'prod'

export interface OpsEnvironment {
  id: OpsEnvId
  /** Display name. */
  name: string
  /** GCP / Firebase project id. */
  projectId: string
  /** What this environment is for — one line, so the right one is picked. */
  description: string
  /** The deployed web app, if it has a public URL. */
  appUrl?: string
  /** Stripe runs in test mode everywhere except prod. */
  stripeMode: 'test' | 'live'
  /** True for the environment where a mistake reaches paying customers. */
  isProduction?: boolean
}

export const OPS_ENVIRONMENTS: OpsEnvironment[] = [
  {
    id: 'prod',
    name: 'Production',
    projectId: 'linyup-prod',
    description: 'Real studios, real money. Check here first when something is reported.',
    appUrl: 'https://app.linyup.com',
    stripeMode: 'live',
    isProduction: true,
  },
  {
    id: 'staging',
    name: 'Staging',
    projectId: 'linyup-staging',
    description: 'Pre-production. Auto-deploys on every push to main.',
    appUrl: 'https://app-stg.linyup.com',
    stripeMode: 'test',
  },
  {
    id: 'sandbox',
    name: 'Sandbox',
    projectId: 'linyup-sandbox',
    description: 'Prospect demos, lead tenants and the /try playground. Deploys are manual.',
    appUrl: 'https://demo.linyup.com',
    stripeMode: 'test',
  },
]

/**
 * The environment THIS console is deployed in, derived from the Firebase project
 * it was built against — the same trick `robots.ts` uses in the web app: a
 * project id cannot disagree with which backend is actually being served, where
 * a separate flag can.
 *
 * The Health page defaults to it, and that default is a safety property rather
 * than a convenience. Three environments' worth of near-identical deep links
 * stacked on one page is how somebody opens STAGING's Error Reporting during a
 * production incident, sees nothing, and concludes nothing is wrong.
 *
 * Falls back to production: an unrecognised project id most likely means a local
 * or preview build, and pointing an operator at the environment that matters is
 * the safer wrong answer.
 */
export function currentOpsEnvironment(): OpsEnvironment {
  const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID
  return (
    OPS_ENVIRONMENTS.find((e) => e.projectId === projectId) ??
    OPS_ENVIRONMENTS.find((e) => e.isProduction)!
  )
}

/** Resolves a `?env=` value to an environment, ignoring anything unrecognised. */
export function opsEnvironmentById(id: string | undefined): OpsEnvironment | undefined {
  return id ? OPS_ENVIRONMENTS.find((e) => e.id === id) : undefined
}

export type OpsLinkGroup = 'Errors & logs' | 'Alerting' | 'Deploys' | 'Data'

export interface OpsLink {
  id: string
  label: string
  /** Why you would open this — the question it answers. */
  hint: string
  group: OpsLinkGroup
  href: string
  /** Marks the link to reach for first during an incident. */
  primary?: boolean
}

export const OPS_LINK_GROUP_ORDER: OpsLinkGroup[] = ['Errors & logs', 'Alerting', 'Deploys', 'Data']

const gcp = (path: string, projectId: string) =>
  `https://console.cloud.google.com/${path}${path.includes('?') ? '&' : '?'}project=${projectId}`

const firebase = (path: string, projectId: string) =>
  `https://console.firebase.google.com/project/${projectId}/${path}`

/** A Logs Explorer deep link carrying a pre-built query. */
const logsQuery = (query: string, projectId: string) =>
  `https://console.cloud.google.com/logs/query;query=${encodeURIComponent(query)};duration=P1D?project=${projectId}`

export function opsLinksFor(env: OpsEnvironment): OpsLink[] {
  const p = env.projectId
  return [
    {
      id: 'error-reporting',
      label: 'Error Reporting',
      hint: 'Every unhandled throw, grouped by cause with a count and a first/last seen. Start here.',
      group: 'Errors & logs',
      href: gcp('errors', p),
      primary: true,
    },
    {
      id: 'logs-errors',
      label: 'Logs — errors only',
      hint: 'Raw ERROR-and-above entries across functions and both SSR apps, last 24h.',
      group: 'Errors & logs',
      href: logsQuery('severity>=ERROR', p),
    },
    {
      id: 'logs-webhooks',
      label: 'Logs — payment webhooks',
      hint: 'handleConnectWebhook and handleStripeWebhook only. A silent failure here means money moved and nothing recorded it.',
      group: 'Errors & logs',
      href: logsQuery(
        'resource.type="cloud_function" (resource.labels.function_name="handleConnectWebhook" OR resource.labels.function_name="handleStripeWebhook")',
        p
      ),
    },
    {
      id: 'logs-appcheck',
      label: 'Logs — App Check monitor',
      hint: 'Requests arriving without a valid App Check token. Must be ~zero before enforcement is turned on.',
      group: 'Errors & logs',
      href: logsQuery('textPayload:"[appcheck-monitor]"', p),
    },
    {
      id: 'alerting',
      label: 'Alert policies',
      hint: 'What is configured to page a human, and whether it is currently firing.',
      group: 'Alerting',
      href: gcp('monitoring/alerting', p),
      primary: true,
    },
    {
      id: 'uptime',
      label: 'Uptime checks',
      hint: 'Is the app answering at all, from outside our own network.',
      group: 'Alerting',
      href: gcp('monitoring/uptime', p),
    },
    {
      id: 'budget',
      label: 'Billing budget',
      hint: 'The spend alert. A runaway function or an abused public callable shows up here first.',
      group: 'Alerting',
      href: gcp('billing', p),
    },
    {
      id: 'apphosting',
      label: 'App Hosting rollouts',
      hint: 'Which commit is actually live for the web app and this console.',
      group: 'Deploys',
      href: firebase('apphosting', p),
      primary: true,
    },
    {
      id: 'functions',
      label: 'Cloud Functions',
      hint: 'Deployed functions, their versions and per-function error rates.',
      group: 'Deploys',
      href: firebase('functions', p),
    },
    {
      id: 'indexes',
      label: 'Firestore indexes',
      hint: 'Index build state. A composite index still BUILDING makes a new query return an empty list, not an error.',
      group: 'Data',
      href: firebase('firestore/indexes', p),
    },
    {
      id: 'firestore',
      label: 'Firestore data',
      hint: 'Browse documents — the fastest way to confirm what a webhook actually wrote.',
      group: 'Data',
      href: firebase('firestore/data', p),
    },
    {
      id: 'backups',
      label: 'Firestore backups',
      hint: 'PITR window and the daily backup schedule. Prod retains 14 weeks, the others 7 days.',
      group: 'Data',
      href: gcp('firestore/databases/-default-/backups', p),
    },
    {
      id: 'storage',
      label: 'Storage rules',
      hint: 'The live ruleset — worth checking against the repo after any deploy that touches storage.rules.',
      group: 'Data',
      href: firebase('storage/rules', p),
    },
  ]
}

/** Provider dashboards that are per-environment rather than global. */
export function opsProviderLinksFor(env: OpsEnvironment): OpsLink[] {
  return [
    {
      id: 'stripe',
      label: `Stripe (${env.stripeMode} mode)`,
      hint:
        env.stripeMode === 'live'
          ? 'Live payments, Connect accounts and webhook delivery. A failed delivery here is silent everywhere else.'
          : 'Test-mode payments and webhook delivery for this environment.',
      group: 'Errors & logs',
      href:
        env.stripeMode === 'live'
          ? 'https://dashboard.stripe.com/webhooks'
          : 'https://dashboard.stripe.com/test/webhooks',
    },
  ]
}
