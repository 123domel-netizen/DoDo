import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  Bell,
  BellOff,
  ChevronUp,
  Hash,
  LogOut,
  MessageSquare,
  MoreVertical,
  User,
  Users,
} from "lucide-react";
import { useStore } from "@/state/store";
import { useChatStore } from "@/lib/chat/store";
import { overviewTitle } from "@/lib/chat/feed";
import {
  deleteChatMessage,
  editChatMessage,
  loadOlderMessages,
  markRead,
  openThread,
  retryFailedMessage,
  scheduleOverviewRefresh,
  sendChatMessage,
  sendChatMessageWithFiles,
} from "@/lib/chat/init";
import { leaveConversation, setConversationNotify } from "@/lib/chat/api";
import { beginConvertMessageToItem } from "@/lib/chat/convert";
import type { ChatMessage } from "@/lib/chat/types";
import { MessageBubble } from "@/components/chat/MessageBubble";
import { MessageComposer } from "@/components/chat/MessageComposer";
import {
  MessageActionsSheet,
  type MessageAction,
} from "@/components/chat/MessageActionsSheet";

interface ConversationViewProps {
  conversationId: string;
  onBack?: () => void;
  /** Tryb osadzony (dyskusja itemu): bez nagłówka i wątków, mniejsza wysokość. */
  embedded?: boolean;
}

function MessageFeed({
  messages,
  myUserId,
  profiles,
  replyCounts,
  hasMore,
  onLoadOlder,
  onOpenThread,
  onOpenActions,
  inThread = false,
}: {
  messages: ChatMessage[];
  myUserId: string | null;
  profiles: Record<string, { displayName: string }>;
  replyCounts: Record<string, number>;
  hasMore: boolean;
  onLoadOlder?: () => void;
  onOpenThread?: (rootId: string) => void;
  onOpenActions: (msg: ChatMessage) => void;
  inThread?: boolean;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);
  const lastCount = useRef(0);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (messages.length !== lastCount.current) {
      lastCount.current = messages.length;
      if (stickToBottom.current) el.scrollTop = el.scrollHeight;
    }
  }, [messages]);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
    // przy zmianie rozmowy zawsze dół
    stickToBottom.current = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div
      ref={scrollRef}
      onScroll={(e) => {
        const el = e.currentTarget;
        stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
      }}
      className="thin-scrollbar min-h-0 flex-1 overflow-y-auto py-2"
    >
      {hasMore && onLoadOlder && (
        <div className="flex justify-center pb-2">
          <button
            type="button"
            onClick={onLoadOlder}
            className="flex items-center gap-1 rounded-full border border-line bg-surface-raised px-3 py-1 text-[11px] text-ink-light transition hover:border-line-strong hover:text-ink"
          >
            <ChevronUp size={12} /> Pokaż wcześniejsze
          </button>
        </div>
      )}
      {messages.length === 0 && (
        <div className="flex h-full items-center justify-center px-6 text-center text-xs text-ink-faint">
          Brak wiadomości — napisz pierwszą.
        </div>
      )}
      {messages.map((m, i) => {
        const prev = messages[i - 1];
        const showAuthor =
          !prev ||
          prev.authorUserId !== m.authorUserId ||
          prev.kind === "system" ||
          new Date(m.createdAt).getTime() - new Date(prev.createdAt).getTime() > 5 * 60_000;
        return (
          <MessageBubble
            key={m.id}
            msg={m}
            mine={m.authorUserId === myUserId}
            authorName={profiles[m.authorUserId]?.displayName || "Nieznany"}
            showAuthor={showAuthor}
            replyCount={replyCounts[m.id] ?? 0}
            inThread={inThread}
            onOpenThread={onOpenThread}
            onOpenActions={onOpenActions}
            onRetry={retryFailedMessage}
          />
        );
      })}
    </div>
  );
}

