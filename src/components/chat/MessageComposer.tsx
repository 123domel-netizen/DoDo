import { useEffect, useRef, useState } from "react";
import { Paperclip, Send, X } from "lucide-react";
import { useIsMobile } from "@/hooks/useMediaQuery";
import { MAX_CHAT_FILE_BYTES, formatFileSize } from "@/lib/chat/upload";

interface MessageComposerProps {
  onSend: (body: string, files: File[]) => void | Promise<void>;
  placeholder?: string;
  /** Tryb edycji istniejącej wiadomości. */
  editing?: { id: string; body: string } | null;
  onSaveEdit?: (id: string, body: string) => void;
  onCancelEdit?: () => void;
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
  disabled = false,
  allowFiles = true,
  autoFocus = false,
}: MessageComposerProps) {
  const [body, setBody] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [sending, setSending] = useState(false);
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
    if (autoFocus && !isMobile) taRef.current?.focus();
  }, [autoFocus, isMobile]);

  const autoGrow = () => {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = `${Math.min(ta.scrollHeight, 132)}px`;
  };

  const submit = async () => {
    const trimmed = body.trim();
    if (editing) {
      if (!trimmed) return;
      onSaveEdit?.(editing.id, trimmed);
      setBody("");
      return;
    }
    if (!trimmed && files.length === 0) return;
    setSending(true);
    try {
      await onSend(trimmed, files);
      setBody("");
      setFiles([]);
      if (taRef.current) taRef.current.style.height = "auto";
    } finally {
      setSending(false);
    }
  };

  const addFiles = (list: FileList | null) => {
    if (!list) return;
    const next: File[] = [...files];
    for (const f of Array.from(list)) {
      if (f.size > MAX_CHAT_FILE_BYTES) {
        alert(`${f.name}: plik przekracza 25 MB.`);
        continue;
      }
      next.push(f);
    }
    setFiles(next.slice(0, 6));
  };

  return (
    <div className="border-t border-line bg-surface px-2 py-2">
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

      <div className="flex items-end gap-1.5">
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
              className="shrink-0 rounded-lg p-2 text-ink-faint transition hover:bg-surface-overlay hover:text-ink disabled:opacity-40"
              aria-label="Dodaj załącznik"
            >
              <Paperclip size={17} />
            </button>
          </>
        )}

        <textarea
          ref={taRef}
          value={body}
          disabled={disabled}
          rows={1}
          placeholder={disabled ? "Rozmowa zarchiwizowana" : placeholder}
          onChange={(e) => {
            setBody(e.target.value);
            autoGrow();
          }}
          onKeyDown={(e) => {
            if (!isMobile && e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void submit();
            }
          }}
          className="min-h-[38px] flex-1 resize-none rounded-xl border border-line bg-surface-raised px-3 py-2 text-sm text-ink outline-none transition placeholder:text-ink-faint focus:border-accent/50 disabled:opacity-50"
        />

        <button
          type="button"
          onClick={() => void submit()}
          disabled={disabled || sending || (!body.trim() && files.length === 0)}
          className="shrink-0 rounded-xl bg-accent-grad p-2.5 text-white shadow-glow transition hover:brightness-110 disabled:opacity-40 disabled:shadow-none"
          aria-label={editing ? "Zapisz" : "Wyślij"}
        >
          <Send size={16} />
        </button>
      </div>
    </div>
  );
}
