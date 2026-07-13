'use client'

// Chart of accounts — grouped by type. Owner: toggle active, rename, add
// custom accounts (direct client writes; rules lock code/type/system), and
// switch the chart template while the ledger is still empty (server-enforced).

import { useMemo, useState } from 'react'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'
import { ArrowLeft, BookOpenText, Plus } from 'lucide-react'
import { Link } from '@/i18n/navigation'
import type { Route } from 'next'
import { CHART_TEMPLATES, type AccountType, type AccountingAccount, type ChartTemplateId } from '@linyup/shared'
import { useAuth } from '@/contexts/AuthContext'
import { useInstalledPlugins } from '@/hooks/useInstalledPlugins'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import {
  callSetChartTemplate,
  saveAccount,
  useAccounts,
  useAccountingSettings,
  useInvalidateAccounting,
} from '@/plugins/finance/hooks'

const TYPE_ORDER: AccountType[] = ['asset', 'liability', 'equity', 'revenue', 'expense']

export default function AccountingAccountsPage() {
  const t = useTranslations('Finance')
  const { currentTeamId, teamRole } = useAuth()
  const teamId = currentTeamId ?? null
  const isOwner = teamRole === 'owner'
  const { isInstalled, isLoading: pluginsLoading } = useInstalledPlugins()
  const { data: accounts = [], isLoading } = useAccounts(teamId)
  const { data: settings } = useAccountingSettings(teamId)
  const invalidate = useInvalidateAccounting(teamId)

  const [editing, setEditing] = useState<AccountingAccount | null>(null)
  const [adding, setAdding] = useState(false)
  const [form, setForm] = useState({ code: '', name: '', type: 'expense' as AccountType })

  const grouped = useMemo(() => {
    const m = new Map<AccountType, AccountingAccount[]>()
    for (const type of TYPE_ORDER) m.set(type, [])
    for (const a of accounts) m.get(a.type)?.push(a)
    return m
  }, [accounts])

  if (pluginsLoading || isLoading) return <Skeleton className="m-6 h-40" />
  if (!teamId || !isInstalled('finance')) {
    return <p className="p-6 text-sm text-muted-foreground">{t('notInstalled')}</p>
  }

  const ledgerHasEntries = (settings?.last_rebuild?.entries_written ?? 0) > 0

  const submitAccount = async () => {
    const code = form.code.trim()
    const name = form.name.trim()
    if (!code || !name) return
    try {
      await saveAccount(teamId, { code, name, type: form.type, active: true }, true)
      invalidate()
      setAdding(false)
      setForm({ code: '', name: '', type: 'expense' })
    } catch (err) {
      console.error('[finance] account save failed:', err)
      toast.error(t('actionFailed'))
    }
  }

  const submitRename = async () => {
    if (!editing) return
    try {
      await saveAccount(teamId, { ...editing, name: editing.name.trim() }, false)
      invalidate()
      setEditing(null)
    } catch (err) {
      console.error('[finance] account rename failed:', err)
      toast.error(t('actionFailed'))
    }
  }

  const toggleActive = async (account: AccountingAccount) => {
    try {
      await saveAccount(teamId, { ...account, active: !account.active }, false)
      invalidate()
    } catch (err) {
      console.error('[finance] account toggle failed:', err)
      toast.error(t('actionFailed'))
    }
  }

  const switchTemplate = async (template: ChartTemplateId) => {
    try {
      await callSetChartTemplate({ teamId, template })
      invalidate()
    } catch (err) {
      console.error('[finance] template switch failed:', err)
      toast.error(t('templateLocked'))
    }
  }

  return (
    <div className="space-y-6 p-4 sm:p-6">
      <Link
        href={'/plugins/finance' as Route}
        className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        {t('backToOverview')}
      </Link>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <BookOpenText className="h-5 w-5 text-muted-foreground" />
          <h1 className="text-lg font-semibold">{t('accounts')}</h1>
        </div>
        <div className="flex items-center gap-2">
          {isOwner && settings && (
            <div className="flex items-center gap-1">
              <Label className="text-xs text-muted-foreground">{t('chartTemplate')}</Label>
              <Select
                value={settings.chart_template}
                onValueChange={(v) => v && v !== settings.chart_template && switchTemplate(v as ChartTemplateId)}
              >
                <SelectTrigger size="sm" disabled={ledgerHasEntries}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(CHART_TEMPLATES) as ChartTemplateId[]).map((id) => (
                    <SelectItem key={id} value={id}>
                      {t(`template_${id}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          {isOwner && (
            <Button size="sm" variant="outline" onClick={() => setAdding(true)}>
              <Plus className="h-4 w-4 mr-1" />
              {t('addAccount')}
            </Button>
          )}
        </div>
      </div>
      {ledgerHasEntries && <p className="text-xs text-muted-foreground">{t('templateLocked')}</p>}

      {TYPE_ORDER.map((type) => {
        const rows = grouped.get(type) ?? []
        if (rows.length === 0) return null
        return (
          <div key={type} className="space-y-1">
            <h2 className="text-sm font-medium">{t(`type_${type}`)}</h2>
            <div className="rounded-lg border overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-20">{t('accountCode')}</TableHead>
                    <TableHead>{t('accountName')}</TableHead>
                    <TableHead className="w-24"></TableHead>
                    <TableHead className="w-24 text-right">{t('active')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((account) => (
                    <TableRow
                      key={account.code}
                      className={!account.active ? 'opacity-50' : undefined}
                      onClick={() => isOwner && setEditing({ ...account })}
                    >
                      <TableCell className="font-mono text-xs">{account.code}</TableCell>
                      <TableCell>{account.name}</TableCell>
                      <TableCell>
                        {account.system && <Badge variant="outline">{t('systemBadge')}</Badge>}
                      </TableCell>
                      <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                        <Switch
                          checked={account.active}
                          disabled={!isOwner}
                          onCheckedChange={() => toggleActive(account)}
                        />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </div>
        )
      })}

      {/* Rename dialog */}
      <Dialog open={!!editing} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {t('editAccount')} · {editing?.code}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            <Label>{t('accountName')}</Label>
            <Input
              value={editing?.name ?? ''}
              onChange={(e) => editing && setEditing({ ...editing, name: e.target.value })}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)}>{t('cancel')}</Button>
            <Button onClick={submitRename}>{t('save')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Add dialog */}
      <Dialog open={adding} onOpenChange={setAdding}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('addAccount')}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3">
            <div className="space-y-1">
              <Label>{t('accountCode')}</Label>
              <Input value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} />
            </div>
            <div className="space-y-1">
              <Label>{t('accountName')}</Label>
              <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </div>
            <div className="space-y-1">
              <Label>{t('accountType')}</Label>
              <Select value={form.type} onValueChange={(v) => v && setForm({ ...form, type: v as AccountType })}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TYPE_ORDER.map((type) => (
                    <SelectItem key={type} value={type}>{t(`type_${type}`)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAdding(false)}>{t('cancel')}</Button>
            <Button onClick={submitAccount} disabled={!form.code.trim() || !form.name.trim()}>
              {t('save')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
