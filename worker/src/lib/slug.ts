import { customAlphabet } from 'nanoid';

const nanoid = customAlphabet('abcdefghijklmnopqrstuvwxyz0123456789', 6);

export const createMemoSlug = () => {
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  return `${date}-${nanoid()}`;
};
