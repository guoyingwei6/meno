import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { getCaretCoords, getRecentTags, recordRecentTag } from '../lib/caret';
import { deleteDraft, enqueueOutbox, getTabDraftId, readDraft, saveDraft, type MemoDraftRecord } from '../lib/draft-store';
import { isLikelyOfflineError } from '../lib/outbox';
import { SortableImagePreviewList } from './SortableImagePreviewList';
import { useTheme, colors } from '../lib/theme';
import { MenuItem, MenuSurface } from './ui/Menu';

interface MemoComposerSubmitInput {
  content: string;
  visibility: 'public' | 'private';
  displayDate: string;
  client_id: string;
  voiceNote?: {
    objectKey: string;
    audioUrl: string;
    mimeType: string;
    durationMs: number;
    transcriptText?: string;
    transcriptSource?: string;
  };
}

interface MemoComposerProps {
  defaultDisplayDate: string;
  defaultVisibility?: 'public' | 'private';
  onSubmit: (input: MemoComposerSubmitInput) => Promise<void>;
  onQueueOffline?: (draft: MemoDraftRecord) => Promise<unknown>;
  existingTags?: Array<{ tag: string; count: number }>;
  /** The shell stays interactive while identity is being resolved. */
  authState?: 'pending' | 'authenticated' | 'unauthenticated';
}

interface UploadedImage {
  url: string;
  name: string;
  clientId?: string;
  blob?: Blob;
}

interface AudioDraft {
  blob: Blob;
  previewUrl: string;
  durationMs: number;
  mimeType: string;
}

type RecordingState = 'idle' | 'recording' | 'review' | 'saving';

interface BrowserSpeechRecognitionResult {
  isFinal?: boolean;
  0?: {
    transcript: string;
  };
}

interface BrowserSpeechRecognitionEvent {
  resultIndex: number;
  results: ArrayLike<BrowserSpeechRecognitionResult>;
}

