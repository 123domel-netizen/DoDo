import { useEffect } from "react";
import { MessageSquare, Pin } from "lucide-react";
import { useChatStore } from "@/lib/chat/store";
import { loadPinnedMessages } from "@/lib/chat/init";
import { threadDisplayTitle } from "@/lib/chat/feed";
import type { ChatMessage, ChatProfile } from "@/lib/chat/types";

/**
 * Przypięte wątki na górze rozmowy — pełna lista (scroll przy wielu).
 * Klik: wątek z odpowiedziami → widok wątku, bez odpowiedzi → skok do wiadomości.
 */

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

  useEffect(() => {
    if (pinned === undefined) void loadPinnedMessages(conversationId);
  }, [conversationId, pinned]);

  if (!pinned?.length) return null;

  const open = (msg: ChatMessage) => {
    if ((replyCounts[msg.id] ?? 0) > 0 && onOpenThread) onOpenThread(msg.id);
    else onJumpTo(msg.id);
  };

  return (
    <div className="border-b border-line bg-surface-raised/40 px-2 py-1">
      <div className="thin-scrollbar max-h-48 overflow-y-auto">
        {pinned.map((msg) => (
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
    </div>
  );
}
