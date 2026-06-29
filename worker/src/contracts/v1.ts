import type { MemoVisibility } from '../../../shared/src/types';

export interface V1CreateMemoRequest {
  content: string;
  visibility?: MemoVisibility;
  displayDate?: string;
}

export interface V1UpdateMemoRequest {
  content?: string;
  visibility?: MemoVisibility;
  displayDate?: string;
}

export type V1MemoVisibilityFilter = 'all' | MemoVisibility | 'trash';

const datePattern = /^\d{4}-\d{2}-\d{2}$/;

export class ContractError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ContractError';
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
};

const parseVisibility = (value: unknown): MemoVisibility | undefined => {
  if (value === undefined) {
    return undefined;
  }
  if (value === 'public' || value === 'private') {
    return value;
  }
  throw new ContractError('visibility must be public or private');
};

const parseDisplayDate = (value: unknown): string | undefined => {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value === 'string' && datePattern.test(value)) {
    return value;
  }
  throw new ContractError('displayDate must use YYYY-MM-DD format');
};

export const parseCreateMemoRequest = (value: unknown): Required<V1CreateMemoRequest> => {
  if (!isRecord(value)) {
    throw new ContractError('request body must be an object');
  }

  const content = typeof value.content === 'string' ? value.content.trim() : '';
  if (!content) {
    throw new ContractError('content is required');
  }

  return {
    content,
    visibility: parseVisibility(value.visibility) ?? 'public',
    displayDate: parseDisplayDate(value.displayDate) ?? new Date().toISOString().slice(0, 10),
  };
};

export const parseUpdateMemoRequest = (value: unknown): V1UpdateMemoRequest => {
  if (!isRecord(value)) {
    throw new ContractError('request body must be an object');
  }

  const input: V1UpdateMemoRequest = {};
  if (value.content !== undefined) {
    if (typeof value.content !== 'string' || !value.content.trim()) {
      throw new ContractError('content must be a non-empty string');
    }
    input.content = value.content.trim();
  }
  if (value.visibility !== undefined) {
    input.visibility = parseVisibility(value.visibility);
  }
  if (value.displayDate !== undefined) {
    input.displayDate = parseDisplayDate(value.displayDate);
  }

  if (Object.keys(input).length === 0) {
    throw new ContractError('at least one field is required');
  }

  return input;
};

export const parseVisibilityFilter = (value: string | undefined): V1MemoVisibilityFilter => {
  const candidate = value || 'public';
  if (candidate === 'all' || candidate === 'public' || candidate === 'private' || candidate === 'trash') {
    return candidate;
  }
  throw new ContractError('visibility filter must be all, public, private, or trash');
};
