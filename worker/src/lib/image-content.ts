export const extractMarkdownImageUrls = (content: string): string[] => {
  return Array.from(content.matchAll(/!\[.*?\]\((https?:\/\/[^)]+)\)/g)).map((match) => match[1]);
};

export const stripMarkdownImageSyntax = (content: string): string => {
  return content.replace(/!\[.*?\]\((https?:\/\/[^)]+)\)/g, '').trim();
};
