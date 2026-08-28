// Third-party providers / vendors the platform depends on.
//
// For now this is a static directory whose purpose is to get you into each
// vendor's control panel in one click. It is deliberately structured so that
// live data (account status, usage, spend) can be attached later via each
// vendor's API without reshaping the UI: add the fields to `Provider`, fetch
// them in a server component, and render them on the card.

export type ProviderCategory =
  | 'Infrastructure'
  | 'Payments'
  | 'Email'
  | 'Analytics'
  | 'Content'
  | 'Other'

export interface Provider {
  /** Stable slug — used as the React key and (later) to key live data. */
  id: string
  name: string
  category: ProviderCategory
  /** One-line reminder of what we use them for. */
  description: string
  /** The console/dashboard to reach out to quickly. */
  panelUrl: string
  /** Optional deep link to their docs. */
  docsUrl?: string
  /** Optional public status page. */
  statusUrl?: string
}

// Order within a category is preserved; categories render in CATEGORY_ORDER.
export const CATEGORY_ORDER: ProviderCategory[] = [
  'Infrastructure',
  'Payments',
  'Email',
  'Analytics',
  'Content',
  'Other',
]

export const PROVIDERS: Provider[] = [
  {
    id: 'firebase',
    name: 'Firebase',
    category: 'Infrastructure',
    description: 'Auth, Firestore, Storage, Cloud Functions & App Hosting.',
    panelUrl: 'https://console.firebase.google.com/project/linyup-prod/overview',
    docsUrl: 'https://firebase.google.com/docs',
    statusUrl: 'https://status.firebase.google.com/',
  },
  {
    id: 'google-cloud',
    name: 'Google Cloud',
    category: 'Infrastructure',
    description: 'Secret Manager, Cloud Scheduler, Tasks, Cloud Translation & billing for the project.',
    panelUrl: 'https://console.cloud.google.com/home/dashboard?project=linyup-prod',
    docsUrl: 'https://cloud.google.com/docs',
    statusUrl: 'https://status.cloud.google.com/',
  },
  {
    id: 'cloudflare',
    name: 'Cloudflare',
    category: 'Infrastructure',
    description:
      'Authoritative DNS for linyup.com, plus Cloudflare for SaaS — the studios’ custom domains and the tenant-router Worker.',
    panelUrl: 'https://dash.cloudflare.com/',
    docsUrl: 'https://developers.cloudflare.com/cloudflare-for-platforms/cloudflare-for-saas/',
    statusUrl: 'https://www.cloudflarestatus.com/',
  },
  {
    id: 'stripe',
    name: 'Stripe',
    category: 'Payments',
    description: 'SaaS billing + Connect (member → studio) payments.',
    panelUrl: 'https://dashboard.stripe.com/',
    docsUrl: 'https://docs.stripe.com/',
    statusUrl: 'https://status.stripe.com/',
  },
  {
    id: 'brevo',
    name: 'Brevo',
    category: 'Email',
    description: 'Transactional email (ESP) + bounce/spam webhooks.',
    panelUrl: 'https://app.brevo.com/',
    docsUrl: 'https://developers.brevo.com/',
    statusUrl: 'https://status.brevo.com/',
  },
  {
    id: 'posthog',
    name: 'PostHog',
    category: 'Analytics',
    description: 'Product analytics for the landing site and web app.',
    panelUrl: 'https://eu.posthog.com/',
    docsUrl: 'https://posthog.com/docs',
    statusUrl: 'https://status.posthog.com/',
  },
  {
    id: 'deepl',
    name: 'DeepL',
    category: 'Content',
    description:
      'Machine translation for studio websites & embed widgets at publish (docs/site-translations.md).',
    panelUrl: 'https://www.deepl.com/your-account/summary',
    docsUrl: 'https://developers.deepl.com/docs',
    statusUrl: 'https://status.deepl.com/',
  },
]
