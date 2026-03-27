export const extractMarkdownImageUrls = (content: string): string[] => {
  return Array.from(content.matchAll(/!\[.*?\]\((https?:\/\/[^)]+)\)/g)).map((match) => match[1]);
};

export const stripMarkdownImageSyntax = (content: string): string => {
  return content.replace(/!\[.*?\]\((https?:\/\/[^)]+)\)/g, '').trim();
};

export const stripTagSyntax = (content: string): string => {
  return content.replace(/(^|\s)#[\p{L}\p{N}_\-/]+[\p{L}\p{N}_-]/gu, '$1').replace(/^\s+/, '').replace(/\s+$/, '').replace(/\n{3,}/g, '\n\n');
};
