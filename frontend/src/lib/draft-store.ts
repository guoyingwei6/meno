/**
 * Small IndexedDB-backed store for the Quick Capture draft.  The store keeps
 * binary attachments as Blob values (structured clone) instead of only
 * keeping temporary object URLs.  A memory fallback keeps the composer usable
 * in browsers without IndexedDB and in the jsdom test environment.
 */

export interface DraftImageRecord {
  name: string;
  /** Stable asset idempotency key for re-uploading this attachment. */
  clientId?: string;
  /** The server URL, when the upload has already completed. */
  url?: string;
  blob?: Blob;
}

export interface DraftAudioRecord {
  blob: Blob;
  durationMs: number;
  mimeType: string;
}

export interface MemoDraftRecord {
  id: string;
  /** Stable idempotency key reused when this draft is retried. */
  clientId?: string;
  content: string;
  displayDate: string;
  visibility: 'public' | 'private';
  tags: string[];
  images: DraftImageRecord[];
  audio: DraftAudioRecord | null;
  transcriptText: string;
  updatedAt: number;
}

export type OutboxStatus = 'pending' | 'sending' | 'synced' | 'failed';

export interface MemoOutboxRecord {
  id: string;
  draft: MemoDraftRecord;
  status: OutboxStatus;
  attempts: number;
  lastError?: string;
  /** Owner token for an in-flight replay claim. */
  claimId?: string;
  /** A crashed tab must not leave an item permanently stuck in `sending`. */
  leaseExpiresAt?: number;
  /** Successful records are kept as a local idempotency tombstone. */
  syncedAt?: number;
  createdAt: number;
  updatedAt: number;
}

const DATABASE_NAME = 'meno-quick-capture';
const DATABASE_VERSION = 3;
const STORE_NAME = 'drafts';
const OUTBOX_STORE_NAME = 'outbox';
const OUTBOX_CLIENT_ID_INDEX = 'by-draft-client-id';
const TAB_DRAFT_KEY = 'meno:quick-capture:draft-id';
const OUTBOX_CLAIM_LEASE_MS = 60_000;
const memoryDrafts = new Map<string, MemoDraftRecord>();
const memoryOutbox = new Map<string, MemoOutboxRecord>();
const draftsPendingPersistence = new Set<string>();
const outboxPendingPersistence = new Set<string>();

const getStorage = (): Storage | null => {
  try {
    return typeof sessionStorage === 'undefined' ? null : sessionStorage;
  } catch {
    return null;
  }
};

