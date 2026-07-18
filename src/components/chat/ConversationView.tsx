import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  ArrowDown,
  ArrowLeft,
  AtSign,
  Bell,
  BellOff,
  ChevronUp,
  FolderOpen,
  Gavel,
  Hash,
  LogOut,
  MailOpen,
  MessageSquare,
  MessagesSquare,
  MoreVertical,
  Pin,
  PinOff,
  StickyNote,
  User,
  Users,
} from "lucide-react";
import { useStore } from "@/state/store";
import { useChatStore } from "@/lib/chat/store";
import { isMuted, mergeMessages, overviewTitle, threadDisplayTitle } from "@/lib/chat/feed";
import {
  MUTE_PRESETS,
  deleteChatMessage,
  editChatMessage,
  jumpToMessage,
  loadNewerFocus,
  loadOlderFocus,
  loadOlderMessages,
  markRead,
  markUnread,
  muteConversation,
  openThread,
  pinConversation,
  pinThreadMessage,
  retryFailedMessage,
  saveThreadTitle,
  returnToLatest,
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
import {
  beginConvertMessageToItem,
  saveMessageAsDecision,
  saveMessageAsNote,
} from "@/lib/chat/convert";
import { isOnline } from "@/lib/chat/presence";
import {
  TYPING_EXPIRE_MS,
  joinTyping,
  typingLabel,
  type TypingHandle,
} from "@/lib/chat/typing";
import type { ChatMessage, ChatProfile } from "@/lib/chat/types";
import { setRouteHash } from "@/lib/navigation";
import { MessageBubble } from "@/components/chat/MessageBubble";
import { MessageComposer, type ReplyTarget } from "@/components/chat/MessageComposer";
import {
  MessageActionsSheet,
  type MessageAction,
} from "@/components/chat/MessageActionsSheet";
import { EditHistoryModal } from "@/components/chat/EditHistoryModal";
import { ConversationMediaView } from "@/components/chat/ConversationMediaView";
import { RegistryView, type RegistryMode } from "@/components/chat/RegistryView";
import { PinnedThreadsBar } from "@/components/chat/PinnedThreadsBar";
import { ThreadsSheet } from "@/components/chat/ThreadsSheet";
import { NameThreadDialog } from "@/components/chat/NameThreadDialog";

interface ConversationViewProps {
  conversationId: string;
  onBack?: () => void;
  /** Tryb osadzony (dyskusja itemu): bez nagłówka i wątków, mniejsza wysokość. */
  embedded?: boolean;
  /**
   * Desktop 3-kolumnowy: bez przycisku wstecz do listy, bez przycisków
   * Decyzje/Notatki/Wątki w nagłówku (są w środkowej kolumnie).
   */
  pane?: boolean;
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
  hasOlder,
  onLoadOlder,
  hasNewer = false,
  onLoadNewer,
  initialBottom = true,
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
  hasOlder: boolean;
  onLoadOlder?: () => void | Promise<void>;
  hasNewer?: boolean;
  onLoadNewer?: () => void | Promise<void>;
  /** false w oknie kontekstowym — start przy kotwicy, nie na dole. */
  initialBottom?: boolean;
  onOpenThread?: (rootId: string) => void;
  onOpenActions: (msg: ChatMessage, anchor: DOMRect) => void;
  onJumpTo: (messageId: string) => void;
  inThread?: boolean;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(initialBottom);
  const lastCount = useRef(0);
  const loadingOlder = useRef(false);
  const loadingNewer = useRef(false);
  /** scrollHeight sprzed dołożenia starszych — do zakotwiczenia pozycji. */
  const anchorHeight = useRef<number | null>(null);

  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (messages.length !== lastCount.current) {
      lastCount.current = messages.length;
      if (anchorHeight.current !== null) {
        el.scrollTop += el.scrollHeight - anchorHeight.current;
        anchorHeight.current = null;
      } else if (stickToBottom.current) {
        el.scrollTop = el.scrollHeight;
      }
    }
  }, [messages]);

  useEffect(() => {
    const el = scrollRef.current;
    if (el && initialBottom) el.scrollTop = el.scrollHeight;
    stickToBottom.current = initialBottom;
    // przy zmianie rozmowy / trybu zawsze od nowa
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Skok do podświetlonej wiadomości (cytat / media / decyzje / notatki).
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

  const triggerOlder = () => {
    const el = scrollRef.current;
    if (!el || !hasOlder || !onLoadOlder || loadingOlder.current) return;
    loadingOlder.current = true;
    anchorHeight.current = el.scrollHeight;
    void Promise.resolve(onLoadOlder()).finally(() => {
      loadingOlder.current = false;
      // Fetch bez zmian (błąd/koniec) → kotwica nie może zostać na później.
      setTimeout(() => {
        anchorHeight.current = null;
      }, 250);
    });
  };

  const triggerNewer = () => {
    if (!hasNewer || !onLoadNewer || loadingNewer.current) return;
    loadingNewer.current = true;
    void Promise.resolve(onLoadNewer()).finally(() => {
      loadingNewer.current = false;
    });
  };

  return (
    <div
      ref={scrollRef}
      onScroll={(e) => {
        const el = e.currentTarget;
        const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
        stickToBottom.current = !hasNewer && nearBottom;
        if (el.scrollTop < 150) triggerOlder();
        if (el.scrollHeight - el.scrollTop - el.clientHeight < 150) triggerNewer();
      }}
      className="thin-scrollbar min-h-0 flex-1 overflow-y-auto py-1"
    >
      {hasOlder && onLoadOlder && (
        <div className="flex justify-center pb-2">
          <button
            type="button"
            onClick={triggerOlder}
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
  pane = false,
}: ConversationViewProps) {
  const myUserId = useChatStore((s) => s.userId);
  const overview = useChatStore((s) => s.overview);
  const profiles = useChatStore((s) => s.profiles);
  const messages = useChatStore((s) => s.messagesByConv[conversationId]);
  const hasMore = useChatStore((s) => s.hasMoreByConv[conversationId] ?? false);
  const replyCounts = useChatStore((s) => s.replyCounts);
  const flashMessageId = useChatStore((s) => s.flashMessageId);
  const setFlashMessage = useChatStore((s) => s.setFlashMessage);
  const focusFeedRaw = useChatStore((s) => s.focusFeed);
  const threadRootId = useChatStore((s) => (embedded ? null : s.activeThreadRootId));
  const threadMessages = useChatStore((s) =>
    threadRootId ? s.threadByRoot[threadRootId] : undefined,
  );
  const setActiveThread = useChatStore((s) => s.setActiveThread);
  const items = useStore((s) => s.items);

  const [actionTarget, setActionTarget] = useState<{
    msg: ChatMessage;
    anchor: DOMRect;
  } | null>(null);
  const [nameThreadMsg, setNameThreadMsg] = useState<ChatMessage | null>(null);
  const [editing, setEditing] = useState<{ id: string; body: string } | null>(null);
  const [replyTo, setReplyTo] = useState<(ReplyTarget & { threadRootId: string | null }) | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [muteMenuOpen, setMuteMenuOpen] = useState(false);
  const [historyMsg, setHistoryMsg] = useState<ChatMessage | null>(null);
  const [showMedia, setShowMedia] = useState(false);
  const [registryMode, setRegistryMode] = useState<RegistryMode | null>(null);
  const [showThreads, setShowThreads] = useState(false);
  const [fetchedQuotes, setFetchedQuotes] = useState<Record<string, ChatMessage | null>>({});
  const [typing, setTyping] = useState<Record<string, { name: string; at: number }>>({});
  const typingHandle = useRef<TypingHandle | null>(null);

  const entry = overview.find((c) => c.id === conversationId);
  const focus =
    !embedded && focusFeedRaw?.conversationId === conversationId ? focusFeedRaw : null;
  const feed = useMemo(() => (messages ?? []).filter((m) => !m.threadRootId), [messages]);
  const displayedFeed = focus ? focus.messages : feed;

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

  // Wskaźnik „X pisze…" (Realtime broadcast, wygasa po TYPING_EXPIRE_MS).
  useEffect(() => {
    const handle = joinTyping(conversationId, (p) => {
      if (p.userId === myUserId) return;
      setTyping((t) => ({ ...t, [p.userId]: { name: p.name, at: Date.now() } }));
    });
    typingHandle.current = handle;
    return () => {
      handle?.unsubscribe();
      typingHandle.current = null;
      setTyping({});
    };
  }, [conversationId, myUserId]);

  useEffect(() => {
    if (!Object.keys(typing).length) return;
    const t = setInterval(() => {
      setTyping((prev) => {
        const now = Date.now();
        const next = Object.fromEntries(
          Object.entries(prev).filter(([, v]) => now - v.at < TYPING_EXPIRE_MS),
        );
        return Object.keys(next).length === Object.keys(prev).length ? prev : next;
      });
    }, 1000);
    return () => clearInterval(t);
  }, [typing]);

  const notifyTyping = useCallback(() => {
    if (!myUserId) return;
    const name = profiles[myUserId]?.displayName || "Ktoś";
    typingHandle.current?.notify({ userId: myUserId, name });
  }, [myUserId, profiles]);

  const typingText = typingLabel(Object.values(typing).map((v) => v.name));

  // Cytaty: wiadomości spoza załadowanego feedu dociągamy pojedynczo.
  const allLoaded = useMemo(() => {
    const map = new Map<string, ChatMessage>();
    for (const m of messages ?? []) map.set(m.id, m);
    for (const m of focus?.messages ?? []) map.set(m.id, m);
    for (const m of threadMessages ?? []) map.set(m.id, m);
    return map;
  }, [messages, focus?.messages, threadMessages]);

  useEffect(() => {
    const missing = new Set<string>();
    for (const m of displayedFeed) {
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
  }, [displayedFeed, allLoaded, fetchedQuotes]);

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
      // Wysyłka z widoku głównego wraca do ogona (nowa wiadomość ląduje na dole).
      if (!threadRootId) returnToLatest(conversationId);
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
        case "saveNote":
          void saveMessageAsNote(msg).then(({ error }) => {
            if (error) alert(error);
          });
          break;
        case "pinThread":
          void pinThreadMessage(msg, !msg.pinnedAt);
          break;
        case "openThread": {
          const rootId = msg.threadRootId ?? msg.id;
          const root =
            displayedFeed.find((m) => m.id === rootId) ??
            feed.find((m) => m.id === rootId) ??
            (msg.id === rootId ? msg : null);
          if (root && !root.threadTitle?.trim()) {
            setNameThreadMsg(root);
          } else {
            void openThread(rootId);
          }
          break;
        }
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
    [profiles, displayedFeed, feed],
  );

  const handleSaveEdit = useCallback(
    (id: string, body: string, mentions: string[]) => {
      const msg =
        (messages ?? []).find((m) => m.id === id) ??
        focus?.messages.find((m) => m.id === id);
      setEditing(null);
      if (msg) void editChatMessage(msg, body, mentions);
    },
    [messages, focus?.messages],
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
    onTyping: notifyTyping,
  };

  const headerIconBtn =
    "rounded-lg p-1.5 text-ink-light transition hover:bg-surface-overlay hover:text-ink";

  const nameThreadDialog = nameThreadMsg ? (
    <NameThreadDialog
      msg={nameThreadMsg}
      onCancel={() => setNameThreadMsg(null)}
      onConfirm={(named) => {
        const root = nameThreadMsg;
        setNameThreadMsg(null);
        void saveThreadTitle(root, named).then(({ error }) => {
          if (error) alert(error);
        });
        void openThread(root.id);
      }}
    />
  ) : null;

  // ── Widok wątku ──────────────────────────────────────────────────────────
  if (threadRootId) {
    const rootFromFeed =
      displayedFeed.find((m) => m.id === threadRootId) ??
      feed.find((m) => m.id === threadRootId);
    // Scal root z cache'em — pusty [] nie może zasłonić wiadomości startowej.
    const thread = mergeMessages(
      rootFromFeed ? [rootFromFeed] : [],
      threadMessages ?? [],
    );
    const rootMsg = thread.find((m) => m.id === threadRootId) ?? rootFromFeed;
    return (
      <div className="flex h-full min-h-0 flex-col">
        <div className="flex items-center gap-2 border-b border-line px-2 py-2">
          <button
            type="button"
            onClick={() => {
              setActiveThread(null);
              setRouteHash({ view: "conversation", conversationId });
            }}
            className={headerIconBtn}
            aria-label="Wróć do rozmowy"
          >
            <ArrowLeft size={18} />
          </button>
          <MessageSquare size={15} className="text-accent" />
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-semibold text-ink">
              {threadDisplayTitle(rootMsg)}
            </div>
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
          hasOlder={false}
          onOpenActions={(msg, anchor) => setActionTarget({ msg, anchor })}
          onJumpTo={handleJumpTo}
          inThread
        />
        {typingText && (
          <div className="px-3 pb-0.5 text-[11px] text-ink-faint">{typingText}</div>
        )}
        <MessageComposer
          onSend={handleSend}
          placeholder="Odpowiedz w wątku…"
          {...composerShared}
        />
        <MessageActionsSheet
          msg={actionTarget?.msg ?? null}
          anchor={actionTarget?.anchor ?? null}
          mine={actionTarget?.msg.authorUserId === myUserId}
          allowThread={false}
          onAction={handleAction}
          onClose={() => setActionTarget(null)}
        />
        <EditHistoryModal
          msg={historyMsg}
          profiles={profiles}
          onClose={() => setHistoryMsg(null)}
        />
        {nameThreadDialog}
      </div>
    );
  }

  // ── Widok rozmowy ────────────────────────────────────────────────────────
  return (
    <div className={`flex min-h-0 flex-col ${embedded ? "" : "h-full"}`}>
      {!embedded && (
        <div className="relative flex items-center gap-1.5 border-b border-line px-2 py-1.5">
          {onBack && !pane && (
            <button
              type="button"
              onClick={onBack}
              className={headerIconBtn}
              aria-label="Wróć do listy rozmów"
            >
              <ArrowLeft size={18} />
            </button>
          )}
          <span className="relative shrink-0 text-ink-faint">
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
            <>
              <button
                type="button"
                onClick={() => setShowMedia(true)}
                className={headerIconBtn}
                aria-label="Media i pliki"
                title="Media i pliki"
              >
                <FolderOpen size={16} />
              </button>
              {!pane && (
                <>
                  <button
                    type="button"
                    onClick={() => setRegistryMode("decisions")}
                    className={headerIconBtn}
                    aria-label="Decyzje"
                    title="Decyzje"
                  >
                    <Gavel size={16} />
                  </button>
                  <button
                    type="button"
                    onClick={() => setRegistryMode("notes")}
                    className={headerIconBtn}
                    aria-label="Notatki"
                    title="Notatki"
                  >
                    <StickyNote size={16} />
                  </button>
                </>
              )}
              <button
                type="button"
                onClick={() => {
                  setMenuOpen((v) => !v);
                  setMuteMenuOpen(false);
                }}
                className={headerIconBtn}
                aria-label="Opcje rozmowy"
              >
                <MoreVertical size={17} />
              </button>
            </>
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
                    setShowThreads(true);
                    setMenuOpen(false);
                  }}
                  className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs text-ink transition hover:bg-surface-raised"
                >
                  <MessagesSquare size={14} /> Wątki
                </button>

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

      {!embedded && !pane && (
        <PinnedThreadsBar
          conversationId={conversationId}
          profiles={profiles}
          replyCounts={replyCounts}
          onOpenThread={(rootId) => void openThread(rootId)}
          onJumpTo={handleJumpTo}
        />
      )}

      <MessageFeed
        key={focus ? `focus-${focus.anchorId}` : "tail"}
        messages={displayedFeed}
        myUserId={myUserId}
        profiles={profiles}
        mentionNames={mentionNames}
        quotedLookup={quotedLookup}
        flashMessageId={flashMessageId}
        replyCounts={replyCounts}
        hasOlder={focus ? focus.hasOlder : hasMore}
        onLoadOlder={
          focus ? () => loadOlderFocus() : () => loadOlderMessages(conversationId)
        }
        hasNewer={focus?.hasNewer ?? false}
        onLoadNewer={focus ? () => loadNewerFocus() : undefined}
        initialBottom={!focus}
        onOpenThread={embedded ? undefined : (rootId) => void openThread(rootId)}
        onOpenActions={(msg, anchor) => setActionTarget({ msg, anchor })}
        onJumpTo={handleJumpTo}
      />

      {focus && (
        <button
          type="button"
          onClick={() => returnToLatest(conversationId)}
          className="flex items-center justify-center gap-1.5 border-t border-line bg-surface-raised/60 px-3 py-1.5 text-[11px] text-accent transition hover:bg-surface-raised"
        >
          <ArrowDown size={12} /> Przeglądasz starsze wiadomości — wróć do najnowszych
        </button>
      )}

      {typingText && (
        <div className="px-3 pb-0.5 text-[11px] text-ink-faint">{typingText}</div>
      )}

      <MessageComposer
        onSend={handleSend}
        autoFocus={!embedded}
        onSendPoll={(q, opts) => void sendPollMessage(conversationId, q, opts)}
        onSendGif={(url) => {
          returnToLatest(conversationId);
          void sendGifMessage(conversationId, url);
        }}
        {...composerShared}
      />

      <MessageActionsSheet
        msg={actionTarget?.msg ?? null}
        anchor={actionTarget?.anchor ?? null}
        mine={actionTarget?.msg.authorUserId === myUserId}
        allowThread={!embedded}
        onAction={handleAction}
        onClose={() => setActionTarget(null)}
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

      {registryMode && (
        <RegistryView
          mode={registryMode}
          conversationId={conversationId}
          myUserId={myUserId}
          profiles={profiles}
          onClose={() => setRegistryMode(null)}
          onJumpTo={handleJumpTo}
        />
      )}

      {showThreads && (
        <ThreadsSheet
          conversationId={conversationId}
          profiles={profiles}
          onClose={() => setShowThreads(false)}
          onOpenThread={(rootId) => void openThread(rootId)}
        />
      )}
      {nameThreadDialog}
    </div>
  );
}