export function ConversationView({
  conversationId,
  onBack,
  embedded = false,
}: ConversationViewProps) {
  const myUserId = useChatStore((s) => s.userId);
  const overview = useChatStore((s) => s.overview);
  const profiles = useChatStore((s) => s.profiles);
  const messages = useChatStore((s) => s.messagesByConv[conversationId]);
  const hasMore = useChatStore((s) => s.hasMoreByConv[conversationId] ?? false);
  const replyCounts = useChatStore((s) => s.replyCounts);
  const threadRootId = useChatStore((s) => (embedded ? null : s.activeThreadRootId));
  const threadMessages = useChatStore((s) =>
    threadRootId ? s.threadByRoot[threadRootId] : undefined,
  );
  const setActiveThread = useChatStore((s) => s.setActiveThread);
  const items = useStore((s) => s.items);

  const [actionMsg, setActionMsg] = useState<ChatMessage | null>(null);
  const [editing, setEditing] = useState<{ id: string; body: string } | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);

  const entry = overview.find((c) => c.id === conversationId);
  const feed = useMemo(() => (messages ?? []).filter((m) => !m.threadRootId), [messages]);

  const title = entry
    ? overviewTitle(entry, myUserId, (id) => items[id]?.title)
    : "Rozmowa";

  // markRead przy nowych wiadomościach, gdy rozmowa otwarta i widoczna
  const feedLen = feed.length;
  useEffect(() => {
    if (feedLen > 0 && document.visibilityState === "visible") {
      markRead(conversationId);
    }
  }, [feedLen, conversationId]);

  const handleSend = useCallback(
    async (body: string, files: File[]) => {
      if (files.length > 0) {
        const { error } = await sendChatMessageWithFiles({
          conversationId,
          body,
          files,
          threadRootId: threadRootId ?? null,
        });
        if (error) alert(error);
      } else {
        sendChatMessage({ conversationId, body, threadRootId: threadRootId ?? null });
      }
    },
    [conversationId, threadRootId],
  );

  const handleAction = useCallback((action: MessageAction, msg: ChatMessage) => {
    switch (action) {
      case "createTask":
        beginConvertMessageToItem(msg, "task");
        break;
      case "createEvent":
        beginConvertMessageToItem(msg, "event");
        break;
      case "openThread":
        void openThread(msg.threadRootId ?? msg.id);
        break;
      case "copy":
        void navigator.clipboard?.writeText(msg.body);
        break;
      case "edit":
        setEditing({ id: msg.id, body: msg.body });
        break;
      case "delete":
        if (confirm("Usunąć wiadomość?")) void deleteChatMessage(msg);
        break;
    }
  }, []);

  const handleSaveEdit = useCallback(
    (id: string, body: string) => {
      const msg = (messages ?? []).find((m) => m.id === id);
      setEditing(null);
      if (msg) void editChatMessage(msg, body);
    },
    [messages],
  );

  const toggleMute = async () => {
    if (!entry || !myUserId) return;
    const next = entry.myNotify === "none" ? "all" : "none";
    await setConversationNotify(conversationId, myUserId, next);
    scheduleOverviewRefresh(200);
    setMenuOpen(false);
  };

  const handleLeave = async () => {
    if (!confirm("Opuścić tę rozmowę?")) return;
    await leaveConversation(conversationId);
    setMenuOpen(false);
    scheduleOverviewRefresh(200);
    onBack?.();
  };

  // ── Widok wątku ──────────────────────────────────────────────────────────
  if (threadRootId) {
    const rootFromFeed = feed.find((m) => m.id === threadRootId);
    const thread =
      threadMessages ?? (rootFromFeed ? [rootFromFeed] : ([] as ChatMessage[]));
    return (
      <div className="flex h-full min-h-0 flex-col">
        <div className="flex items-center gap-2 border-b border-line px-2 py-2">
          <button
            type="button"
            onClick={() => setActiveThread(null)}
            className="rounded-lg p-1.5 text-ink-light transition hover:bg-surface-overlay hover:text-ink"
            aria-label="Wróć do rozmowy"
          >
            <ArrowLeft size={18} />
          </button>
          <MessageSquare size={15} className="text-accent" />
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-semibold text-ink">Wątek</div>
            <div className="truncate text-[11px] text-ink-faint">{title}</div>
          </div>
        </div>
        <MessageFeed
          messages={thread}
          myUserId={myUserId}
          profiles={profiles}
          replyCounts={replyCounts}
          hasMore={false}
          onOpenActions={setActionMsg}
          inThread
        />
        <MessageComposer
          onSend={handleSend}
          placeholder="Odpowiedz w wątku…"
          editing={editing}
          onSaveEdit={handleSaveEdit}
          onCancelEdit={() => setEditing(null)}
        />
        <MessageActionsSheet
          msg={actionMsg}
          mine={actionMsg?.authorUserId === myUserId}
          allowThread={false}
          onAction={handleAction}
          onClose={() => setActionMsg(null)}
        />
      </div>
    );
  }

  // ── Widok rozmowy ────────────────────────────────────────────────────────
  return (
    <div className={`flex min-h-0 flex-col ${embedded ? "" : "h-full"}`}>
      {!embedded && (
        <div className="relative flex items-center gap-2 border-b border-line px-2 py-2">
          {onBack && (
            <button
              type="button"
              onClick={onBack}
              className="rounded-lg p-1.5 text-ink-light transition hover:bg-surface-overlay hover:text-ink"
              aria-label="Wróć do listy rozmów"
            >
              <ArrowLeft size={18} />
            </button>
          )}
          <span className="text-ink-faint">
            {entry?.kind === "channel" ? (
              <Hash size={15} />
            ) : entry?.kind === "dm" ? (
              entry.members.length > 2 ? <Users size={15} /> : <User size={15} />
            ) : (
              <MessageSquare size={15} />
            )}
          </span>
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-semibold text-ink">{title}</div>
            {entry && (
              <div className="truncate text-[11px] text-ink-faint">
                {entry.kind === "channel"
                  ? `${entry.isPublic ? "kanał publiczny" : "kanał prywatny"} · ${entry.members.length} os.`
                  : entry.kind === "item"
                    ? "dyskusja wpisu"
                    : `${entry.members.length} os.`}
                {entry.myNotify === "none" ? " · wyciszona" : ""}
              </div>
            )}
          </div>
          {entry && (
            <button
              type="button"
              onClick={() => setMenuOpen((v) => !v)}
              className="rounded-lg p-1.5 text-ink-light transition hover:bg-surface-overlay hover:text-ink"
              aria-label="Opcje rozmowy"
            >
              <MoreVertical size={17} />
            </button>
          )}
          {menuOpen && entry && (
            <>
              <button
                type="button"
                className="fixed inset-0 z-40 cursor-default"
                aria-label="Zamknij menu"
                onClick={() => setMenuOpen(false)}
              />
              <div className="absolute right-2 top-full z-50 mt-1 w-52 rounded-xl border border-line bg-surface-overlay p-1 shadow-pop">
                <button
                  type="button"
                  onClick={() => void toggleMute()}
                  className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs text-ink transition hover:bg-surface-raised"
                >
                  {entry.myNotify === "none" ? <Bell size={14} /> : <BellOff size={14} />}
                  {entry.myNotify === "none" ? "Włącz powiadomienia" : "Wycisz rozmowę"}
                </button>
                {entry.kind !== "item" && (
                  <button
                    type="button"
                    onClick={() => void handleLeave()}
                    className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs text-red-400 transition hover:bg-surface-raised"
                  >
                    <LogOut size={14} /> Opuść rozmowę
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      )}

      <MessageFeed
        messages={feed}
        myUserId={myUserId}
        profiles={profiles}
        replyCounts={replyCounts}
        hasMore={hasMore}
        onLoadOlder={() => void loadOlderMessages(conversationId)}
        onOpenThread={embedded ? undefined : (rootId) => void openThread(rootId)}
        onOpenActions={setActionMsg}
      />

      <MessageComposer
        onSend={handleSend}
        editing={editing}
        onSaveEdit={handleSaveEdit}
        onCancelEdit={() => setEditing(null)}
        autoFocus={!embedded}
      />

      <MessageActionsSheet
        msg={actionMsg}
        mine={actionMsg?.authorUserId === myUserId}
        allowThread={!embedded}
        onAction={handleAction}
        onClose={() => setActionMsg(null)}
      />
    </div>
  );
}
