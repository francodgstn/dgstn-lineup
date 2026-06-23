'use client'

import type { CSSProperties, ReactNode } from 'react'
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import {
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
  useSortable,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'

// Reusable vertical drag-and-drop sortable list, shared by the bio-link and
// website builders. Drag-by-handle keeps card clicks/inputs working; the
// keyboard sensor makes reordering accessible (focus handle → Space → arrows →
// Space). `onReorder` receives source/target indices into `ids`.

export interface SortableRenderProps {
  setNodeRef: (node: HTMLElement | null) => void
  style: CSSProperties
  /** Spread onto the drag handle element. */
  attributes: ReturnType<typeof useSortable>['attributes']
  /** Spread onto the drag handle element. */
  listeners: ReturnType<typeof useSortable>['listeners']
  isDragging: boolean
}

export function SortableItem({
  id,
  children,
}: {
  id: string
  children: (props: SortableRenderProps) => ReactNode
}) {
  const { setNodeRef, transform, transition, attributes, listeners, isDragging } = useSortable({ id })
  const style: CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    ...(isDragging ? { zIndex: 50, position: 'relative' } : {}),
  }
  return <>{children({ setNodeRef, style, attributes, listeners, isDragging })}</>
}

export function SortableList({
  ids,
  onReorder,
  children,
}: {
  ids: string[]
  onReorder: (from: number, to: number) => void
  children: ReactNode
}) {
  const sensors = useSensors(
    // Small drag threshold so taps/clicks on cards still register normally.
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  function handleDragEnd(e: DragEndEvent) {
    const { active, over } = e
    if (!over || active.id === over.id) return
    const from = ids.indexOf(String(active.id))
    const to = ids.indexOf(String(over.id))
    if (from !== -1 && to !== -1 && from !== to) onReorder(from, to)
  }

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
      <SortableContext items={ids} strategy={verticalListSortingStrategy}>
        {children}
      </SortableContext>
    </DndContext>
  )
}
