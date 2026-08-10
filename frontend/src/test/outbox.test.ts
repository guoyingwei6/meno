import { beforeEach, describe, expect, it, vi } from 'vitest';
import { claimOutbox, completeOutbox, deleteOutbox, enqueueOutbox, failOutbox, listOutbox, updateOutbox } from '../lib/draft-store';
import { replayOutbox } from '../lib/outbox';
import { createMemo, uploadFile } from '../lib/api';

vi.mock('../lib/api', () => ({
  createMemo: vi.fn(async () => ({ memo: { id: 1 } })),
  uploadFile: vi.fn(async () => ({ url: 'https://cdn.example.com/image.png', objectKey: 'uploads/image.png' })),
}));

const createDraft = (id: string) => ({
  id,
  clientId: `client-${id}`,
  content: '离线记录',
  displayDate: '2026-08-09',
  visibility: 'private' as const,
  tags: [],
  images: [],
  audio: null,
  transcriptText: '',
  updatedAt: Date.now(),
});

describe('offline outbox', () => {
  beforeEach(async () => {
    vi.mocked(createMemo).mockClear();
    vi.mocked(uploadFile).mockClear();
    await Promise.all((await listOutbox({ includeSynced: true })).map((record) => deleteOutbox(record.id)));
  });

  it('tracks pending, failed, retrying and synced states without exposing synced items to the queue', async () => {
    const id = `outbox-${Date.now()}-states`;
    const queued = await enqueueOutbox(createDraft(id));
    expect(queued).toEqual(expect.objectContaining({ status: 'pending', attempts: 0 }));

    const firstClaim = await claimOutbox(id, 'state-tab-a');
    expect(firstClaim).toEqual(expect.objectContaining({ status: 'sending', attempts: 1 }));
    expect(await failOutbox(id, 'state-tab-a', '网络不可用')).toBe(true);
    expect((await listOutbox()).find((record) => record.id === id)).toEqual(expect.objectContaining({
      status: 'failed',
      attempts: 1,
      lastError: '网络不可用',
    }));

    const retryClaim = await claimOutbox(id, 'state-tab-b');
    expect(retryClaim).toEqual(expect.objectContaining({ status: 'sending', attempts: 2 }));
    expect(retryClaim?.lastError).toBeUndefined();
    expect(await completeOutbox(id, 'state-tab-b')).toBe(true);
    expect((await listOutbox()).find((record) => record.id === id)).toBeUndefined();
    expect((await listOutbox({ includeSynced: true })).find((record) => record.id === id)).toEqual(expect.objectContaining({
      status: 'synced',
      syncedAt: expect.any(Number),
    }));
  });

  it('replays one queued draft once with its stable client_id and clears it', async () => {
    const id = `outbox-${Date.now()}-success`;
    await enqueueOutbox(createDraft(id));

    const result = await replayOutbox();
    expect(result).toEqual({ sent: 1, failed: 0 });
    expect(createMemo).toHaveBeenCalledTimes(1);
    expect(createMemo).toHaveBeenCalledWith(expect.objectContaining({ client_id: `client-${id}` }));
    expect((await listOutbox()).some((record) => record.id === id)).toBe(false);
    expect(await replayOutbox()).toEqual({ sent: 0, failed: 0 });
    expect(createMemo).toHaveBeenCalledTimes(1);
  });

  it('keeps a failed item for a later manual retry', async () => {
    const id = `outbox-${Date.now()}-failure`;
    vi.mocked(createMemo).mockRejectedValueOnce(new Error('offline'));
    await enqueueOutbox(createDraft(id));

    expect(await replayOutbox()).toEqual({ sent: 0, failed: 1 });
    expect((await listOutbox()).find((record) => record.id === id)?.status).toBe('failed');

    vi.mocked(createMemo).mockResolvedValueOnce({ memo: { id: 2 } } as never);
    expect(await replayOutbox()).toEqual({ sent: 1, failed: 0 });
    expect((await listOutbox()).some((record) => record.id === id)).toBe(false);
  });

  it('atomically gives a concurrent replay only one owner', async () => {
    const id = `outbox-${Date.now()}-claim`;
    await enqueueOutbox(createDraft(id));

    const [first, second] = await Promise.all([
      claimOutbox(id, 'tab-a'),
      claimOutbox(id, 'tab-b'),
    ]);

    expect([first, second].filter(Boolean)).toHaveLength(1);
    const owner = first ?? second;
    expect(owner?.status).toBe('sending');
    expect(owner?.attempts).toBe(1);
    await completeOutbox(id, owner!.claimId!);
    expect((await listOutbox()).some((record) => record.id === id)).toBe(false);
  });

  it('does not claim two records that carry the same client_id', async () => {
    const clientId = `duplicate-client-${Date.now()}`;
    const firstId = `outbox-${Date.now()}-same-client-a`;
    const secondId = `outbox-${Date.now()}-same-client-b`;
    await enqueueOutbox({ ...createDraft(firstId), clientId });
    await enqueueOutbox({ ...createDraft(secondId), clientId });

    const [first, second] = await Promise.all([
      claimOutbox(firstId, 'same-client-tab-a'),
      claimOutbox(secondId, 'same-client-tab-b'),
    ]);

    expect([first, second].filter(Boolean)).toHaveLength(1);
    const owner = first ?? second;
    expect(owner?.draft.clientId).toBe(clientId);
    await completeOutbox(owner!.id, owner!.claimId!);
    expect((await listOutbox()).filter((record) => record.draft.clientId === clientId)).toHaveLength(0);
  });

  it('replays duplicate outbox records for one client_id only once', async () => {
    const clientId = `replay-client-${Date.now()}`;
    await enqueueOutbox({ ...createDraft(`outbox-${Date.now()}-replay-a`), clientId });
    await enqueueOutbox({ ...createDraft(`outbox-${Date.now()}-replay-b`), clientId });

    expect(await replayOutbox()).toEqual({ sent: 1, failed: 0 });
    expect(createMemo).toHaveBeenCalledTimes(1);
    expect(createMemo).toHaveBeenCalledWith(expect.objectContaining({ client_id: clientId }));
    expect((await listOutbox()).filter((record) => record.draft.clientId === clientId)).toHaveLength(0);
  });

  it('recovers a sending item after its lease expires', async () => {
    const id = `outbox-${Date.now()}-lease`;
    await enqueueOutbox(createDraft(id));
    const firstClaim = await claimOutbox(id, 'crashed-tab');
    expect(firstClaim?.status).toBe('sending');

    await updateOutbox({
      ...firstClaim!,
      leaseExpiresAt: Date.now() - 1,
    });
    const recovered = await claimOutbox(id, 'recovery-tab');
    expect(recovered).toEqual(expect.objectContaining({ status: 'sending', attempts: 2, claimId: 'recovery-tab' }));
  });

  it('coalesces overlapping replay calls in one tab', async () => {
    const id = `outbox-${Date.now()}-overlap`;
    await enqueueOutbox(createDraft(id));
    let release!: () => void;
    const started = new Promise<void>((resolve) => {
      vi.mocked(createMemo).mockImplementationOnce((async () => {
        resolve();
        await new Promise<void>((done) => { release = done; });
        return { memo: { id: 3 } };
      }) as never);
    });

    const first = replayOutbox();
    await started;
    const second = replayOutbox();
    expect(second).toBe(first);
    release();

    await expect(first).resolves.toEqual({ sent: 1, failed: 0 });
    expect(vi.mocked(createMemo)).toHaveBeenCalledTimes(1);
    expect((await listOutbox()).some((record) => record.id === id)).toBe(false);
  });

  it('keeps an attachment draft when its upload fails before memo creation', async () => {
    const id = `outbox-${Date.now()}-upload-failure`;
    vi.mocked(uploadFile).mockRejectedValueOnce(new Error('upload failed'));
    await enqueueOutbox({
      ...createDraft(id),
      images: [{ name: 'offline.png', blob: new Blob(['image'], { type: 'image/png' }) }],
    });

    expect(await replayOutbox()).toEqual({ sent: 0, failed: 1 });
    expect(createMemo).not.toHaveBeenCalled();
    expect((await listOutbox()).find((record) => record.id === id)?.status).toBe('failed');
  });

  it('uses stable draft-scoped client_id values for image and audio replays', async () => {
    const id = `outbox-${Date.now()}-attachment-ids`;
    await enqueueOutbox({
      ...createDraft(id),
      images: [
        { name: 'one.png', blob: new Blob(['one'], { type: 'image/png' }) },
        { name: 'two.png', blob: new Blob(['two'], { type: 'image/png' }) },
      ],
      audio: { blob: new Blob(['audio'], { type: 'audio/webm' }), durationMs: 1200, mimeType: 'audio/webm' },
    });

    expect(await replayOutbox()).toEqual({ sent: 1, failed: 0 });
    expect(uploadFile).toHaveBeenNthCalledWith(1, expect.any(File), `client-${id}:image:0`);
    expect(uploadFile).toHaveBeenNthCalledWith(2, expect.any(File), `client-${id}:image:1`);
    expect(uploadFile).toHaveBeenNthCalledWith(3, expect.any(File), `client-${id}:audio`);
  });
});
