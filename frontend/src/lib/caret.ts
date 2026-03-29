/** 返回 textarea 光标在视口中的 {top, left} 坐标（dropdown 应出现在 top 下方） */
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

  // Text before caret
  const text = document.createTextNode(ta.value.slice(0, pos));
  const marker = document.createElement('span');
  marker.textContent = '\u200b'; // zero-width space as anchor
  mirror.appendChild(text);
  mirror.appendChild(marker);
  document.body.appendChild(mirror);

  const taRect = ta.getBoundingClientRect();
  const markerRect = marker.getBoundingClientRect();
  const mirrorRect = mirror.getBoundingClientRect();
  document.body.removeChild(mirror);

  const lineHeight = parseFloat(computed.lineHeight) || 22;

  return {
    // position below the caret line, accounting for textarea scroll
    top: taRect.top + (markerRect.top - mirrorRect.top) - ta.scrollTop + lineHeight,
    // clamp so dropdown doesn't overflow right edge
    left: Math.min(
      taRect.left + (markerRect.left - mirrorRect.left),
      window.innerWidth - 220,
    ),
  };
}
