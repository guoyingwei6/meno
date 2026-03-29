const RECENT_TAGS_KEY = 'meno:recent-tags';

export function getRecentTags(): string[] {
  try { return JSON.parse(localStorage.getItem(RECENT_TAGS_KEY) ?? '[]'); } catch { return []; }
}

export function recordRecentTag(tag: string): void {
  const recent = getRecentTags().filter((t) => t !== tag);
  recent.unshift(tag);
  localStorage.setItem(RECENT_TAGS_KEY, JSON.stringify(recent.slice(0, 30)));
}

/**
 * 返回光标相对于 container 元素的 {top, left} 坐标（用于 position: absolute 的 dropdown）。
 * container 必须是 textarea 的祖先且 position 不为 static。
 */
export function getCaretCoords(
  ta: HTMLTextAreaElement,
  container: HTMLElement,
): { top: number; left: number } {
  const pos = ta.selectionStart ?? 0;
  const computed = window.getComputedStyle(ta);

  const mirror = document.createElement('div');
  Object.assign(mirror.style, {
    position: 'fixed',
    top: '0',
    left: '-9999px',
    width: computed.width,
    fontFamily: computed.fontFamily,
    fontSize: computed.fontSize,
    fontWeight: computed.fontWeight,
    lineHeight: computed.lineHeight,
    letterSpacing: computed.letterSpacing,
    paddingTop: computed.paddingTop,
    paddingRight: computed.paddingRight,
    paddingBottom: computed.paddingBottom,
    paddingLeft: computed.paddingLeft,
    borderTopWidth: computed.borderTopWidth,
    borderRightWidth: computed.borderRightWidth,
    borderBottomWidth: computed.borderBottomWidth,
    borderLeftWidth: computed.borderLeftWidth,
    boxSizing: computed.boxSizing,
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-word',
    overflowWrap: 'break-word',
  });

  const text = document.createTextNode(ta.value.slice(0, pos));
  const marker = document.createElement('span');
  marker.textContent = '\u200b';
  mirror.appendChild(text);
  mirror.appendChild(marker);
  document.body.appendChild(mirror);

  const containerRect = container.getBoundingClientRect();
  const taRect = ta.getBoundingClientRect();
  const markerRect = marker.getBoundingClientRect();
  const mirrorRect = mirror.getBoundingClientRect();
  document.body.removeChild(mirror);

  const lineHeight = parseFloat(computed.lineHeight) || 22;
  // caret's offset within textarea content (mirror starts at top:0 so mirrorRect.top=0)
  const caretY = markerRect.top - mirrorRect.top;
  const caretX = markerRect.left - mirrorRect.left;

  // position relative to container
  const top = (taRect.top - containerRect.top) + caretY - ta.scrollTop + lineHeight;
  const left = Math.min(
    (taRect.left - containerRect.left) + caretX,
    containerRect.width - 220,
  );

  return { top: Math.max(0, top), left: Math.max(0, left) };
}
