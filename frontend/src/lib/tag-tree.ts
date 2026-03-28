export interface TagTreeChild {
  name: string;
  count: number;
}

export interface TagTreeGroup {
  label: string;
  children: TagTreeChild[];
  count: number;
}

export interface TagTreeResult {
  groups: TagTreeGroup[];
  flat: TagTreeChild[];
}

export const buildTagTree = (tags: string[] | Array<{ tag: string; count: number }>): TagTreeResult => {
  const groups = new Map<string, Map<string, number>>();
  const flat: Map<string, number> = new Map();

  for (const item of tags) {
    const rawTag = typeof item === 'string' ? item : item.tag;
    const rawCount = typeof item === 'string' ? 1 : item.count;
    const slashIndex = rawTag.indexOf('/');

    if (slashIndex === -1) {
      flat.set(rawTag, (flat.get(rawTag) ?? 0) + rawCount);
      continue;
    }

    const parent = rawTag.slice(0, slashIndex);
    const child = rawTag.slice(slashIndex + 1);
    if (!parent || !child) {
      flat.set(rawTag, (flat.get(rawTag) ?? 0) + rawCount);
      continue;
    }

    const childMap = groups.get(parent) ?? new Map<string, number>();
    childMap.set(child, (childMap.get(child) ?? 0) + rawCount);
    groups.set(parent, childMap);
  }

  const groupList: TagTreeGroup[] = Array.from(groups.entries())
    .map(([label, childMap]) => {
      const children = Array.from(childMap.entries())
        .map(([name, count]) => ({ name, count }))
        .sort((a, b) => a.name.localeCompare(b.name));
      return {
        label,
        children,
        count: children.reduce((sum, c) => sum + c.count, 0),
      };
    })
    .sort((a, b) => a.label.localeCompare(b.label));

  const flatList: TagTreeChild[] = Array.from(flat.entries())
    .filter(([name]) => !groups.has(name))
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => a.name.localeCompare(b.name));

  return { groups: groupList, flat: flatList };
};
