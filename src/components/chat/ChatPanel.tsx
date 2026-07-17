import { useEffect, useMemo, useState } from "react";
import {
  CalendarDays,
  CheckSquare,
  FileText,
  Hash,
  MessageSquare,
  Plus,
  Search,
  User,
  Users,
  X,
} from "lucide-react";
import { cloudEnabled } from "@/lib/supabase";
import { useStore } from "@/state/store";
import { useChatStore } from "@/lib/chat/store";
import { overviewTitle } from "@/lib/chat/feed";
import { openConversation } from "@/lib/chat/init";
import {
  fetchPublicChannels,
  joinChannel,
  searchAll,
} from "@/lib/chat/api";
import { setRouteHash } from "@/lib/navigation";
import type {
  ChatOverviewEntry,
  ChatSearchResult,
  PublicChannelInfo,
} from "@/lib/chat/types";
import { ConversationView } from "@/components/chat/ConversationView";
import { NewConversationDialog } from "@/components/chat/NewConversationDialog";
import { formatMessageTime } from "@/components/chat/MessageBubble";

function ConversationRow({
  entry,
  title,
  authorName,
  onOpen,
}: {
  entry: ChatOverviewEntry;
  title: string;
  authorName: string | null;
  onOpen: () => void;
}) {
  const last = entry.lastMessage;
  const preview = last
    ? last.deletedAt
      ? "Wiadomość usunięta"
      : last.kind === "system"
        ? last.body
        : `${authorName ? `${authorName}: ` : ""}${last.body || "(załącznik)"}`
    : "Brak wiadomości";

  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex w-full items-center gap-2.5 border-b border-line/50 px-3 py-2.5 text-left transition hover:bg-surface-raised"
    >
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-line bg-surface-raised text-ink-faint">
        {entry.kind === "channel" ? (
          <Hash size={15} />
        ) : entry.kind === "item" ? (
          <MessageSquare size={15} />
        ) : entry.members.length > 2 ? (
          <Users size={15} />
        ) : (
          <User size={15} />
        )}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline justify-between gap-2">
          <span
            className={`truncate text-sm ${
              entry.unreadCount > 0 ? "font-semibold text-ink" : "font-medium text-ink"
            }`}
          >
            {title}
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
              entry.unreadCount > 0 ? "text-ink-light" : "text-ink-faint"
            }`}
          >
            {preview}
          </span>
          {entry.unreadCount > 0 && (
            <span className="flex h-4 min-w-[1rem] shrink-0 items-center justify-center rounded-full bg-accent px-1 text-[10px] font-semibold text-white">
              {entry.unreadCount > 99 ? "99+" : entry.unreadCount}
            </span>
          )}
        </span>
      </span>
    </button>
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
      void openConversation(r.conversationId);
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

export function ChatPanel() {
  const myUserId = useChatStore((s) => s.userId);
  const overview = useChatStore((s) => s.overview);
  const activeId = useChatStore((s) => s.activeConversationId);
  const setActiveConversation = useChatStore((s) => s.setActiveConversation);
  const items = useStore((s) => s.items);

  const [showNew, setShowNew] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<ChatSearchResult[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [publicChannels, setPublicChannels] = useState<PublicChannelInfo[]>([]);

  const joinedIds = useMemo(() => new Set(overview.map((c) => c.id)), [overview]);
  const discoverable = publicChannels.filter((c) => !joinedIds.has(c.id));

  useEffect(() => {
    if (!activeId && cloudEnabled) {
      void fetchPublicChannels().then(setPublicChannels);
    }
  }, [activeId]);

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

  if (activeId) {
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

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-2 border-b border-line px-3 py-2">
        <div className="relative min-w-0 flex-1">
          <Search
            size={14}
            className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-faint"
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
            placeholder="Szukaj wiadomości, zadań, plików…"
            className="w-full rounded-lg border border-line bg-surface-raised py-1.5 pl-8 pr-7 text-sm text-ink outline-none transition placeholder:text-ink-faint focus:border-accent/50"
          />
          {query && (
            <button
              type="button"
              onClick={() => {
                setQuery("");
                setResults(null);
              }}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-ink-faint transition hover:text-ink"
              aria-label="Wyczyść"
            >
              <X size={13} />
            </button>
          )}
        </div>
        <button
          type="button"
          onClick={() => setShowNew(true)}
          className="shrink-0 rounded-lg bg-accent-grad p-2 text-white shadow-glow transition hover:brightness-110"
          aria-label="Nowa rozmowa"
        >
          <Plus size={16} />
        </button>
      </div>

      {results !== null ? (
        searching ? (
          <div className="px-4 py-6 text-center text-xs text-ink-faint">Szukam…</div>
        ) : (
          <SearchResults results={results} onClose={() => setResults(null)} />
        )
      ) : (
        <div className="thin-scrollbar min-h-0 flex-1 overflow-y-auto">
          {overview.length === 0 && (
            <div className="px-6 py-10 text-center text-xs leading-relaxed text-ink-faint">
              Nie masz jeszcze rozmów.
              <br />
              Zacznij od <span className="text-ink-light">+</span> — napisz do kogoś albo
              załóż kanał (np. Dom, Budowa).
            </div>
          )}
          {overview.map((entry) => {
            const last = entry.lastMessage;
            const authorName =
              last && last.kind !== "system"
                ? last.authorUserId === myUserId
                  ? "Ty"
                  : (entry.members.find((m) => m.userId === last.authorUserId)
                      ?.displayName ?? null)
                : null;
            return (
              <ConversationRow
                key={entry.id}
                entry={entry}
                title={overviewTitle(entry, myUserId, (id) => items[id]?.title)}
                authorName={authorName}
                onOpen={() => {
                  void openConversation(entry.id);
                  setRouteHash({ view: "conversation", conversationId: entry.id });
                }}
              />
            );
          })}

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
        </div>
      )}

      <NewConversationDialog open={showNew} onClose={() => setShowNew(false)} />
    </div>
  );
}
