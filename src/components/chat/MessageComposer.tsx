import { useEffect, useRef, useState } from "react";
import {
  BarChart3,
  CornerUpLeft,
  Film,
  Images,
  Mic,
  Paperclip,
  Plus,
  Send,
  Smile,
  Trash2,
  X,
} from "lucide-react";
import { useIsMobile } from "@/hooks/useMediaQuery";
import { MAX_CHAT_FILE_BYTES, formatFileSize } from "@/lib/chat/upload";
import {
  applyMention,
  collectMentions,
  mentionQueryAt,
  mentionSuggestions,
  type MentionableMember,
  type MentionQuery,
} from "@/lib/chat/mentions";
import {
  formatDuration,
  startVoiceRecording,
  voiceSupported,
  type ActiveRecorder,
} from "@/lib/chat/voice";
import { PollCreateDialog } from "@/components/chat/PollCreateDialog";
import { GifPicker } from "@/components/chat/GifPicker";
import { EmojiPicker } from "@/components/chat/EmojiPicker";

export interface ReplyTarget {
  id: string;
  authorName: string;
  snippet: string;
}

interface MessageComposerProps {
  onSend: (
    body: string,
    files: File[],
    mentions: string[],
    opts?: { attachMode?: "photo" | "file" },
  ) => void | Promise<void>;
  placeholder?: string;
  /** Tryb edycji istniejącej wiadomości. */
  editing?: { id: string; body: string } | null;
  onSaveEdit?: (id: string, body: string, mentions: string[]) => void;
  onCancelEdit?: () => void;
  /** Odpowiedź na wiadomość (cytat). */
  replyTo?: ReplyTarget | null;
  onCancelReply?: () => void;
  /** Członkowie rozmowy (autouzupełnianie wzmianek @). */
  members?: MentionableMember[];
  myUserId?: string | null;
  onSendVoice?: (file: File, durationSec: number) => void | Promise<void>;
  onSendPoll?: (question: string, options: string[]) => void;
  onSendGif?: (url: string) => void;
  onOpenGallery?: () => void;
  /** Sygnał „piszę" (throttling po stronie odbiorcy hooka). */
  onTyping?: () => void;
  disabled?: boolean;
  allowFiles?: boolean;
  autoFocus?: boolean;
}

