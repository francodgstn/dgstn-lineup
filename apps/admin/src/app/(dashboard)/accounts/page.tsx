import Link from 'next/link'
import type { SaasPlan, SaasStatus } from '@linyup/shared'
import { listAccounts } from '@/lib/queries/accounts'
import { Card } from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { StatusBadge, PlanBadge } from '@/components/status-badge'
import { formatDate } from '@/lib/format'
import { AccountsFilters } from './accounts-filters'

export const dynamic = 'force-dynamic'

export default async function AccountsPage({
  searchParams,
}: {
  searchParams: Promise<{ search?: string; plan?: string; status?: string }>
}) {
  const sp = await searchParams
  const accounts = await listAccounts({
    search: sp.search,
    plan: sp.plan as SaasPlan | undefined,
    status: sp.status as SaasStatus | undefined,
  })

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-xl font-semibold">Accounts</h1>
        <p className="text-sm text-muted-foreground">
          {accounts.length} {accounts.length === 1 ? 'account' : 'accounts'}
        </p>
      </div>

      <AccountsFilters />

      <Card className="py-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Plan</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Contacts</TableHead>
              <TableHead>Trial ends</TableHead>
              <TableHead>Owner</TableHead>
              <TableHead>Created</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {accounts.length === 0 && (
              <TableRow>
                <TableCell className="py-6 text-center text-muted-foreground" colSpan={8}>
                  No accounts match these filters.
                </TableCell>
              </TableRow>
            )}
            {accounts.map((a) => (
              <TableRow key={`${a.type}-${a.id}`} className="cursor-pointer">
                <TableCell className="font-medium">
                  <Link href={`/accounts/${a.type}/${a.id}`} className="hover:underline">
                    {a.name}
                  </Link>
                </TableCell>
                <TableCell>
                  <Badge variant="secondary" className="uppercase">
                    {a.type}
                  </Badge>
                </TableCell>
                <TableCell>
                  <PlanBadge plan={a.plan} />
                </TableCell>
                <TableCell>
                  <StatusBadge status={a.status} />
                </TableCell>
                <TableCell className="tabular-nums">
                  {a.contactCount == null
                    ? '—'
                    : a.includedContacts == null
                      ? a.contactCount
                      : `${a.contactCount} / ${a.includedContacts}`}
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {a.status === 'trial' ? formatDate(a.trialEndsAtMs) : '—'}
                </TableCell>
                <TableCell className="text-muted-foreground">{a.ownerEmail ?? '—'}</TableCell>
                <TableCell className="text-muted-foreground">{formatDate(a.createdMs)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
    </div>
  )
}
