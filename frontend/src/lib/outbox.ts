import { createMemo, uploadFile } from './api';
import { claimOutbox, completeOutbox, deleteDraft, deleteOutbox, failOutbox, listOutbox, type MemoDraftRecord } from './draft-store';

const createAttachmentFile = (blob: Blob, name: string): File => new File([blob], name, { type: blob.type || 'application/octet-stream' });

const createReplayId = (): string => {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  } catch {
    // Fall through to the timestamp/random fallback for older browsers.
  }
  return `replay-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
};

interface ReplayLockManager {
  request<T>(name: string, options: { ifAvailable: boolean }, callback: (lock: object | null) => Promise<T>): Promise<T>;
}

const getReplayLockManager = (): ReplayLockManager | null => {
  if (typeof navigator === 'undefined') return null;
  return (navigator as Navigator & { locks?: ReplayLockManager }).locks ?? null;
};

const OUTBOX_REPLAY_LOCK = 'meno:quick-capture:outbox-replay';

const publishDraft = async (draft: MemoDraftRecord): Promise<void> => {
  const imageUrls: string[] = [];
  const draftClientId = draft.clientId ?? draft.id;
  for (const [index, image] of draft.images.entries()) {
    if (image.url && !image.url.startsWith('blob:')) {
      imageUrls.push(image.url);
      continue;
    }
    if (!image.blob) throw new Error(`图片 ${image.name || index + 1} 缺少本地数据`);
    const attachmentClientId = image.clientId ?? `${draftClientId}:image:${index}`;
    const uploaded = await uploadFile(createAttachmentFile(image.blob, image.name || `image-${index + 1}`), attachmentClientId);
    if (!uploaded || typeof uploaded.url !== 'string' || !uploaded.url) throw new Error(`图片 ${image.name || index + 1} 上传响应无效`);
    imageUrls.push(uploaded.url);
  }

  let voiceNote: Parameters<typeof createMemo>[0]['voiceNote'];
  if (draft.audio) {
    const extension = draft.audio.mimeType.includes('mp4') ? 'm4a' : draft.audio.mimeType.includes('mpeg') ? 'mp3' : 'webm';
    const uploaded = await uploadFile(createAttachmentFile(draft.audio.blob, `voice-note.${extension}`), `${draftClientId}:audio`);
    if (!uploaded || typeof uploaded.url !== 'string' || !uploaded.url || typeof uploaded.objectKey !== 'string' || !uploaded.objectKey) {
      throw new Error('语音上传响应无效');
    }
    voiceNote = {
      objectKey: uploaded.objectKey,
      audioUrl: uploaded.url,
      mimeType: draft.audio.mimeType,
      durationMs: draft.audio.durationMs,
      ...(draft.transcriptText.trim()
        ? { transcriptText: draft.transcriptText.trim(), transcriptSource: 'browser-native' }
        : {}),
    };
  }

  const text = draft.content.trim();
  const content = [text, ...imageUrls.map((url) => `![](${url})`)].filter(Boolean).join('\n');
  if (!content && !voiceNote) throw new Error('草稿没有可发布内容');

  await createMemo({
    content,
    visibility: draft.visibility,
    displayDate: draft.displayDate,
    client_id: draft.clientId ?? draft.id,
    voiceNote,
  });
};

const replayOutboxItems = async (): Promise<{ sent: number; failed: number }> => {
  const records = await listOutbox();
  let sent = 0;
  let failed = 0;
  const replayId = createReplayId();

  for (const record of records) {
    // claimOutbox performs the compare-and-set in one IDB transaction. A
    // sending item with a live lease belongs to another tab; an expired lease
    // is recoverable after a tab crash.
    const claimed = await claimOutbox(record.id, replayId);
    if (!claimed) continue;
    try {
      await publishDraft(claimed.draft);
      sent += 1;
      try {
        const completed = await completeOutbox(claimed.id, replayId);
        if (completed) await deleteOutbox(claimed.id);
      } catch {
        // The memo is already idempotently created. Keep the outbox item if a
        // local cleanup transaction fails; the next replay is safe.
      }
      await deleteDraft(claimed.draft.id);
    } catch (error) {
      failed += 1;
      try {
        await failOutbox(claimed.id, replayId, error instanceof Error ? error.message : '发布失败，请重试');
      } catch {
        // Keep the item in its current state for a later lease-based retry.
      }
    }
  }

  return { sent, failed };
};

let activeReplay: Promise<{ sent: number; failed: number }> | null = null;

/**
 * Serialize replays in one tab and, where supported, across tabs through the
 * Web Locks API. IndexedDB claims remain the correctness fallback for
 * browsers without Web Locks.
 */
export const replayOutbox = (): Promise<{ sent: number; failed: number }> => {
  if (activeReplay) return activeReplay;

  const run = async () => {
    const locks = getReplayLockManager();
    if (!locks) return replayOutboxItems();
    try {
      return await locks.request(OUTBOX_REPLAY_LOCK, { ifAvailable: true }, (lock) => (
        lock ? replayOutboxItems() : Promise.resolve({ sent: 0, failed: 0 })
      ));
    } catch {
      // A partially implemented Web Locks shim must not disable the IDB claim
      // path; fall back to the atomic per-item protocol.
      return replayOutboxItems();
    }
  };

  activeReplay = run().finally(() => {
    activeReplay = null;
  });
  return activeReplay;
};

export const isLikelyOfflineError = (error: unknown): boolean => {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return true;
  return error instanceof TypeError;
};
