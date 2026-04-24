import { useEffect, useRef, useState } from 'react';

export interface SortableImagePreviewItem {
  id: string;
  url: string;
  name: string;
  alt?: string;
}

interface SortableImagePreviewListProps {
  items: SortableImagePreviewItem[];
  onReorder: (items: SortableImagePreviewItem[]) => void;
  onRemove: (index: number) => void;
  onPreview?: (index: number) => void;
  containerStyle?: React.CSSProperties;
  itemStyle?: React.CSSProperties;
  thumbStyle?: React.CSSProperties;
  removeButtonStyle?: React.CSSProperties;
}

interface DragGesture {
  activeId: string;
  originX: number;
  originY: number;
  pointerId: number;
  moved: boolean;
}

const DRAG_THRESHOLD_PX = 6;

export const reorderSortableItems = <T,>(items: T[], fromIndex: number, toIndex: number): T[] => {
  if (fromIndex === toIndex) return items;
  const next = [...items];
  const [item] = next.splice(fromIndex, 1);
  next.splice(toIndex, 0, item);
  return next;
};

export const SortableImagePreviewList = ({
  items,
  onReorder,
  onRemove,
  onPreview,
  containerStyle,
  itemStyle,
  thumbStyle,
  removeButtonStyle,
}: SortableImagePreviewListProps) => {
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const gestureRef = useRef<DragGesture | null>(null);
  const itemsRef = useRef(items);
  const onReorderRef = useRef(onReorder);
  const cleanupListenersRef = useRef<(() => void) | null>(null);
  const suppressClickRef = useRef(false);

  useEffect(() => {
    itemsRef.current = items;
  }, [items]);

  useEffect(() => {
    onReorderRef.current = onReorder;
  }, [onReorder]);

  useEffect(() => () => {
    cleanupListenersRef.current?.();
  }, []);

  const moveActiveItem = (activeId: string, targetId: string) => {
    const currentItems = itemsRef.current;
    const fromIndex = currentItems.findIndex((item) => item.id === activeId);
    const toIndex = currentItems.findIndex((item) => item.id === targetId);
    if (fromIndex === -1 || toIndex === -1) return;
    if (fromIndex === toIndex) return;
    onReorderRef.current(reorderSortableItems(currentItems, fromIndex, toIndex));
  };

  const finishGesture = () => {
    cleanupListenersRef.current?.();
    cleanupListenersRef.current = null;
    const moved = gestureRef.current?.moved ?? false;
    suppressClickRef.current = moved;
    gestureRef.current = null;
    setDraggingId(null);
  };

  const markGestureMoved = (clientX: number, clientY: number) => {
    const gesture = gestureRef.current;
    if (!gesture) return;
    const movedEnough = Math.abs(clientX - gesture.originX) >= DRAG_THRESHOLD_PX || Math.abs(clientY - gesture.originY) >= DRAG_THRESHOLD_PX;
    if (!movedEnough && !gesture.moved) return;
    gesture.moved = true;
  };

  const beginGesture = (activeId: string, clientX: number, clientY: number, pointerId: number) => {
    cleanupListenersRef.current?.();
    gestureRef.current = {
      activeId,
      originX: clientX,
      originY: clientY,
      pointerId,
      moved: false,
    };
    setDraggingId(activeId);

    const onPointerMove = (event: PointerEvent) => {
      if (event.pointerId !== gestureRef.current?.pointerId) return;
      markGestureMoved(event.clientX, event.clientY);
    };
    const onPointerUp = (event: PointerEvent) => {
      if (event.pointerId !== gestureRef.current?.pointerId) return;
      finishGesture();
    };
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerUp);
    cleanupListenersRef.current = () => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointercancel', onPointerUp);
    };
  };

  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, padding: '4px 20px 8px', ...containerStyle }}>
      {items.map((item, index) => (
        <div
          key={item.id}
          data-testid={`sortable-image-item-${item.id}`}
          data-image-id={item.id}
          style={{
            position: 'relative',
            width: 80,
            height: 80,
            borderRadius: 8,
            touchAction: 'none',
            cursor: draggingId === item.id ? 'grabbing' : 'grab',
            opacity: draggingId === item.id ? 0.9 : 1,
            ...itemStyle,
          }}
          onPointerDown={(event) => {
            if (event.button !== 0 && event.pointerType === 'mouse') return;
            beginGesture(item.id, event.clientX, event.clientY, event.pointerId);
            event.currentTarget.setPointerCapture?.(event.pointerId);
          }}
          onPointerMove={(event) => {
            const gesture = gestureRef.current;
            if (!gesture || gesture.pointerId !== event.pointerId) return;
            markGestureMoved(event.clientX, event.clientY);
            if (!gestureRef.current?.moved) return;
            moveActiveItem(gesture.activeId, item.id);
          }}
          onPointerEnter={(event) => {
            const gesture = gestureRef.current;
            if (!gesture || gesture.pointerId !== event.pointerId || !gesture.moved) return;
            moveActiveItem(gesture.activeId, item.id);
          }}
          onPointerUp={(event) => {
            if (event.pointerId !== gestureRef.current?.pointerId) return;
            finishGesture();
          }}
          onClick={() => {
            if (suppressClickRef.current) {
              suppressClickRef.current = false;
              return;
            }
            onPreview?.(index);
          }}
        >
          <img
            src={item.url}
            alt={item.alt || item.name}
            draggable={false}
            style={{
              width: '100%',
              height: '100%',
              objectFit: 'cover',
              borderRadius: 8,
              background: '#f5f5f5',
              display: 'block',
              userSelect: 'none',
              pointerEvents: 'none',
              ...thumbStyle,
            }}
          />
          <div
            aria-hidden="true"
            style={{
              position: 'absolute',
              left: 6,
              bottom: 6,
              padding: '2px 6px',
              borderRadius: 999,
              background: 'rgba(0,0,0,0.55)',
              color: '#fff',
              fontSize: 10,
              lineHeight: 1.2,
              pointerEvents: 'none',
            }}
          >
            拖动排序
          </div>
          {index > 0 ? (
            <button
              type="button"
              aria-label={`左移 ${item.name}`}
              style={{
                position: 'absolute',
                top: 6,
                left: 6,
                width: 18,
                height: 18,
                borderRadius: '50%',
                border: 'none',
                background: 'rgba(0,0,0,0.55)',
                color: '#fff',
                cursor: 'pointer',
                fontSize: 11,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                padding: 0,
              }}
              onPointerDown={(event) => event.stopPropagation()}
              onClick={(event) => {
                event.stopPropagation();
                onReorder(reorderSortableItems(items, index, index - 1));
              }}
            >
              ‹
            </button>
          ) : null}
          {index < items.length - 1 ? (
            <button
              type="button"
              aria-label={`右移 ${item.name}`}
              style={{
                position: 'absolute',
                top: 6,
                left: index > 0 ? 28 : 6,
                width: 18,
                height: 18,
                borderRadius: '50%',
                border: 'none',
                background: 'rgba(0,0,0,0.55)',
                color: '#fff',
                cursor: 'pointer',
                fontSize: 11,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                padding: 0,
              }}
              onPointerDown={(event) => event.stopPropagation()}
              onClick={(event) => {
                event.stopPropagation();
                onReorder(reorderSortableItems(items, index, index + 1));
              }}
            >
              ›
            </button>
          ) : null}
          <button
            type="button"
            aria-label={`删除 ${item.name}`}
            style={{
              position: 'absolute',
              top: -6,
              right: -6,
              width: 20,
              height: 20,
              borderRadius: '50%',
              background: 'rgba(0,0,0,0.5)',
              color: '#fff',
              border: 'none',
              cursor: 'pointer',
              fontSize: 11,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              lineHeight: 1,
              padding: 0,
              ...removeButtonStyle,
            }}
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => {
              event.stopPropagation();
              onRemove(index);
            }}
          >
            ✕
          </button>
        </div>
      ))}
    </div>
  );
};
