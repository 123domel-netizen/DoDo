import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  AtSign,
  BellOff,
  CalendarDays,
  CheckSquare,
  FileText,
  Hash,
  MessageSquare,
  Pin,
  Plus,
  Search,
  User,
  Users,
  X,
} from "lucide-react";
import { cloudEnabled } from "@/lib/supabase";
import { useStore } from "@/state/store";
import { useChatStore } from "@/lib/chat/store";
import { isMuted, overviewTitle, sortOverview } from "@/lib/chat/feed";
import { jumpToMessage, openConversation, openThread } from "@/lib/chat/init";
import {
  fetchMyMentions,
  fetchPublicChannels,
  joinChannel,
  searchAll,
} from "@/lib/chat/api";
import { isOnline } from "@/lib/chat/presence";
import { setRouteHash } from "@/lib/navigation";
import { useIsMobile } from "@/hooks/useMediaQuery";
import type {
  ChatMessage,
  ChatOverviewEntry,
  ChatSearchResult,
  PublicChannelInfo,
} from "@/lib/chat/types";
import { messagePreviewLabel } from "@/lib/chat/types";
import { ConversationView } from "@/components/chat/ConversationView";
import { ChatContextColumn } from "@/components/chat/ChatContextColumn";
import { NewConversationDialog } from "@/components/chat/NewConversationDialog";
import { formatMessageTime } from "@/components/chat/MessageBubble";

const FREQUENT_LIMIT = 8;

function ConversationRow({
  entry,
  title,
  authorName,
  online,
  onOpen,
}: {
  entry: ChatOverviewEntry;
  title: string;
  authorName: string | null;
  online: boolean;
  onOpen: () => void;
}) {
  const last = entry.lastMessage;
  const preview = last
    ? last.deletedAt
      ? "Wiadomość usunięta"
      : last.kind === "system"
        ? last.body
        : `${authorName ? `${authorName}: ` : ""}${
            messagePreviewLabel(last.kind, last.body) || "(załącznik)"
          }`
    : "Brak wiadomości";
  const muted = isMuted(entry);
  const showUnread = entry.unreadCount > 0 || entry.myMarkedUnread;

  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex w-full items-center gap-2.5 border-b border-line/50 px-3 py-2.5 text-left transition hover:bg-surface-raised"
    >
      <span className="relative flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-line bg-surface-raised text-ink-faint">
        {entry.kind === "channel" ? (
          <Hash size={15} />
        ) : entry.kind === "item" ? (
          <MessageSquare size={15} />
        ) : entry.members.length > 2 ? (
          <Users size={15} />
        ) : (
          <User size={15} />
        )}
        {online && (
          <span className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 border-surface bg-green-500" />
        )}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline justify-between gap-2">
          <span
            className={`flex min-w-0 items-center gap-1 truncate text-sm ${
              showUnread ? "font-semibold text-ink" : "font-medium text-ink"
            }`}
          >
            {entry.myPinnedAt && <Pin size={11} className="shrink-0 text-accent" />}
            <span className="truncate">{title}</span>
            {muted && <BellOff size={11} className="shrink-0 text-ink-faint" />}
          </span>
          {entry.lastMessageAt && (
            <span className="shrink-0 text-[10px] text-ink-faint">
              {formatMessageTime(entry.lastMessageAt)}
            </span>
          )}
        </span>
        <span className="mt-0.5 flex items-center justify-between gap-2">
          <span
            className={`min-w-0 flex-1 truncate text-xs ${
              showUnread ? "text-ink-light" : "text-ink-faint"
            }`}
          >
            {preview}
          </span>
          {entry.unreadCount > 0 ? (
            <span className="flex h-4 min-w-[1rem] shrink-0 items-center justify-center rounded-full bg-accent px-1 text-[10px] font-semibold text-white">
              {entry.unreadCount > 99 ? "99+" : entry.unreadCount}
            </span>
          ) : entry.myMarkedUnread ? (
            <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-accent" />
          ) : null}
        </span>
      </span>
    </button>
  );
}

