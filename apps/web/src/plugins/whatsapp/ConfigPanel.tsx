'use client'

import { MessageCircle } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'

export function ConfigPanel() {
  const t = useTranslations('Plugins')
  return (
    <div className="flex flex-col gap-4 py-2">
      <div className="flex items-center gap-2 rounded-md border border-dashed p-3 text-sm text-muted-foreground">
        <MessageCircle className="h-4 w-4 shrink-0 opacity-50" />
        <span>{t('statusComingSoon')}</span>
      </div>
      <div className="space-y-2 opacity-50 pointer-events-none">
        <Label>{t('whatsappConfigTokenLabel')}</Label>
        <Input disabled placeholder="EAAx…" />
      </div>
      <div className="space-y-2 opacity-50 pointer-events-none">
        <Label>{t('whatsappConfigPhoneIdLabel')}</Label>
        <Input disabled placeholder="1234567890" />
      </div>
    </div>
  )
}
