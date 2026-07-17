import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  AtSign,
  Bell,
  BellOff,
  ChevronUp,
  FolderOpen,
  Hash,
  LogOut,
  MailOpen,
  MessageSquare,
  MoreVertical,
  Pin,
  PinOff,
  User,
  Users,
} from "lucide-react";
import { useStore } from "@/state/store";
import { useChatStore } from "@/lib/chat/store";
import { isMuted, overviewTitle } from "@/lib/chat/feed";
import {
  MUTE_PRESETS,
  deleteChatMessage,
  editChatMessage,
  jumpToMessage,
  loadOlderMessages,
  markRead,
  markUnread,
  muteConversation,
  openThread,
  pinConversation,
  retryFailedMessage,
  scheduleOverviewRefresh,
  sendChatMessage,
  sendChatMessageWithFiles,
  sendGifMessage,
  sendPollMessage,
  sendVoiceMessage,
  toggleReaction,
  unmuteConversation,
  votePoll,
} from "@/lib/chat/init";
import {
  fetchMessageById,
  leaveConversation,
  setConversationNotify,
} from "@/lib/chat/api";
import { beginConvertMessageToItem, saveMessageAsDecision } from "@/lib/chat/convert";
import { isOnline } from "@/lib/chat/presence";
import type { ChatMessage, ChatProfile } from "@/lib/chat/types";
import { MessageBubble } from "@/components/chat/MessageBubble";
import { MessageComposer, type ReplyTarget } from "@/components/chat/MessageComposer";
import {
  MessageActionsSheet,
  type MessageAction,
} from "@/components/chat/MessageActionsSheet";
import { EditHistoryModal } from "@/components/chat/EditHistoryModal";
import { ConversationMediaView } from "@/components/chat/ConversationMediaView";
import { DecisionsView } from "@/components/chat/DecisionsView";

interface ConversationViewProps {
  conversationId: string;
  onBack?: () => void;
  /** Tryb osadzony (dyskusja itemu): bez nagłówka i wątków, mniejsza wysokość. */
  embedded?: boolean;
}

function quoteSnippet(msg: ChatMessage): string {
  if (msg.deletedAt) return "Wiadomość usunięta";
  if (msg.kind === "voice") return "🎤 Wiadomość głosowa";
  if (msg.kind === "gif") return "GIF";
  return msg.body || "(załącznik)";
}