function NavRow({
  entry,
  title,
  online,
  active,
  onOpen,
}: {
  entry: ChatOverviewEntry;
  title: string;
  online: boolean;
  active: boolean;
  onOpen: () => void;
}) {
  const muted = isMuted(entry);
  const showUnread = entry.unreadCount > 0 || entry.myMarkedUnread;
  const label =
    entry.kind === "channel" ? (title.startsWith("#") ? title : `#${title}`) : title;

  return (
    <button
      type="button"
      onClick={onOpen}
      className={`flex w-full items-center gap-1.5 rounded-md px-1.5 py-1 text-left transition ${
        active ? "bg-accent/15 text-ink" : "hover:bg-surface-raised"
      }`}
    >
      <span className="relative flex h-5 w-5 shrink-0 items-center justify-center text-ink-faint">
        {entry.kind === "channel" ? (
          <Hash size={12} />
        ) : entry.kind === "item" ? (
          <MessageSquare size={12} />
        ) : entry.members.length > 2 ? (
          <Users size={12} />
        ) : (
          <User size={12} />
        )}
        {online && (
          <span className="absolute -bottom-0.5 -right-0.5 h-1.5 w-1.5 rounded-full border border-surface bg-green-500" />
        )}
      </span>
      <span
        className={`min-w-0 flex-1 truncate text-[12px] leading-tight ${
          showUnread ? "font-semibold text-ink" : "text-ink-light"
        }`}
      >
        {label}
      </span>
      {muted && <BellOff size={10} className="shrink-0 text-ink-faint" />}
      {entry.unreadCount > 0 ? (
        <span className="flex h-3.5 min-w-[0.875rem] shrink-0 items-center justify-center rounded-full bg-accent px-1 text-[9px] font-semibold text-white">
          {entry.unreadCount > 99 ? "99+" : entry.unreadCount}
        </span>
      ) : entry.myMarkedUnread ? (
        <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-accent" />
      ) : null}
    </button>
  );
}

function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <div className="px-1.5 pb-0.5 pt-2 text-[10px] font-medium uppercase tracking-wide text-ink-faint">
      {children}
    </div>
  );
}

function SearchResults({
  results,
  onClose,
}: {
  results: ChatSearchResult[];
  onClose: () => void;
}) {
  const setEditing = useStore((s) => s.setEditing);
  const items = useStore((s) => s.items);

  const open = (r: ChatSearchResult) => {
    onClose();
    if (r.resultType === "item" && r.itemId) {
      setEditing(r.itemId);
    } else if (r.conversationId) {
      void openConversation(r.conversationId).then(() => {
        if (r.resultType === "message") void jumpToMessage(r.conversationId!, r.id);
      });
      setRouteHash({ view: "conversation", conversationId: r.conversationId });
    }
  };

  if (!results.length) {
    return (
      <div className="px-4 py-6 text-center text-xs text-ink-faint">Brak wyników.</div>
    );
  }

  return (
    <div className="thin-scrollbar min-h-0 flex-1 overflow-y-auto">
      {results.map((r) => (
        <button
          key={`${r.resultType}-${r.id}`}
          type="button"
          onClick={() => open(r)}
          className="flex w-full items-start gap-2.5 border-b border-line/50 px-3 py-2.5 text-left transition hover:bg-surface-raised"
        >
          <span className="mt-0.5 shrink-0 text-ink-faint">
            {r.resultType === "message" ? (
              <MessageSquare size={14} />
            ) : r.resultType === "file" ? (
              <FileText size={14} />
            ) : r.itemId && items[r.itemId]?.type === "event" ? (
              <CalendarDays size={14} />
            ) : (
              <CheckSquare size={14} />
            )}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm text-ink">
              {r.title || r.snippet || "(bez treści)"}
            </span>
            {r.title && r.snippet && (
              <span className="block truncate text-xs text-ink-faint">{r.snippet}</span>
            )}
            <span className="block text-[10px] text-ink-faint">
              {r.resultType === "message"
                ? "wiadomość"
                : r.resultType === "file"
                  ? "plik"
                  : "wpis"}{" "}
              · {formatMessageTime(r.createdAt)}
            </span>
          </span>
        </button>
      ))}
    </div>
  );
}

