'use client'

// Desktop-only "open pages" tab strip (Notion-style). Mounted once in the
// (auth) shell so it survives navigation. One active tab follows the user as
// they navigate (label/href update in place); extra tabs are created only by
// the ＋ button here or ctrl/⌘/middle-click on a row elsewhere. Tabs are
// navigational: switching re-navigates and the view remounts from the React
// Query cache. Hidden on mobile.

import { useEffect } from 'react'
import { useTranslations } from 'next-intl'
import { useRouter, usePathname } from '@/i18n/navigation'
import {
  Plus,
  MoreHorizontal,
  Pin,
  PinOff,
  X,
  User,
  CalendarClock,
  Ticket,
  PanelsTopLeft,
  FileText,
} from 'lucide-react'
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
import {
  normalizeTabPath,
  resolveTabRoute,
  fallbackLabelFromPath,
  toRoute,
  type EntityKind,
} from '@/lib/tab-routes'

const KIND_ICON: Record<EntityKind, LucideIcon> = {
  contact: User,
  session: CalendarClock,
  event: Ticket,
  section: PanelsTopLeft,
}

export function OpenTabsStrip() {
  const { tabs, activeTabId, hydrated, enabled, reconcileLocation, newTab, switchTab, closeTab, closeOthers, pinTab, reorderTabs } =
    useOpenTabs()
  const router = useRouter()
  const pathname = usePathname()
  const tNav = useTranslations('Nav')

  // Readable label + kind for any route (tracked section, entity, or fallback).
  const describe = (path: string): { label: string; entityKind?: EntityKind } => {
    const r = resolveTabRoute(path)
    if (r?.labelKey) return { label: tNav(r.labelKey as Parameters<typeof tNav>[0]), entityKind: 'section' }
    if (r?.kind) {
      const key = `tabFallback${r.kind[0].toUpperCase()}${r.kind.slice(1)}`
      return { label: tNav(key as Parameters<typeof tNav>[0]), entityKind: r.kind }
    }
    return { label: fallbackLabelFromPath(path) }
  }

  // URL → active tab. The active tab follows the user; a location already open
  // in another tab just activates that tab (dedup). Waits for hydration so the
  // first navigation reconciles against the restored tabs, not empty state.
  useEffect(() => {
    if (!hydrated || !enabled) return
    const { label, entityKind } = describe(pathname)
    reconcileLocation(pathname, label, entityKind)
    // describe/tNav are stable for a locale; re-run only when the path changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname, hydrated, enabled])

  if (!enabled || tabs.length === 0) return null

  const navigate = (href: string) => router.push(toRoute(href))

  const handleSwitch = (tab: OpenTab) => {
    switchTab(tab.tabId)
    if (normalizeTabPath(tab.href) !== normalizeTabPath(pathname)) navigate(tab.href)
  }

  const handleNewTab = () => {
    newTab('/dashboard', tNav('dashboard'), 'section')
    navigate('/dashboard')
  }

  const handleClose = (tab: OpenTab) => {
    const idx = tabs.findIndex((t) => t.tabId === tab.tabId)
    const wasActive = tab.tabId === activeTabId
    const neighbour = tabs[idx + 1] ?? tabs[idx - 1]
    closeTab(tab.tabId)
    if (wasActive) navigate(neighbour ? neighbour.href : '/dashboard')
  }

  return (
    <div className="hidden md:block border-b bg-background">
      <div className="px-2">
        <SortableList horizontal ids={tabs.map((t) => t.tabId)} onReorder={reorderTabs}>
          <div className="flex items-stretch gap-1 overflow-x-auto no-scrollbar -mb-px">
            {tabs.map((tab) => {
              const Icon = tab.entityKind ? KIND_ICON[tab.entityKind] : FileText
              const isActive = tab.tabId === activeTabId
              return (
                <SortableItem key={tab.tabId} id={tab.tabId}>
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
                          plain click still switches). */}
                      <button
                        type="button"
                        onClick={() => handleSwitch(tab)}
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
                          <DropdownMenuItem onClick={() => pinTab(tab.tabId)}>
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
                          <DropdownMenuItem onClick={() => closeOthers(tab.tabId)}>
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

            {/* Explicit branch — the only way (besides ctrl/⌘-click) to add a tab. */}
            <button
              type="button"
              onClick={handleNewTab}
              aria-label={tNav('tabNew')}
              title={tNav('tabNew')}
              className="shrink-0 self-center rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              <Plus className="h-4 w-4" />
            </button>
          </div>
        </SortableList>
      </div>
    </div>
  )
}
