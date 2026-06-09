import { useCallback, useEffect, useRef, useState } from 'react';

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

const LONG_PRESS_MS = 450;
const SCROLL_CANCEL_PX = 10;

export const reorderSortableItems = <T,>(items: T[], from: number, to: number): T[] => {
  if (from === to) return items;
  const next = [...items];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
};

// Inject CSS once — ensures -webkit-touch-callout works across Safari versions
let cssInjected = false;
function ensureCSS() {
  if (cssInjected || typeof document === 'undefined') return;
  cssInjected = true;
  const s = document.createElement('style');
  s.textContent = `
    [data-sortable-item] {
      -webkit-touch-callout: none !important;
      -webkit-user-select: none !important;
      user-select: none !important;
      touch-action: none !important;
    }
  `;
  document.head.appendChild(s);
}

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

  const itemsRef = useRef(items);
  const onReorderRef = useRef(onReorder);
  const onPreviewRef = useRef(onPreview);
  useEffect(() => { itemsRef.current = items; }, [items]);
  useEffect(() => { onReorderRef.current = onReorder; }, [onReorder]);
  useEffect(() => { onPreviewRef.current = onPreview; }, [onPreview]);

  const dragRef = useRef<{
    id: string;
    startX: number;
    startY: number;
    mode: 'mouse' | 'touch' | 'pen';
    active: boolean;
    moved: boolean;
    longPressTimer: ReturnType<typeof setTimeout> | null;
  } | null>(null);

  const ghostRef = useRef<HTMLDivElement | null>(null);
  const cleanupRef = useRef<(() => void) | null>(null);
  const suppressClickRef = useRef(false);

  useEffect(() => {
    ensureCSS();
    return () => { cleanupRef.current?.(); };
  }, []);

  const containerRef = useRef<HTMLDivElement | null>(null);

  const removeGhost = () => {
    if (ghostRef.current) {
      ghostRef.current.remove();
      ghostRef.current = null;
    }
  };

  const createGhost = (imgUrl: string, x: number, y: number) => {
    removeGhost();
    const g = document.createElement('div');
    g.style.cssText = [
      'position:fixed',
      `left:${x - 40}px`,
      `top:${y - 40}px`,
      'width:80px',
      'height:80px',
      `background-image:url(${imgUrl})`,
      'background-size:cover',
      'background-position:center',
      'border-radius:8px',
      'opacity:0.85',
      'pointer-events:none',
      'z-index:99999',
      'box-shadow:0 6px 24px rgba(0,0,0,0.28)',
      'transform:scale(1.1)',
      'transition:none',
    ].join(';');
    document.body.appendChild(g);
    ghostRef.current = g;
  };

  const moveGhost = (x: number, y: number) => {
    if (!ghostRef.current) return;
    ghostRef.current.style.left = `${x - 40}px`;
    ghostRef.current.style.top = `${y - 40}px`;
  };

  const tryReorder = useCallback((id: string, clientX: number, clientY: number) => {
    const el = document.elementFromPoint(clientX, clientY);
    if (!(el instanceof HTMLElement)) return;
    const targetEl = el.closest<HTMLElement>('[data-sortable-item]');
    const targetId = targetEl?.dataset.sortableItem;
    if (!targetId || targetId === id) return;
    const cur = itemsRef.current;
    const from = cur.findIndex((item) => item.id === id);
    const to = cur.findIndex((item) => item.id === targetId);
    if (from === -1 || to === -1 || from === to) return;
    const next = reorderSortableItems(cur, from, to);
    itemsRef.current = next;
    onReorderRef.current(next);
  }, []);

  const endDrag = useCallback((committed = true) => {
    const drag = dragRef.current;
    if (drag?.longPressTimer) clearTimeout(drag.longPressTimer);
    suppressClickRef.current = committed && !!(drag?.active && drag?.moved);
    removeGhost();
    cleanupRef.current?.();
    dragRef.current = null;
    setDraggingId(null);
  }, []);

  const startDrag = useCallback((id: string, imgUrl: string, clientX: number, clientY: number, mode: 'mouse' | 'touch' | 'pen') => {
    cleanupRef.current?.();

    const needsLongPress = mode === 'touch' || mode === 'pen';
    dragRef.current = {
      id,
      startX: clientX,
      startY: clientY,
      mode,
      active: !needsLongPress,
      moved: false,
      longPressTimer: null,
    };

    if (needsLongPress) {
      dragRef.current.longPressTimer = setTimeout(() => {
        const drag = dragRef.current;
        if (drag?.id === id && !drag.moved) {
          drag.active = true;
          drag.longPressTimer = null;
          createGhost(imgUrl, clientX, clientY);
          setDraggingId(id);
        }
      }, LONG_PRESS_MS);
    } else {
      createGhost(imgUrl, clientX, clientY);
      setDraggingId(id);
    }

    const onMove = (clientXMove: number, clientYMove: number, preventDefault?: () => void) => {
      const drag = dragRef.current;
      if (!drag) return;
      const dx = Math.abs(clientXMove - drag.startX);
      const dy = Math.abs(clientYMove - drag.startY);
      if (!drag.moved && (dx > SCROLL_CANCEL_PX || dy > SCROLL_CANCEL_PX)) {
        drag.moved = true;
        if (drag.mode !== 'mouse' && !drag.active) {
          endDrag(false);
          return;
        }
      }
      if (drag.active) {
        preventDefault?.();
        moveGhost(clientXMove, clientYMove);
        tryReorder(drag.id, clientXMove, clientYMove);
      }
    };

    const onMouseMove = (e: MouseEvent) => {
      onMove(e.clientX, e.clientY, () => e.preventDefault());
    };

    const onPointerMove = (e: PointerEvent) => {
      onMove(e.clientX, e.clientY, () => e.preventDefault());
    };

    const onTouchMove = (e: TouchEvent) => {
      const t = e.touches[0];
      if (!t) return;
      onMove(t.clientX, t.clientY, () => e.preventDefault());
    };

    const cleanup = () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointercancel', onPointerCancel);
      window.removeEventListener('touchmove', onTouchMove);
      window.removeEventListener('touchend', onTouchEnd);
      window.removeEventListener('touchcancel', onTouchEnd);
      cleanupRef.current = null;
    };

    const onMouseUp = () => endDrag(true);
    const onPointerUp = () => endDrag(true);
    const onPointerCancel = () => endDrag(false);
    const onTouchEnd = () => endDrag(true);

    if (mode === 'mouse') {
      window.addEventListener('mousemove', onMouseMove);
      window.addEventListener('mouseup', onMouseUp);
    } else if (mode === 'pen') {
      window.addEventListener('pointermove', onPointerMove);
      window.addEventListener('pointerup', onPointerUp);
      window.addEventListener('pointercancel', onPointerCancel);
    } else {
      window.addEventListener('touchmove', onTouchMove, { passive: false });
      window.addEventListener('touchend', onTouchEnd);
      window.addEventListener('touchcancel', onTouchEnd);
    }
    cleanupRef.current = cleanup;
  }, [endDrag, tryReorder]);

  return (
    <div
      ref={containerRef}
      style={{ display: 'flex', flexWrap: 'wrap', gap: 8, padding: '4px 20px 8px', ...containerStyle }}
      onContextMenu={(e) => {
        if ((e.target as HTMLElement).closest('[data-sortable-item]')) e.preventDefault();
      }}
    >
      {items.map((item, index) => {
        const isDragging = draggingId === item.id;
        return (
          <div
            key={item.id}
            data-testid={`sortable-image-item-${item.id}`}
            data-sortable-item={item.id}
            style={{
              position: 'relative',
              width: 80,
              height: 80,
              borderRadius: 8,
              cursor: isDragging ? 'grabbing' : 'grab',
              // Dragging item becomes a dimmed placeholder; the ghost follows cursor
              opacity: isDragging ? 0.3 : 1,
              outline: isDragging ? '2px dashed #999' : 'none',
              transition: isDragging ? 'none' : 'opacity 0.15s',
              ...itemStyle,
            }}
            onPointerDown={(e) => {
              if ((e.target as HTMLElement).closest('button')) return;
              if (e.pointerType !== 'pen') return;
              e.preventDefault();
              startDrag(item.id, item.url, e.clientX, e.clientY, 'pen');
            }}
            onMouseDown={(e) => {
              if ((e.target as HTMLElement).closest('button')) return;
              if (e.button !== 0) return;
              startDrag(item.id, item.url, e.clientX, e.clientY, 'mouse');
            }}
            onTouchStart={(e) => {
              if ((e.target as HTMLElement).closest('button')) return;
              const touch = e.touches[0];
              if (!touch) return;
              e.preventDefault();
              startDrag(item.id, item.url, touch.clientX, touch.clientY, 'touch');
            }}
            onDragStart={(e) => e.preventDefault()}
            onClick={() => {
              if (suppressClickRef.current) { suppressClickRef.current = false; return; }
              onPreviewRef.current?.(index);
            }}
          >
            <div
              role="img"
              aria-label={item.alt || item.name}
              style={{
                width: '100%',
                height: '100%',
                backgroundImage: `url(${item.url})`,
                backgroundSize: 'cover',
                backgroundPosition: 'center',
                borderRadius: 8,
                backgroundColor: '#f5f5f5',
                pointerEvents: 'none',
                ...thumbStyle,
              }}
            />
            {index > 0 && (
              <button
                type="button"
                aria-label={`上移 ${item.name}`}
                style={{
                  position: 'absolute',
                  bottom: 6,
                  left: 6,
                  minWidth: 34,
                  height: 22,
                  borderRadius: 999,
                  border: 'none',
                  background: 'rgba(0,0,0,0.55)',
                  color: '#fff',
                  cursor: 'pointer',
                  fontSize: 11,
                  fontWeight: 700,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  padding: '0 8px',
                }}
                onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) => { e.stopPropagation(); onReorder(reorderSortableItems(items, index, index - 1)); }}
              >
                上移
              </button>
            )}
            {index < items.length - 1 && (
              <button
                type="button"
                aria-label={`下移 ${item.name}`}
                style={{
                  position: 'absolute',
                  bottom: 6,
                  left: index > 0 ? 46 : 6,
                  minWidth: 34,
                  height: 22,
                  borderRadius: 999,
                  border: 'none',
                  background: 'rgba(0,0,0,0.55)',
                  color: '#fff',
                  cursor: 'pointer',
                  fontSize: 11,
                  fontWeight: 700,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  padding: '0 8px',
                }}
                onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) => { e.stopPropagation(); onReorder(reorderSortableItems(items, index, index + 1)); }}
              >
                下移
              </button>
            )}
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
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => { e.stopPropagation(); onRemove(index); }}
            >
              ✕
            </button>
          </div>
        );
      })}
    </div>
  );
};