function MentionsList({ onOpen }: { onOpen: (msg: ChatMessage) => void }) {
  const myUserId = useChatStore((s) => s.userId);
  const overview = useChatStore((s) => s.overview);
  const profiles = useChatStore((s) => s.profiles);
  const [rows, setRows] = useState<ChatMessage[] | null>(null);

  useEffect(() => {
    if (!myUserId) return;
    let cancelled = false;
    void fetchMyMentions(myUserId).then((list) => {
      if (!cancelled) setRows(list);
    });
    return () => {
      cancelled = true;
    };
  }, [myUserId]);

  if (rows === null) {
    return <div className="px-4 py-6 text-center text-xs text-ink-faint">Wczytywanie…</div>;
  }
  if (!rows.length) {
    return (
      <div className="px-6 py-10 text-center text-xs leading-relaxed text-ink-faint">
        Brak wzmianek.
      </div>
    );
  }

  return (
    <div className="thin-scrollbar min-h-0 flex-1 overflow-y-auto">
      {rows.map((msg) => {
        const conv = overview.find((c) => c.id === msg.conversationId);
        return (
          <button
            key={msg.id}
            type="button"
            onClick={() => onOpen(msg)}
            className="flex w-full flex-col gap-0.5 border-b border-line/50 px-3 py-2.5 text-left transition hover:bg-surface-raised"
          >
            <span className="truncate text-[11px] text-ink-faint">
              {profiles[msg.authorUserId]?.displayName || "Nieznany"}
              {conv ? ` · ${overviewTitle(conv, myUserId, () => undefined)}` : ""}
            </span>
            <span className="line-clamp-2 text-sm text-ink">{msg.body || "(załącznik)"}</span>
            <span className="text-[10px] text-ink-faint">
              {formatMessageTime(msg.createdAt)}
            </span>
          </button>
        );
      })}
    </div>
  );
}

