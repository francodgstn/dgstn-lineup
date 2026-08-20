'use client'

/**
 * ONE styled confirmation, shaped like the `window.confirm()` it replaces.
 *
 * ── WHY A HOOK AND NOT A COMPONENT ───────────────────────────────────────────
 *
 * The sites being fixed are a mix: some had a native `confirm()` (unstyled, and
 * on a phone it renders as a browser chrome sheet with the origin in it), and
 * some had nothing at all. A controlled `<ConfirmDialog open=… />` would cost
 * every one of them a piece of state, a handler and a JSX block, and the
 * temptation at the fifth site is to copy the fourth and let the copies drift.
 *
 * So this keeps the call shape that already reads correctly at the site:
 *
 *     if (!(await confirm({ title, description, confirmLabel }))) return
 *     await doTheThing()
 *
 * which is a one-line edit over `if (!confirm(msg)) return`, and renders the
 * project's own Dialog rather than the browser's.
 *
 * ── THE PROMISE ALWAYS SETTLES ───────────────────────────────────────────────
 *
 * Every exit resolves it: the confirm button (true), the cancel button, the
 * backdrop, Escape, and an unmount while it is open (all false). A confirmation
 * that never settles leaves the caller awaiting forever and the row it guards
 * looking dead — which is a worse bug than the missing dialog it replaced.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import { AlertTriangle } from 'lucide-react'
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'

export interface ConfirmOptions {
  title: string
  /** The body. A node, so a caller can add a second paragraph for the case that
   *  makes the action worse (already happened, has people on it, is paid). */
  description?: React.ReactNode
  confirmLabel: string
  cancelLabel?: string
  /** Red confirm button + warning icon. On by default: everything that has
   *  reached for this so far destroys something. */
  destructive?: boolean
}

export function useConfirm() {
  const t = useTranslations('Common')
  const [pending, setPending] = useState<ConfirmOptions | null>(null)
  const resolveRef = useRef<((ok: boolean) => void) | null>(null)

  const settle = useCallback((ok: boolean) => {
    const resolve = resolveRef.current
    resolveRef.current = null
    setPending(null)
    resolve?.(ok)
  }, [])

  // An unmount with a question still on screen — a route change under an open
  // dialog — is a "no", not a hang.
  useEffect(() => () => resolveRef.current?.(false), [])

  const confirm = useCallback(
    (options: ConfirmOptions) =>
      new Promise<boolean>((resolve) => {
        // A second question while one is open cannot happen from a click, but
        // if it ever does, the first is answered rather than dropped.
        resolveRef.current?.(false)
        resolveRef.current = resolve
        setPending(options)
      }),
    []
  )

  const destructive = pending?.destructive !== false

  const confirmDialog = (
    <Dialog open={pending !== null} onOpenChange={(o) => !o && settle(false)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {destructive && <AlertTriangle className="h-4 w-4 shrink-0 text-destructive" />}
            {pending?.title}
          </DialogTitle>
        </DialogHeader>
        {pending?.description ? (
          <DialogBody className="space-y-2 text-sm text-muted-foreground">
            {pending.description}
          </DialogBody>
        ) : null}
        <DialogFooter>
          <Button variant="ghost" onClick={() => settle(false)}>
            {pending?.cancelLabel ?? t('cancel')}
          </Button>
          <Button variant={destructive ? 'destructive' : 'default'} onClick={() => settle(true)}>
            {pending?.confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )

  return { confirm, confirmDialog }
}
