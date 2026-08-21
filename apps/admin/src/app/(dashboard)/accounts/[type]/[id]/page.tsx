import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'
import { getAccount } from '@/lib/queries/account'
import type { AccountType } from '@/lib/queries/accounts'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { StatusBadge, PlanBadge, PaymentsBadge } from '@/components/status-badge'
import { Badge } from '@/components/ui/badge'
import { formatChf, formatDate } from '@/lib/format'
import { getMessagingInfo } from '@/lib/queries/messaging'
import { ConnectToggle } from './connect-toggle'
import { DisconnectConnect } from './disconnect-connect'
import { MessagingPolicyCard } from './messaging-policy-card'

export const dynamic = 'force-dynamic'

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-xs uppercase tracking-wide text-muted-foreground">{label}</span>
      <span className="text-sm">{value}</span>
    </div>
  )
}

export default async function AccountDetailPage({
  params,
}: {
  params: Promise<{ type: string; id: string }>
}) {
  const { type, id } = await params
  if (type !== 'team' && type !== 'org') notFound()
  const account = await getAccount(type as AccountType, id)
  if (!account) notFound()

  const sub = account.subscription
  const usage = account.contactUsage
  const messaging = await getMessagingInfo(account.id)

  return (
    <div className="flex flex-col gap-6">
      <Link
        href="/accounts"
        className="inline-flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" /> Accounts
      </Link>

      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-semibold">{account.name}</h1>
        <PlanBadge plan={account.plan} />
        <StatusBadge status={account.status} />
        <span className="text-sm text-muted-foreground capitalize">· {account.type}</span>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Studio → Linyup: the platform subscription the studio pays Linyup. */}
        <Card>
          <CardHeader>
            <CardTitle>
              {account.type === 'org' ? 'Organization' : 'Studio'} → Linyup (platform billing)
            </CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-2 gap-4">
            {sub ? (
              <>
                <Field label="Plan" value={<span className="capitalize">{sub.plan}</span>} />
                <Field label="Status" value={<StatusBadge status={sub.status} />} />
                <Field label="Base price" value={`${formatChf(sub.baseMonthly)}/mo`} />
                <Field label="Gateway" value={sub.gatewayType ?? 'manual'} />
                <Field label="Current period" value={`${formatDate(sub.currentPeriodStartMs)} → ${formatDate(sub.currentPeriodEndMs)}`} />
                <Field label="Trial ends" value={formatDate(sub.trialEndsAtMs)} />
                {/* A DATE where we have one — a billing-portal cancellation
                    leaves the boolean false, so this field used to read "No" for
                    a studio that had already cancelled.

                    But the date is NOT the signal. Docs written before the
                    Dahlia field migration carry the cancellation with no
                    `current_period_end` at all, so falling silent whenever the
                    date is missing hides the entire pre-migration population
                    from the operator. Say "cancelling" without the date rather
                    than saying nothing. */}
                <Field
                  label="Cancels on"
                  value={
                    sub.endsAtMs
                      ? formatDate(sub.endsAtMs)
                      : sub.cancelling
                        ? 'at period end (date not recorded)'
                        : '—'
                  }
                />
                <Field
                  label="Cancellation"
                  value={
                    sub.cancelling || sub.canceledAtMs || sub.cancellationReason ? (
                      <span className="text-sm">
                        {/* A pre-migration doc has the cancellation and none of
                            its detail. "Cancelling" is still the true and useful
                            answer; an empty cell is not. */}
                        {[
                          sub.canceledAtMs ? `requested ${formatDate(sub.canceledAtMs)}` : null,
                          sub.cancellationReason,
                          sub.cancellationFeedback,
                        ]
                          .filter(Boolean)
                          .join(' · ') || 'cancelling — no reason recorded'}
                        {sub.cancellationComment ? (
                          <em className="block text-muted-foreground">
                            “{sub.cancellationComment}”
                          </em>
                        ) : null}
                      </span>
                    ) : (
                      '—'
                    )
                  }
                />
                <Field label="Last payment" value={sub.lastPaymentStatus ?? '—'} />
                <Field label="Stripe customer" value={<code className="text-xs">{sub.customerId ?? '—'}</code>} />
                <Field label="Stripe subscription" value={<code className="text-xs">{sub.subscriptionId ?? '—'}</code>} />
              </>
            ) : (
              <p className="col-span-2 text-sm text-muted-foreground">
                No saas_subscriptions record (manually managed or not yet provisioned).
              </p>
            )}
          </CardContent>
        </Card>

        {/* Member → Studio: Stripe Connect (the studio collects from its members). */}
        {account.payments && (
          <Card>
            <CardHeader className="flex flex-row items-start justify-between gap-2">
              <CardTitle>Member → Studio (Stripe Connect)</CardTitle>
              <ConnectToggle
                teamId={account.id}
                initialEnabled={account.payments.status !== 'disabled'}
              />
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
                <Field label="Status" value={<PaymentsBadge status={account.payments.status} />} />
                <Field
                  label="Onboarding"
                  value={account.payments.model ? account.payments.model.toUpperCase() : '—'}
                />
                <Field
                  label="Charges / payouts"
                  value={`${account.payments.chargesEnabled ? 'on' : 'off'} / ${account.payments.payoutsEnabled ? 'on' : 'off'}`}
                />
                <Field
                  label="Collected (gross)"
                  value={formatChf(account.payments.grossCollectedChf)}
                />
                <Field
                  label="Linyup fees earned"
                  value={formatChf(account.payments.platformFeesChf)}
                />
                <Field label="Refunded" value={formatChf(account.payments.refundedChf)} />
                <Field label="Payments" value={account.payments.paymentsCount} />
                <Field label="Active subscriptions" value={account.payments.activeSubscriptions} />
                <Field
                  label="Connected account"
                  value={
                    <code className="text-xs">{account.payments.connectAccountId ?? '—'}</code>
                  }
                />
              </div>

              {/* The other half of teardown: the toggle above stops charges,
                  this removes the link. `purgeTeam` cannot do it, which is why
                  its runbook otherwise ends in a manual Stripe step. */}
              {account.payments.connectAccountId && (
                <DisconnectConnect
                  teamId={account.id}
                  accountId={account.payments.connectAccountId}
                />
              )}

              {account.payments.requirementsDue.length > 0 && (
                <div className="flex flex-col gap-1">
                  <span className="text-xs uppercase tracking-wide text-muted-foreground">
                    Outstanding requirements
                  </span>
                  <div className="flex flex-wrap gap-1.5">
                    {account.payments.requirementsDue.map((r) => (
                      <Badge key={r} variant="warning" className="font-normal">
                        {r}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        )}
      </div>

      {/* Outbound messaging — operator-only delivery policy + recent ledger. */}
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Outbound messaging policy</CardTitle>
          </CardHeader>
          <CardContent>
            <MessagingPolicyCard
              entityId={account.id}
              initialPolicy={messaging.policy}
              env={messaging.env}
            />
          </CardContent>
        </Card>

        <Card className="py-0">
          <div className="px-4 pt-4">
            <CardTitle>Recent sends</CardTitle>
          </div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>When</TableHead>
                <TableHead>Channel</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {messaging.recentSends.length === 0 && (
                <TableRow>
                  <TableCell className="py-4 text-muted-foreground" colSpan={3}>
                    No ledger entries (only keyed sends are recorded).
                  </TableCell>
                </TableRow>
              )}
              {messaging.recentSends.map((s) => (
                <TableRow key={s.id}>
                  <TableCell className="text-muted-foreground">{formatDate(s.updatedMs)}</TableCell>
                  <TableCell className="text-xs">{s.channel}</TableCell>
                  <TableCell>
                    <Badge
                      variant={
                        s.status === 'suppressed' || s.status === 'failed' || s.status === 'bounced'
                          ? 'warning'
                          : 'outline'
                      }
                      className="font-normal"
                    >
                      {s.status}
                      {s.suppressReason ? ` · ${s.suppressReason}` : ''}
                    </Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Contact usage</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {usage ? (
            <>
              <div className="flex items-end justify-between">
                <span className="text-2xl font-semibold tabular-nums">{usage.used}</span>
                <span className="text-sm text-muted-foreground">
                  {usage.isUnlimited ? 'unlimited' : `of ${usage.included} included`}
                </span>
              </div>
              {!usage.isUnlimited && (
                <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                  <div
                    className={usage.overBy > 0 ? 'h-full bg-destructive' : 'h-full bg-primary'}
                    style={{ width: `${usage.percent}%` }}
                  />
                </div>
              )}
              {usage.overBy > 0 && (
                <p className="text-sm text-destructive">{usage.overBy} over the included limit.</p>
              )}
            </>
          ) : (
            <p className="text-sm text-muted-foreground">
              Contact usage is tracked per team (orgs aggregate their teams).
            </p>
          )}
          <Field label="Created" value={formatDate(account.createdMs)} />
        </CardContent>
      </Card>

      <Card className="py-0">
        <div className="px-4 pt-4">
          <CardTitle>Members</CardTitle>
        </div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Email</TableHead>
              <TableHead>Role</TableHead>
              <TableHead>Joined</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {account.members.length === 0 && (
              <TableRow>
                <TableCell className="py-4 text-muted-foreground" colSpan={3}>
                  No members.
                </TableCell>
              </TableRow>
            )}
            {account.members.map((mb) => (
              <TableRow key={mb.userId}>
                <TableCell>{mb.email ?? mb.userId}</TableCell>
                <TableCell className="capitalize">{mb.role.replace('_', ' ')}</TableCell>
                <TableCell className="text-muted-foreground">{formatDate(mb.joinedMs)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>

      {account.type === 'team' && (
        <Card className="py-0">
          <div className="px-4 pt-4">
            <CardTitle>Recent activity</CardTitle>
          </div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>When</TableHead>
                <TableHead>Event</TableHead>
                <TableHead>Description</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {account.activity.length === 0 && (
                <TableRow>
                  <TableCell className="py-4 text-muted-foreground" colSpan={3}>
                    No activity recorded.
                  </TableCell>
                </TableRow>
              )}
              {account.activity.map((row) => (
                <TableRow key={row.id}>
                  <TableCell className="text-muted-foreground">{formatDate(row.createdMs)}</TableCell>
                  <TableCell className="font-mono text-xs">{row.event}</TableCell>
                  <TableCell className="whitespace-normal text-muted-foreground">{row.description}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}
    </div>
  )
}
