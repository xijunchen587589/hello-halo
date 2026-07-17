/**
 * SortableSpaceList — drag-to-reorder wrapper for space lists.
 *
 * Wraps a list of Space items in a dnd-kit DndContext + SortableContext.
 * Each row exposes a drag handle (GripVertical). On drag end, calls
 * onReorder with the new id order.
 *
 * Render strategy: rectSortingStrategy supports both single-column and
 * multi-column (e.g. 2-col grid) layouts — the parent decides layout via
 * the wrapper className; this component only owns the drag wiring.
 */

import { useState, type ReactNode } from 'react'
import {
  DndContext,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  closestCorners,
  type DragEndEvent,
} from '@dnd-kit/core'
import {
  SortableContext,
  sortableKeyboardCoordinates,
  arrayMove,
  useSortable,
  rectSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { GripVertical } from 'lucide-react'
import { useTranslation } from '../../i18n'
import type { Space } from '../../types'

interface SortableSpaceListProps {
  items: Space[]
  onReorder: (spaceIds: string[]) => void
  /** Render the row body for a single space. The drag handle is provided separately. */
  renderItem: (space: Space) => ReactNode
  /** Class applied to the list wrapper (controls layout: grid/flex/cols). */
  className?: string
  /** Class applied to each row wrapper (excludes the handle). */
  itemClassName?: string
  /** Whether to show the drag handle (default true). */
  showHandle?: boolean
}

export function SortableSpaceList({
  items,
  onReorder,
  renderItem,
  className,
  itemClassName,
  showHandle = true,
}: SortableSpaceListProps) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  )
  const [activeId, setActiveId] = useState<string | null>(null)

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event
    setActiveId(null)
    if (!over || active.id === over.id) return
    const oldIndex = items.findIndex(s => s.id === active.id)
    const newIndex = items.findIndex(s => s.id === over.id)
    if (oldIndex === -1 || newIndex === -1) return
    const next = arrayMove(items, oldIndex, newIndex)
    onReorder(next.map(s => s.id))
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragStart={(e) => setActiveId(String(e.active.id))}
      onDragEnd={handleDragEnd}
      onDragCancel={() => setActiveId(null)}
    >
      <SortableContext items={items.map(s => s.id)} strategy={rectSortingStrategy}>
        <div className={className}>
          {items.map(space => (
            <SortableSpaceRow
              key={space.id}
              space={space}
              isDragging={activeId === space.id}
              renderItem={renderItem}
              itemClassName={itemClassName}
              showHandle={showHandle}
            />
          ))}
        </div>
      </SortableContext>
    </DndContext>
  )
}

interface SortableSpaceRowProps {
  space: Space
  isDragging: boolean
  renderItem: (space: Space) => ReactNode
  itemClassName?: string
  showHandle: boolean
}

function SortableSpaceRow({
  space,
  isDragging,
  renderItem,
  itemClassName,
  showHandle,
}: SortableSpaceRowProps) {
  const { t } = useTranslation()
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging: isSortableDragging,
  } = useSortable({ id: space.id })

  const dragging = isDragging || isSortableDragging

  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
      }}
      className={itemClassName}
    >
      <div className={`flex items-stretch ${dragging ? 'opacity-60 ring-2 ring-primary/50 rounded-lg' : ''}`}>
        {showHandle && (
          <button
            type="button"
            className="flex items-center justify-center px-1 cursor-grab active:cursor-grabbing text-muted-foreground hover:text-foreground touch-none"
            aria-label={t('Drag to reorder')}
            {...attributes}
            {...listeners}
          >
            <GripVertical className="w-4 h-4" />
          </button>
        )}
        <div className="flex-1 min-w-0">{renderItem(space)}</div>
      </div>
    </div>
  )
}
