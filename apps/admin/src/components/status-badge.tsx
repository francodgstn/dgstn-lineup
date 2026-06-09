import type { SaasStatus } from '@linyup/shared'
import { Badge } from '@/components/ui/badge'

const VARIANT: Record<SaasStatus, React.ComponentProps<typeof Badge>['variant']> = {
  active: 'success',
  trial: 'default',
  past_due: 'warning',
  cancelled: 'secondary',
  expired: 'destructive',
}

const LABEL: Record<SaasStatus, string> = {
  active: 'Active',
  trial: 'Trial',
  past_due: 'Past due',
  cancelled: 'Cancelled',
  expired: 'Expired',
}

export function StatusBadge({ status }: { status: SaasStatus | null }) {
  if (!status) return <span className="text-muted-foreground">—</span>
  return <Badge variant={VARIANT[status]}>{LABEL[status]}</Badge>
}

export function PlanBadge({ plan }: { plan: string | null }) {
  if (!plan) return <span className="text-muted-foreground">—</span>
  return <Badge variant="outline" className="capitalize">{plan}</Badge>
}
