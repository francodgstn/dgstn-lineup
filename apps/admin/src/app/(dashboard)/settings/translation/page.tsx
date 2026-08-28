import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { getTranslationStatus } from '@/lib/queries/settings'
import { requireOperator } from '@/lib/require-operator'
import { useEmulators } from '@/lib/secret-manager'
import { DeeplForm } from './deepl-form'

export const dynamic = 'force-dynamic'

export default async function TranslationSettingsPage() {
  const [status] = await Promise.all([getTranslationStatus(), requireOperator()])

  return (
    <Card>
      <CardHeader>
        <CardTitle>Site translation</CardTitle>
        <CardDescription>
          Studio websites and embed widgets are machine-translated into the other locales of
          en/de/fr/it at publish time. Which vendor serves a run is decided by the functions env
          var <code className="mx-1">TRANSLATION_PROVIDER</code> (default: DeepL when its key is
          set, else Google Cloud Translation in deployed functions) — see
          <code className="mx-1">docs/site-translations.md</code>.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-6">
        {useEmulators && (
          <p className="rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">
            Running against the emulators — secrets are not persisted here. Set
            <code className="mx-1">DEEPL_API_KEY</code> in
            <code className="mx-1">packages/functions/.env.local</code> instead.
          </p>
        )}

        {/* At-a-glance status */}
        <div className="flex flex-col gap-3 rounded-md border p-4">
          <div className="flex items-center justify-between gap-3">
            <span className="text-sm text-muted-foreground">DeepL API key</span>
            {status.deeplKeyConfigured ? (
              <Badge variant="success">Configured</Badge>
            ) : (
              <Badge variant="warning">Not configured</Badge>
            )}
          </div>
        </div>

        <DeeplForm apiKeyConfigured={status.deeplKeyConfigured} />

        <div className="flex flex-col gap-2 border-t pt-4">
          <span className="text-sm font-medium">Google Cloud Translation (no key)</span>
          <p className="text-xs text-muted-foreground">
            The alternative provider needs no secret: it authenticates as the Cloud Functions
            runtime service account and bills the project. It only requires the
            <code className="mx-1">translate.googleapis.com</code> API to be enabled and
            <code className="mx-1">roles/cloudtranslate.user</code> granted to the runtime service
            account. A missing DeepL key therefore does not disable translation in deployed
            environments — the pipeline falls back to Google automatically.
          </p>
          <p className="text-xs text-muted-foreground">
            Translation can never fail a publish: with no working provider, sites publish
            untranslated and the public pages fall back to the studio&apos;s authoring language.
          </p>
        </div>
      </CardContent>
    </Card>
  )
}
