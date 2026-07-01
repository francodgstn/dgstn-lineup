'use client'

import { useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import { QRCodeCanvas } from 'qrcode.react'
import { Copy, Download, Check, ExternalLink } from 'lucide-react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'

// Share dialog for a published + public document — QR code + copy/open/download,
// cloned from components/layout/QRDialog.tsx mechanics (single URL, no tabs).
export function DocumentShareDialog({
  open,
  onClose,
  url,
  title,
  teamName,
}: {
  open: boolean
  onClose: () => void
  url: string
  title: string
  teamName?: string
}) {
  const t = useTranslations('Documents')
  const [copied, setCopied] = useState(false)
  const qrRef = useRef<HTMLCanvasElement>(null)

  function download(filename: string) {
    const canvas = qrRef.current
    if (!canvas) return
    const a = document.createElement('a')
    a.href = canvas.toDataURL('image/png')
    a.download = filename
    a.click()
  }

  function downloadBranded(filename: string) {
    const qr = qrRef.current
    if (!qr) return

    const pad = 20
    const headerH = 40
    const qrSize = qr.width
    const out = document.createElement('canvas')
    out.width = qrSize + pad * 2
    out.height = qrSize + headerH + pad * 2

    const ctx = out.getContext('2d')!
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, out.width, out.height)
    ctx.strokeStyle = '#000000'
    ctx.lineWidth = 2
    ctx.strokeRect(1, 1, out.width - 2, out.height - 2)
    ctx.fillStyle = '#000000'
    ctx.font = 'bold 16px Arial, sans-serif'
    ctx.textAlign = 'center'
    ctx.fillText(teamName || 'Linyup', out.width / 2, headerH / 2 + pad)
    ctx.drawImage(qr, pad, headerH + pad / 2)

    const a = document.createElement('a')
    a.href = out.toDataURL('image/png')
    a.download = filename
    a.click()
  }

  async function downloadPdfPoster() {
    const qrCanvas = qrRef.current
    if (!qrCanvas) return

    const scale = 4
    const hiRes = document.createElement('canvas')
    hiRes.width = qrCanvas.width * scale
    hiRes.height = qrCanvas.height * scale
    const hCtx = hiRes.getContext('2d')!
    hCtx.fillStyle = '#ffffff'
    hCtx.fillRect(0, 0, hiRes.width, hiRes.height)
    hCtx.drawImage(qrCanvas, 0, 0, hiRes.width, hiRes.height)
    const qrDataUrl = hiRes.toDataURL('image/png')

    const { jsPDF } = await import('jspdf')
    const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })

    const pageW = doc.internal.pageSize.getWidth()
    const pageH = doc.internal.pageSize.getHeight()
    const margin = 22
    const centerX = pageW / 2
    const maxW = pageW - margin * 2

    doc.setFont('helvetica', 'bold')
    doc.setFontSize(30)
    doc.setTextColor(0, 0, 0)
    const titleLines = doc.splitTextToSize(title, maxW) as string[]
    let cursorY = 40
    for (const line of titleLines) {
      doc.text(line, centerX, cursorY, { align: 'center' })
      cursorY += 12
    }

    const lineY = cursorY + 6
    doc.setDrawColor(100, 100, 100)
    doc.setLineWidth(0.3)
    doc.line(50, lineY, centerX - 28, lineY)
    doc.line(centerX + 28, lineY, 160, lineY)

    if (teamName) {
      doc.setFontSize(14)
      doc.setTextColor(0, 0, 0)
      doc.text(teamName, centerX, lineY + 1.5, { align: 'center' })
    }

    let qrCursorY = lineY + 14
    const qrSize = 78
    const qrPad = 7
    const boxSize = qrSize + qrPad * 2
    const boxX = centerX - boxSize / 2
    const qrX = centerX - qrSize / 2

    doc.setDrawColor(70, 70, 70)
    doc.setLineWidth(0.9)
    doc.roundedRect(boxX + 0.45, qrCursorY + 0.45, boxSize - 0.9, boxSize - 0.9, 7, 7, 'S')
    doc.addImage(qrDataUrl, 'PNG', qrX, qrCursorY + qrPad, qrSize, qrSize)

    qrCursorY += boxSize

    doc.setFont('helvetica', 'normal')
    doc.setFontSize(14)
    doc.setTextColor(0, 0, 0)
    doc.text('Scan to view', centerX, qrCursorY + 20, { align: 'center' })

    doc.setFontSize(8)
    doc.setTextColor(160, 160, 160)
    doc.text('Powered by Linyup', centerX, pageH - 10, { align: 'center' })

    doc.save(`linyup-document-${title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.pdf`)
  }

  async function copyUrl() {
    if (!url) return
    await navigator.clipboard.writeText(url)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{t('shareTitle')}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <p className="text-xs text-muted-foreground">{t('shareDesc')}</p>

          <div className="flex justify-center py-2">
            <QRCodeCanvas ref={qrRef} value={url} size={200} level="M" />
          </div>

          <div className="flex items-center gap-2 bg-muted rounded-md px-3 py-1.5">
            <span className="text-xs font-mono flex-1 truncate text-muted-foreground">{url}</span>
            <button
              type="button"
              onClick={copyUrl}
              className="shrink-0 text-muted-foreground hover:text-foreground transition-colors"
              title={t('copyUrl')}
            >
              {copied ? (
                <Check className="h-3.5 w-3.5 text-green-600" />
              ) : (
                <Copy className="h-3.5 w-3.5" />
              )}
            </button>
            <a
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              className="shrink-0 text-muted-foreground hover:text-foreground transition-colors"
              title={t('openInNewTab')}
            >
              <ExternalLink className="h-3.5 w-3.5" />
            </a>
          </div>

          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="flex-1 gap-1.5"
              onClick={() => download('linyup-document-qr.png')}
            >
              <Download className="h-3.5 w-3.5" />
              {t('downloadPng')}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="flex-1 gap-1.5"
              onClick={() => downloadBranded('linyup-document-qr-branded.png')}
            >
              <Download className="h-3.5 w-3.5" />
              {t('downloadBranded')}
            </Button>
          </div>

          <Button
            type="button"
            variant="secondary"
            size="sm"
            className="w-full gap-1.5"
            onClick={downloadPdfPoster}
          >
            <Download className="h-3.5 w-3.5" />
            {t('downloadPoster')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