export function ChatPanel() {
  const isMobile = useIsMobile();
  const myUserId = useChatStore((s) => s.userId);
  const overview = useChatStore((s) => s.overview);
  const profiles = useChatStore((s) => s.profiles);
  const activeId = useChatStore((s) => s.activeConversationId);
  const setActiveConversation = useChatStore((s) => s.setActiveConversation);
  const items = useStore((s) => s.items);

  const [showNew, setShowNew] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<ChatSearchResult[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [showMentions, setShowMentions] = useState(false);
  const [publicChannels, setPublicChannels] = useState<PublicChannelInfo[]>([]);

  const joinedIds = useMemo(() => new Set(overview.map((c) => c.id)), [overview]);
  const discoverable = publicChannels.filter((c) => !joinedIds.has(c.id));
  const sorted = useMemo(() => sortOverview(overview), [overview]);
  const pinned = sorted.filter((c) => c.myPinnedAt);
  const unpinned = sorted.filter((c) => !c.myPinnedAt);
  const frequent = unpinned.slice(0, FREQUENT_LIMIT);
  const more = unpinned.slice(FREQUENT_LIMIT);

  useEffect(() => {
    if (cloudEnabled) void fetchPublicChannels().then(setPublicChannels);
  }, []);

  if (!cloudEnabled) {
    return (
      <div className="flex h-full items-center justify-center px-6 text-center text-sm text-ink-faint">
        Czat wymaga synchronizacji z chmurą (logowanie Google).
      </div>
    );
  }
  if (!myUserId) {
    return (
      <div className="flex h-full items-center justify-center px-6 text-center text-sm text-ink-faint">
        Zaloguj się, aby korzystać z czatu.
      </div>
    );
  }

  if (isMobile && activeId) {
    return (
      <ConversationView
        conversationId={activeId}
        onBack={() => {
          setActiveConversation(null);
          setRouteHash({ view: "chat" });
        }}
      />
    );
  }

  const runSearch = async () => {
    const q = query.trim();
    if (!q) {
      setResults(null);
      return;
    }
    setSearching(true);
    try {
      setResults(await searchAll(q));
    } finally {
      setSearching(false);
    }
  };

  const handleJoin = async (channelId: string) => {
    const { error } = await joinChannel(channelId);
    if (error) {
      alert(error);
      return;
    }
    void openConversation(channelId);
    setRouteHash({ view: "conversation", conversationId: channelId });
  };

  const openRow = (entry: ChatOverviewEntry) => {
    void openConversation(entry.id);
    setRouteHash({ view: "conversation", conversationId: entry.id });
  };

  const openMention = (msg: ChatMessage) => {
    setShowMentions(false);
    void openConversation(msg.conversationId).then(() => {
      void jumpToMessage(msg.conversationId, msg.threadRootId ?? msg.id);
    });
    setRouteHash({ view: "conversation", conversationId: msg.conversationId });
  };

  const dmOnline = (entry: ChatOverviewEntry): boolean => {
    if (entry.kind !== "dm") return false;
    const other = entry.members.find((m) => m.userId !== myUserId);
    return Boolean(other && isOnline(profiles[other.userId]?.lastSeenAt));
  };

  const titleOf = (entry: ChatOverviewEntry) =>
    overviewTitle(entry, myUserId, (id) => items[id]?.title);

  const renderMobileRow = (entry: ChatOverviewEntry) => {
    const last = entry.lastMessage;
    const authorName =
      last && last.kind !== "system"
        ? last.authorUserId === myUserId
          ? "Ty"
          : (entry.members.find((m) => m.userId === last.authorUserId)?.displayName ??
            null)
        : null;
    return (
      <ConversationRow
        key={entry.id}
        entry={entry}
        title={titleOf(entry)}
        authorName={authorName}
        online={dmOnline(entry)}
        onOpen={() => openRow(entry)}
      />
    );
  };

  const renderNavSection = (label: string, entries: ChatOverviewEntry[]) =>
    entries.length > 0 && (
      <>
        <SectionLabel>{label}</SectionLabel>
        {entries.map((entry) => (
          <NavRow
            key={entry.id}
            entry={entry}
            title={titleOf(entry)}
            online={dmOnline(entry)}
            active={entry.id === activeId}
            onOpen={() => openRow(entry)}
          />
        ))}
      </>
    );

  const navList = (
    <>
      {overview.length === 0 && (
        <div className="px-2 py-6 text-center text-[11px] leading-relaxed text-ink-faint">
          Brak rozmów — kliknij <span className="text-ink-light">+</span>.
        </div>
      )}
      {renderNavSection("Najczęstsze", frequent)}
      {renderNavSection("Przypięte", pinned)}
      {renderNavSection("Pozostałe", more)}
      {discoverable.length > 0 && (
        <>
          <SectionLabel>Kanały publiczne</SectionLabel>
          {discoverable.map((c) => (
            <div key={c.id} className="flex items-center gap-1 px-1.5 py-1">
              <Hash size={11} className="shrink-0 text-ink-faint" />
              <span className="min-w-0 flex-1 truncate text-[12px] text-ink-light">
                {c.name}
              </span>
              <button
                type="button"
                onClick={() => void handleJoin(c.id)}
                className="shrink-0 rounded border border-line px-1.5 py-0.5 text-[10px] text-ink-faint transition hover:text-ink"
              >
                Dołącz
              </button>
            </div>
          ))}
        </>
      )}
    </>
  );

  const toolbar = (
    <div className="flex items-center gap-1 border-b border-line px-1.5 py-1.5">
      <div className="relative min-w-0 flex-1">
        <Search
          size={12}
          className="pointer-events-none absolute left-1.5 top-1/2 -translate-y-1/2 text-ink-faint"
        />
        <input
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            if (!e.target.value.trim()) setResults(null);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") void runSearch();
          }}
          placeholder="Szukaj…"
          className="w-full rounded-md border border-line bg-surface-raised py-1 pl-6 pr-6 text-[12px] text-ink outline-none placeholder:text-ink-faint focus:border-accent/50"
        />
        {query && (
          <button
            type="button"
            onClick={() => {
              setQuery("");
              setResults(null);
            }}
            className="absolute right-1 top-1/2 -translate-y-1/2 text-ink-faint hover:text-ink"
            aria-label="Wyczyść"
          >
            <X size={11} />
          </button>
        )}
      </div>
      <button
        type="button"
        onClick={() => setShowMentions((v) => !v)}
        className={`shrink-0 rounded-md border p-1.5 transition ${
          showMentions
            ? "border-accent/50 bg-accent/15 text-accent"
            : "border-line text-ink-faint hover:text-ink"
        }`}
        aria-label="Moje wzmianki"
      >
        <AtSign size={13} />
      </button>
      <button
        type="button"
        onClick={() => setShowNew(true)}
        className="shrink-0 rounded-md bg-accent-grad p-1.5 text-white transition hover:brightness-110"
        aria-label="Nowa rozmowa"
      >
        <Plus size={13} />
      </button>
    </div>
  );

  const navBody = showMentions ? (
    <MentionsList onOpen={openMention} />
  ) : results !== null ? (
    searching ? (
      <div className="px-3 py-4 text-center text-[11px] text-ink-faint">Szukam…</div>
    ) : (
      <SearchResults results={results} onClose={() => setResults(null)} />
    )
  ) : (
    <div className="thin-scrollbar min-h-0 flex-1 overflow-y-auto px-1 pb-2">
      {isMobile ? (
        <>
          {overview.length === 0 && (
            <div className="px-6 py-10 text-center text-xs leading-relaxed text-ink-faint">
              Nie masz jeszcze rozmów.
            </div>
          )}
          {pinned.length > 0 && (
            <>
              <div className="px-3 pb-1 pt-3 text-[11px] font-medium uppercase tracking-wide text-ink-faint">
                Ulubione
              </div>
              {pinned.map(renderMobileRow)}
              {unpinned.length > 0 && (
                <div className="px-3 pb-1 pt-3 text-[11px] font-medium uppercase tracking-wide text-ink-faint">
                  Rozmowy
                </div>
              )}
            </>
          )}
          {unpinned.map(renderMobileRow)}
          {discoverable.length > 0 && (
            <>
              <div className="px-3 pb-1 pt-4 text-[11px] font-medium uppercase tracking-wide text-ink-faint">
                Kanały publiczne
              </div>
              {discoverable.map((c) => (
                <div
                  key={c.id}
                  className="flex items-center gap-2.5 border-b border-line/50 px-3 py-2"
                >
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-dashed border-line text-ink-faint">
                    <Hash size={15} />
                  </span>
                  <span className="min-w-0 flex-1 truncate text-sm text-ink">{c.name}</span>
                  <button
                    type="button"
                    onClick={() => void handleJoin(c.id)}
                    className="shrink-0 rounded-lg border border-line px-2.5 py-1 text-xs text-ink-light transition hover:border-line-strong hover:text-ink"
                  >
                    Dołącz
                  </button>
                </div>
              ))}
            </>
          )}
        </>
      ) : (
        navList
      )}
    </div>
  );

  if (isMobile) {
    return (
      <div className="flex h-full min-h-0 flex-col">
        {toolbar}
        {navBody}
        <NewConversationDialog open={showNew} onClose={() => setShowNew(false)} />
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0">
      <aside className="flex min-h-0 w-[25%] min-w-[9rem] max-w-[14rem] flex-col border-r border-line bg-surface">
        {toolbar}
        {navBody}
      </aside>

      <aside className="flex min-h-0 w-[25%] min-w-[9rem] max-w-[16rem] flex-col border-r border-line bg-surface-raised/30">
        <ChatContextColumn
          conversationId={activeId}
          profiles={profiles}
          onOpenThread={(rootId) => void openThread(rootId)}
          onJumpTo={(messageId) => {
            if (activeId) void jumpToMessage(activeId, messageId);
          }}
        />
      </aside>

      <section className="min-h-0 min-w-0 flex-[2]">
        {activeId ? (
          <ConversationView conversationId={activeId} pane />
        ) : (
          <div className="flex h-full items-center justify-center px-6 text-center text-xs text-ink-faint">
            Wybierz rozmowę z listy po lewej.
          </div>
        )}
      </section>

      <NewConversationDialog open={showNew} onClose={() => setShowNew(false)} />
    </div>
  );
}
