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
 * 返回光标在视口中的 {top, left} 坐标，用于 position:fixed 的 dropdown。
 * position:fixed 天然逃出 overflow:hidden，无需传 container。
 */
export function getCaretCoords(ta: HTMLTextAreaElement): { top: number; left: number } {
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

  const taRect = ta.getBoundingClientRect();
  const markerRect = marker.getBoundingClientRect();
  const mirrorRect = mirror.getBoundingClientRect();
  document.body.removeChild(mirror);

  const lineHeight = parseFloat(computed.lineHeight) || 22;
  // mirrorRect.top=0, mirrorRect.left=-9999 (fixed)
  // markerRect.top = caret's Y offset in content
  // markerRect.left - mirrorRect.left = caret's X offset in content
  const caretY = markerRect.top - mirrorRect.top;   // = markerRect.top
  const caretX = markerRect.left - mirrorRect.left; // = markerRect.left + 9999

  const top = taRect.top + caretY - ta.scrollTop + lineHeight;
  const left = Math.min(taRect.left + caretX, window.innerWidth - 240);

  return { top: Math.max(0, top), left: Math.max(0, left) };
}
