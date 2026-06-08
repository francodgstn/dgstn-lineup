'use client'

import { forwardRef, useEffect, useImperativeHandle, useState } from 'react'
import type { LucideIcon } from 'lucide-react'

export interface SlashItem {
  title: string
  icon: LucideIcon
  command: (args: { editor: unknown; range: unknown }) => void
}

export interface SlashCommandListRef {
  onKeyDown: (props: { event: KeyboardEvent }) => boolean
}

// Popup list rendered by the slash-command suggestion. Keyboard nav is exposed
// to the editor via the imperative ref (arrow keys + Enter).
export const SlashCommandList = forwardRef<
  SlashCommandListRef,
  { items: SlashItem[]; command: (item: SlashItem) => void }
>(function SlashCommandList({ items, command }, ref) {
  const [selected, setSelected] = useState(0)

  useEffect(() => setSelected(0), [items])

  useImperativeHandle(ref, () => ({
    onKeyDown: ({ event }) => {
      if (items.length === 0) return false
      if (event.key === 'ArrowUp') {
        setSelected((s) => (s + items.length - 1) % items.length)
        return true
      }
      if (event.key === 'ArrowDown') {
        setSelected((s) => (s + 1) % items.length)
        return true
      }
      if (event.key === 'Enter') {
        if (items[selected]) command(items[selected])
        return true
      }
      return false
    },
  }), [items, selected, command])

  if (items.length === 0) return null

  return (
    <div className="w-64 rounded-lg border bg-popover text-popover-foreground shadow-md p-1 max-h-72 overflow-y-auto">
      {items.map((item, i) => {
        const Icon = item.icon
        return (
          <button
            key={item.title}
            type="button"
            onMouseEnter={() => setSelected(i)}
            onClick={() => command(item)}
            className={`flex items-center gap-2 w-full rounded-md px-2 py-1.5 text-sm text-left transition-colors ${
              i === selected ? 'bg-accent text-foreground' : 'text-muted-foreground'
            }`}
          >
            <Icon className="h-4 w-4 shrink-0" />
            <span>{item.title}</span>
          </button>
        )
      })}
    </div>
  )
})
