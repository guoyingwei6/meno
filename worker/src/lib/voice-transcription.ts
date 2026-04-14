import type { WorkerBindings } from '../db/client';
import { getAuthorMemoById, updateMemo } from '../db/memo-repository';
import { getMemoVoiceNoteByMemoId, listMemoVoiceNotesByStatuses, updateMemoVoiceNoteTranscript } from '../db/memo-voice-note-repository';
import type { MemoVoiceNote } from '../../../shared/src/types';

const TRANSCRIPTION_MODEL = '@cf/openai/whisper-large-v3-turbo';

const toBase64 = (buffer: ArrayBuffer) => {
  let binary = '';
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;

  for (let index = 0; index < bytes.length; index += chunkSize) {
    const chunk = bytes.subarray(index, index + chunkSize);
    binary += String.fromCharCode(...chunk);
  }

  return btoa(binary);
};

const extractTranscriptText = (response: unknown) => {
  if (!response || typeof response !== 'object') return null;
  const payload = response as { text?: unknown; transcript?: unknown; result?: { text?: unknown; transcript?: unknown } };

  if (typeof payload.text === 'string') return payload.text.trim();
  if (typeof payload.transcript === 'string') return payload.transcript.trim();
  if (typeof payload.result?.text === 'string') return payload.result.text.trim();
  if (typeof payload.result?.transcript === 'string') return payload.result.transcript.trim();

  return null;
};

export const processVoiceNote = async (env: WorkerBindings, voiceNote: MemoVoiceNote) => {
  if (!env.AI?.run) {
    await updateMemoVoiceNoteTranscript(env.DB, voiceNote.memoId, {
      transcriptStatus: 'not_available',
      transcriptError: 'No transcription engine configured',
      transcriptCompletedAt: new Date().toISOString(),
    });
    return;
  }

  const startedAt = new Date().toISOString();

  await updateMemoVoiceNoteTranscript(env.DB, voiceNote.memoId, {
    transcriptStatus: 'processing',
    transcriptError: null,
    transcriptStartedAt: startedAt,
    transcriptAttempts: voiceNote.transcriptAttempts + 1,
  });

  try {
    const object = await env.ASSETS.get(voiceNote.objectKey);
    if (!object) {
      throw new Error('Voice note audio asset not found');
    }

    const audioBuffer = await object.arrayBuffer();
    const result = await env.AI.run(TRANSCRIPTION_MODEL, {
      audio: toBase64(audioBuffer),
    });
    const transcriptText = extractTranscriptText(result);

    if (!transcriptText) {
      throw new Error('Workers AI returned an empty transcript');
    }

    await updateMemoVoiceNoteTranscript(env.DB, voiceNote.memoId, {
      transcriptStatus: 'done',
      transcriptText,
      transcriptSource: 'workers-ai',
      transcriptError: null,
      transcriptCompletedAt: new Date().toISOString(),
    });

    const memo = await getAuthorMemoById(env.DB, voiceNote.memoId);
    if (memo && memo.content.trim() === '') {
      await updateMemo(env.DB, voiceNote.memoId, { content: transcriptText });
    }
  } catch (error) {
    await updateMemoVoiceNoteTranscript(env.DB, voiceNote.memoId, {
      transcriptStatus: 'failed',
      transcriptError: error instanceof Error ? error.message : 'Voice transcription failed',
      transcriptCompletedAt: new Date().toISOString(),
    });
  }
};

export const processVoiceNoteByMemoId = async (env: WorkerBindings, memoId: number) => {
  const voiceNote = await getMemoVoiceNoteByMemoId(env.DB, memoId);
  if (!voiceNote) return;
  if (!['pending', 'processing'].includes(voiceNote.transcriptStatus)) return;
  await processVoiceNote(env, voiceNote);
};

export const processVoiceNoteQueue = async (env: WorkerBindings) => {
  const pending = await listMemoVoiceNotesByStatuses(env.DB, ['pending', 'processing'], 20);

  for (const voiceNote of pending) {
    await processVoiceNote(env, voiceNote);
  }
};