const createDraftId = (): string => {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
  } catch {
    // Fall through to the timestamp/random fallback for older browsers.
  }
  return `tab-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
};

/** Every browser tab gets one stable draft key through tab-scoped storage. */
export const getTabDraftId = (): string => {
  const storage = getStorage();
  if (!storage) return createDraftId();
  try {
    const existing = storage.getItem(TAB_DRAFT_KEY);
    if (existing) return existing;
    const next = createDraftId();
    storage.setItem(TAB_DRAFT_KEY, next);
    return next;
  } catch {
    return createDraftId();
  }
};

const canUseIndexedDb = () => typeof indexedDB !== 'undefined';

const getOutboxClientId = (record: Pick<MemoOutboxRecord, 'id' | 'draft'>): string => record.draft.clientId ?? record.id;

const isLiveClaim = (record: MemoOutboxRecord, now: number): boolean => (
  record.status === 'sending' && (record.leaseExpiresAt ?? 0) > now
);

const sortOutbox = (records: MemoOutboxRecord[], includeSynced: boolean): MemoOutboxRecord[] => records
  .filter((record) => includeSynced || record.status !== 'synced')
  .sort((a, b) => a.updatedAt - b.updatedAt);

const openDatabase = (): Promise<IDBDatabase> => new Promise((resolve, reject) => {
  if (!canUseIndexedDb()) {
    reject(new Error('IndexedDB is unavailable'));
    return;
  }

  const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
  request.onerror = () => reject(request.error ?? new Error('Unable to open draft database'));
  request.onupgradeneeded = () => {
    const database = request.result;
    if (!database.objectStoreNames.contains(STORE_NAME)) {
      database.createObjectStore(STORE_NAME, { keyPath: 'id' });
    }
    let outboxStore: IDBObjectStore | null = null;
    if (!database.objectStoreNames.contains(OUTBOX_STORE_NAME)) {
      outboxStore = database.createObjectStore(OUTBOX_STORE_NAME, { keyPath: 'id' });
    } else if (request.transaction) {
      // Existing v2 databases are upgraded in a versionchange transaction;
      // using that transaction preserves every draft and outbox record while
      // adding the index without copying or rewriting the store.
      outboxStore = request.transaction.objectStore(OUTBOX_STORE_NAME);
    }
    if (outboxStore && !outboxStore.indexNames.contains(OUTBOX_CLIENT_ID_INDEX)) {
      outboxStore.createIndex(OUTBOX_CLIENT_ID_INDEX, 'draft.clientId', { unique: false });
    }
  };
  request.onsuccess = () => resolve(request.result);
});

const withStore = async <T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>, storeName = STORE_NAME): Promise<T> => {
  const database = await openDatabase();
  return new Promise<T>((resolve, reject) => {
    const transaction = database.transaction(storeName, mode);
    let result!: T;
    let settled = false;
    const fail = (error: unknown) => {
      if (settled) return;
      settled = true;
      database.close();
      reject(error instanceof Error ? error : new Error('Draft database operation failed'));
    };
    let request: IDBRequest<T>;
    try {
      request = run(transaction.objectStore(storeName));
    } catch (error) {
      fail(error);
      return;
    }
    request.onerror = () => fail(request.error ?? new Error('Draft database request failed'));
    request.onsuccess = () => { result = request.result; };
    transaction.oncomplete = () => {
      if (settled) return;
      settled = true;
      database.close();
      resolve(result);
    };
    transaction.onerror = () => fail(transaction.error ?? new Error('Draft database transaction failed'));
    transaction.onabort = () => fail(transaction.error ?? new Error('Draft database transaction aborted'));
  });
};

export const readDraft = async (id: string): Promise<MemoDraftRecord | null> => {
  if (!canUseIndexedDb()) return memoryDrafts.get(id) ?? null;
  try {
    const persisted = await withStore<MemoDraftRecord | undefined>('readonly', (store) => store.get(id));
    if (persisted) return persisted;
    return draftsPendingPersistence.has(id) ? memoryDrafts.get(id) ?? null : null;
  } catch {
    return memoryDrafts.get(id) ?? null;
  }
};

export const saveDraft = async (draft: MemoDraftRecord): Promise<void> => {
  memoryDrafts.set(draft.id, draft);
  if (!canUseIndexedDb()) return;
  try {
    await withStore('readwrite', (store) => store.put(draft));
    draftsPendingPersistence.delete(draft.id);
  } catch {
    draftsPendingPersistence.add(draft.id);
    // Keep the memory copy so a transient/quota failure does not lose input.
  }
};

export const deleteDraft = async (id: string): Promise<void> => {
  memoryDrafts.delete(id);
  if (!canUseIndexedDb()) return;
  try {
    await withStore('readwrite', (store) => store.delete(id));
    draftsPendingPersistence.delete(id);
  } catch {
    // Deletion is best effort; a later successful publish should not be
    // blocked by an unavailable local database.
  }
};

const findOutboxCandidates = async (draft: MemoDraftRecord): Promise<MemoOutboxRecord[]> => {
  const clientId = draft.clientId ?? draft.id;
  const matchesCandidate = (record: MemoOutboxRecord): boolean => (
    record.id === draft.id
    || record.id === clientId
    || getOutboxClientId(record) === clientId
  );

  if (!canUseIndexedDb()) {
    return Array.from(memoryOutbox.values()).filter(matchesCandidate);
  }

  try {
    const database = await openDatabase();
    const records = await new Promise<MemoOutboxRecord[]>((resolve, reject) => {
      const transaction = database.transaction(OUTBOX_STORE_NAME, 'readonly');
      const store = transaction.objectStore(OUTBOX_STORE_NAME);
      const matches = new Map<string, MemoOutboxRecord>();
      let settled = false;

      const finishWithError = (error: unknown) => {
        if (settled) return;
        settled = true;
        database.close();
        reject(error instanceof Error ? error : new Error('Unable to query outbox candidates'));
      };

      const addRecord = (record: MemoOutboxRecord | undefined) => {
        if (record && matchesCandidate(record)) matches.set(record.id, record);
      };

      const addRequest = <T>(request: IDBRequest<T>, consume: (value: T) => void) => {
        request.onerror = () => finishWithError(request.error ?? new Error('Unable to query outbox candidates'));
        request.onsuccess = () => consume(request.result);
      };

      transaction.onerror = () => finishWithError(transaction.error ?? new Error('Outbox query transaction failed'));
      transaction.onabort = () => finishWithError(transaction.error ?? new Error('Outbox query transaction aborted'));
      transaction.oncomplete = () => {
        if (settled) return;
        settled = true;
        database.close();
        resolve(Array.from(matches.values()));
      };

      try {
        addRequest(store.get(draft.id), addRecord);
        if (clientId !== draft.id) addRequest(store.get(clientId), addRecord);
        addRequest(
          store.index(OUTBOX_CLIENT_ID_INDEX).getAll(clientId),
          (indexedRecords) => {
            for (const record of indexedRecords as MemoOutboxRecord[]) addRecord(record);
          },
        );
      } catch (error) {
        finishWithError(error);
      }
    });

    for (const id of outboxPendingPersistence) {
      const record = memoryOutbox.get(id);
      if (record && matchesCandidate(record)) records.push(record);
    }
    const merged = new Map(records.map((record) => [record.id, record]));
    for (const record of merged.values()) memoryOutbox.set(record.id, record);
    return Array.from(merged.values());
  } catch {
    return Array.from(memoryOutbox.values()).filter(matchesCandidate);
  }
};

export const enqueueOutbox = async (draft: MemoDraftRecord): Promise<MemoOutboxRecord> => {
  const existingRecords = await findOutboxCandidates(draft);
  const previous = existingRecords.find((record) => record.id === draft.id);
  const sameClientRecord = existingRecords.find(
    (record) => getOutboxClientId(record) === (draft.clientId ?? draft.id),
  );
  if (sameClientRecord?.status === 'synced' || (sameClientRecord && isLiveClaim(sameClientRecord, Date.now()))) {
    return sameClientRecord;
  }
  const now = Date.now();
  const record: MemoOutboxRecord = {
    id: draft.id,
    draft,
    status: 'pending',
    attempts: previous?.attempts ?? sameClientRecord?.attempts ?? 0,
    lastError: undefined,
    claimId: undefined,
    leaseExpiresAt: undefined,
    syncedAt: undefined,
    createdAt: previous?.createdAt ?? sameClientRecord?.createdAt ?? now,
    updatedAt: now,
  };
  memoryOutbox.set(record.id, record);
  if (!canUseIndexedDb()) return record;
  try {
    await withStore('readwrite', (store) => store.put(record), OUTBOX_STORE_NAME);
    outboxPendingPersistence.delete(record.id);
  } catch {
    outboxPendingPersistence.add(record.id);
    // The memory copy still makes the current page retryable.
  }
  return record;
};

export interface ListOutboxOptions {
  /** Include successful idempotency tombstones. UI callers normally do not need them. */
  includeSynced?: boolean;
}

export const listOutbox = async ({ includeSynced = false }: ListOutboxOptions = {}): Promise<MemoOutboxRecord[]> => {
  if (!canUseIndexedDb()) return sortOutbox(Array.from(memoryOutbox.values()), includeSynced);
  try {
    const records = await withStore<MemoOutboxRecord[]>('readonly', (store) => store.getAll(), OUTBOX_STORE_NAME);
    const merged = new Map((records ?? []).map((record) => [record.id, record]));
    // A successful IndexedDB read is authoritative except for writes that
    // previously failed after the in-memory copy was updated.
    for (const id of outboxPendingPersistence) {
      const record = memoryOutbox.get(id);
      if (record) merged.set(id, record);
    }
    for (const record of merged.values()) memoryOutbox.set(record.id, record);
    return sortOutbox(Array.from(merged.values()), includeSynced);
  } catch {
    return sortOutbox(Array.from(memoryOutbox.values()), includeSynced);
  }
};

export const updateOutbox = async (record: MemoOutboxRecord): Promise<void> => {
  memoryOutbox.set(record.id, record);
  if (!canUseIndexedDb()) return;
  try {
    await withStore('readwrite', (store) => store.put(record), OUTBOX_STORE_NAME);
    outboxPendingPersistence.delete(record.id);
  } catch {
    outboxPendingPersistence.add(record.id);
    // Best effort; the in-memory record remains available for this session.
  }
};

/**
 * Atomically claim one outbox item.  The read and write must happen in one
 * IndexedDB readwrite transaction; otherwise two tabs can both observe
 * `pending` and publish the same draft concurrently.
 */
export const claimOutbox = async (id: string, claimId: string): Promise<MemoOutboxRecord | null> => {
  if (!canUseIndexedDb()) {
    const existing = memoryOutbox.get(id);
    const now = Date.now();
    if (!existing || existing.status === 'synced' || isLiveClaim(existing, now)) return null;
    const clientId = getOutboxClientId(existing);
    const siblingRecords = Array.from(memoryOutbox.values()).filter(
      (record) => record.id !== id && getOutboxClientId(record) === clientId,
    );
    if (siblingRecords.some((record) => record.status === 'synced')) {
      memoryOutbox.delete(id);
      return null;
    }
    if (siblingRecords.some((record) => isLiveClaim(record, now))) return null;
    const claimed: MemoOutboxRecord = {
      ...existing,
      status: 'sending',
      attempts: (existing.attempts ?? 0) + 1,
      lastError: undefined,
      claimId,
      leaseExpiresAt: now + OUTBOX_CLAIM_LEASE_MS,
      updatedAt: now,
    };
    memoryOutbox.set(id, claimed);
    return claimed;
  }

  const database = await openDatabase();
  return new Promise<MemoOutboxRecord | null>((resolve, reject) => {
    const transaction = database.transaction(OUTBOX_STORE_NAME, 'readwrite');
    const store = transaction.objectStore(OUTBOX_STORE_NAME);
    let claimed: MemoOutboxRecord | null = null;
    let removedAsDuplicate = false;
    let failed = false;
    const request = store.getAll();

    request.onerror = () => {
      failed = true;
      reject(request.error ?? new Error('Unable to read outbox item'));
    };
    request.onsuccess = () => {
      const records = request.result as MemoOutboxRecord[];
      const existing = records.find((record) => record.id === id);
      const now = Date.now();
      if (!existing || existing.status === 'synced' || isLiveClaim(existing, now)) return;
      const clientId = getOutboxClientId(existing);
      const siblingRecords = records.filter(
        (record) => record.id !== id && getOutboxClientId(record) === clientId,
      );
      if (siblingRecords.some((record) => record.status === 'synced')) {
        store.delete(id);
        removedAsDuplicate = true;
        return;
      }
      if (siblingRecords.some((record) => isLiveClaim(record, now))) return;
      claimed = {
        ...existing,
        status: 'sending',
        attempts: (existing.attempts ?? 0) + 1,
        lastError: undefined,
        claimId,
        leaseExpiresAt: now + OUTBOX_CLAIM_LEASE_MS,
        updatedAt: now,
      };
      store.put(claimed);
    };
    transaction.oncomplete = () => {
      database.close();
      if (!failed) {
        if (claimed) {
          memoryOutbox.set(id, claimed);
          outboxPendingPersistence.delete(id);
        } else if (removedAsDuplicate) {
          memoryOutbox.delete(id);
          outboxPendingPersistence.delete(id);
        }
        resolve(claimed);
      }
    };
    transaction.onerror = () => {
      if (failed) return;
      failed = true;
      database.close();
      reject(transaction.error ?? new Error('Unable to claim outbox item'));
    };
    transaction.onabort = () => {
      if (failed) return;
      failed = true;
      database.close();
      reject(transaction.error ?? new Error('Outbox claim transaction aborted'));
    };
  });
};

const finishClaimedOutbox = async (id: string, claimId: string, errorMessage?: string): Promise<boolean> => {
  if (!canUseIndexedDb()) {
    const existing = memoryOutbox.get(id);
    if (!existing || existing.claimId !== claimId) return false;
    if (errorMessage === undefined) {
      const clientId = getOutboxClientId(existing);
      const now = Date.now();
      const synced: MemoOutboxRecord = {
        ...existing,
        status: 'synced',
        lastError: undefined,
        claimId: undefined,
        leaseExpiresAt: undefined,
        syncedAt: now,
        updatedAt: now,
      };
      for (const record of memoryOutbox.values()) {
        if (getOutboxClientId(record) === clientId) memoryOutbox.delete(record.id);
      }
      memoryOutbox.set(id, synced);
    } else {
      memoryOutbox.set(id, {
        ...existing,
        status: 'failed',
        lastError: errorMessage,
        claimId: undefined,
        leaseExpiresAt: undefined,
        updatedAt: Date.now(),
      });
    }
    return true;
  }

  const database = await openDatabase();
  return new Promise<boolean>((resolve, reject) => {
    const transaction = database.transaction(OUTBOX_STORE_NAME, 'readwrite');
    const store = transaction.objectStore(OUTBOX_STORE_NAME);
    let finished = false;
    let syncedRecord: MemoOutboxRecord | null = null;
    let finishedRecord: MemoOutboxRecord | null = null;
    let deletedSiblingIds: string[] = [];
    let failed = false;
    const request = store.getAll();

    request.onerror = () => {
      failed = true;
      reject(request.error ?? new Error('Unable to read outbox claim'));
    };
    request.onsuccess = () => {
      const records = request.result as MemoOutboxRecord[];
      const existing = records.find((record) => record.id === id);
      if (!existing || existing.claimId !== claimId) return;
      finished = true;
      if (errorMessage === undefined) {
        const now = Date.now();
        const clientId = getOutboxClientId(existing);
        syncedRecord = {
          ...existing,
          status: 'synced',
          lastError: undefined,
          claimId: undefined,
          leaseExpiresAt: undefined,
          syncedAt: now,
          updatedAt: now,
        };
        store.put(syncedRecord);
        deletedSiblingIds = records
          .filter((record) => record.id !== id && getOutboxClientId(record) === clientId)
          .map((record) => record.id);
        for (const siblingId of deletedSiblingIds) store.delete(siblingId);
      } else {
        finishedRecord = {
          ...existing,
          status: 'failed',
          lastError: errorMessage,
          claimId: undefined,
          leaseExpiresAt: undefined,
          updatedAt: Date.now(),
        };
        store.put(finishedRecord);
      }
    };
    transaction.oncomplete = () => {
      database.close();
      if (!failed) {
        if (finished && errorMessage === undefined && syncedRecord) {
          for (const record of memoryOutbox.values()) {
            if (getOutboxClientId(record) === getOutboxClientId(syncedRecord)) memoryOutbox.delete(record.id);
          }
          memoryOutbox.set(id, syncedRecord);
          outboxPendingPersistence.delete(id);
          for (const siblingId of deletedSiblingIds) outboxPendingPersistence.delete(siblingId);
        } else if (finished && finishedRecord) {
          memoryOutbox.set(id, finishedRecord);
          outboxPendingPersistence.delete(id);
        }
        resolve(finished);
      }
    };
    transaction.onerror = () => {
      if (failed) return;
      failed = true;
      database.close();
      reject(transaction.error ?? new Error('Unable to finish outbox claim'));
    };
    transaction.onabort = () => {
      if (failed) return;
      failed = true;
      database.close();
      reject(transaction.error ?? new Error('Outbox completion transaction aborted'));
    };
  });
};

/** Complete an item only if this replay still owns its claim. */
export const completeOutbox = (id: string, claimId: string): Promise<boolean> => finishClaimedOutbox(id, claimId);

/** Leave an item retryable only if this replay still owns its claim. */
export const failOutbox = (id: string, claimId: string, errorMessage: string): Promise<boolean> => finishClaimedOutbox(id, claimId, errorMessage);

export const deleteOutbox = async (id: string): Promise<void> => {
  memoryOutbox.delete(id);
  if (!canUseIndexedDb()) return;
  try {
    await withStore('readwrite', (store) => store.delete(id), OUTBOX_STORE_NAME);
    outboxPendingPersistence.delete(id);
  } catch {
    // A later retry can safely remove it once IndexedDB is available again.
  }
};
