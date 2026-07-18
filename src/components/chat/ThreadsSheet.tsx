import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { MessageSquare, Pin, X } from "lucide-react";
import { fetchThreadsList } from "@/lib/chat/api";
import type { ChatProfile, ThreadListEntry } from "@/lib/chat/types";
import { formatMessageTime } from "@/components/chat/MessageBubble";

interface ThreadsSheetProps {
  conversationId: string;
  profiles: Record<string, ChatProfile>;
  onClose: () => void;
  onOpenThread: (rootId: string) => void;
}

/** CHAT6: lista wszystkich wątków rozmowy (rooty z odpowiedziami). */
export function ThreadsSheet({
  conversationId,
  profiles,
  onClose,
  onOpenThread,
}: ThreadsSheetProps) {
  const [threads, setThreads] = useState<ThreadListEntry[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    void fetchThreadsList(conversationId).then((t) => {
      if (!cancelled) setThreads(t);
    });
    return () => {
      cancelled = true;
    };
  }, [conversationId]);

  return createPortal(
    <div className="fixed inset-0 z-[70] flex items-end justify-center sm:items-center">
      <button
        type="button"
        className="absolute inset-0 bg-black/50"
        aria-label="Zamknij"
        onClick={onClose}
      />
      <div className="relative flex max-h-[80vh] min-h-[40vh] w-full max-w-lg flex-col rounded-t-2xl border border-line bg-surface-overlay p-3 shadow-pop sm:rounded-2xl">
        <div className="mb-2 flex items-center justify-between px-1">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-ink">
            <MessageSquare size={15} className="text-accent" /> Wątki
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

        <div className="thin-scrollbar min-h-0 flex-1 overflow-y-auto">
          {threads === null && (
            <div className="py-10 text-center text-xs text-ink-faint">Wczytywanie…</div>
          )}
          {threads?.length === 0 && (
            <div className="px-6 py-10 text-center text-xs leading-relaxed text-ink-faint">
              Brak wątków w tej rozmowie.
              <br />
              Otwórz menu wiadomości i wybierz{" "}
              <span className="text-ink-light">„Odpowiedz w wątku”</span>.
            </div>
          )}
          <div className="flex flex-col gap-1.5">
            {threads?.map(({ root, replyCount }) => (
              <button
                key={root.id}
                type="button"
                onClick={() => {
                  onClose();
                  onOpenThread(root.id);
                }}
                className="rounded-xl border border-line bg-surface-raised px-3 py-2 text-left transition hover:border-line-strong"
              >
                <div className="flex items-center gap-1.5 text-[10px] text-ink-faint">
                  {root.pinnedAt && <Pin size={10} className="text-accent" />}
                  <span className="min-w-0 flex-1 truncate">
                    {profiles[root.authorUserId]?.displayName || "Nieznany"} ·{" "}
                    {formatMessageTime(root.createdAt)}
                  </span>
                  <span className="flex shrink-0 items-center gap-0.5 text-accent">
                    <MessageSquare size={10} /> {replyCount}
                  </span>
                </div>
                <div className="mt-0.5 line-clamp-2 break-words text-sm text-ink">
                  {root.deletedAt
                    ? "Wiadomość usunięta"
                    : root.threadTitle?.trim() ||
                      root.body ||
                      (root.kind === "gif" ? "GIF" : "(załącznik)")}
                </div>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
