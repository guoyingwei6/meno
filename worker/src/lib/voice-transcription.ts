import type { WorkerBindings } from '../db/client';
import { listMemoVoiceNotesByStatuses, updateMemoVoiceNoteTranscript } from '../db/memo-voice-note-repository';

export const processVoiceNoteQueue = async (env: WorkerBindings) => {
  const pending = await listMemoVoiceNotesByStatuses(env.DB, ['pending', 'processing'], 20);

  for (const voiceNote of pending) {
    await updateMemoVoiceNoteTranscript(env.DB, voiceNote.memoId, {
      transcriptStatus: 'not_available',
      transcriptError: 'No transcription engine configured',
      transcriptCompletedAt: new Date().toISOString(),
    });
  }
};
