import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { SecretField } from '@/components/secret-field'
import { getCustomDomainPlatformStatus, listCustomDomains } from '@/lib/queries/domains'
import { requireOperator } from '@/lib/require-operator'
import { useEmulators } from '@/lib/secret-manager'
import { formatDateTime } from '@/lib/format'
import { customDomainsAvailable } from '@linyup/shared'
import { saveCloudflareToken } from './actions'

export const dynamic = 'force-dynamic'

export default async function DomainsSettingsPage() {
  const [status, domains] = await Promise.all([
    getCustomDomainPlatformStatus(),
    listCustomDomains(),
    requireOperator(),
  ])

  // Production only — see customDomainsAvailable. Off-prod the token field is
  // replaced by the reason, not merely hidden: an operator staring at an empty
  // 'not configured' badge would reasonably go looking for the missing secret.
  const available = customDomainsAvailable(process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID)

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle>Custom domains (Cloudflare)</CardTitle>
          <CardDescription>
            Studios can serve their public pages from a domain they own. One Cloudflare token and
            one zone serve every tenant, so this is configured once here — not per studio.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-6">
          {!available && (
            <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs text-amber-900">
              <p className="font-medium">Disabled in this environment</p>
              <p className="mt-0.5">
                Custom domains run on <strong>production only</strong>. One Cloudflare zone has one
                fallback origin, so a non-prod environment would need its own domain, token and
                Worker deploy — deferred deliberately. Nothing here is configurable, and studios on
                this environment see the same explanation in their settings. Demos and showcases run
                on the linyup.com URLs.
              </p>
            </div>
          )}

          {available && useEmulators && (
            <p className="rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">
              Running against the emulators — secrets are not persisted here. Set
              <code className="mx-1">CLOUDFLARE_API_TOKEN</code> in
              <code className="mx-1">packages/functions/.env.local</code> instead.
            </p>
          )}

          {available && (
          <SecretField
            label="Cloudflare API token"
            name="cloudflareToken"
            configured={status.tokenConfigured}
            hint={
              'Scope it to Zone → SSL and Certificates → Write on the linyup.com zone only. ' +
              'Do NOT grant DNS: Edit — nothing here writes DNS records, and withholding it is ' +
              'what keeps the zone’s MX and DKIM out of reach.'
            }
            buttonLabel="Save token"
            action={saveCloudflareToken}
          />
          )}

          {available && (
          <div className="flex flex-col gap-3 rounded-md border p-4">
            <div className="flex items-center justify-between gap-3">
              <span className="text-sm text-muted-foreground">Zone ID</span>
              {status.zoneId ? (
                <code className="text-sm font-medium">{status.zoneId}</code>
              ) : (
                <span className="text-sm text-muted-foreground">not set for this console</span>
              )}
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="text-sm text-muted-foreground">CNAME target</span>
              {status.cnameTarget ? (
                <code className="text-sm font-medium">{status.cnameTarget}</code>
              ) : (
                <span className="text-sm text-muted-foreground">not set for this console</span>
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              Both are Cloud Functions params (<code>CLOUDFLARE_ZONE_ID</code>,{' '}
              <code>CLOUDFLARE_CNAME_TARGET</code>), shown here only if this console has them in
              its own environment. Blank means unset <em>here</em> — not necessarily unset for the
              functions. The CNAME target can never change once studios have it in their DNS.
            </p>
          </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Connected domains</CardTitle>
          <CardDescription>
            Every claimed hostname across all tenants. A row with no status is a stranded claim —
            the registry holds the hostname but the studio has no config, which blocks them
            re-adding it.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {domains.length === 0 ? (
            <p className="text-sm text-muted-foreground">No custom domains connected yet.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Hostname</TableHead>
                  <TableHead>Tenant</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Certificate</TableHead>
                  <TableHead>Last checked</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {domains.map((row) => (
                  <TableRow key={row.hostname}>
                    <TableCell>
                      <code className="text-xs">{row.hostname}</code>
                      {row.error && (
                        <p className="mt-1 text-xs text-amber-700 break-words">{row.error}</p>
                      )}
                    </TableCell>
                    <TableCell>
                      <span className="text-sm">{row.entityName ?? row.entityId}</span>
                      <span className="ml-1 text-xs text-muted-foreground">({row.scope})</span>
                    </TableCell>
                    <TableCell>
                      <DomainStatusBadge status={row.status} />
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {row.sslStatus ?? '—'}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {row.lastCheckedAt
                        ? formatDateTime(new Date(row.lastCheckedAt).getTime())
                        : '—'}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

function DomainStatusBadge({ status }: { status: string }) {
  if (status === 'active') return <Badge>Live</Badge>
  if (status === 'verifying') return <Badge variant="secondary">Issuing cert</Badge>
  if (status === 'pending') return <Badge variant="outline">Waiting for DNS</Badge>
  if (status === 'error') return <Badge variant="destructive">Needs attention</Badge>
  return <Badge variant="destructive">Stranded claim</Badge>
}