interface BrowserSpeechRecognition {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((event: BrowserSpeechRecognitionEvent) => void) | null;
  onerror: (() => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
}

interface BrowserSpeechRecognitionConstructor {
  new (): BrowserSpeechRecognition;
}

interface BrowserMediaRecorderConstructor {
  new (stream: MediaStream, options?: MediaRecorderOptions): MediaRecorder;
  isTypeSupported?: (mimeType: string) => boolean;
}

const getApiBase = () => (globalThis as typeof globalThis & { __MENO_API_BASE_URL__?: string }).__MENO_API_BASE_URL__ || '';
const formatDuration = (durationMs: number) => {
  const totalSeconds = Math.max(Math.floor(durationMs / 1000), 0);
  const minutes = Math.floor(totalSeconds / 60).toString().padStart(2, '0');
  const seconds = (totalSeconds % 60).toString().padStart(2, '0');
  return `${minutes}:${seconds}`;
};

const getPreferredRecordingMimeType = () => {
  const mediaRecorder = MediaRecorder as unknown as BrowserMediaRecorderConstructor;
  const candidates = ['audio/mp4', 'audio/webm;codecs=opus', 'audio/webm'];

  for (const mimeType of candidates) {
    if (!mediaRecorder.isTypeSupported || mediaRecorder.isTypeSupported(mimeType)) {
      return mimeType;
    }
  }

  return undefined;
};

const getAudioFileExtension = (mimeType: string) => {
  if (mimeType.includes('mp4')) return 'm4a';
  if (mimeType.includes('mpeg')) return 'mp3';
  if (mimeType.includes('ogg')) return 'ogg';
  return 'webm';
};

const COMPOSER_TEXTAREA_MIN_HEIGHT = 100;
const COMPOSER_TEXTAREA_MAX_HEIGHT = 420;
const COMPOSER_TEXTAREA_MAX_VIEWPORT_RATIO = 0.6;
const COMPOSER_NARROW_SCREEN_QUERY = '(max-width: 640px)';
const MAX_COMPOSER_IMAGES = 8;
const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
const ATTACHMENT_EXTENSIONS: Record<string, string[]> = {
  'image/jpeg': ['.jpg', '.jpeg'],
  'image/png': ['.png'],
  'image/webp': ['.webp'],
  'image/gif': ['.gif'],
  'image/avif': ['.avif'],
  'audio/webm': ['.webm'],
  'audio/mp4': ['.m4a', '.mp4'],
  'audio/mpeg': ['.mp3'],
  'audio/ogg': ['.ogg', '.oga'],
  'audio/wav': ['.wav'],
  'audio/x-wav': ['.wav'],
};

const validateAttachment = (file: File, kind: 'image' | 'audio'): string | null => {
  if (file.size < 1) return '文件不能为空';
  if (file.size > MAX_ATTACHMENT_BYTES) return '文件不能超过 10 MiB';
  const mimeType = file.type.trim().toLowerCase().split(';', 1)[0];
  const allowedExtensions = ATTACHMENT_EXTENSIONS[mimeType];
  const extension = file.name.slice(file.name.lastIndexOf('.')).toLowerCase();
  if (!allowedExtensions || !allowedExtensions.includes(extension) || !mimeType.startsWith(`${kind}/`)) {
    return kind === 'image'
      ? '仅支持 JPEG、PNG、WebP、GIF 或 AVIF 图片'
      : '录音格式不受支持';
  }
  return null;
};

const getComposerTextareaMaxHeight = () => {
  const viewportCap = Math.floor(window.innerHeight * COMPOSER_TEXTAREA_MAX_VIEWPORT_RATIO);
  return Math.max(COMPOSER_TEXTAREA_MIN_HEIGHT, Math.min(COMPOSER_TEXTAREA_MAX_HEIGHT, viewportCap));
};

const isNarrowComposerScreen = () => {
  if (typeof window === 'undefined') return false;
  if (typeof window.matchMedia === 'function') {
    return window.matchMedia(COMPOSER_NARROW_SCREEN_QUERY)?.matches ?? window.innerWidth <= 640;
  }
  return window.innerWidth <= 640;
};

const resizeComposerTextarea = (textarea: HTMLTextAreaElement) => {
  textarea.style.height = 'auto';
  textarea.style.overflowY = 'hidden';

  const contentHeight = Math.max(textarea.scrollHeight, COMPOSER_TEXTAREA_MIN_HEIGHT);
  const maxHeight = getComposerTextareaMaxHeight();
  const nextHeight = Math.min(contentHeight, maxHeight);

  textarea.style.height = `${nextHeight}px`;
  textarea.style.overflowY = contentHeight > maxHeight ? 'auto' : 'hidden';
};

const createLocalObjectUrl = (blob: Blob): string => {
  if (typeof URL.createObjectURL === 'function') return URL.createObjectURL(blob);
  return `blob:meno-local-${Date.now()}-${Math.random().toString(36).slice(2)}`;
};

const createClientId = (): string => {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
  } catch {
    // Fall through to the timestamp/random fallback for older browsers.
  }
  return `memo-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
};

/** Renders text with #tags in green and code blocks with background — sits behind transparent textarea */
const HighlightOverlay = ({ text, textColor, isDark }: { text: string; textColor: string; isDark: boolean }) => {
  const parts = text.split(/(```[\s\S]*?```|`[^`\n]+`|#[^\s#]+)/g);
  const codeBg = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)';
  return (
    <div style={styles.highlightOverlay} aria-hidden="true">
      {parts.map((part, i) => {
        if (part.startsWith('```'))
          return <span key={i} style={{ color: textColor, background: codeBg, borderRadius: 3 }}>{part}</span>;
        if (part.startsWith('`') && part.endsWith('`') && part.length > 1)
          return <span key={i} style={{ color: textColor, background: codeBg, borderRadius: 3 }}>{part}</span>;
        if (/^#[^\s#]+$/.test(part))
          return <span key={i} style={{ color: '#3aa864', fontWeight: 500 }}>{part}</span>;
        return <span key={i} style={{ color: textColor }}>{part}</span>;
      })}
      <span>{'\n '}</span>
    </div>
  );
};

const areSuggestionsEqual = (prev: string[] | undefined, next: string[]) => {
  if (!prev) return false;
  return prev.length === next.length && prev.every((tag, index) => tag === next[index]);
};

const isInsideCodeBlock = (text: string, pos: number): boolean => {
  const before = text.slice(0, pos);
  const fenced = (before.match(/```/g) || []).length;
  if (fenced % 2 === 1) return true;
  const withoutFenced = before.replace(/```[\s\S]*?```/g, '');
  const backticks = (withoutFenced.match(/`/g) || []).length;
  return backticks % 2 === 1;
};

const getTagMatchBeforeCursor = (value: string, cursorPos: number) => {
  if (isInsideCodeBlock(value, cursorPos)) return null;
  return value.slice(0, cursorPos).match(/#([^\s#]*)$/);
};

const restoreTextareaFocus = (textarea: HTMLTextAreaElement | null, cursorPos: number) => {
  if (!textarea) return;
  requestAnimationFrame(() => {
    textarea.focus();
    textarea.setSelectionRange(cursorPos, cursorPos);
  });
};

export const MemoComposer = ({ defaultDisplayDate, defaultVisibility = 'public', onSubmit, onQueueOffline = enqueueOutbox, existingTags = [], authState = 'authenticated' }: MemoComposerProps) => {
  const [content, setContent] = useState('');
  const [visibility, setVisibility] = useState<'public' | 'private'>(defaultVisibility);
  const [displayDate, setDisplayDate] = useState(defaultDisplayDate);
  const [images, setImages] = useState<UploadedImage[]>([]);
  const [recordingState, setRecordingState] = useState<RecordingState>('idle');
  const [recordingStartedAt, setRecordingStartedAt] = useState<number | null>(null);
  const [recordingDurationMs, setRecordingDurationMs] = useState(0);
  const [audioDraft, setAudioDraft] = useState<AudioDraft | null>(null);
  const [transcriptText, setTranscriptText] = useState('');
  const [tagDropdown, setTagDropdown] = useState<{ suggestions: string[]; top: number; left: number } | null>(null);
  const [tagIndex, setTagIndex] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [draftReady, setDraftReady] = useState(false);
  const [formatMenuOpen, setFormatMenuOpen] = useState(false);
  const [isNarrowScreen, setIsNarrowScreen] = useState(isNarrowComposerScreen);
  const { isDark } = useTheme();
  const c = colors(isDark);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const editorWrapRef = useRef<HTMLDivElement | null>(null);
  const dismissedTagMatchRef = useRef<string | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const speechRecognitionRef = useRef<BrowserSpeechRecognition | null>(null);
  const discardRecordingRef = useRef(false);
  const draftIdRef = useRef<string | null>(null);
  const clientIdRef = useRef<string | null>(null);
  const draftUserInputRef = useRef(false);
  const skipNextDraftSaveRef = useRef(false);
  const formatMenuRef = useRef<HTMLDivElement | null>(null);
  const moreButtonRef = useRef<HTMLButtonElement | null>(null);
  const formatMenuId = useId();
  const isRecordingSupported = Boolean(navigator.mediaDevices?.getUserMedia) && typeof MediaRecorder !== 'undefined';
  const hasDraft = recordingState !== 'recording' && (content.length > 0 || images.length > 0 || Boolean(audioDraft) || transcriptText.length > 0);
  const canPublish = authState === 'authenticated';

  const latestDraftStateRef = useRef({ content, images, audioDraft, transcriptText, displayDate, visibility });
  latestDraftStateRef.current = { content, images, audioDraft, transcriptText, displayDate, visibility };

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const mediaQuery = typeof window.matchMedia === 'function'
      ? window.matchMedia(COMPOSER_NARROW_SCREEN_QUERY) ?? null
      : null;
    const updateScreenMode = () => {
      const next = mediaQuery ? mediaQuery.matches : window.innerWidth <= 640;
      setIsNarrowScreen(next);
      if (!next) setFormatMenuOpen(false);
    };
    updateScreenMode();
    window.addEventListener('resize', updateScreenMode);
    if (mediaQuery && typeof mediaQuery.addEventListener === 'function') {
      mediaQuery.addEventListener('change', updateScreenMode);
    } else {
      mediaQuery?.addListener?.(updateScreenMode);
    }
    return () => {
      window.removeEventListener('resize', updateScreenMode);
      if (mediaQuery && typeof mediaQuery.removeEventListener === 'function') {
        mediaQuery.removeEventListener('change', updateScreenMode);
      } else {
        mediaQuery?.removeListener?.(updateScreenMode);
      }
    };
  }, []);

  useEffect(() => {
    if (!formatMenuOpen || !isNarrowScreen) return;
    formatMenuRef.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus();
  }, [formatMenuOpen, isNarrowScreen]);

