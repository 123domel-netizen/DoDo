import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { History, X } from "lucide-react";
import { fetchRevisions } from "@/lib/chat/api";
import type { ChatMessage, ChatProfile, MessageRevision } from "@/lib/chat/types";
import { formatMessageTime } from "@/components/chat/MessageBubble";

interface EditHistoryModalProps {
  msg: ChatMessage | null;
  profiles: Record<string, ChatProfile>;
  onClose: () => void;
}

/** Historia edycji wiadomości: kto, kiedy, poprzednie wersje treści. */
export function EditHistoryModal({ msg, profiles, onClose }: EditHistoryModalProps) {
  const [revisions, setRevisions] = useState<MessageRevision[] | null>(null);

  useEffect(() => {
    if (!msg) {
      setRevisions(null);
      return;
    }
    let cancelled = false;
    void fetchRevisions(msg.id).then((r) => {
      if (!cancelled) setRevisions(r);
    });
    return () => {
      cancelled = true;
    };
  }, [msg]);

  if (!msg) return null;

  const authorName = (id: string | null) =>
    (id && profiles[id]?.displayName) || "Nieznany";

  return createPortal(
    <div className="fixed inset-0 z-[70] flex items-end justify-center sm:items-center">
      <button
        type="button"
        className="absolute inset-0 bg-black/50"
        aria-label="Zamknij"
        onClick={onClose}
      />
      <div className="relative flex max-h-[75vh] w-full max-w-md flex-col rounded-t-2xl border border-line bg-surface-overlay p-4 shadow-pop sm:rounded-2xl">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-ink">
            <History size={15} className="text-accent" /> Historia edycji
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-ink-faint transition hover:text-ink"
            aria-label="Zamknij"
          >
            <X size={16} />
          </button>
        </div>

        <div className="thin-scrollbar flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto">
          <div className="rounded-xl border border-accent/30 bg-accent/5 px-3 py-2">
            <div className="mb-0.5 text-[10px] font-medium uppercase tracking-wide text-accent">
              Aktualna wersja
              {msg.editedAt ? ` · ${formatMessageTime(msg.editedAt)}` : ""}
            </div>
            <div className="whitespace-pre-wrap break-words text-sm text-ink">
              {msg.body}
            </div>
          </div>

          {revisions === null && (
            <div className="py-4 text-center text-xs text-ink-faint">Wczytywanie…</div>
          )}
          {revisions?.map((rev) => (
            <div key={rev.id} className="rounded-xl border border-line bg-surface-raised px-3 py-2">
              <div className="mb-0.5 text-[10px] text-ink-faint">
                {authorName(rev.editedBy)} · {formatMessageTime(rev.editedAt)}
              </div>
              <div className="whitespace-pre-wrap break-words text-sm text-ink-light">
                {rev.body}
              </div>
            </div>
          ))}
          {revisions?.length === 0 && (
            <div className="py-4 text-center text-xs text-ink-faint">
              Brak wcześniejszych wersji.
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
