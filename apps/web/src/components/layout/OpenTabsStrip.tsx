'use client'

// Desktop-only horizontal "open pages" tab strip. Mounted once in the (auth)
// shell so it survives navigation. Tabs are navigational, not live: clicking one
// re-navigates and the view remounts from the React Query cache (per-entity keys,
// 60s stale / 5min gc), so reopening is near-instant. Hidden on mobile.

import { useEffect } from 'react'
import { useTranslations } from 'next-intl'
import { useRouter, usePathname } from '@/i18n/navigation'
import { MoreHorizontal, Pin, PinOff, X, User, CalendarClock, Ticket, PanelsTopLeft } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { SortableList, SortableItem } from '@/components/ui/sortable'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu'
import { useOpenTabs, type OpenTab } from '@/contexts/OpenTabsContext'
import { normalizeTabPath, resolveTabRoute, toRoute, type EntityKind } from '@/lib/tab-routes'

const KIND_ICON: Record<EntityKind, LucideIcon> = {
  contact: User,
  session: CalendarClock,
  event: Ticket,
  section: PanelsTopLeft,
}

export function OpenTabsStrip() {
  const { tabs, ensureTab, closeTab, closeOthers, pinTab, reorderTabs } = useOpenTabs()
  const router = useRouter()
  const pathname = usePathname()
  const tNav = useTranslations('Nav')
  const activeId = normalizeTabPath(pathname)

  // Auto-open a tab for the current route if it's trackable and not already open.
  // ensureTab never clobbers an existing (richer) label, so returning to an open
  // contact keeps its name. Entity pages upgrade the fallback via useRegisterTab.
  useEffect(() => {
    const resolved = resolveTabRoute(pathname)
    if (!resolved) return
    const label = resolved.labelKey
      ? tNav(resolved.labelKey as Parameters<typeof tNav>[0])
      : tNav(
          `tabFallback${resolved.kind[0].toUpperCase()}${resolved.kind.slice(
            1
          )}` as Parameters<typeof tNav>[0]
        )
    ensureTab({ id: resolved.id, href: pathname, label, entityKind: resolved.kind })
  }, [pathname, ensureTab, tNav])

  if (tabs.length === 0) return null

  const navigate = (href: string) => router.push(toRoute(href))

  const handleClose = (tab: OpenTab) => {
    const idx = tabs.findIndex((t) => t.id === tab.id)
    closeTab(tab.id)
    if (tab.id === activeId) {
      const neighbour = tabs[idx + 1] ?? tabs[idx - 1]
      navigate(neighbour ? neighbour.href : '/dashboard')
    }
  }

  return (
    <div className="hidden md:block border-b bg-background">
      <div className="max-w-5xl 2xl:max-w-7xl mx-auto px-4 sm:px-6">
        <SortableList
          horizontal
          ids={tabs.map((t) => t.id)}
          onReorder={(from, to) => reorderTabs(from, to)}
        >
          <div className="flex items-stretch gap-1 overflow-x-auto no-scrollbar -mb-px">
            {tabs.map((tab) => {
              const Icon = KIND_ICON[tab.entityKind]
              const isActive = tab.id === activeId
              return (
                <SortableItem key={tab.id} id={tab.id}>
                  {({ setNodeRef, style, attributes, listeners, isDragging }) => (
                    <div
                      ref={setNodeRef}
                      style={style}
                      className={`group relative flex items-center gap-1 rounded-t-md border-b-2 pl-2.5 pr-1 max-w-[180px] ${
                        isActive
                          ? 'border-primary bg-primary/5 text-primary'
                          : 'border-transparent text-muted-foreground hover:bg-accent hover:text-foreground'
                      } ${isDragging ? 'opacity-60' : ''}`}
                    >
                      {/* Label — also the drag handle (distance-activated, so a
                          plain click still navigates). */}
                      <button
                        type="button"
                        onClick={() => navigate(tab.href)}
                        onAuxClick={(e) => {
                          if (e.button === 1) {
                            e.preventDefault()
                            handleClose(tab)
                          }
                        }}
                        title={tab.label}
                        {...attributes}
                        {...listeners}
                        className={`flex min-w-0 items-center gap-1.5 py-1.5 text-sm cursor-pointer ${
                          isActive ? 'font-medium' : ''
                        }`}
                      >
                        <Icon className="h-3.5 w-3.5 shrink-0 opacity-70" />
                        <span className="truncate">{tab.label}</span>
                        {tab.pinned && <Pin className="h-3 w-3 shrink-0 opacity-60" />}
                      </button>

                      {/* Overflow menu — pin/unpin + close others. */}
                      <DropdownMenu>
                        <DropdownMenuTrigger
                          className={`shrink-0 rounded p-0.5 text-muted-foreground opacity-0 transition-opacity hover:bg-muted hover:text-foreground focus:opacity-100 group-hover:opacity-100 ${
                            isActive ? 'opacity-70' : ''
                          }`}
                          aria-label={tNav('tabMenu')}
                        >
                          <MoreHorizontal className="h-3.5 w-3.5" />
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="start" className="w-44">
                          <DropdownMenuItem onClick={() => pinTab(tab.id)}>
                            {tab.pinned ? (
                              <>
                                <PinOff className="h-4 w-4" /> {tNav('tabUnpin')}
                              </>
                            ) : (
                              <>
                                <Pin className="h-4 w-4" /> {tNav('tabPin')}
                              </>
                            )}
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem onClick={() => handleClose(tab)}>
                            <X className="h-4 w-4" /> {tNav('tabClose')}
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => closeOthers(tab.id)}>
                            {tNav('tabCloseOthers')}
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>

                      {/* Quick close — hidden for pinned tabs. */}
                      {!tab.pinned && (
                        <button
                          type="button"
                          onClick={() => handleClose(tab)}
                          aria-label={tNav('tabClose')}
                          className={`shrink-0 rounded p-0.5 text-muted-foreground opacity-0 transition-opacity hover:bg-muted hover:text-foreground group-hover:opacity-100 ${
                            isActive ? 'opacity-70' : ''
                          }`}
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>
                  )}
                </SortableItem>
              )
            })}
          </div>
        </SortableList>
      </div>
    </div>
  )
}
