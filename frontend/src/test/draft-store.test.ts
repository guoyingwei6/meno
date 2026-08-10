import { afterEach, describe, expect, it, vi } from 'vitest';
import { deleteDraft, deleteOutbox, enqueueOutbox, getTabDraftId, listOutbox, readDraft, saveDraft } from '../lib/draft-store';
import { getIndexedDbFixtureMetrics } from './indexeddb-fixture';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('quick capture draft store', () => {
  it('persists an offline outbox record with its draft payload before returning', async () => {
    const id = `outbox-store-${Date.now()}-${Math.random()}`;
    const image = new Blob(['image'], { type: 'image/png' });
    const queued = await enqueueOutbox({
      id,
      clientId: `offline-client-${id}`,
      content: '离线正文',
      displayDate: '2026-08-10',
      visibility: 'private',
      tags: ['离线'],
      images: [{ name: 'offline.png', blob: image }],
      audio: null,
      transcriptText: '',
      updatedAt: Date.now(),
    });

    expect(queued.status).toBe('pending');
    const restored = (await listOutbox()).find((record) => record.id === id);
    expect(restored).toEqual(expect.objectContaining({
      id,
      status: 'pending',
      attempts: 0,
      draft: expect.objectContaining({ content: '离线正文' }),
    }));
    expect(restored?.draft.images[0].blob).toBeInstanceOf(Blob);
    expect(restored?.draft.images[0].blob?.size).toBe(image.size);

    await deleteOutbox(id);
  });

  it('upgrades a legacy outbox and finds a matching client id through its index without a full-store read', async () => {
    const legacyId = `legacy-outbox-${Date.now()}-${Math.random()}`;
    const clientId = `legacy-client-${legacyId}`;
    const legacyDraft = {
      id: legacyId,
      clientId,
      content: '旧离线草稿',
      displayDate: '2026-08-10',
      visibility: 'private' as const,
      tags: [],
      images: [],
      audio: null,
      transcriptText: '',
      updatedAt: Date.now(),
    };
    const legacyRecord = {
      id: legacyId,
      draft: legacyDraft,
      status: 'synced' as const,
      attempts: 1,
      syncedAt: Date.now(),
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open('meno-quick-capture', 2);
      request.onerror = () => reject(request.error);
      request.onupgradeneeded = () => {
        request.result.createObjectStore('drafts', { keyPath: 'id' });
        request.result.createObjectStore('outbox', { keyPath: 'id' });
      };
      request.onsuccess = () => {
        const database = request.result;
        const transaction = database.transaction('outbox', 'readwrite');
        transaction.objectStore('outbox').put(legacyRecord);
        transaction.onerror = () => reject(transaction.error);
        transaction.onabort = () => reject(transaction.error);
        transaction.oncomplete = () => {
          database.close();
          resolve();
        };
      };
    });

    const before = getIndexedDbFixtureMetrics();
    const result = await enqueueOutbox({ ...legacyDraft, id: `${legacyId}-replay` });
    const after = getIndexedDbFixtureMetrics();

    expect(result).toMatchObject({ id: legacyId, status: 'synced' });
    expect(after.objectStoreGetAll).toBe(before.objectStoreGetAll);
    expect(after.indexGetAll).toBe(before.indexGetAll + 1);

    await deleteOutbox(legacyId);
  });

  it('round-trips metadata and binary attachments and deletes successful drafts', async () => {
    const id = `test-${Date.now()}-${Math.random()}`;
    const image = new Blob(['image'], { type: 'image/png' });
    const audio = new Blob(['audio'], { type: 'audio/webm' });
    await saveDraft({
      id,
      clientId: 'draft-client-1',
      content: '正文 #标签',
      displayDate: '2026-08-09',
      visibility: 'private',
      tags: ['标签'],
      images: [{ name: 'a.png', blob: image }],
      audio: { blob: audio, durationMs: 1234, mimeType: 'audio/webm' },
      transcriptText: '语音转写',
      updatedAt: Date.now(),
    });

    const restored = await readDraft(id);
    expect(restored?.clientId).toBe('draft-client-1');
    expect(restored?.content).toBe('正文 #标签');
    expect(restored?.displayDate).toBe('2026-08-09');
    expect(restored?.visibility).toBe('private');
    expect(restored?.tags).toEqual(['标签']);
    expect(restored?.images[0].blob).toBeInstanceOf(Blob);
    expect(restored?.images[0].blob?.size).toBe(image.size);
    expect(restored?.audio?.blob).toBeInstanceOf(Blob);
    expect(restored?.audio?.blob.size).toBe(audio.size);

    await deleteDraft(id);
    expect(await readDraft(id)).toBeNull();
  });

  it('keeps one draft id within a tab-scoped session and does not use localStorage', () => {
    sessionStorage.clear();
    localStorage.setItem('meno:quick-capture:draft-id', 'local-storage-id');

    const first = getTabDraftId();
    expect(first).not.toBe('local-storage-id');
    expect(getTabDraftId()).toBe(first);

    sessionStorage.clear();
    expect(getTabDraftId()).not.toBe(first);
  });

  it('does not report an IndexedDB draft save before its transaction commits', async () => {
    const id = `transaction-commit-${Date.now()}-${Math.random()}`;
    let resolveRequestSuccess!: () => void;
    const requestSuccess = new Promise<void>((resolve) => { resolveRequestSuccess = resolve; });
    const writeRequest = { result: undefined, error: null, onsuccess: null, onerror: null } as unknown as IDBRequest<undefined>;
    const store = {
      put: vi.fn(() => {
        queueMicrotask(() => {
          writeRequest.onsuccess?.(new Event('success'));
          resolveRequestSuccess();
        });
        return writeRequest;
      }),
    } as unknown as IDBObjectStore;
    const transaction = {
      objectStore: vi.fn(() => store),
      oncomplete: null,
      onerror: null,
      onabort: null,
      error: null,
    } as unknown as IDBTransaction;
    const database = {
      transaction: vi.fn(() => transaction),
      close: vi.fn(),
      objectStoreNames: { contains: () => true },
    } as unknown as IDBDatabase;
    const openRequest = { result: database, error: null, onsuccess: null, onerror: null, onupgradeneeded: null } as unknown as IDBOpenDBRequest;
    vi.stubGlobal('indexedDB', {
      open: () => {
        queueMicrotask(() => openRequest.onsuccess?.(new Event('success')));
        return openRequest;
      },
    });

    let settled = false;
    const saving = saveDraft({
      id,
      content: '等待事务提交',
      displayDate: '2026-08-10',
      visibility: 'private',
      tags: [],
      images: [],
      audio: null,
      transcriptText: '',
      updatedAt: Date.now(),
    }).then(() => { settled = true; });

    await requestSuccess;
    expect(settled).toBe(false);
    transaction.oncomplete?.(new Event('complete'));
    await saving;
    expect(settled).toBe(true);
    expect(database.close).toHaveBeenCalledOnce();
  });
});
