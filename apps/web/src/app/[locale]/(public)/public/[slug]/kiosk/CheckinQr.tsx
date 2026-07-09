'use client'

import { useTranslations } from 'next-intl'
import { QRCodeCanvas } from 'qrcode.react'

interface Props {
  slug: string
}

// Same check-in QR payload as the admin QRDialog (components/layout/QRDialog.tsx):
// { team: slug }, scanned by a member's phone to self check-in.
export default function CheckinQr({ slug }: Props) {
  const t = useTranslations('Kiosk')
  const value = JSON.stringify({ team: slug })

  return (
    <div className="flex flex-col items-center gap-3 rounded-2xl border bg-card p-6 text-center">
      <p className="text-sm font-bold uppercase tracking-wide text-muted-foreground">
        {t('checkinTitle')}
      </p>
      <div className="rounded-xl bg-white p-3">
        <QRCodeCanvas value={value} size={180} level="M" />
      </div>
      <p className="max-w-[220px] text-sm text-muted-foreground">{t('checkinScanCaption')}</p>
    </div>
  )
}