  useEffect(() => {
    if (!formatMenuOpen) return;
    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (!formatMenuRef.current?.contains(event.target as Node)) setFormatMenuOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      setFormatMenuOpen(false);
      moreButtonRef.current?.focus();
    };
    document.addEventListener('pointerdown', closeOnOutsidePointer);
    window.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsidePointer);
      window.removeEventListener('keydown', closeOnEscape);
    };
  }, [formatMenuOpen]);

  const getSpeechRecognitionConstructor = () => {
    const speechWindow = window as Window & {
      SpeechRecognition?: BrowserSpeechRecognitionConstructor;
      webkitSpeechRecognition?: BrowserSpeechRecognitionConstructor;
    };
    return speechWindow.SpeechRecognition ?? speechWindow.webkitSpeechRecognition ?? null;
  };

  const revokeAudioDraftUrl = (draft: AudioDraft | null) => {
    if (draft && typeof URL.revokeObjectURL === 'function') URL.revokeObjectURL(draft.previewUrl);
  };

  const revokeImageObjectUrl = (image: UploadedImage) => {
    if (image.url.startsWith('blob:') && typeof URL.revokeObjectURL === 'function') {
      URL.revokeObjectURL(image.url);
    }
  };

  const revokeImageObjectUrls = (items: UploadedImage[]) => {
    items.forEach(revokeImageObjectUrl);
  };

  const ensureDraftId = () => {
    if (!draftIdRef.current) draftIdRef.current = getTabDraftId();
    return draftIdRef.current;
  };

  const clearAudioDraft = () => {
    setAudioDraft((current) => {
      revokeAudioDraftUrl(current);
      return null;
    });
  };

  const stopMediaStream = () => {
    mediaStreamRef.current?.getTracks().forEach((track) => track.stop());
    mediaStreamRef.current = null;
  };

  const stopSpeechRecognition = () => {
    speechRecognitionRef.current?.stop();
    speechRecognitionRef.current = null;
  };

  const resizeTextarea = () => {
    const ta = textareaRef.current;
    if (!ta) return;
    resizeComposerTextarea(ta);
  };

  const updateTagSuggestions = (value: string, cursorPos: number) => {
    const ta = textareaRef.current;
    const match = getTagMatchBeforeCursor(value, cursorPos);
    if (!match || !ta) {
      dismissedTagMatchRef.current = null;
      setTagDropdown(null);
      return;
    }
    if (dismissedTagMatchRef.current === match[0]) {
      setTagDropdown(null);
      return;
    }
    dismissedTagMatchRef.current = null;
    const prefix = match[1];
    const recent = getRecentTags();
    const suggestions = existingTags
      .map((t) => t.tag)
      .filter((t) => t.startsWith(prefix) && t !== prefix)
      .sort((a, b) => {
        const ia = recent.indexOf(a), ib = recent.indexOf(b);
        if (ia === -1 && ib === -1) return 0;
        if (ia === -1) return 1;
        if (ib === -1) return -1;
        return ia - ib;
      });
    if (!suggestions.length) { setTagDropdown(null); setTagIndex(0); return; }
    const coords = getCaretCoords(ta);
    setTagDropdown({ suggestions, ...coords });
    setTagIndex((current) => {
      if (areSuggestionsEqual(tagDropdown?.suggestions, suggestions) && current < suggestions.length) return current;
      return 0;
    });
  };

  const dismissTagSuggestions = (value: string, cursorPos: number) => {
    const match = getTagMatchBeforeCursor(value, cursorPos);
    dismissedTagMatchRef.current = match?.[0] ?? null;
    setTagDropdown(null);
    restoreTextareaFocus(textareaRef.current, cursorPos);
  };

  const closeTagSuggestions = (value: string, cursorPos: number) => {
    const match = getTagMatchBeforeCursor(value, cursorPos);
    dismissedTagMatchRef.current = match?.[0] ?? null;
    setTagDropdown(null);
  };

  const applyTagSuggestion = (tag: string) => {
    const ta = textareaRef.current;
    if (!ta) return;
    const cursorPos = ta.selectionStart;
    const before = content.slice(0, cursorPos);
    const match = before.match(/#([^\s#]*)$/);
    if (!match) return;
    const newContent = content.slice(0, cursorPos - match[0].length) + '#' + tag + ' ' + content.slice(cursorPos);
    draftUserInputRef.current = true;
    setContent(newContent);
    setTagDropdown(null);
    dismissedTagMatchRef.current = null;
    recordRecentTag(tag);
    setTimeout(() => {
      const newPos = cursorPos - match[0].length + tag.length + 2;
      ta.focus();
      ta.setSelectionRange(newPos, newPos);
    }, 0);
  };

  const uploadImage = async (file: File) => {
    if (images.length >= MAX_COMPOSER_IMAGES) {
      setSubmitError(`最多添加 ${MAX_COMPOSER_IMAGES} 张图片`);
      return;
    }
    const validationError = validateAttachment(file, 'image');
    if (validationError) {
      setSubmitError(validationError);
      return;
    }
    // Add the Blob first. Network/upload failures must leave a recoverable
    // attachment in the draft instead of discarding the user's selection.
    setSubmitError(null);
    draftUserInputRef.current = true;
    const attachmentClientId = `${ensureClientId()}:image:${createClientId()}`;
    const localUrl = createLocalObjectUrl(file);
    setImages((prev) => [...prev, { url: localUrl, name: file.name, clientId: attachmentClientId, blob: file }]);
    const form = new FormData();
    form.append('file', file);
    form.append('client_id', attachmentClientId);
    try {
      const response = await fetch(`${getApiBase()}/api/uploads`, {
        method: 'POST',
        credentials: 'include',
        body: form,
      });
      if (!response.ok) throw new Error(`图片上传失败（HTTP ${response.status}）`);
      const payload = (await response.json()) as { url?: string };
      if (!payload.url) throw new Error('图片上传响应无效');
      const uploadedUrl = payload.url;
      setImages((prev) => prev.map((image) => {
        if (image.url !== localUrl) return image;
        if (localUrl.startsWith('blob:') && typeof URL.revokeObjectURL === 'function') URL.revokeObjectURL(localUrl);
        return { ...image, url: uploadedUrl };
      }));
    } catch {
      // Keep the local Blob/object URL; handleSubmit will retry its upload.
    }
  };

  const uploadAudio = async (file: File, clientId: string) => {
    const validationError = validateAttachment(file, 'audio');
    if (validationError) throw new Error(validationError);
    const form = new FormData();
    form.append('file', file);
    form.append('client_id', clientId);
    const response = await fetch(`${getApiBase()}/api/uploads`, {
      method: 'POST',
      credentials: 'include',
      body: form,
    });
    if (!response.ok) throw new Error(`语音上传失败（HTTP ${response.status}）`);
    const payload = await response.json() as { url?: string; objectKey?: string; fileName?: string };
    if (!payload.url || !payload.objectKey) throw new Error('语音上传响应无效');
    return payload as { url: string; objectKey: string; fileName: string };
  };

  const resetVoiceDraft = () => {
    discardRecordingRef.current = false;
    clearAudioDraft();
    mediaRecorderRef.current = null;
    stopMediaStream();
    stopSpeechRecognition();
    setTranscriptText('');
    setRecordingStartedAt(null);
    setRecordingDurationMs(0);
    setRecordingState('idle');
  };

  const cancelDraft = () => {
    draftUserInputRef.current = false;
    setContent('');
    setVisibility(defaultVisibility);
    setDisplayDate(defaultDisplayDate);
    revokeImageObjectUrls(images);
    setImages([]);
    setTagDropdown(null);
    dismissedTagMatchRef.current = null;
    resetVoiceDraft();
    void clearStoredDraft();
    clientIdRef.current = createClientId();
  };

  const cancelRecording = () => {
    discardRecordingRef.current = true;
    mediaRecorderRef.current = null;
    stopMediaStream();
    stopSpeechRecognition();
    setRecordingStartedAt(null);
    setRecordingDurationMs(0);
    setRecordingState(audioDraft ? 'review' : 'idle');
  };

  const startRecording = async () => {
    if (!isRecordingSupported || recordingState === 'recording' || submitting) return;

    draftUserInputRef.current = true;

    let stream: MediaStream | null = null;

    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const preferredMimeType = getPreferredRecordingMimeType();
      const recorder = preferredMimeType ? new MediaRecorder(stream, { mimeType: preferredMimeType }) : new MediaRecorder(stream);
      const SpeechRecognitionCtor = getSpeechRecognitionConstructor();
      const recognition = SpeechRecognitionCtor ? new SpeechRecognitionCtor() : null;
      const startedAt = Date.now();
      const chunks: Blob[] = [];

      if (recognition) {
        recognition.lang = 'zh-CN';
        recognition.continuous = true;
        recognition.interimResults = true;
        recognition.onresult = (event) => {
          const nextTranscript = Array.from(event.results)
            .slice(event.resultIndex)
            .map((result) => result[0]?.transcript?.trim() ?? '')
            .filter(Boolean)
            .join('');
          if (nextTranscript) {
            setTranscriptText(nextTranscript);
          }
        };
        recognition.onerror = () => {
          speechRecognitionRef.current = null;
        };
        recognition.onend = () => {
          speechRecognitionRef.current = null;
        };
      }

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunks.push(event.data);
      };
      recorder.onstop = () => {
        stopSpeechRecognition();
        if (discardRecordingRef.current) {
          discardRecordingRef.current = false;
          mediaRecorderRef.current = null;
          stopMediaStream();
          setRecordingStartedAt(null);
          setRecordingDurationMs(0);
          setRecordingState('idle');
          return;
        }
        const mimeType = recorder.mimeType || 'audio/webm';
        const blob = new Blob(chunks, { type: mimeType });
        setAudioDraft((current) => {
          // Re-recording replaces the old review draft only after the new
          // recorder has actually produced a Blob. This keeps a failed setup
          // from destroying the previous recording.
          revokeAudioDraftUrl(current);
          return {
            blob,
            previewUrl: createLocalObjectUrl(blob),
            durationMs: Math.max(Date.now() - startedAt, 0),
            mimeType,
          };
        });
        mediaRecorderRef.current = null;
        stopMediaStream();
        setRecordingStartedAt(null);
        setRecordingDurationMs(0);
        setRecordingState('review');
      };

      recorder.start();
      mediaStreamRef.current = stream;
      mediaRecorderRef.current = recorder;
      speechRecognitionRef.current = recognition;
      discardRecordingRef.current = false;
      setTranscriptText('');
      setRecordingStartedAt(startedAt);
      setRecordingDurationMs(0);
      setRecordingState('recording');
      recognition?.start();
    } catch {
      stopSpeechRecognition();
      stream?.getTracks().forEach((track) => track.stop());
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
      return;
    }
    mediaRecorderRef.current?.stop();
  };

  const handlePaste = (e: React.ClipboardEvent) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item.type.startsWith('image/')) {
        e.preventDefault();
        const file = item.getAsFile();
        if (file) uploadImage(file);
        return;
      }
    }
  };

  const wrapSelection = (before: string, after: string) => {
    const ta = textareaRef.current;
    if (!ta) return;
    const start = ta.selectionStart;
    const end = ta.selectionEnd;
    const selected = content.slice(start, end);
    const wrapped = `${before}${selected || '文本'}${after}`;
    const next = content.slice(0, start) + wrapped + content.slice(end);
    draftUserInputRef.current = true;
    setContent(next);
    setTimeout(() => {
      ta.focus();
      const cursorStart = start + before.length;
      const cursorEnd = cursorStart + (selected || '文本').length;
      ta.setSelectionRange(cursorStart, cursorEnd);
    }, 0);
  };

  const insertLinePrefix = (prefix: string) => {
    const ta = textareaRef.current;
    if (!ta) return;
    const start = ta.selectionStart;
    const lineStart = content.lastIndexOf('\n', start - 1) + 1;
    const next = content.slice(0, lineStart) + prefix + content.slice(lineStart);
    draftUserInputRef.current = true;
    setContent(next);
    setTimeout(() => {
      ta.focus();
      ta.setSelectionRange(start + prefix.length, start + prefix.length);
    }, 0);
  };

  const runFormatMenuAction = (action: () => void) => {
    action();
    setFormatMenuOpen(false);
  };

  const handleFormatMenuKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    const items = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'));
    if (!items.length) return;
    event.preventDefault();
    const currentIndex = items.indexOf(document.activeElement as HTMLButtonElement);
    const nextIndex = event.key === 'Home'
      ? 0
      : event.key === 'End'
        ? items.length - 1
        : (currentIndex + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
    items[nextIndex]?.focus();
  };

  const buildDraftRecord = (state = latestDraftStateRef.current): MemoDraftRecord | null => {
    const id = ensureDraftId();
    if (!id) return null;
    const { content: draftContent, displayDate: draftDisplayDate, visibility: draftVisibility, images: draftImages, audioDraft: draftAudio, transcriptText: draftTranscript } = state;
    const draftClientId = clientIdRef.current ?? (clientIdRef.current = createClientId());
    const tags = Array.from(draftContent.matchAll(/(?:^|\s)#([^\s#]+)/g)).map((match) => match[1]);
    return {
      id,
      clientId: draftClientId,
      content: draftContent,
      displayDate: draftDisplayDate,
      visibility: draftVisibility,
      tags,
      images: draftImages.map((image, index) => ({
        name: image.name,
        clientId: image.clientId ?? `${draftClientId}:image:${index}`,
        // Object URLs are tab-local and must never be persisted as if they
        // were durable upload URLs. Keep the original Blob for re-upload.
        url: image.url.startsWith('blob:') ? undefined : image.url,
        blob: image.blob,
      })),
      audio: draftAudio
        ? { blob: draftAudio.blob, durationMs: draftAudio.durationMs, mimeType: draftAudio.mimeType }
        : null,
      transcriptText: draftTranscript,
      updatedAt: Date.now(),
    };
  };

  const clearStoredDraft = async () => {
    const id = ensureDraftId();
    if (!id) return;
    // Resetting state below triggers the draft effect. Skip that one empty
    // write so a successful publish really removes the local draft.
    skipNextDraftSaveRef.current = true;
    await deleteDraft(id);
  };

  const ensureClientId = () => {
    if (!clientIdRef.current) clientIdRef.current = createClientId();
    return clientIdRef.current;
  };

  const handleSubmit = async () => {
    const textPart = content.trim();
    const transcriptPart = transcriptText.trim();
    const imagePart = images.map((img) => `![](${img.url})`).join('\n');
    const fullContent = [textPart || transcriptPart, imagePart].filter(Boolean).join('\n');
    if ((!fullContent && !audioDraft) || submitting || recordingState === 'recording' || !canPublish) return;
    const currentAudioDraft = audioDraft;
    let submitted = false;
    setSubmitError(null);
    setSubmitting(true);
    setRecordingState(currentAudioDraft ? 'saving' : 'idle');
    try {
      if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        const offlineDraft = buildDraftRecord();
        if (!offlineDraft) throw new Error('无法保存空白草稿');
        await onQueueOffline(offlineDraft);
        setSubmitError('当前离线，已保存到待发送箱；联网后会自动发布。');
        return;
      }

      let voiceNote: MemoComposerSubmitInput['voiceNote'];

      // A restored image may only have a Blob and a tab-local object URL. Make
      // sure it gets uploaded before the memo references it.
      const resolvedImages = [] as UploadedImage[];
      for (const [index, image] of images.entries()) {
        if (image.blob && image.url.startsWith('blob:')) {
          const attachmentClientId = image.clientId ?? `${ensureClientId()}:image:${index}`;
          const form = new FormData();
          form.append('file', image.blob, image.name);
          form.append('client_id', attachmentClientId);
          const response = await fetch(`${getApiBase()}/api/uploads`, {
            method: 'POST',
            credentials: 'include',
            body: form,
          });
          if (!response.ok) throw new Error(`图片上传失败（HTTP ${response.status}）`);
          const payload = (await response.json()) as { url?: string };
          if (!payload.url) throw new Error('图片上传响应无效');
          resolvedImages.push({ ...image, url: payload.url, clientId: attachmentClientId });
        } else {
          resolvedImages.push(image);
        }
      }

      if (currentAudioDraft) {
        const extension = getAudioFileExtension(currentAudioDraft.mimeType);
        const file = new File([currentAudioDraft.blob], `voice-note.${extension}`, { type: currentAudioDraft.mimeType });
        const upload = await uploadAudio(file, `${ensureClientId()}:audio`);
        voiceNote = {
          objectKey: upload.objectKey,
          audioUrl: upload.url,
          mimeType: currentAudioDraft.mimeType,
          durationMs: currentAudioDraft.durationMs,
          ...(transcriptPart
            ? {
              transcriptText: transcriptPart,
              transcriptSource: 'browser-native',
            }
            : {}),
        };
      }

      setImages(resolvedImages);
      const resolvedImagePart = resolvedImages.map((img) => `![](${img.url})`).join('\n');
      const resolvedContent = [textPart || transcriptPart, resolvedImagePart].filter(Boolean).join('\n');
      await onSubmit({ content: resolvedContent, visibility, displayDate, client_id: ensureClientId(), voiceNote });
      draftUserInputRef.current = false;
      setContent('');
      setVisibility(defaultVisibility);
      setDisplayDate(defaultDisplayDate);
      revokeImageObjectUrls(images);
      setImages([]);
      clearAudioDraft();
      mediaRecorderRef.current = null;
      stopMediaStream();
      stopSpeechRecognition();
      setTranscriptText('');
      setRecordingStartedAt(null);
      setRecordingDurationMs(0);
      setRecordingState('idle');
      await clearStoredDraft();
      clientIdRef.current = createClientId();
      submitted = true;
    } catch (error) {
      // Keep all editor state (including Blob attachments) for retry after a
      // transient upload/API failure. Avoid an unhandled rejection from the
      // button's async event handler.
      if (isLikelyOfflineError(error)) {
        const offlineDraft = buildDraftRecord();
        if (offlineDraft) {
          await onQueueOffline(offlineDraft);
          setSubmitError('网络不可用，已保存到待发送箱；联网后会自动发布。');
        } else {
          setSubmitError('网络不可用，草稿保存失败，请重试');
        }
      } else {
        setSubmitError(error instanceof Error ? error.message : '发布失败，请重试');
      }
    } finally {
      setSubmitting(false);
      if (!submitted) setRecordingState(currentAudioDraft ? 'review' : 'idle');
    }
  };

  const handleEditorKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      dismissTagSuggestions(e.currentTarget.value, e.currentTarget.selectionStart ?? e.currentTarget.value.length);
      return;
    }
    // Tag dropdown navigation
    if (tagDropdown) {
      const len = tagDropdown.suggestions.length;
      if (e.key === 'ArrowDown') { e.preventDefault(); setTagIndex((i) => (i + 1) % len); return; }
      if (e.key === 'ArrowUp') { e.preventDefault(); setTagIndex((i) => (i - 1 + len) % len); return; }
      if (e.key === 'Enter') { e.preventDefault(); applyTagSuggestion(tagDropdown.suggestions[tagIndex]); return; }
    }
    // Format shortcuts: Ctrl/Cmd + B/I/U
    const mod = e.metaKey || e.ctrlKey;
    if (!mod) return;
    if (e.key === 'Enter') {
      // Do not steal the Enter key while an IME is composing (Chrome uses
      // keyCode 229 for this path). The same shortcut works on macOS and
      // Windows/Linux once composition has ended.
      const nativeEvent = e.nativeEvent as KeyboardEvent & { isComposing?: boolean; keyCode?: number };
      if (nativeEvent.isComposing || nativeEvent.keyCode === 229) return;
      e.preventDefault();
      void handleSubmit();
      return;
    }
    if (e.key === 'b') { e.preventDefault(); wrapSelection('**', '**'); }
    else if (e.key === 'i') { e.preventDefault(); wrapSelection('*', '*'); }
    else if (e.key === 'u') { e.preventDefault(); wrapSelection('<u>', '</u>'); }
  };

  useEffect(() => {
    if (!tagDropdown) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopPropagation();
      const ta = textareaRef.current;
      if (!ta) return;
      dismissTagSuggestions(ta.value, ta.selectionStart ?? ta.value.length);
    };
    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, [tagDropdown]);

  useEffect(() => {
    resizeTextarea();
  }, [content]);

  useEffect(() => {
    if (draftUserInputRef.current || content || images.length > 0 || audioDraft || transcriptText) return;
    setVisibility(defaultVisibility);
  }, [audioDraft, content, defaultVisibility, images.length, transcriptText]);

  useEffect(() => {
    const handleCaptureShortcut = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey || event.key.toLowerCase() !== 'c') return;
      const target = event.target as HTMLElement | null;
      if (target?.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target?.tagName ?? '')) return;
      event.preventDefault();
      textareaRef.current?.focus();
    };
    window.addEventListener('keydown', handleCaptureShortcut);
    return () => window.removeEventListener('keydown', handleCaptureShortcut);
  }, []);

  // Restore once per tab. If a user starts typing before IndexedDB responds,
  // leave that input untouched instead of replacing it with an older draft.
  useEffect(() => {
    const draftId = ensureDraftId();
    setDraftReady(false);
    let cancelled = false;
    void readDraft(draftId).then((draft) => {
      if (cancelled) return;
      const current = latestDraftStateRef.current;
      if (draft && !draftUserInputRef.current && !current.content && current.images.length === 0 && !current.audioDraft && !current.transcriptText) {
        clientIdRef.current = draft.clientId ?? clientIdRef.current ?? createClientId();
        setContent(draft.content);
        setDisplayDate(draft.displayDate || defaultDisplayDate);
        setVisibility(draft.visibility === 'private' ? 'private' : 'public');
        const restoredClientId = draft.clientId ?? (clientIdRef.current ?? (clientIdRef.current = createClientId()));
        setImages(draft.images.map((image, index) => ({
          name: image.name,
          clientId: image.clientId ?? `${restoredClientId}:image:${index}`,
          url: image.url || (image.blob ? createLocalObjectUrl(image.blob) : ''),
          blob: image.blob,
        })).filter((image) => Boolean(image.url)));
        if (draft.audio?.blob) {
          setAudioDraft({
            blob: draft.audio.blob,
            previewUrl: createLocalObjectUrl(draft.audio.blob),
            durationMs: draft.audio.durationMs,
            mimeType: draft.audio.mimeType,
          });
        }
        setTranscriptText(draft.transcriptText || '');
      }
      if (!clientIdRef.current) clientIdRef.current = createClientId();
      // This state transition is intentional: input entered before the
      // asynchronous read completed must still run through the save effect.
      setDraftReady(true);
    }).catch(() => {
      // The composer remains usable if storage is blocked or unavailable.
      if (cancelled) return;
      setDraftReady(true);
    });
    return () => { cancelled = true; };
    // The restore must run only when the composer is mounted for this date.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [defaultDisplayDate]);

  // Persist input after a short idle period. Blobs are structured-cloned by
  // IndexedDB, so reloads can recover image and recording attachments too.
  useEffect(() => {
    if (!draftReady) {
      return;
    }
    // A reset after successful publish/cancel should not write an empty draft.
    // If the user starts typing again before this effect runs, however, the
    // non-empty state below must still be saved.
    if (skipNextDraftSaveRef.current) {
      skipNextDraftSaveRef.current = false;
    }
    const draft = buildDraftRecord();
    if (!draft || (!hasDraft && !content.trim())) return;
    const timer = window.setTimeout(() => {
      void saveDraft(draft);
    }, 500);
    return () => window.clearTimeout(timer);
    // buildDraftRecord/hasDraft intentionally read the current composer state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [content, displayDate, visibility, images, audioDraft, transcriptText, hasDraft, draftReady]);

  useEffect(() => {
    if (recordingState !== 'recording' || recordingStartedAt === null) return;
    const tick = () => setRecordingDurationMs(Date.now() - recordingStartedAt);
    tick();
    const timer = window.setInterval(tick, 250);
    return () => window.clearInterval(timer);
  }, [recordingState, recordingStartedAt]);

  useEffect(() => () => {
    revokeAudioDraftUrl(latestDraftStateRef.current.audioDraft);
    revokeImageObjectUrls(latestDraftStateRef.current.images);
    mediaRecorderRef.current = null;
    stopMediaStream();
    stopSpeechRecognition();
  }, []);

  return (
    <>
    <section style={{ ...styles.card, background: c.cardBg, borderColor: c.borderMedium }}>
      <div ref={editorWrapRef} style={styles.editorWrap}>
        <HighlightOverlay text={content} textColor={c.textPrimary} isDark={isDark} />
        <textarea
          ref={textareaRef}
          id="memo-composer-input"
          style={{ ...styles.textarea, caretColor: c.textPrimary }}
          placeholder="现在的想法是..."
          value={content}
          onBlur={(e) => {
            if (!tagDropdown) return;
            closeTagSuggestions(e.currentTarget.value, e.currentTarget.selectionStart ?? e.currentTarget.value.length);
          }}
          onChange={(event) => {
            draftUserInputRef.current = true;
            setContent(event.target.value);
            updateTagSuggestions(event.target.value, event.target.selectionStart ?? event.target.value.length);
          }}
          onKeyUp={(e) => {
            if (e.key === 'Escape') return;
            if (tagDropdown && ['ArrowDown', 'ArrowUp', 'Enter'].includes(e.key)) return;
            updateTagSuggestions(content, (e.target as HTMLTextAreaElement).selectionStart);
          }}
          onPaste={handlePaste}
          onKeyDown={handleEditorKeyDown}
          onCompositionEnd={(e) => { const ta = e.target as HTMLTextAreaElement; updateTagSuggestions(ta.value, ta.selectionStart); }}
          onScroll={(e) => {
            const overlay = (e.target as HTMLElement).previousElementSibling as HTMLElement;
            if (overlay) overlay.scrollTop = (e.target as HTMLElement).scrollTop;
            // update dropdown position on scroll
            updateTagSuggestions(content, textareaRef.current?.selectionStart ?? content.length);
          }}
        />
      </div>
      {images.length > 0 ? (
        <SortableImagePreviewList
          items={images.map((img) => ({ id: img.url, url: img.url, name: img.name }))}
          onReorder={(nextItems) => {
            draftUserInputRef.current = true;
            setImages(nextItems.map((item) => {
              const previous = images.find((image) => image.url === item.url);
              return previous ? { ...previous, name: item.name } : { url: item.url, name: item.name };
            }));
          }}
          onRemove={(index) => {
            draftUserInputRef.current = true;
            setImages((prev) => {
              const removed = prev[index];
              if (removed) revokeImageObjectUrl(removed);
              return prev.filter((_, idx) => idx !== index);
            });
          }}
        />
      ) : null}
      {recordingState !== 'idle' || audioDraft ? (
        <div style={{ ...styles.voicePanel, background: c.inputBg }}>
          {recordingState === 'recording' ? (
            <>
              <div style={{ ...styles.voiceStatus, color: c.textTertiary }}>正在录音 {formatDuration(recordingDurationMs)}</div>
              <button type="button" style={{ ...styles.voiceGhostButton, background: c.cardBg, color: c.textPrimary, borderColor: c.borderMedium }} onClick={cancelRecording}>
                取消录音
              </button>
              <button type="button" style={{ ...styles.voiceActionButton, background: c.cardBg, color: c.textPrimary, borderColor: c.borderMedium }} onClick={stopRecording}>
                停止录音
              </button>
            </>
          ) : null}
          {audioDraft ? (
            <>
              <audio controls src={audioDraft.previewUrl} style={styles.voicePlayer} />
              {transcriptText ? <div style={{ ...styles.transcriptPreview, color: c.textTertiary }}>{transcriptText}</div> : null}
              <div style={styles.voiceActions}>
                <button type="button" style={{ ...styles.voiceGhostButton, background: c.cardBg, color: c.textPrimary, borderColor: c.borderMedium }} onClick={resetVoiceDraft}>
                  取消
                </button>
                <button type="button" style={{ ...styles.voiceGhostButton, background: c.cardBg, color: c.textPrimary, borderColor: c.borderMedium }} onClick={startRecording} disabled={submitting}>
                  重录
                </button>
                <button
                  type="button"
                  style={{ ...styles.voicePrimaryButton, ...(submitting || !canPublish ? styles.disabledButton : null) }}
                  onClick={handleSubmit}
                  disabled={submitting || !canPublish}
                  title={!canPublish ? (authState === 'pending' ? '正在验证身份...' : '登录后发布') : '保存语音笔记'}
                >
                  {!canPublish ? '🔒 验证身份后发布' : '保存语音笔记'}
                </button>
              </div>
            </>
          ) : null}
        </div>
      ) : null}
      {submitError ? <div role="alert" style={{ padding: '0 20px 8px', color: '#c24b4b', fontSize: 13 }}>{submitError}</div> : null}
      <div style={{ ...styles.toolbar, borderTopColor: c.borderLight }}>
        <div style={styles.toolsRow}>
          <button type="button" style={{ ...styles.fmtButton, color: '#3aa864', fontWeight: 700 }} title="添加标签" onClick={() => {
            const ta = textareaRef.current;
            if (!ta) return;
            const pos = ta.selectionStart;
            const before = content.slice(0, pos);
            const after = content.slice(pos);
            const prefix = pos > 0 && content[pos - 1] !== ' ' && content[pos - 1] !== '\n' ? ' #' : '#';
            draftUserInputRef.current = true;
            setContent(before + prefix + after);
            setTimeout(() => { ta.focus(); ta.setSelectionRange(pos + prefix.length, pos + prefix.length); }, 0);
          }}>
            #
          </button>
          <span style={styles.fmtDivider} />
          {isNarrowScreen ? (
            <div ref={formatMenuRef} style={styles.moreMenu}>
              <button
                ref={moreButtonRef}
                type="button"
                style={{ ...styles.fmtButton, ...styles.moreButton }}
                title="更多格式"
                aria-haspopup="menu"
                aria-expanded={formatMenuOpen}
                aria-controls={formatMenuId}
                onClick={() => setFormatMenuOpen((open) => !open)}
              >
                更多
              </button>
              {formatMenuOpen ? (
                <MenuSurface
                  id={formatMenuId}
                  label="更多格式"
                  aria-orientation="vertical"
                  onKeyDown={handleFormatMenuKeyDown}
                  style={{ ...styles.formatMenu, background: c.cardBg, borderColor: c.borderMedium }}
                >
                  <MenuItem aria-label="加粗" style={{ ...styles.formatMenuItem, color: c.textPrimary }} onClick={() => runFormatMenuAction(() => wrapSelection('**', '**'))}>
                    <strong aria-hidden="true">B</strong><span>加粗</span>
                  </MenuItem>
                  <MenuItem aria-label="斜体" style={{ ...styles.formatMenuItem, color: c.textPrimary }} onClick={() => runFormatMenuAction(() => wrapSelection('*', '*'))}>
                    <em aria-hidden="true">I</em><span>斜体</span>
                  </MenuItem>
                  <MenuItem aria-label="下划线" style={{ ...styles.formatMenuItem, color: c.textPrimary }} onClick={() => runFormatMenuAction(() => wrapSelection('<u>', '</u>'))}>
                    <span aria-hidden="true" style={{ textDecoration: 'underline' }}>U</span><span>下划线</span>
                  </MenuItem>
                  <MenuItem aria-label="代码块" style={{ ...styles.formatMenuItem, color: c.textPrimary }} onClick={() => runFormatMenuAction(() => wrapSelection('```\n', '\n```'))}>
                    <span aria-hidden="true" style={{ fontFamily: 'ui-monospace, monospace', fontSize: 12 }}>&lt;/&gt;</span><span>代码块</span>
                  </MenuItem>
                  <MenuItem aria-label="无序列表" style={{ ...styles.formatMenuItem, color: c.textPrimary }} onClick={() => runFormatMenuAction(() => insertLinePrefix('- '))}>
                    <span aria-hidden="true">•</span><span>无序列表</span>
                  </MenuItem>
                  <MenuItem aria-label="有序列表" style={{ ...styles.formatMenuItem, color: c.textPrimary }} onClick={() => runFormatMenuAction(() => insertLinePrefix('1. '))}>
                    <span aria-hidden="true">1.</span><span>有序列表</span>
                  </MenuItem>
                </MenuSurface>
              ) : null}
            </div>
          ) : (
            <>
              <button type="button" style={styles.fmtButton} title="加粗" onClick={() => wrapSelection('**', '**')}>
                <strong>B</strong>
              </button>
              <button type="button" style={styles.fmtButton} title="斜体" onClick={() => wrapSelection('*', '*')}>
                <em>I</em>
              </button>
              <button type="button" style={styles.fmtButton} title="下划线" onClick={() => wrapSelection('<u>', '</u>')}>
                <span style={{ textDecoration: 'underline' }}>U</span>
              </button>
              <button type="button" style={styles.fmtButton} title="代码块" onClick={() => wrapSelection('```\n', '\n```')}>
                <span style={{ fontFamily: 'ui-monospace, monospace', fontSize: 12 }}>&lt;/&gt;</span>
              </button>
              <span style={styles.fmtDivider} />
              <button type="button" style={styles.fmtButton} title="无序列表" onClick={() => insertLinePrefix('- ')}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#666" strokeWidth="2"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><circle cx="4" cy="6" r="1" fill="#666"/><circle cx="4" cy="12" r="1" fill="#666"/><circle cx="4" cy="18" r="1" fill="#666"/></svg>
              </button>
              <button type="button" style={styles.fmtButton} title="有序列表" onClick={() => insertLinePrefix('1. ')}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#666" strokeWidth="2"><line x1="10" y1="6" x2="21" y2="6"/><line x1="10" y1="12" x2="21" y2="12"/><line x1="10" y1="18" x2="21" y2="18"/><text x="2" y="8" fill="#666" stroke="none" fontSize="8" fontFamily="sans-serif">1</text><text x="2" y="14" fill="#666" stroke="none" fontSize="8" fontFamily="sans-serif">2</text><text x="2" y="20" fill="#666" stroke="none" fontSize="8" fontFamily="sans-serif">3</text></svg>
              </button>
            </>
          )}
          <span style={styles.fmtDivider} />
          <button type="button" style={styles.toolIcon} title="上传图片" onClick={() => fileInputRef.current?.click()}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#999" strokeWidth="2"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m21 15-5-5L5 21"/></svg>
          </button>
          <button
            type="button"
            style={{ ...styles.toolIcon, ...(!isRecordingSupported ? styles.disabledToolIcon : null) }}
            title={isRecordingSupported ? '录音' : '当前浏览器不支持录音'}
            aria-label="录音"
            aria-disabled={isRecordingSupported ? undefined : 'true'}
            onClick={startRecording}
            disabled={!isRecordingSupported || recordingState === 'recording' || submitting}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#999" strokeWidth="2"><path d="M12 3a3 3 0 0 1 3 3v6a3 3 0 0 1-6 0V6a3 3 0 0 1 3-3Z"/><path d="M19 11a7 7 0 0 1-14 0"/><path d="M12 18v3"/><path d="M8 21h8"/></svg>
          </button>
          <input
            ref={fileInputRef}
            aria-label="上传图片"
            type="file"
            accept="image/*"
            style={{ display: 'none' }}
            onChange={async (event) => {
              const input = event.currentTarget;
              const file = input.files?.[0];
              if (!file) return;
              await uploadImage(file);
              input.value = '';
            }}
          />
          <label style={styles.selectWrap}>
            <select aria-label="可见性" value={visibility} onChange={(event) => { draftUserInputRef.current = true; setVisibility(event.target.value as 'public' | 'private'); }} style={{ ...styles.select, background: c.inputBg, color: c.textTertiary, borderColor: c.borderMedium }}>
              <option value="public">公开</option>
              <option value="private">私密</option>
            </select>
          </label>
          <input aria-label="归属日期" type="date" value={displayDate} onChange={(event) => { draftUserInputRef.current = true; setDisplayDate(event.target.value); }} style={{ ...styles.dateInput, background: c.inputBg, color: c.textTertiary, borderColor: c.borderMedium }} />
        </div>
        {hasDraft ? (
          <button type="button" style={{ ...styles.cancelButton, color: c.textMuted }} onClick={cancelDraft}>
            取消
          </button>
        ) : null}
        <button type="button" style={{ ...styles.submitButton, ...(submitting || !canPublish ? { opacity: 0.5, cursor: 'not-allowed' } : {}) }} onClick={handleSubmit} disabled={submitting || !canPublish} title={submitting ? '发布中...' : (authState === 'pending' ? '正在验证身份...' : (!canPublish ? '登录后发布' : '发布'))}>
          {submitting ? <span style={{ fontSize: 12, color: '#fff' }}>...</span> : !canPublish ? <span aria-hidden="true">🔒</span> : <svg width="18" height="18" viewBox="0 0 24 24" fill="white"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/></svg>}
        </button>
      </div>
    </section>
    {tagDropdown && createPortal(
      <div style={{ position: 'fixed', top: tagDropdown.top, left: tagDropdown.left, zIndex: 9999, background: isDark ? '#2a2a2a' : '#fff', border: `1px solid ${c.borderMedium}`, borderRadius: 10, boxShadow: '0 4px 16px rgba(0,0,0,0.18)', minWidth: 160, maxWidth: 280, maxHeight: `${5 * 40}px`, overflowY: 'auto' }}>
        {tagDropdown.suggestions.map((tag, i) => (
          <button key={tag} type="button" tabIndex={-1} onMouseDown={(e) => { e.preventDefault(); applyTagSuggestion(tag); }}
            onMouseEnter={() => setTagIndex(i)}
            style={{ display: 'block', width: '100%', textAlign: 'left', border: 'none', background: i === tagIndex ? (isDark ? '#333' : '#f0f0f0') : 'transparent', padding: '8px 14px', fontSize: 14, color: '#3aa864', cursor: 'pointer', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            #{tag}
          </button>
        ))}
      </div>,
      document.body,
    )}
    </>
  );
};

const sharedFont: React.CSSProperties = {
  fontSize: 15,
  lineHeight: 1.6,
  fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
  letterSpacing: 'normal',
  wordSpacing: 'normal',
  whiteSpace: 'pre-wrap',
  wordBreak: 'break-word',
};

const styles: Record<string, React.CSSProperties> = {
  card: {
    background: '#fff',
    borderRadius: 12,
    border: '1px solid #e8e8e8',
    overflow: 'hidden',
    marginBottom: 16,
  },
  editorWrap: {
    position: 'relative',
  },
  highlightOverlay: {
    ...sharedFont,
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    padding: '16px 20px 8px',
    boxSizing: 'border-box',
    overflow: 'hidden',
    pointerEvents: 'none',
  },
  textarea: {
    ...sharedFont,
    width: '100%',
    minHeight: 100,
    maxHeight: 'min(60vh, 420px)',
    padding: '16px 20px 8px',
    border: 'none',
    outline: 'none',
    resize: 'none',
    overflowY: 'hidden',
    boxSizing: 'border-box',
    background: 'transparent',
    color: 'transparent',
    position: 'relative',
    zIndex: 1,
  },
  toolbar: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: 8,
    padding: '8px 12px',
    borderTop: '1px solid #f5f5f5',
  },
  toolsRow: {
    flex: 1,
    display: 'flex',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 4,
  },
  fmtButton: {
    border: 'none',
    background: 'transparent',
    cursor: 'pointer',
    padding: '4px 6px',
    fontSize: 14,
    color: '#666',
    borderRadius: 4,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 28,
  },
  fmtDivider: {
    width: 1,
    height: 16,
    background: '#e0e0e0',
    margin: '0 2px',
  },
  moreMenu: {
    position: 'relative',
    display: 'flex',
    alignItems: 'center',
  },
  moreButton: {
    padding: '4px 8px',
    minWidth: 'auto',
  },
  formatMenu: {
    position: 'absolute',
    left: 0,
    bottom: 'calc(100% + 8px)',
    zIndex: 2,
    display: 'flex',
    flexDirection: 'column',
    minWidth: 148,
    padding: 4,
    border: '1px solid',
    borderRadius: 8,
    boxShadow: '0 4px 16px rgba(0,0,0,0.18)',
  },
  formatMenuItem: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    width: '100%',
    minHeight: 34,
    padding: '6px 10px',
    border: 'none',
    borderRadius: 6,
    background: 'transparent',
    textAlign: 'left',
    fontSize: 14,
    cursor: 'pointer',
    boxSizing: 'border-box',
  },
  toolIcon: {
    border: 'none',
    background: 'transparent',
    cursor: 'pointer',
    padding: 4,
    display: 'flex',
    alignItems: 'center',
  },
  disabledToolIcon: {
    opacity: 0.45,
    cursor: 'not-allowed',
  },
  voicePanel: {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 10,
    padding: '8px 20px 12px',
  },
  voiceStatus: {
    fontSize: 14,
    color: '#666',
    flex: '1 1 180px',
  },
  voicePlayer: {
    width: '100%',
    minWidth: 0,
  },
  voiceActions: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: 8,
    width: '100%',
  },
  transcriptPreview: {
    width: '100%',
    fontSize: 14,
    lineHeight: 1.6,
    color: '#666',
  },
  voiceActionButton: {
    border: '1px solid #e0e0e0',
    background: '#fff',
    borderRadius: 999,
    padding: '8px 14px',
    fontSize: 14,
    cursor: 'pointer',
  },
  voiceGhostButton: {
    border: '1px solid #e0e0e0',
    background: '#fff',
    borderRadius: 999,
    padding: '8px 14px',
    fontSize: 14,
    cursor: 'pointer',
  },
  voicePrimaryButton: {
    border: 'none',
    background: '#31d266',
    color: '#fff',
    borderRadius: 999,
    padding: '8px 14px',
    fontSize: 14,
    cursor: 'pointer',
  },
  disabledButton: {
    opacity: 0.5,
    cursor: 'not-allowed',
  },
  selectWrap: {
    display: 'flex',
    alignItems: 'center',
  },
  select: {
    borderRadius: 8,
    border: '1px solid #e0e0e0',
    padding: '0 8px',
    background: '#fff',
    fontSize: 14,
    color: '#555',
    height: 32,
    boxSizing: 'border-box',
  },
  dateInput: {
    borderRadius: 8,
    border: '1px solid #e0e0e0',
    padding: '0 8px',
    background: '#fff',
    fontSize: 14,
    color: '#555',
    height: 32,
    boxSizing: 'border-box',
  },
  cancelButton: {
    border: 'none',
    background: 'transparent',
    cursor: 'pointer',
    borderRadius: 6,
    padding: '0 8px',
    height: 36,
    fontSize: 14,
    flexShrink: 0,
  },
  submitButton: {
    border: 'none',
    borderRadius: '50%',
    width: 36,
    height: 36,
    background: '#31d266',
    color: '#fff',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
};
