import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { MessageSquare, X } from "lucide-react";
import type { ChatMessage } from "@/lib/chat/types";
import { defaultThreadTitle } from "@/lib/chat/feed";

interface NameThreadDialogProps {
  msg: ChatMessage;
  onConfirm: (title: string) => void;
  onCancel: () => void;
}

/** Kompaktowy dialog nazwy wątku — domyślnie treść wiadomości startowej. */
export function NameThreadDialog({ msg, onConfirm, onCancel }: NameThreadDialogProps) {
  const [title, setTitle] = useState(() => defaultThreadTitle(msg));
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  const submit = () => {
    const cleaned = title.trim();
    if (!cleaned) return;
    onConfirm(cleaned.slice(0, 200));
  };

  return createPortal(
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-4">
      <button
        type="button"
        className="absolute inset-0 bg-black/40"
        aria-label="Anuluj"
        onClick={onCancel}
      />
      <div
        role="dialog"
        aria-labelledby="name-thread-title"
        className="relative w-full max-w-sm overflow-hidden rounded-xl border border-line/80 bg-surface-overlay/95 shadow-[0_12px_40px_rgba(0,0,0,0.45)] backdrop-blur-md"
      >
        <div className="flex items-start gap-2 border-b border-line/60 px-3 py-2.5">
          <MessageSquare size={15} className="mt-0.5 shrink-0 text-accent" />
          <div className="min-w-0 flex-1">
            <h3 id="name-thread-title" className="text-sm font-semibold text-ink">
              Nazwij wątek
            </h3>
            <p className="mt-0.5 text-[11px] text-ink-faint">
              Domyślnie treść wiadomości — możesz zmienić.
            </p>
          </div>
          <button
            type="button"
            onClick={onCancel}
            className="rounded p-1 text-ink-faint transition hover:text-ink"
            aria-label="Zamknij"
          >
            <X size={15} />
          </button>
        </div>

        <form
          className="flex flex-col gap-3 p-3"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <input
            ref={inputRef}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={200}
            placeholder="Nazwa wątku"
            className="w-full rounded-lg border border-line bg-surface-raised px-3 py-2 text-sm text-ink outline-none transition placeholder:text-ink-faint focus:border-accent/50"
          />
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={onCancel}
              className="rounded-lg px-3 py-1.5 text-xs font-medium text-ink-light transition hover:bg-surface-raised hover:text-ink"
            >
              Anuluj
            </button>
            <button
              type="submit"
              disabled={!title.trim()}
              className="rounded-lg bg-accent/90 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-accent disabled:opacity-40"
            >
              Otwórz wątek
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body,
  );
}