function MessageFeed({
  messages,
  myUserId,
  profiles,
  mentionNames,
  quotedLookup,
  flashMessageId,
  replyCounts,
  hasMore,
  onLoadOlder,
  onOpenThread,
  onOpenActions,
  onJumpTo,
  inThread = false,
}: {
  messages: ChatMessage[];
  myUserId: string | null;
  profiles: Record<string, ChatProfile>;
  mentionNames: string[];
  quotedLookup: (id: string) => ChatMessage | null;
  flashMessageId: string | null;
  replyCounts: Record<string, number>;
  hasMore: boolean;
  onLoadOlder?: () => void;
  onOpenThread?: (rootId: string) => void;
  onOpenActions: (msg: ChatMessage) => void;
  onJumpTo: (messageId: string) => void;
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

  // Skok do podświetlonej wiadomości (cytat / media / decyzje).
  useEffect(() => {
    if (!flashMessageId || !scrollRef.current) return;
    const el = scrollRef.current.querySelector(
      `[data-message-id="${flashMessageId}"]`,
    );
    if (el) {
      stickToBottom.current = false;
      el.scrollIntoView({ block: "center", behavior: "smooth" });
    }
  }, [flashMessageId, messages.length]);

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
        const quotedMsg = m.replyToMessageId ? quotedLookup(m.replyToMessageId) : null;
        return (
          <MessageBubble
            key={m.id}
            msg={m}
            mine={m.authorUserId === myUserId}
            authorName={profiles[m.authorUserId]?.displayName || "Nieznany"}
            showAuthor={showAuthor}
            myUserId={myUserId}
            mentionNames={mentionNames}
            quoted={
              m.replyToMessageId
                ? {
                    msg: quotedMsg,
                    authorName: quotedMsg
                      ? profiles[quotedMsg.authorUserId]?.displayName || "Nieznany"
                      : "…",
                  }
                : null
            }
            flash={m.id === flashMessageId}
            replyCount={replyCounts[m.id] ?? 0}
            inThread={inThread}
            onOpenThread={onOpenThread}
            onOpenActions={onOpenActions}
            onRetry={retryFailedMessage}
            onToggleReaction={(msg, emoji) => void toggleReaction(msg, emoji)}
            onVote={(msg, optionId) => void votePoll(msg, optionId)}
            onJumpTo={onJumpTo}
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
  const flashMessageId = useChatStore((s) => s.flashMessageId);
  const setFlashMessage = useChatStore((s) => s.setFlashMessage);
  const threadRootId = useChatStore((s) => (embedded ? null : s.activeThreadRootId));
  const threadMessages = useChatStore((s) =>
    threadRootId ? s.threadByRoot[threadRootId] : undefined,
  );
  const setActiveThread = useChatStore((s) => s.setActiveThread);
  const items = useStore((s) => s.items);

  const [actionMsg, setActionMsg] = useState<ChatMessage | null>(null);
  const [editing, setEditing] = useState<{ id: string; body: string } | null>(null);
  const [replyTo, setReplyTo] = useState<(ReplyTarget & { threadRootId: string | null }) | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [muteMenuOpen, setMuteMenuOpen] = useState(false);
  const [historyMsg, setHistoryMsg] = useState<ChatMessage | null>(null);
  const [showMedia, setShowMedia] = useState(false);
  const [showDecisions, setShowDecisions] = useState(false);
  const [fetchedQuotes, setFetchedQuotes] = useState<Record<string, ChatMessage | null>>({});

  const entry = overview.find((c) => c.id === conversationId);
  const feed = useMemo(() => (messages ?? []).filter((m) => !m.threadRootId), [messages]);

  const title = entry
    ? overviewTitle(entry, myUserId, (id) => items[id]?.title)
    : "Rozmowa";

  const members = useMemo(
    () =>
      (entry?.members ?? []).map((m) => ({
        userId: m.userId,
        displayName: m.displayName,
      })),
    [entry?.members],
  );
  const mentionNames = useMemo(
    () => members.map((m) => m.displayName).filter(Boolean),
    [members],
  );

  // DM: obecność drugiej osoby (zielona kropka w nagłówku).
  const dmOther = entry?.kind === "dm" ? entry.members.find((m) => m.userId !== myUserId) : null;
  const dmOtherOnline = Boolean(dmOther && isOnline(profiles[dmOther.userId]?.lastSeenAt));

  // Cytaty: wiadomości spoza załadowanego feedu dociągamy pojedynczo.
  const allLoaded = useMemo(() => {
    const map = new Map<string, ChatMessage>();
    for (const m of messages ?? []) map.set(m.id, m);
    for (const m of threadMessages ?? []) map.set(m.id, m);
    return map;
  }, [messages, threadMessages]);

  useEffect(() => {
    const missing = new Set<string>();
    for (const m of feed) {
      if (
        m.replyToMessageId &&
        !allLoaded.has(m.replyToMessageId) &&
        !(m.replyToMessageId in fetchedQuotes)
      ) {
        missing.add(m.replyToMessageId);
      }
    }
    if (!missing.size) return;
    let cancelled = false;
    for (const id of missing) {
      void fetchMessageById(id).then((msg) => {
        if (!cancelled) setFetchedQuotes((q) => ({ ...q, [id]: msg }));
      });
    }
    return () => {
      cancelled = true;
    };
  }, [feed, allLoaded, fetchedQuotes]);

  const quotedLookup = useCallback(
    (id: string) => allLoaded.get(id) ?? fetchedQuotes[id] ?? null,
    [allLoaded, fetchedQuotes],
  );

  // Gaszenie podświetlenia po skoku.
  useEffect(() => {
    if (!flashMessageId) return;
    const t = setTimeout(() => setFlashMessage(null), 2000);
    return () => clearTimeout(t);
  }, [flashMessageId, setFlashMessage]);

  // markRead przy nowych wiadomościach, gdy rozmowa otwarta i widoczna
  const feedLen = feed.length;
  useEffect(() => {
    if (feedLen > 0 && document.visibilityState === "visible") {
      markRead(conversationId);
    }
  }, [feedLen, conversationId]);

  const handleJumpTo = useCallback(
    (messageId: string) => void jumpToMessage(conversationId, messageId),
    [conversationId],
  );

  const handleSend = useCallback(
    async (body: string, files: File[], mentions: string[]) => {
      const reply = replyTo;
      setReplyTo(null);
      if (files.length > 0) {
        const { error } = await sendChatMessageWithFiles({
          conversationId,
          body,
          files,
          mentions,
          threadRootId: threadRootId ?? null,
          replyToMessageId: reply?.id ?? null,
        });
        if (error) alert(error);
      } else {
        sendChatMessage({
          conversationId,
          body,
          mentions,
          threadRootId: threadRootId ?? null,
          replyToMessageId: reply?.id ?? null,
        });
      }
    },
    [conversationId, threadRootId, replyTo],
  );

  const handleSendVoice = useCallback(
    async (file: File, durationSec: number) => {
      const { error } = await sendVoiceMessage(
        conversationId,
        file,
        durationSec,
        threadRootId ?? null,
      );
      if (error) alert(error);
    },
    [conversationId, threadRootId],
  );

  const handleAction = useCallback(
    (action: MessageAction, msg: ChatMessage, arg?: string) => {
      switch (action) {
        case "react":
          if (arg) void toggleReaction(msg, arg);
          break;
        case "reply":
          setReplyTo({
            id: msg.id,
            authorName: profiles[msg.authorUserId]?.displayName || "Nieznany",
            snippet: quoteSnippet(msg),
            threadRootId: msg.threadRootId,
          });
          break;
        case "createTask":
          beginConvertMessageToItem(msg, "task");
          break;
        case "createEvent":
          beginConvertMessageToItem(msg, "event");
          break;
        case "createChecklist":
          beginConvertMessageToItem(msg, "checklist");
          break;
        case "saveDecision":
          void saveMessageAsDecision(msg).then(({ error }) => {
            if (error) alert(error);
          });
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
        case "history":
          setHistoryMsg(msg);
          break;
        case "delete":
          if (confirm("Usunąć wiadomość?")) void deleteChatMessage(msg);
          break;
      }
    },
    [profiles],
  );

  const handleSaveEdit = useCallback(
    (id: string, body: string, mentions: string[]) => {
      const msg = (messages ?? []).find((m) => m.id === id);
      setEditing(null);
      if (msg) void editChatMessage(msg, body, mentions);
    },
    [messages],
  );

  const muted = entry ? isMuted(entry) : false;

  const toggleNotifyMentions = async () => {
    if (!entry || !myUserId) return;
    const next = entry.myNotify === "mentions" ? "all" : "mentions";
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

  const composerShared = {
    members,
    myUserId,
    editing,
    onSaveEdit: handleSaveEdit,
    onCancelEdit: () => setEditing(null),
    replyTo,
    onCancelReply: () => setReplyTo(null),
    onSendVoice: handleSendVoice,
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
          mentionNames={mentionNames}
          quotedLookup={quotedLookup}
          flashMessageId={flashMessageId}
          replyCounts={replyCounts}
          hasMore={false}
          onOpenActions={setActionMsg}
          onJumpTo={handleJumpTo}
          inThread
        />
        <MessageComposer
          onSend={handleSend}
          placeholder="Odpowiedz w wątku…"
          {...composerShared}
        />
        <MessageActionsSheet
          msg={actionMsg}
          mine={actionMsg?.authorUserId === myUserId}
          allowThread={false}
          onAction={handleAction}
          onClose={() => setActionMsg(null)}
        />
        <EditHistoryModal
          msg={historyMsg}
          profiles={profiles}
          onClose={() => setHistoryMsg(null)}
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
          <span className="relative text-ink-faint">
            {entry?.kind === "channel" ? (
              <Hash size={15} />
            ) : entry?.kind === "dm" ? (
              entry.members.length > 2 ? <Users size={15} /> : <User size={15} />
            ) : (
              <MessageSquare size={15} />
            )}
            {dmOtherOnline && (
              <span className="absolute -right-1 -top-1 h-2 w-2 rounded-full border border-surface bg-green-500" />
            )}
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5 truncate text-sm font-semibold text-ink">
              {entry?.myPinnedAt && <Pin size={11} className="shrink-0 text-accent" />}
              <span className="truncate">{title}</span>
            </div>
            {entry && (
              <div className="truncate text-[11px] text-ink-faint">
                {entry.kind === "channel"
                  ? `${entry.isPublic ? "kanał publiczny" : "kanał prywatny"} · ${entry.members.length} os.`
                  : entry.kind === "item"
                    ? "dyskusja wpisu"
                    : dmOtherOnline
                      ? "online"
                      : `${entry.members.length} os.`}
                {muted ? " · wyciszona" : ""}
                {entry.myNotify === "mentions" ? " · tylko wzmianki" : ""}
              </div>
            )}
          </div>
          {entry && (
            <button
              type="button"
              onClick={() => {
                setMenuOpen((v) => !v);
                setMuteMenuOpen(false);
              }}
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
              <div className="thin-scrollbar absolute right-2 top-full z-50 mt-1 max-h-[70vh] w-56 overflow-y-auto rounded-xl border border-line bg-surface-overlay p-1 shadow-pop">
                <button
                  type="button"
                  onClick={() => {
                    void pinConversation(conversationId, !entry.myPinnedAt);
                    setMenuOpen(false);
                  }}
                  className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs text-ink transition hover:bg-surface-raised"
                >
                  {entry.myPinnedAt ? <PinOff size={14} /> : <Pin size={14} />}
                  {entry.myPinnedAt ? "Odepnij z ulubionych" : "Przypnij do ulubionych"}
                </button>

                {muted ? (
                  <button
                    type="button"
                    onClick={() => {
                      void unmuteConversation(conversationId);
                      setMenuOpen(false);
                    }}
                    className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs text-ink transition hover:bg-surface-raised"
                  >
                    <Bell size={14} /> Włącz powiadomienia
                  </button>
                ) : (
                  <>
                    <button
                      type="button"
                      onClick={() => setMuteMenuOpen((v) => !v)}
                      className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs text-ink transition hover:bg-surface-raised"
                    >
                      <BellOff size={14} /> Wycisz rozmowę…
                    </button>
                    {muteMenuOpen &&
                      MUTE_PRESETS.map((p) => (
                        <button
                          key={p.label}
                          type="button"
                          onClick={() => {
                            void muteConversation(conversationId, p.minutes);
                            setMenuOpen(false);
                          }}
                          className="flex w-full items-center gap-2 rounded-lg py-1.5 pl-9 pr-2.5 text-left text-xs text-ink-light transition hover:bg-surface-raised hover:text-ink"
                        >
                          {p.label}
                        </button>
                      ))}
                  </>
                )}

                <button
                  type="button"
                  onClick={() => void toggleNotifyMentions()}
                  className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs text-ink transition hover:bg-surface-raised"
                >
                  <AtSign size={14} />
                  {entry.myNotify === "mentions"
                    ? "Powiadamiaj o wszystkim"
                    : "Powiadamiaj tylko o wzmiankach"}
                </button>

                <button
                  type="button"
                  onClick={() => {
                    void markUnread(conversationId);
                    setMenuOpen(false);
                    onBack?.();
                  }}
                  className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs text-ink transition hover:bg-surface-raised"
                >
                  <MailOpen size={14} /> Oznacz jako nieprzeczytane
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setShowMedia(true);
                    setMenuOpen(false);
                  }}
                  className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs text-ink transition hover:bg-surface-raised"
                >
                  <FolderOpen size={14} /> Media i pliki
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setShowDecisions(true);
                    setMenuOpen(false);
                  }}
                  className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs text-ink transition hover:bg-surface-raised"
                >
                  <Pin size={14} /> Decyzje
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
        mentionNames={mentionNames}
        quotedLookup={quotedLookup}
        flashMessageId={flashMessageId}
        replyCounts={replyCounts}
        hasMore={hasMore}
        onLoadOlder={() => void loadOlderMessages(conversationId)}
        onOpenThread={embedded ? undefined : (rootId) => void openThread(rootId)}
        onOpenActions={setActionMsg}
        onJumpTo={handleJumpTo}
      />

      <MessageComposer
        onSend={handleSend}
        autoFocus={!embedded}
        onSendPoll={(q, opts) => void sendPollMessage(conversationId, q, opts)}
        onSendGif={(url) => void sendGifMessage(conversationId, url)}
        {...composerShared}
      />

      <MessageActionsSheet
        msg={actionMsg}
        mine={actionMsg?.authorUserId === myUserId}
        allowThread={!embedded}
        onAction={handleAction}
        onClose={() => setActionMsg(null)}
      />

      <EditHistoryModal
        msg={historyMsg}
        profiles={profiles}
        onClose={() => setHistoryMsg(null)}
      />

      {showMedia && (
        <ConversationMediaView
          conversationId={conversationId}
          onClose={() => setShowMedia(false)}
          onJumpTo={handleJumpTo}
        />
      )}

      {showDecisions && (
        <DecisionsView
          conversationId={conversationId}
          myUserId={myUserId}
          profiles={profiles}
          onClose={() => setShowDecisions(false)}
          onJumpTo={handleJumpTo}
        />
      )}
    </div>
  );
}
