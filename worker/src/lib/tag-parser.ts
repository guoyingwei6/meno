export const parseTags = (content: string): string[] => {
  return Array.from(
    new Set(
      Array.from(content.matchAll(/(^|\s)#([\p{L}\p{N}_\-/]+[\p{L}\p{N}_-])/gu)).map((match) => match[2]),
    ),
  );
};
