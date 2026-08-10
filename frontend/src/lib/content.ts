export const extractMarkdownImageUrls = (content: string): string[] => {
  return Array.from(content.matchAll(/!\[.*?\]\((https?:\/\/[^)]+)\)/g)).map((match) => match[1]);
};

export const stripMarkdownImageSyntax = (content: string): string => {
  return content.replace(/!\[.*?\]\((https?:\/\/[^)]+)\)/g, '').trim();
};

export const stripTagSyntax = (content: string): string => {
  // Preserve code blocks, only strip tags from non-code text
  return content
    .replace(/(```[\s\S]*?```|`[^`\n]+`)|(?:^|\s)#[\p{L}\p{N}_\-/]+[\p{L}\p{N}_-]/gu, (match, code) => code ?? '')
    .replace(/^\s+/, '').replace(/\s+$/, '').replace(/\n{3,}/g, '\n\n');
};

/**
 * Plain-text fallback for the lazy Markdown renderer.  Raw HTML is disabled
 * by SafeMarkdown; the fallback must not echo executable-looking tags while
 * the renderer chunk is loading either.
 */
export const stripHtmlTags = (content: string): string => content
  .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
  .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '')
  .replace(/<!--[\s\S]*?-->/g, '')
  .replace(/<\/?[a-z][^>]*>/gi, '');

export const shouldRenderMarkdown = (content: string): boolean => {
  return /(^|\s)(#{1,6}\s|[-*+]\s|\d+\.\s|>|```)|[*_~`[\]<]|!\[.*?\]\(https?:\/\/[^)]+\)|\[[^\]]+\]\([^)]+\)/m.test(content);
};
