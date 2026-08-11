'use client'

import { useTranslations } from 'next-intl'
import { ChevronDown, ChevronUp } from 'lucide-react'
import type { PublicSurface, SiteSurfaceLinkConfig } from '@linyup/shared'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { usePublicSurfaces } from '@/hooks/usePublicSurfaces'

// ─── SurfaceLinksEditor ───────────────────────────────────────────────────────
//
// Studio control over the website header's links to its OTHER public pages.
//
// The list is not authored here — it's derived at render time from what's
// actually live, so enabling the shop plugin makes a Shop link appear without
// the studio touching the website. This editor only records deviations:
// hide it, rename it, reorder it. Nothing here can create a link to a surface
// the team doesn't have.

/** The surfaces that can appear as a header link (booking has its own CTA). */
const LINKABLE: PublicSurface[] = ['shop', 'space', 'documents']

export function SurfaceLinksEditor({
  links,
  onChange,
}: {
  links: SiteSurfaceLinkConfig[] | undefined
  onChange: (links: SiteSurfaceLinkConfig[] | undefined) => void
}) {
  // Same namespace the live site nav uses, so the placeholder shows exactly what
  // the visitor will see when the studio leaves the label blank.
  const t = useTranslations('PublicSurfaceNav')
  const { flags } = usePublicSurfaces()

  const liveBySurface: Record<string, boolean> = {
    shop: flags.shopLive,
    space: flags.spaceLive,
    documents: flags.documentsLive,
  }
  const live = LINKABLE.filter((s) => liveBySurface[s])

  // Same ordering rule the renderer uses: configured entries first by `order`,
  // everything else after in its natural order.
  const ordered = [...live].sort((a, b) => {
    const oa = links?.find((l) => l.surface === a)?.order ?? Number.MAX_SAFE_INTEGER
    const ob = links?.find((l) => l.surface === b)?.order ?? Number.MAX_SAFE_INTEGER
    return oa - ob || live.indexOf(a) - live.indexOf(b)
  })

  /** Merge one surface's override in, dropping it entirely when it's back to default. */
  const update = (surface: PublicSurface, patch: Partial<SiteSurfaceLinkConfig>) => {
    const rest = (links ?? []).filter((l) => l.surface !== surface)
    const current = links?.find((l) => l.surface === surface) ?? { surface }
    const merged: SiteSurfaceLinkConfig = { ...current, ...patch, surface }
    if (!merged.hidden && !merged.label?.trim() && merged.order === undefined) {
      onChange(rest.length ? rest : undefined)
      return
    }
    if (!merged.label?.trim()) delete merged.label
    onChange([...rest, merged])
  }

  /** Reordering writes an explicit `order` for every live link, so it's stable. */
  const move = (surface: PublicSurface, direction: -1 | 1) => {
    const from = ordered.indexOf(surface)
    const to = from + direction
    if (to < 0 || to >= ordered.length) return
    const next = [...ordered]
    ;[next[from], next[to]] = [next[to], next[from]]
    const bySurface = new Map((links ?? []).map((l) => [l.surface, l] as const))
    onChange(
      next.map((s, index) => ({ ...(bySurface.get(s) ?? { surface: s }), surface: s, order: index }))
    )
  }

  if (live.length === 0) {
    return (
      <div className="border-t pt-3">
        <p className="text-xs font-medium text-muted-foreground">Links to your other pages</p>
        <p className="mt-1 text-xs text-muted-foreground">
          Nothing to link yet — your shop, Space and documents appear here once they&apos;re live.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-2 border-t pt-3">
      <div>
        <p className="text-xs font-medium text-muted-foreground">Links to your other pages</p>
        <p className="mt-1 text-xs text-muted-foreground">
          Shown in your website&apos;s menu. New pages appear here automatically.
        </p>
      </div>

      {ordered.map((surface, index) => {
        const config = links?.find((l) => l.surface === surface)
        const visible = !config?.hidden
        return (
          <div key={surface} className="space-y-2 rounded-md border p-2.5">
            <div className="flex items-center gap-2">
              <div className="flex shrink-0 flex-col">
                <button
                  type="button"
                  onClick={() => move(surface, -1)}
                  disabled={index === 0}
                  aria-label={`Move ${surface} up`}
                  className="text-muted-foreground transition-colors hover:text-foreground disabled:opacity-30"
                >
                  <ChevronUp className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => move(surface, 1)}
                  disabled={index === ordered.length - 1}
                  aria-label={`Move ${surface} down`}
                  className="text-muted-foreground transition-colors hover:text-foreground disabled:opacity-30"
                >
                  <ChevronDown className="h-3.5 w-3.5" />
                </button>
              </div>
              <Input
                value={config?.label ?? ''}
                onChange={(e) => update(surface, { label: e.target.value })}
                placeholder={t(surface)}
                disabled={!visible}
                className="h-8 flex-1 text-sm"
              />
              <Switch
                checked={visible}
                onCheckedChange={(v) => update(surface, { hidden: v ? undefined : true })}
                aria-label={`Show ${surface} link`}
              />
            </div>
          </div>
        )
      })}
    </div>
  )
}
