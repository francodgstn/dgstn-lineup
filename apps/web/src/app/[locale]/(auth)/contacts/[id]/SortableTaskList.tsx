'use client'

// Drag-to-reorder for a task list — a goal's steps, or the virtual "General"
// bucket. Thin wrapper over the house SortableList (components/ui/sortable.tsx,
// the same dnd-kit setup the bio-link and website builders use), so the drag
// threshold, the keyboard sensor and the handle convention stay in one place.
//
// A RENDER PROP, not a TaskCard import: the card lives inside GoalsTab and is
// not exported, and pulling it out here would move a 60-line component for the
// sake of a wrapper. The caller renders its own row and decides where the handle
// goes; this file owns only the dragging.
//
// Dragging is OFF unless the list is in manual order. Offering a handle while
// the list is sorted by a date would be a lie — the drop would be overwritten
// by the sort on the next render — so in a date mode the handle is not rendered
// at all rather than rendered inert.

import { Fragment, type ReactNode } from 'react'
import { GripVertical } from 'lucide-react'
import { SortableItem, SortableList } from '@/components/ui/sortable'

export function SortableTaskList<T extends { id: string }>({
  tasks,
  enabled,
  onReorder,
  dragLabel,
  children,
}: {
  tasks: T[]
  /** Manual order, and the viewer may write. */
  enabled: boolean
  onReorder: (from: number, to: number) => void
  /** Accessible name for the handle. */
  dragLabel: string
  children: (task: T, handle: ReactNode) => ReactNode
}) {
  if (!enabled) {
    return (
      <>
        {tasks.map((task) => (
          <Fragment key={task.id}>{children(task, null)}</Fragment>
        ))}
      </>
    )
  }

  return (
    <SortableList ids={tasks.map((t) => t.id)} onReorder={onReorder}>
      {tasks.map((task) => (
        <SortableItem key={task.id} id={task.id}>
          {({ setNodeRef, style, attributes, listeners, isDragging }) => (
            <div ref={setNodeRef} style={style} className={isDragging ? 'opacity-70' : undefined}>
              {children(
                task,
                <button
                  type="button"
                  aria-label={dragLabel}
                  title={dragLabel}
                  className="cursor-grab touch-none p-1 text-muted-foreground/50 hover:text-foreground active:cursor-grabbing"
                  {...attributes}
                  {...listeners}
                >
                  <GripVertical className="h-3.5 w-3.5" />
                </button>,
              )}
            </div>
          )}
        </SortableItem>
      ))}
    </SortableList>
  )
}
