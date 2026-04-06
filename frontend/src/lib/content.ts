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
