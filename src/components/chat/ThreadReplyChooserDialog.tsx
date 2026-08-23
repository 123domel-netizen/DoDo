import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import {
  GitBranchPlus,
  MessageSquare,
  Search,
  X,
} from "lucide-react";
import { fetchThreadsList } from "@/lib/chat/api";
import { threadDisplayTitle } from "@/lib/chat/feed";
import type { ChatMessage, ThreadListEntry } from "@/lib/chat/types";
import { formatMessageTime } from "@/components/chat/MessageBubble";
import { useChatStore } from "@/lib/chat/store";

type ChooserMode = "pick" | "assign";

interface ThreadReplyChooserDialogProps {
  msg: ChatMessage;
  onCreateNew: () => void;
  onAssign: (threadRootId: string) => void | Promise<void>;
  onCancel: () => void;
}

/**
 * Po „Odpowiedz w wątku” na samodzielnej wiadomości:
 * utwórz nowy wątek albo przypisz do istniejącego.
 */
export function ThreadReplyChooserDialog({
  msg,
  onCreateNew,
  onAssign,
  onCancel,
}: ThreadReplyChooserDialogProps) {
  const profiles = useChatStore((s) => s.profiles);
  const [mode, setMode] = useState<ChooserMode>("pick");
  const [threads, setThreads] = useState<ThreadListEntry[] | null>(null);
  const [q, setQ] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (mode === "assign") setMode("pick");
        else onCancel();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mode, onCancel]);

  useEffect(() => {
    if (mode !== "assign") return;
    let cancelled = false;
    setThreads(null);
    setError(null);
    void fetchThreadsList(msg.conversationId).then((list) => {
      if (cancelled) return;
      setThreads(
        list.filter((t) => !t.root.threadArchivedAt && t.root.id !== msg.id),
      );
    });
    return () => {
      cancelled = true;
    };
  }, [mode, msg.conversationId, msg.id]);

  const filtered = useMemo(() => {
    if (!threads) return [];
    const needle = q.trim().toLowerCase();
    if (!needle) return threads;
    return threads.filter(({ root, replyCount }) => {
      const title = threadDisplayTitle(root).toLowerCase();
      const author =
        profiles[root.authorUserId]?.displayName?.toLowerCase() ?? "";
      return (
        title.includes(needle) ||
        author.includes(needle) ||
        String(replyCount).includes(needle)
      );
    });
  }, [threads, q, profiles]);

  const preview =
    msg.body.slice(0, 120) ||
    (msg.kind === "voice"
      ? "🎤 Wiadomość głosowa"
      : msg.kind === "gif"
        ? "GIF"
        : "(załącznik)");

  const pickThread = async (rootId: string) => {
    if (busyId) return;
    setBusyId(rootId);
    setError(null);
    try {
      await onAssign(rootId);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Nie udało się przypisać.");
      setBusyId(null);
    }
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
        aria-labelledby="thread-reply-chooser-title"
        className="relative flex w-full max-w-sm flex-col overflow-hidden rounded-xl border border-line/80 bg-surface-overlay/95 shadow-[0_12px_40px_rgba(0,0,0,0.45)] backdrop-blur-md"
      >
        <div className="flex items-start gap-2 border-b border-line/60 px-3 py-2.5">
          <MessageSquare size={15} className="mt-0.5 shrink-0 text-accent" />
          <div className="min-w-0 flex-1">
            <h3
              id="thread-reply-chooser-title"
              className="text-sm font-semibold text-ink"
            >
              {mode === "assign" ? "Przypisz do wątku" : "Odpowiedź w wątku"}
            </h3>
            <p className="mt-0.5 line-clamp-2 text-[11px] text-ink-faint">
              {preview}
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

        {mode === "pick" ? (
          <div className="flex flex-col gap-1.5 p-3">
            <button
              type="button"
              onClick={onCreateNew}
              className="flex items-start gap-2.5 rounded-lg border border-line bg-surface-raised px-3 py-2.5 text-left transition hover:border-accent/40 hover:bg-accent/10"
            >
              <GitBranchPlus
                size={16}
                className="mt-0.5 shrink-0 text-accent"
              />
              <span className="min-w-0">
                <span className="block text-sm font-medium text-ink">
                  Utwórz nowy wątek
                </span>
                <span className="mt-0.5 block text-[11px] text-ink-faint">
                  Ta wiadomość zostanie początkiem nowego wątku (z nazwą).
                </span>
              </span>
            </button>
            <button
              type="button"
              onClick={() => setMode("assign")}
              className="flex items-start gap-2.5 rounded-lg border border-line bg-surface-raised px-3 py-2.5 text-left transition hover:border-accent/40 hover:bg-accent/10"
            >
              <MessageSquare
                size={16}
                className="mt-0.5 shrink-0 text-accent"
              />
              <span className="min-w-0">
                <span className="block text-sm font-medium text-ink">
                  Przypisz do istniejącego
                </span>
                <span className="mt-0.5 block text-[11px] text-ink-faint">
                  Przenieś wiadomość do wybranego wątku w tej rozmowie.
                </span>
              </span>
            </button>
            <div className="mt-1 flex justify-end">
              <button
                type="button"
                onClick={onCancel}
                className="rounded-lg px-3 py-1.5 text-xs font-medium text-ink-light transition hover:bg-surface-raised hover:text-ink"
              >
                Anuluj
              </button>
            </div>
          </div>
        ) : (
          <div className="flex max-h-[min(70vh,28rem)] flex-col">
            <div className="border-b border-line/60 px-3 py-2">
              <div className="flex items-center gap-1.5 rounded-lg border border-line bg-surface-raised px-2 py-1.5">
                <Search size={13} className="shrink-0 text-ink-faint" />
                <input
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder="Szukaj wątku…"
                  className="min-w-0 flex-1 bg-transparent text-sm text-ink outline-none placeholder:text-ink-faint"
                  autoFocus
                />
              </div>
            </div>
            <div className="thin-scrollbar min-h-0 flex-1 overflow-y-auto px-2 py-2">
              {threads === null && (
                <p className="px-1 py-4 text-center text-xs text-ink-faint">
                  Ładowanie wątków…
                </p>
              )}
              {threads && filtered.length === 0 && (
                <p className="px-1 py-4 text-center text-xs text-ink-faint">
                  {threads.length === 0
                    ? "Brak wątków w tej rozmowie. Utwórz nowy."
                    : "Brak wyników."}
                </p>
              )}
              {filtered.map(({ root, replyCount }) => (
                <button
                  key={root.id}
                  type="button"
                  disabled={Boolean(busyId)}
                  onClick={() => void pickThread(root.id)}
                  className="mb-1 flex w-full flex-col gap-0.5 rounded-lg border border-transparent px-2.5 py-2 text-left transition hover:border-line hover:bg-surface-raised disabled:opacity-50"
                >
                  <span className="flex items-center gap-1.5 text-[10px] text-ink-faint">
                    <span className="min-w-0 flex-1 truncate">
                      {profiles[root.authorUserId]?.displayName || "Nieznany"} ·{" "}
                      {formatMessageTime(root.createdAt)}
                    </span>
                    {replyCount > 0 ? (
                      <span className="inline-flex shrink-0 items-center gap-0.5 text-accent">
                        <MessageSquare size={10} /> {replyCount}
                      </span>
                    ) : null}
                    {busyId === root.id ? (
                      <span className="shrink-0 text-ink-faint">…</span>
                    ) : null}
                  </span>
                  <span className="line-clamp-2 text-sm text-ink">
                    {threadDisplayTitle(root)}
                  </span>
                </button>
              ))}
            </div>
            {error && (
              <p className="border-t border-line/60 px-3 py-2 text-xs text-rose-400">
                {error}
              </p>
            )}
            <div className="flex justify-between gap-2 border-t border-line/60 px-3 py-2">
              <button
                type="button"
                disabled={Boolean(busyId)}
                onClick={() => {
                  setMode("pick");
                  setError(null);
                }}
                className="rounded-lg px-3 py-1.5 text-xs font-medium text-ink-light transition hover:bg-surface-raised hover:text-ink disabled:opacity-40"
              >
                Wstecz
              </button>
              <button
                type="button"
                disabled={Boolean(busyId)}
                onClick={onCancel}
                className="rounded-lg px-3 py-1.5 text-xs font-medium text-ink-light transition hover:bg-surface-raised hover:text-ink disabled:opacity-40"
              >
                Anuluj
              </button>
            </div>
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
