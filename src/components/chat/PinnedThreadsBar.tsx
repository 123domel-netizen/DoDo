import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { MessageSquare, MoreHorizontal, Pin, PinOff, X } from "lucide-react";
import { useChatStore } from "@/lib/chat/store";
import { loadPinnedMessages, pinThreadMessage } from "@/lib/chat/init";
import { threadDisplayTitle } from "@/lib/chat/feed";
import type { ChatMessage, ChatProfile } from "@/lib/chat/types";

/**
 * CHAT6: przypięte wątki na górze rozmowy — widoczne maks. 3, reszta pod „…"
 * (przypinać można bez limitu). Klik: wątek z odpowiedziami → widok wątku,
 * bez odpowiedzi → skok do wiadomości.
 */

const VISIBLE_LIMIT = 3;

interface PinnedThreadsBarProps {
  conversationId: string;
  profiles: Record<string, ChatProfile>;
  replyCounts: Record<string, number>;
  onOpenThread?: (rootId: string) => void;
  onJumpTo: (messageId: string) => void;
}

export function PinnedThreadsBar({
  conversationId,
  profiles,
  replyCounts,
  onOpenThread,
  onJumpTo,
}: PinnedThreadsBarProps) {
  const pinned = useChatStore((s) => s.pinnedByConv[conversationId]);
  const [showAll, setShowAll] = useState(false);

  useEffect(() => {
    if (pinned === undefined) void loadPinnedMessages(conversationId);
  }, [conversationId, pinned]);

  if (!pinned?.length) return null;

  const open = (msg: ChatMessage) => {
    setShowAll(false);
    if ((replyCounts[msg.id] ?? 0) > 0 && onOpenThread) onOpenThread(msg.id);
    else onJumpTo(msg.id);
  };

  const visible = pinned.slice(0, VISIBLE_LIMIT);
  const hiddenCount = pinned.length - visible.length;

  return (
    <>
      <div className="border-b border-line bg-surface-raised/40 px-2 py-1">
        {hiddenCount > 0 && (
          <button
            type="button"
            onClick={() => setShowAll(true)}
            className="flex w-full items-center justify-center gap-1 rounded-md py-0.5 text-[10px] text-ink-faint transition hover:bg-surface-overlay hover:text-ink"
            aria-label="Pokaż wszystkie przypięte wątki"
          >
            <MoreHorizontal size={12} /> jeszcze {hiddenCount}
          </button>
        )}
        {visible.map((msg) => (
          <button
            key={msg.id}
            type="button"
            onClick={() => open(msg)}
            className="flex w-full items-center gap-1.5 rounded-md px-1.5 py-1 text-left transition hover:bg-surface-overlay"
          >
            <Pin size={11} className="shrink-0 text-accent" />
            <span className="min-w-0 flex-1 truncate text-[11px] text-ink-light">
              <span className="text-ink-faint">
                {profiles[msg.authorUserId]?.displayName || "Nieznany"}:
              </span>{" "}
              {threadDisplayTitle(msg)}
            </span>
            {(replyCounts[msg.id] ?? 0) > 0 && (
              <span className="flex shrink-0 items-center gap-0.5 text-[10px] text-accent">
                <MessageSquare size={10} /> {replyCounts[msg.id]}
              </span>
            )}
          </button>
        ))}
      </div>

      {showAll &&
        createPortal(
          <div className="fixed inset-0 z-[70] flex items-end justify-center sm:items-center">
            <button
              type="button"
              className="absolute inset-0 bg-black/50"
              aria-label="Zamknij"
              onClick={() => setShowAll(false)}
            />
            <div className="relative flex max-h-[80vh] w-full max-w-lg flex-col rounded-t-2xl border border-line bg-surface-overlay p-3 shadow-pop sm:rounded-2xl">
              <div className="mb-2 flex items-center justify-between px-1">
                <h3 className="flex items-center gap-2 text-sm font-semibold text-ink">
                  <Pin size={15} className="text-accent" /> Przypięte wątki
                </h3>
                <button
                  type="button"
                  onClick={() => setShowAll(false)}
                  className="rounded p-1 text-ink-faint transition hover:text-ink"
                  aria-label="Zamknij"
                >
                  <X size={16} />
                </button>
              </div>
              <div className="thin-scrollbar flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto">
                {pinned.map((msg) => (
                  <div
                    key={msg.id}
                    className="flex items-start gap-2 rounded-xl border border-line bg-surface-raised px-3 py-2"
                  >
                    <button
                      type="button"
                      onClick={() => open(msg)}
                      className="min-w-0 flex-1 text-left"
                    >
                      <span className="block text-[10px] text-ink-faint">
                        {profiles[msg.authorUserId]?.displayName || "Nieznany"}
                        {(replyCounts[msg.id] ?? 0) > 0 &&
                          ` · ${replyCounts[msg.id]} odp.`}
                      </span>
                      <span className="line-clamp-2 break-words text-sm text-ink">
                        {threadDisplayTitle(msg)}
                      </span>
                    </button>
                    <button
                      type="button"
                      onClick={() => void pinThreadMessage(msg, false)}
                      className="rounded p-1 text-ink-faint transition hover:text-red-400"
                      aria-label="Odepnij wątek"
                    >
                      <PinOff size={14} />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
