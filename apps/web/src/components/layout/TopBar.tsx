'use client'

import { useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useTranslations, useLocale } from 'next-intl'
import { doc, getDoc } from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { useAuth } from '@/contexts/AuthContext'
import { useTheme } from 'next-themes'
import { QRCodeCanvas } from 'qrcode.react'
import { TEAMS_COLLECTION } from '@lineup/shared'
import type { Team } from '@lineup/shared'
import type { Route } from 'next'
import {
  Menu, QrCode, Bell, Sun, Moon, Settings, Users, LogOut,
  Copy, Download, Check, ExternalLink,
} from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Button } from '@/components/ui/button'
import { useRouter, usePathname } from '@/i18n/navigation'

// ─── team data hook ───────────────────────────────────────────────────────────

function useTeam(teamId: string | null) {
  return useQuery<Team | null>({
    queryKey: ['team', teamId],
    enabled: !!teamId,
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      if (!teamId) return null
      const snap = await getDoc(doc(db, TEAMS_COLLECTION, teamId))
      return snap.exists() ? ({ id: snap.id, ...snap.data() } as Team) : null
    },
  })
}

// ─── QR dialog ────────────────────────────────────────────────────────────────

type QRTab = 'checkin' | 'portal'

function QRDialog({ open, onClose, team }: { open: boolean; onClose: () => void; team: Team | null }) {
  const t = useTranslations('TopBar')
  const [tab, setTab] = useState<QRTab>('checkin')
  const [copied, setCopied] = useState(false)
  const checkinRef = useRef<HTMLCanvasElement>(null)
  const portalRef  = useRef<HTMLCanvasElement>(null)

  const portalUrl = typeof window !== 'undefined' && team?.slug
    ? `${window.location.origin}/portal/${team.slug}`
    : ''

  const checkinValue = team?.slug ? JSON.stringify({ team: team.slug }) : ''

  function activeRef() { return tab === 'checkin' ? checkinRef : portalRef }

  function download(filename: string) {
    const canvas = activeRef().current
    if (!canvas) return
    const a = document.createElement('a')
    a.href = canvas.toDataURL('image/png')
    a.download = filename
    a.click()
  }

  function downloadBranded(teamName: string, filename: string) {
    const qr = activeRef().current
    if (!qr) return

    const pad = 20
    const headerH = 40
    const qrSize = qr.width
    const out = document.createElement('canvas')
    out.width  = qrSize + pad * 2
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
    ctx.fillText(teamName, out.width / 2, headerH / 2 + pad)
    ctx.drawImage(qr, pad, headerH + pad / 2)

    const a = document.createElement('a')
    a.href = out.toDataURL('image/png')
    a.download = filename
    a.click()
  }

  async function downloadCheckinPdf() {
    const qrCanvas = checkinRef.current
    if (!qrCanvas || !team) return

    // Scale QR 4× for crisp print resolution
    const scale = 4
    const hiRes = document.createElement('canvas')
    hiRes.width  = qrCanvas.width  * scale
    hiRes.height = qrCanvas.height * scale
    const hCtx = hiRes.getContext('2d')!
    hCtx.fillStyle = '#ffffff'
    hCtx.fillRect(0, 0, hiRes.width, hiRes.height)
    hCtx.drawImage(qrCanvas, 0, 0, hiRes.width, hiRes.height)
    const qrDataUrl = hiRes.toDataURL('image/png')

    const { jsPDF } = await import('jspdf')
    const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })

    const pageW   = doc.internal.pageSize.getWidth()   // 210
    const pageH   = doc.internal.pageSize.getHeight()  // 297
    const margin  = 22
    const centerX = pageW / 2                          // 105
    const maxW    = pageW - margin * 2                 // 166

    // ── Title ────────────────────────────────────────────────────────────────
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(42)
    doc.setTextColor(0, 0, 0)
    doc.text('CHECK IN', centerX, 34, { align: 'center' })

    doc.setFontSize(34)
    doc.text('TO YOUR CLASS', centerX, 50, { align: 'center' })

    // ── Divider + team name ──────────────────────────────────────────────────
    const lineY = 62
    doc.setDrawColor(100, 100, 100)
    doc.setLineWidth(0.3)
    doc.line(50, lineY, centerX - 28, lineY)
    doc.line(centerX + 28, lineY, 160, lineY)

    doc.setFontSize(16)
    doc.setTextColor(0, 0, 0)
    doc.text(team.name, centerX, lineY + 1.5, { align: 'center' })

    // ── Description ──────────────────────────────────────────────────────────
    let cursorY = lineY + 9   // 71 mm
    if (team.description) {
      doc.setFont('helvetica', 'normal')
      doc.setFontSize(9)
      doc.setTextColor(90, 90, 90)
      const lines = doc.splitTextToSize(team.description, maxW - 20) as string[]
      for (const line of lines) {
        doc.text(line, centerX, cursorY, { align: 'center' })
        cursorY += 4.5
      }
      cursorY += 8
    } else {
      cursorY += 8
    }

    // ── QR code + border box ─────────────────────────────────────────────────
    const qrSize   = 78
    const qrPad    = 7
    const boxSize  = qrSize + qrPad * 2   // 92
    const boxX     = centerX - boxSize / 2
    const qrX      = centerX - qrSize / 2

    doc.setDrawColor(70, 70, 70)
    doc.setLineWidth(0.9)
    doc.roundedRect(boxX + 0.45, cursorY + 0.45, boxSize - 0.9, boxSize - 0.9, 7, 7, 'S')
    doc.addImage(qrDataUrl, 'PNG', qrX, cursorY + qrPad, qrSize, qrSize)

    cursorY += boxSize

    // ── Instruction ───────────────────────────────────────────────────────────
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(18)
    doc.setTextColor(0, 0, 0)
    doc.text('Scan with your phone to check in', centerX, cursorY + 24, { align: 'center' })

    // ── Footer ────────────────────────────────────────────────────────────────
    doc.setFontSize(8)
    doc.setTextColor(160, 160, 160)
    doc.text('Powered by Lineup', centerX, pageH - 10, { align: 'center' })

    doc.save(`lineup-checkin-${team.slug ?? 'poster'}.pdf`)
  }

  async function copyUrl() {
    if (!portalUrl) return
    await navigator.clipboard.writeText(portalUrl)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const noSlug = !team?.slug

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{t('qrTitle')}</DialogTitle>
        </DialogHeader>

        {noSlug ? (
          <p className="text-sm text-muted-foreground py-4 text-center">{t('qrNoSlug')}</p>
        ) : (
          <div className="space-y-4">
            {/* Tabs */}
            <div className="flex rounded-lg border overflow-hidden w-fit">
              {(['checkin', 'portal'] as QRTab[]).map((v) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => setTab(v)}
                  className={`px-4 py-1.5 text-sm transition-colors ${
                    tab === v ? 'bg-primary text-primary-foreground' : 'hover:bg-muted text-muted-foreground'
                  }`}
                >
                  {t(v === 'checkin' ? 'qrCheckinTab' : 'qrPortalTab')}
                </button>
              ))}
            </div>

            {/* Description */}
            <p className="text-xs text-muted-foreground">
              {t(tab === 'checkin' ? 'qrCheckinDesc' : 'qrPortalDesc')}
            </p>

            {/* QR codes (both rendered, only one visible — preserves canvas ref) */}
            <div className="flex justify-center py-2">
              <div className={tab === 'checkin' ? '' : 'hidden'}>
                <QRCodeCanvas ref={checkinRef} value={checkinValue} size={200} level="M" />
              </div>
              <div className={tab === 'portal' ? '' : 'hidden'}>
                <QRCodeCanvas ref={portalRef} value={portalUrl} size={200} level="M" />
              </div>
            </div>

            {/* Portal URL */}
            {tab === 'portal' && (
              <div className="flex items-center gap-2 bg-muted rounded-md px-3 py-1.5">
                <span className="text-xs font-mono flex-1 truncate text-muted-foreground">{portalUrl}</span>
                <button type="button" onClick={copyUrl} className="shrink-0 text-muted-foreground hover:text-foreground transition-colors">
                  {copied ? <Check className="h-3.5 w-3.5 text-green-600" /> : <Copy className="h-3.5 w-3.5" />}
                </button>
                <a href={portalUrl} target="_blank" rel="noopener noreferrer" className="shrink-0 text-muted-foreground hover:text-foreground transition-colors">
                  <ExternalLink className="h-3.5 w-3.5" />
                </a>
              </div>
            )}

            {/* Download buttons */}
            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="flex-1 gap-1.5"
                onClick={() => download(`lineup-qr-${tab}.png`)}
              >
                <Download className="h-3.5 w-3.5" />
                {t('qrDownloadPng')}
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="flex-1 gap-1.5"
                onClick={() => downloadBranded(team?.name ?? 'Lineup', `lineup-qr-${tab}-branded.png`)}
              >
                <Download className="h-3.5 w-3.5" />
                {t('qrDownloadBranded')}
              </Button>
            </div>

            {/* PDF poster — check-in tab only */}
            {tab === 'checkin' && (
              <Button
                type="button"
                variant="secondary"
                size="sm"
                className="w-full gap-1.5"
                onClick={downloadCheckinPdf}
              >
                <Download className="h-3.5 w-3.5" />
                {t('qrDownloadPoster')}
              </Button>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

// ─── user initial avatar ──────────────────────────────────────────────────────

function UserAvatar({ email }: { email: string | null }) {
  const initial = email?.[0]?.toUpperCase() ?? '?'
  return (
    <div className="h-7 w-7 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-xs font-bold select-none shrink-0">
      {initial}
    </div>
  )
}

// ─── top bar ─────────────────────────────────────────────────────────────────

export function TopBar({ onMobileMenu }: { onMobileMenu: () => void }) {
  const t = useTranslations('TopBar')
  const tNav = useTranslations('Nav')
  const { user, currentTeamId } = useAuth()
  const { data: team } = useTeam(currentTeamId)
  const { resolvedTheme, setTheme } = useTheme()
  const router = useRouter()
  const pathname = usePathname()
  const locale = useLocale()
  const [qrOpen, setQrOpen] = useState(false)

  async function handleSignOut() {
    const { signOut } = await import('@/lib/auth')
    await signOut()
    router.push('/login')
  }

  return (
    <>
      <header className="flex items-center h-14 px-3 bg-card border-b border-border/60 shadow-[0_1px_3px_0_oklch(0.52_0.24_288_/_0.06)] shrink-0 gap-1.5">
        {/* Mobile hamburger */}
        <button
          type="button"
          onClick={onMobileMenu}
          className="md:hidden p-2 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
        >
          <Menu className="h-5 w-5" />
        </button>

        {/* Team name (desktop) / Logo (mobile) */}
        <div className="flex-1 min-w-0 px-1">
          <span className="hidden md:block text-sm font-medium text-muted-foreground truncate">
            {team?.name ?? ''}
          </span>
          <span className="md:hidden text-base font-bold tracking-tight">Lineup</span>
        </div>

        {/* QR codes */}
        <button
          type="button"
          onClick={() => setQrOpen(true)}
          title={t('qrTitle')}
          className="p-2 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
        >
          <QrCode className="h-5 w-5" />
        </button>

        {/* Notifications */}
        <Popover>
          <PopoverTrigger
            className="p-2 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
            aria-label={t('notificationsTitle')}
          >
            <Bell className="h-5 w-5" />
          </PopoverTrigger>
          <PopoverContent side="bottom" align="end" className="w-80 p-0">
            <div className="px-4 py-3 border-b">
              <p className="text-sm font-semibold">{t('notificationsTitle')}</p>
            </div>
            <div className="py-8 text-center">
              <p className="text-sm text-muted-foreground">{t('noNotifications')}</p>
            </div>
          </PopoverContent>
        </Popover>

        {/* User menu */}
        <DropdownMenu>
          <DropdownMenuTrigger
            className="p-1 rounded-full hover:ring-2 hover:ring-primary/30 transition-all"
            aria-label={t('account')}
          >
            <UserAvatar email={user?.email ?? null} />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuGroup>
              <DropdownMenuLabel className="font-normal">
                <div className="flex flex-col gap-0.5">
                  <span className="text-xs font-medium truncate">{user?.email}</span>
                  {team?.name && (
                    <span className="text-xs text-muted-foreground truncate">{team.name}</span>
                  )}
                </div>
              </DropdownMenuLabel>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />

            {/* Theme toggle */}
            <div className="px-2 py-1.5">
              <div className="flex rounded-md border overflow-hidden">
                <button
                  type="button"
                  onClick={() => setTheme('light')}
                  className={`flex-1 flex items-center justify-center gap-1 py-1 text-xs transition-colors ${
                    resolvedTheme === 'light' ? 'bg-primary text-primary-foreground' : 'hover:bg-muted text-muted-foreground'
                  }`}
                >
                  <Sun className="h-3 w-3" />
                  {t('lightMode')}
                </button>
                <button
                  type="button"
                  onClick={() => setTheme('dark')}
                  className={`flex-1 flex items-center justify-center gap-1 py-1 text-xs transition-colors ${
                    resolvedTheme === 'dark' ? 'bg-primary text-primary-foreground' : 'hover:bg-muted text-muted-foreground'
                  }`}
                >
                  <Moon className="h-3 w-3" />
                  {t('darkMode')}
                </button>
              </div>
            </div>
            {/* Language switcher */}
            <div className="px-2 py-1.5">
              <Select value={locale} onValueChange={(l) => { if (l) router.replace(pathname, { locale: l }) }}>
                <SelectTrigger className="h-7 text-xs w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="en">English</SelectItem>
                  <SelectItem value="de">Deutsch</SelectItem>
                  <SelectItem value="fr">Français</SelectItem>
                  <SelectItem value="it">Italiano</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <DropdownMenuSeparator />

            <DropdownMenuItem onClick={() => router.push('/team/settings' as Route)}>
              <Settings className="h-4 w-4 mr-2" />
              {tNav('settings')}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => router.push('/team/members' as Route)}>
              <Users className="h-4 w-4 mr-2" />
              {tNav('members')}
            </DropdownMenuItem>
            <DropdownMenuSeparator />

            <DropdownMenuItem onClick={handleSignOut} variant="destructive">
              <LogOut className="h-4 w-4 mr-2" />
              {tNav('signOut')}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </header>

      <QRDialog open={qrOpen} onClose={() => setQrOpen(false)} team={team ?? null} />
    </>
  )
}
