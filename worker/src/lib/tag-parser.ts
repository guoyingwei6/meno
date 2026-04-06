export const parseTags = (content: string): string[] => {
  // Strip fenced code blocks and inline code before extracting tags
  const stripped = content.replace(/```[\s\S]*?```/g, '').replace(/`[^`\n]+`/g, '');
  return Array.from(
    new Set(
      Array.from(stripped.matchAll(/(^|\s)#([\p{L}\p{N}_\-/]+[\p{L}\p{N}_-])/gu)).map((match) => match[2]),
    ),
  );
};