export function MessageComposer({
  onSend,
  placeholder = "Napisz wiadomość…",
  editing = null,
  onSaveEdit,
  onCancelEdit,
  replyTo = null,
  onCancelReply,
  members = [],
  myUserId = null,
  onSendVoice,
  onSendPoll,
  onSendGif,
  onOpenGallery,
  onTyping,
  disabled = false,
  allowFiles = true,
  autoFocus = false,
}: MessageComposerProps) {
  const [body, setBody] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [attachMode, setAttachMode] = useState<"photo" | "file">("file");
  const [imageModePrompt, setImageModePrompt] = useState<File[] | null>(null);
  const [sending, setSending] = useState(false);
  const [mention, setMention] = useState<MentionQuery | null>(null);
  const [plusOpen, setPlusOpen] = useState(false);
  const [pollOpen, setPollOpen] = useState(false);
  const [gifOpen, setGifOpen] = useState(false);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [recording, setRecording] = useState(false);
  const [recordSec, setRecordSec] = useState(0);
  const recorderRef = useRef<ActiveRecorder | null>(null);
  const recordTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const isMobile = useIsMobile();

  useEffect(() => {
    if (editing) {
      setBody(editing.body);
      taRef.current?.focus();
    }
  }, [editing]);

  useEffect(() => {
    if (replyTo) taRef.current?.focus();
  }, [replyTo]);

  useEffect(() => {
    if (autoFocus && !isMobile) taRef.current?.focus();
  }, [autoFocus, isMobile]);

  useEffect(
    () => () => {
      recorderRef.current?.cancel();
      if (recordTimerRef.current) clearInterval(recordTimerRef.current);
    },
    [],
  );

  const autoGrow = () => {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = `${Math.min(ta.scrollHeight, 132)}px`;
  };

  const refreshMention = () => {
    const ta = taRef.current;
    if (!ta || !members.length) {
      setMention(null);
      return;
    }
    setMention(mentionQueryAt(ta.value, ta.selectionStart ?? ta.value.length));
  };

  const suggestions = mention
    ? mentionSuggestions(members, mention.query, myUserId)
    : [];

  const pickMention = (m: MentionableMember) => {
    const ta = taRef.current;
    if (!ta || !mention) return;
    const caret = ta.selectionStart ?? body.length;
    const next = applyMention(body, caret, mention, m.displayName);
    setBody(next.text);
    setMention(null);
    requestAnimationFrame(() => {
      ta.focus();
      ta.setSelectionRange(next.caret, next.caret);
      autoGrow();
    });
  };

  const insertEmoji = (emoji: string) => {
    const ta = taRef.current;
    const start = ta?.selectionStart ?? body.length;
    const end = ta?.selectionEnd ?? start;
    const next = body.slice(0, start) + emoji + body.slice(end);
    const caret = start + emoji.length;
    setBody(next);
    requestAnimationFrame(() => {
      if (!ta) return;
      ta.focus();
      ta.setSelectionRange(caret, caret);
      autoGrow();
    });
  };

  const submit = async () => {
    const trimmed = body.trim();
    const mentions = collectMentions(trimmed, members);
    if (editing) {
      if (!trimmed) return;
      onSaveEdit?.(editing.id, trimmed, mentions);
      setBody("");
      return;
    }
    if (!trimmed && files.length === 0) return;
    setSending(true);
    try {
      await onSend(trimmed, files, mentions, { attachMode });
      setBody("");
      setFiles([]);
      setAttachMode("file");
      setMention(null);
      if (taRef.current) taRef.current.style.height = "auto";
    } finally {
      setSending(false);
    }
  };

  const addFiles = (list: FileList | null) => {
    if (!list) return;
    const incoming = Array.from(list).filter((f) => {
      if (f.size > MAX_CHAT_FILE_BYTES) {
        alert(`${f.name}: plik przekracza 25 MB.`);
        return false;
      }
      return true;
    });
    if (!incoming.length) return;
    const hasImage = incoming.some((f) => /^image\//i.test(f.type));
    if (hasImage) {
      setImageModePrompt(incoming);
      return;
    }
    setAttachMode("file");
    setFiles((prev) => [...prev, ...incoming].slice(0, 6));
  };

  const confirmImageMode = (mode: "photo" | "file") => {
    if (!imageModePrompt) return;
    setAttachMode(mode);
    setFiles((prev) => [...prev, ...imageModePrompt].slice(0, 6));
    setImageModePrompt(null);
  };

  const startRecording = async () => {
    if (!voiceSupported() || recording) return;
    try {
      recorderRef.current = await startVoiceRecording();
    } catch {
      alert("Brak dostępu do mikrofonu.");
      return;
    }
    setRecording(true);
    setRecordSec(0);
    recordTimerRef.current = setInterval(() => setRecordSec((s) => s + 1), 1000);
  };

  const finishRecording = async (send: boolean) => {
    const rec = recorderRef.current;
    recorderRef.current = null;
    if (recordTimerRef.current) {
      clearInterval(recordTimerRef.current);
      recordTimerRef.current = null;
    }
    setRecording(false);
    if (!rec) return;
    if (!send) {
      rec.cancel();
      return;
    }
    const result = await rec.stop();
    if (result && onSendVoice) await onSendVoice(result.file, result.durationSec);
  };

  const showMic = Boolean(onSendVoice) && voiceSupported() && !body.trim() && !editing;

  return (
    <div className="relative border-t border-line bg-surface px-2 py-2">
      {imageModePrompt && (
        <div className="absolute inset-x-2 bottom-full z-50 mb-2 rounded-xl border border-line bg-surface-overlay p-3 shadow-pop">
          <p className="mb-2 text-sm font-medium text-ink">Jak wysłać zdjęcie?</p>
          <div className="flex flex-col gap-1.5">
            <button
              type="button"
              onClick={() => confirmImageMode("photo")}
              className="rounded-lg bg-accent px-3 py-2.5 text-left text-sm font-medium text-white"
            >
              Wyślij jako zdjęcie
              <span className="mt-0.5 block text-[11px] font-normal opacity-90">
                Optymalizacja do 2560 px + miniatura
              </span>
            </button>
            <button
              type="button"
              onClick={() => confirmImageMode("file")}
              className="rounded-lg border border-line bg-surface-raised px-3 py-2.5 text-left text-sm text-ink"
            >
              Wyślij jako plik
              <span className="mt-0.5 block text-[11px] text-ink-faint">
                Oryginał bez kompresji
              </span>
            </button>
            <button
              type="button"
              onClick={() => setImageModePrompt(null)}
              className="py-1.5 text-center text-xs text-ink-faint"
            >
              Anuluj
            </button>
          </div>
        </div>
      )}
      {suggestions.length > 0 && !editing && (
        <div className="absolute bottom-full left-2 right-2 z-50 mb-1 overflow-hidden rounded-xl border border-line bg-surface-overlay shadow-pop">
          {suggestions.map((m) => (
            <button
              key={m.userId}
              type="button"
              onClick={() => pickMention(m)}
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-ink transition hover:bg-surface-raised"
            >
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-accent/15 text-[11px] font-semibold text-accent">
                {m.displayName.slice(0, 1).toUpperCase()}
              </span>
              {m.displayName}
            </button>
          ))}
        </div>
      )}

      {editing && (
        <div className="mb-1.5 flex items-center gap-2 rounded-lg border border-accent/30 bg-accent/10 px-2.5 py-1 text-[11px] text-ink-light">
          <span className="flex-1">Edytujesz wiadomość</span>
          <button
            type="button"
            onClick={() => {
              setBody("");
              onCancelEdit?.();
            }}
            className="rounded p-0.5 text-ink-faint transition hover:text-ink"
            aria-label="Anuluj edycję"
          >
            <X size={13} />
          </button>
        </div>
      )}

      {replyTo && !editing && (
        <div className="mb-1.5 flex items-start gap-2 rounded-lg border border-line bg-surface-raised px-2.5 py-1.5 text-[11px]">
          <CornerUpLeft size={12} className="mt-0.5 shrink-0 text-accent" />
          <span className="min-w-0 flex-1">
            <span className="block font-medium text-accent">{replyTo.authorName}</span>
            <span className="line-clamp-1 text-ink-faint">{replyTo.snippet}</span>
          </span>
          <button
            type="button"
            onClick={onCancelReply}
            className="rounded p-0.5 text-ink-faint transition hover:text-ink"
            aria-label="Anuluj odpowiedź"
          >
            <X size={13} />
          </button>
        </div>
      )}

      {files.length > 0 && (
        <div className="mb-1.5 flex flex-wrap gap-1.5">
          {files.map((f, i) => (
            <span
              key={`${f.name}-${i}`}
              className="flex items-center gap-1.5 rounded-full border border-line bg-surface-raised px-2 py-0.5 text-[11px] text-ink-light"
            >
              <span className="max-w-[9rem] truncate">{f.name}</span>
              <span className="text-ink-faint">{formatFileSize(f.size)}</span>
              <button
                type="button"
                onClick={() => setFiles(files.filter((_, j) => j !== i))}
                className="text-ink-faint transition hover:text-ink"
                aria-label={`Usuń ${f.name}`}
              >
                <X size={11} />
              </button>
            </span>
          ))}
        </div>
      )}

      {recording ? (
        <div className="flex items-center gap-2">
          <span className="flex h-2.5 w-2.5 animate-pulse rounded-full bg-red-500" />
          <span className="flex-1 text-sm text-ink">
            Nagrywanie… {formatDuration(recordSec)}
          </span>
          <button
            type="button"
            onClick={() => void finishRecording(false)}
            className="rounded-lg p-2 text-ink-faint transition hover:bg-surface-overlay hover:text-red-400"
            aria-label="Odrzuć nagranie"
          >
            <Trash2 size={17} />
          </button>
          <button
            type="button"
            onClick={() => void finishRecording(true)}
            className="rounded-xl bg-accent-grad p-2.5 text-white shadow-glow transition hover:brightness-110"
            aria-label="Wyślij nagranie"
          >
            <Send size={16} />
          </button>
        </div>
      ) : (
        <div className="flex items-end gap-1">
          <div className="relative shrink-0 self-center">
            <button
              type="button"
              onClick={() => setEmojiOpen((v) => !v)}
              disabled={disabled}
              className="rounded-full p-2 text-ink-faint transition hover:bg-surface-overlay hover:text-ink disabled:opacity-40"
              aria-label="Emotikony"
              aria-expanded={emojiOpen}
            >
              <Smile size={22} strokeWidth={1.75} />
            </button>
            <EmojiPicker
              open={emojiOpen}
              onClose={() => setEmojiOpen(false)}
              onPick={insertEmoji}
            />
          </div>

          <textarea
            ref={taRef}
            value={body}
            disabled={disabled}
            rows={1}
            placeholder={disabled ? "Rozmowa zarchiwizowana" : placeholder}
            onChange={(e) => {
              setBody(e.target.value);
              autoGrow();
              refreshMention();
              if (!editing && e.target.value.trim()) onTyping?.();
            }}
            onKeyUp={refreshMention}
            onClick={refreshMention}
            onBlur={() => setTimeout(() => setMention(null), 200)}
            onKeyDown={(e) => {
              if (suggestions.length > 0 && e.key === "Escape") {
                setMention(null);
                return;
              }
              if (
                suggestions.length > 0 &&
                (e.key === "Enter" || e.key === "Tab") &&
                !e.shiftKey
              ) {
                e.preventDefault();
                pickMention(suggestions[0]);
                return;
              }
              if (!isMobile && e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void submit();
              }
            }}
            className="min-h-[40px] max-h-[132px] flex-1 resize-none rounded-[1.25rem] border border-line bg-surface-raised px-3.5 py-2.5 text-sm leading-snug text-ink outline-none transition placeholder:text-ink-faint focus:border-accent/40 disabled:opacity-50"
          />

          {(onSendPoll || onSendGif || onOpenGallery) && !editing && (
            <div className="relative shrink-0 self-center">
              <button
                type="button"
                onClick={() => setPlusOpen((v) => !v)}
                disabled={disabled}
                className="rounded-full p-2 text-ink-faint transition hover:bg-surface-overlay hover:text-ink disabled:opacity-40"
                aria-label="Więcej opcji"
              >
                <Plus size={22} strokeWidth={1.75} />
              </button>
              {plusOpen && (
                <>
                  <button
                    type="button"
                    className="fixed inset-0 z-40 cursor-default"
                    aria-label="Zamknij menu"
                    onClick={() => setPlusOpen(false)}
                  />
                  <div className="absolute bottom-full right-0 z-50 mb-1 w-40 rounded-xl border border-line bg-surface-overlay p-1 shadow-pop">
                    {onSendPoll && (
                      <button
                        type="button"
                        onClick={() => {
                          setPlusOpen(false);
                          setPollOpen(true);
                        }}
                        className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs text-ink transition hover:bg-surface-raised"
                      >
                        <BarChart3 size={14} className="text-ink-faint" /> Ankieta
                      </button>
                    )}
                    {onSendGif && (
                      <button
                        type="button"
                        onClick={() => {
                          setPlusOpen(false);
                          setGifOpen(true);
                        }}
                        className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs text-ink transition hover:bg-surface-raised"
                      >
                        <Film size={14} className="text-ink-faint" /> GIF
                      </button>
                    )}
                    {onOpenGallery && (
                      <button
                        type="button"
                        onClick={() => {
                          setPlusOpen(false);
                          onOpenGallery();
                        }}
                        className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs text-ink transition hover:bg-surface-raised"
                      >
                        <Images size={14} className="text-ink-faint" /> Galeria
                      </button>
                    )}
                  </div>
                </>
              )}
            </div>
          )}

          {allowFiles && !editing && (
            <>
              <input
                ref={fileRef}
                type="file"
                multiple
                className="hidden"
                onChange={(e) => {
                  addFiles(e.target.files);
                  e.target.value = "";
                }}
              />
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                disabled={disabled}
                className="shrink-0 self-center rounded-full p-2 text-ink-faint transition hover:bg-surface-overlay hover:text-ink disabled:opacity-40"
                aria-label="Dodaj załącznik"
              >
                <Paperclip size={20} strokeWidth={1.75} />
              </button>
            </>
          )}

          {showMic ? (
            <button
              type="button"
              onClick={() => void startRecording()}
              disabled={disabled}
              className="shrink-0 self-center rounded-full p-2 text-ink-faint transition hover:bg-surface-overlay hover:text-ink disabled:opacity-40"
              aria-label="Nagraj wiadomość głosową"
            >
              <Mic size={22} strokeWidth={1.75} />
            </button>
          ) : (
            <button
              type="button"
              onClick={() => void submit()}
              disabled={disabled || sending || (!body.trim() && files.length === 0)}
              className="shrink-0 self-center rounded-full bg-accent-grad p-2.5 text-white shadow-glow transition hover:brightness-110 disabled:opacity-40 disabled:shadow-none"
              aria-label={editing ? "Zapisz" : "Wyślij"}
            >
              <Send size={16} />
            </button>
          )}
        </div>
      )}

      <PollCreateDialog
        open={pollOpen}
        onClose={() => setPollOpen(false)}
        onCreate={(q, opts) => onSendPoll?.(q, opts)}
      />
      <GifPicker
        open={gifOpen}
        onClose={() => setGifOpen(false)}
        onPick={(url) => onSendGif?.(url)}
      />
    </div>
  );
}
