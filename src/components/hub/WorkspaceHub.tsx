import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  AtSign,
  BellOff,
  ChevronDown,
  ChevronRight,
  Eye,
  EyeOff,
  Filter,
  FolderOpen,
  FolderPlus,
  Gavel,
  Hash,
  Link2,
  Maximize2,
  Minimize2,
  MessageSquare,
  MessagesSquare,
  MoreHorizontal,
  Pin,
  Plus,
  Search,
  StickyNote,
  Sun,
  User,
  Users,
  X,
} from "lucide-react";
import { cloudEnabled } from "@/lib/supabase";
import { useStore } from "@/state/store";
import { useChatStore } from "@/lib/chat/store";
import {
  filterOverviewForHubGroup,
  isMuted,
  overviewTitle,
  sortOverview,
  totalUnread,
  threadDisplayTitle,
} from "@/lib/chat/feed";
import {
  jumpToMessage,
  openConversation,
  openMediaInPanel,
  openRegistryInPanel,
  openThread,
} from "@/lib/chat/init";
import {
  fetchAttachmentsForConversations,
  fetchDecisionsForConversations,
  fetchMyMentions,
  fetchNotesForConversations,
  fetchPinnedMessagesForConversations,
  fetchPublicChannels,
  fetchThreadsForConversations,
  joinChannel,
  searchAll,
  type ConversationAttachment,
} from "@/lib/chat/api";
import { isOnline } from "@/lib/chat/presence";
import { setRouteHash } from "@/lib/navigation";
import type {
  ChatDecision,
  ChatMessage,
  ChatNote,
  ChatOverviewEntry,
  ChatSearchResult,
  PublicChannelInfo,
  ThreadListEntry,
} from "@/lib/chat/types";
import { messagePreviewLabel } from "@/lib/chat/types";
import { NewConversationDialog } from "@/components/chat/NewConversationDialog";
import { formatMessageTime, useSignedUrl } from "@/components/chat/MessageBubble";
import { formatFileSize } from "@/lib/chat/upload";
import { HubTodayInbox } from "@/components/hub/HubTodayInbox";
import { HubSearchPane } from "@/components/hub/HubSearchPane";
import { HubLinksPane } from "@/components/hub/HubLinksPane";

const FREQUENT_LIMIT = 8;

type HubTab =
  | "today"
  | "chat"
  | "threads"
  | "decisions"
  | "notes"
  | "media"
  | "mentions"
  | "search"
  | "links";

const RAIL: { id: HubTab; label: string; icon: typeof MessageSquare }[] = [
  { id: "today", label: "Dziś", icon: Sun },
  { id: "chat", label: "Czat", icon: MessageSquare },
  { id: "threads", label: "Wątki", icon: MessagesSquare },
  { id: "decisions", label: "Decyzje", icon: Gavel },
  { id: "notes", label: "Notatki", icon: StickyNote },
  { id: "media", label: "Media", icon: FolderOpen },
  { id: "mentions", label: "@", icon: AtSign },
  { id: "search", label: "Szukaj", icon: Search },
  { id: "links", label: "Linki", icon: Link2 },
];

function ConversationRow({
  entry,
  title,
  authorName,
  online,
  active,
  folders,
  onOpen,
  onAddToFolder,
  onRemoveFromFolder,
  inFolderId,
}: {
  entry: ChatOverviewEntry;
  title: string;
  authorName: string | null;
  online: boolean;
  active: boolean;
  folders: { id: string; name: string }[];
  onOpen: () => void;
  onAddToFolder: (folderId: string) => void;
  onRemoveFromFolder?: () => void;
  inFolderId?: string;
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
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <div
      className={`relative flex w-full items-center gap-1 border-b border-line/50 ${
        active ? "bg-accent/10" : "hover:bg-surface-raised"
      }`}
    >
      <button
        type="button"
        onClick={onOpen}
        className="flex min-w-0 flex-1 items-center gap-2.5 px-3 py-2 text-left"
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
      {(folders.length > 0 || onRemoveFromFolder) && (
        <button
          type="button"
          onClick={() => setMenuOpen((v) => !v)}
          className="mr-1 shrink-0 rounded p-1 text-ink-faint hover:bg-surface-raised hover:text-ink"
          aria-label="Opcje folderu"
        >
          <MoreHorizontal size={14} />
        </button>
      )}
      {menuOpen && (
        <>
          <button
            type="button"
            className="fixed inset-0 z-40 cursor-default"
            aria-label="Zamknij"
            onClick={() => setMenuOpen(false)}
          />
          <div className="absolute right-2 top-full z-50 mt-0.5 w-44 rounded-lg border border-line bg-surface-overlay p-1 shadow-pop">
            {onRemoveFromFolder && (
              <button
                type="button"
                onClick={() => {
                  onRemoveFromFolder();
                  setMenuOpen(false);
                }}
                className="flex w-full rounded-md px-2 py-1.5 text-left text-[11px] text-ink hover:bg-surface-raised"
              >
                Usuń z folderu
              </button>
            )}
            {folders.map((f) => (
              <button
                key={f.id}
                type="button"
                disabled={f.id === inFolderId}
                onClick={() => {
                  onAddToFolder(f.id);
                  setMenuOpen(false);
                }}
                className="flex w-full rounded-md px-2 py-1.5 text-left text-[11px] text-ink hover:bg-surface-raised disabled:opacity-40"
              >
                Do „{f.name}”
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function CollapsibleSection({
  sectionKey,
  label,
  collapsed,
  onToggle,
  children,
  actions,
}: {
  sectionKey: string;
  label: string;
  collapsed: boolean;
  onToggle: (key: string) => void;
  children: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <>
      <div className="flex items-center gap-1 px-2 pb-1 pt-3">
        <button
          type="button"
          onClick={() => onToggle(sectionKey)}
          className="flex min-w-0 flex-1 items-center gap-1 text-[11px] font-medium uppercase tracking-wide text-ink-faint hover:text-ink"
        >
          {collapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
          <span className="truncate">{label}</span>
        </button>
        {actions}
      </div>
      {!collapsed && children}
    </>
  );
}

function MediaThumb({ att }: { att: ConversationAttachment & { conversationId: string } }) {
  const url = useSignedUrl(att.thumbPath ?? att.bucketPath);
  if (!att.mimeType.startsWith("image/")) {
    return (
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-line bg-surface-raised text-ink-faint">
        <FolderOpen size={14} />
      </span>
    );
  }
  return (
    <span className="h-10 w-10 shrink-0 overflow-hidden rounded-md border border-line bg-surface-raised">
      {url ? (
        <img src={url} alt="" className="h-full w-full object-cover" loading="lazy" />
      ) : (
        <span className="flex h-full items-center justify-center text-[9px] text-ink-faint">…</span>
      )}
    </span>
  );
}

/**
 * Desktop hub pod kalendarzem: Czat / Wątki / Decyzje / Notatki / Media / @.
 * Detal otwiera się w prawym panelu.
 */
export function WorkspaceHub() {
  const myUserId = useChatStore((s) => s.userId);
  const overview = useChatStore((s) => s.overview);
  const profiles = useChatStore((s) => s.profiles);
  const activeId = useChatStore((s) => s.activeConversationId);
  const hubTab = useChatStore((s) => s.hubTab);
  const setHubTab = useChatStore((s) => s.setHubTab);
  const hubExpanded = useChatStore((s) => s.hubExpanded);
  const toggleHubExpanded = useChatStore((s) => s.toggleHubExpanded);
  const hubMatchGroup = useChatStore((s) => s.hubMatchGroup);
  const setHubMatchGroup = useChatStore((s) => s.setHubMatchGroup);
  const hubHiddenTabs = useChatStore((s) => s.hubHiddenTabs);
  const toggleHubTabHidden = useChatStore((s) => s.toggleHubTabHidden);
  const hubChatFolders = useChatStore((s) => s.hubChatFolders);
  const hubCollapsedSections = useChatStore((s) => s.hubCollapsedSections);
  const addHubChatFolder = useChatStore((s) => s.addHubChatFolder);
  const removeHubChatFolder = useChatStore((s) => s.removeHubChatFolder);
  const addConversationToHubFolder = useChatStore((s) => s.addConversationToHubFolder);
  const removeConversationFromHubFolder = useChatStore(
    (s) => s.removeConversationFromHubFolder,
  );
  const toggleHubSectionCollapsed = useChatStore((s) => s.toggleHubSectionCollapsed);
  const registryFocus = useChatStore((s) => s.registryFocus);
  const registryEpoch = useChatStore((s) => s.registryEpoch);
  const activeGroupFilter = useStore((s) => s.activeGroupFilter);
  const items = useStore((s) => s.items);
  const groups = useStore((s) => s.groups);

  const [showNew, setShowNew] = useState(false);
  const [showVisibility, setShowVisibility] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<ChatSearchResult[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [publicChannels, setPublicChannels] = useState<PublicChannelInfo[]>([]);
  const [decisions, setDecisions] = useState<ChatDecision[] | null>(null);
  const [notes, setNotes] = useState<ChatNote[] | null>(null);
  const [mentions, setMentions] = useState<ChatMessage[] | null>(null);
  const [threads, setThreads] = useState<
    (ThreadListEntry & { conversationId: string })[] | null
  >(null);
  const [pinnedThreads, setPinnedThreads] = useState<ChatMessage[] | null>(null);
  const [media, setMedia] = useState<(ConversationAttachment & { conversationId: string })[] | null>(
    null,
  );

  const filteredOverview = useMemo(
    () =>
      filterOverviewForHubGroup(overview, {
        matchGroup: hubMatchGroup,
        activeGroupFilter,
        itemGroupId: (itemId) => items[itemId]?.groupId,
      }),
    [overview, hubMatchGroup, activeGroupFilter, items],
  );

  const joinedIds = useMemo(
    () => new Set(filteredOverview.map((c) => c.id)),
    [filteredOverview],
  );
  const discoverable = publicChannels.filter((c) => !joinedIds.has(c.id) && !hubMatchGroup);
  const sorted = useMemo(() => sortOverview(filteredOverview), [filteredOverview]);
  const pinned = sorted.filter((c) => c.myPinnedAt);
  const unpinned = sorted.filter((c) => !c.myPinnedAt);
  const frequent = unpinned.slice(0, FREQUENT_LIMIT);
  const more = unpinned.slice(FREQUENT_LIMIT);
  const convIds = useMemo(() => filteredOverview.map((c) => c.id), [filteredOverview]);
  const convIdsKey = convIds.join(",");
  const unread = totalUnread(filteredOverview);
  const activeGroupName = activeGroupFilter
    ? groups.find((g) => g.id === activeGroupFilter)?.name
    : null;

  // Gdy aktywna zakładka jest ukryta — przełącz na pierwszą widoczną.
  useEffect(() => {
    if (!hubHiddenTabs.includes(hubTab)) return;
    const next = RAIL.find((t) => !hubHiddenTabs.includes(t.id));
    if (next) setHubTab(next.id);
  }, [hubTab, hubHiddenTabs, setHubTab]);

  useEffect(() => {
    if (cloudEnabled) void fetchPublicChannels().then(setPublicChannels);
  }, []);

  // Prefetch wzmianek pod badge w railu.
  useEffect(() => {
    if (!myUserId) return;
    let cancelled = false;
    void fetchMyMentions(myUserId).then((list) => {
      if (!cancelled) setMentions(list);
    });
    return () => {
      cancelled = true;
    };
  }, [myUserId, registryEpoch]);

  useEffect(() => {
    if (hubTab !== "decisions") return;
    let cancelled = false;
    setDecisions(null);
    void fetchDecisionsForConversations(convIds).then((list) => {
      if (!cancelled) setDecisions(list);
    });
    return () => {
      cancelled = true;
    };
  }, [hubTab, convIdsKey, registryEpoch]);

  useEffect(() => {
    if (hubTab !== "notes") return;
    let cancelled = false;
    setNotes(null);
    void fetchNotesForConversations(convIds).then((list) => {
      if (!cancelled) setNotes(list);
    });
    return () => {
      cancelled = true;
    };
  }, [hubTab, convIdsKey, registryEpoch]);

  useEffect(() => {
    if (hubTab !== "mentions" || !myUserId) return;
    let cancelled = false;
    setMentions(null);
    void fetchMyMentions(myUserId).then((list) => {
      if (!cancelled) {
        const allowed = new Set(convIds);
        setMentions(
          hubMatchGroup && activeGroupFilter
            ? list.filter((m) => allowed.has(m.conversationId))
            : list,
        );
      }
    });
    return () => {
      cancelled = true;
    };
  }, [hubTab, myUserId, convIdsKey, hubMatchGroup, activeGroupFilter]);

  useEffect(() => {
    if (hubTab !== "threads") return;
    let cancelled = false;
    setThreads(null);
    setPinnedThreads(null);
    void Promise.all([
      fetchThreadsForConversations(convIds),
      fetchPinnedMessagesForConversations(convIds),
    ]).then(([t, p]) => {
      if (!cancelled) {
        setThreads(t);
        setPinnedThreads(p);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [hubTab, convIdsKey]);

  useEffect(() => {
    if (hubTab !== "media") return;
    let cancelled = false;
    setMedia(null);
    void fetchAttachmentsForConversations(convIds).then((list) => {
      if (!cancelled) setMedia(list);
    });
    return () => {
      cancelled = true;
    };
  }, [hubTab, convIdsKey]);

  // Wszystkie hooki muszą być przed warunkowymi returnami (Rules of Hooks).
  const folderIdsInUse = useMemo(() => {
    const set = new Set<string>();
    for (const f of hubChatFolders) {
      for (const id of f.conversationIds) set.add(id);
    }
    return set;
  }, [hubChatFolders]);

  const mentionCount = useMemo(() => {
    if (!mentions) return 0;
    if (!hubMatchGroup || !activeGroupFilter) return mentions.length;
    const allowed = new Set(convIds);
    return mentions.filter((m) => allowed.has(m.conversationId)).length;
  }, [mentions, hubMatchGroup, activeGroupFilter, convIds]);

  if (!cloudEnabled) {
    return (
      <div className="flex h-full items-center justify-center px-6 text-center text-sm text-ink-faint">
        Hub wymaga synchronizacji z chmurą (logowanie Google).
      </div>
    );
  }

  if (!myUserId) {
    return (
      <div className="flex h-full items-center justify-center px-6 text-center text-sm text-ink-faint">
        Zaloguj się, aby korzystać z hubu.
      </div>
    );
  }

  const titleOf = (entry: ChatOverviewEntry) =>
    overviewTitle(entry, myUserId, (id) => items[id]?.title);

  const dmOnline = (entry: ChatOverviewEntry): boolean => {
    if (entry.kind !== "dm") return false;
    const other = entry.members.find((m) => m.userId !== myUserId);
    return Boolean(other && isOnline(profiles[other.userId]?.lastSeenAt));
  };

  const openRow = (entry: ChatOverviewEntry) => {
    void openConversation(entry.id);
    setRouteHash({ view: "conversation", conversationId: entry.id });
  };

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

  const openThreadRow = (conversationId: string, rootId: string) => {
    void openConversation(conversationId).then(() => {
      void openThread(rootId);
    });
    setRouteHash({
      view: "conversation",
      conversationId,
      threadRootId: rootId,
    });
  };

  const renderConvRow = (
    entry: ChatOverviewEntry,
    opts?: { inFolderId?: string },
  ) => {
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
        key={`${opts?.inFolderId ?? "main"}-${entry.id}`}
        entry={entry}
        title={titleOf(entry)}
        authorName={authorName}
        online={dmOnline(entry)}
        active={entry.id === activeId}
        folders={hubChatFolders.map((f) => ({ id: f.id, name: f.name }))}
        inFolderId={opts?.inFolderId}
        onOpen={() => openRow(entry)}
        onAddToFolder={(folderId) => addConversationToHubFolder(folderId, entry.id)}
        onRemoveFromFolder={
          opts?.inFolderId
            ? () => removeConversationFromHubFolder(opts.inFolderId!, entry.id)
            : undefined
        }
      />
    );
  };

  const groupFilterBar = (
    <div className="relative flex items-center gap-1 border-b border-line px-2 py-1">
      <button
        type="button"
        onClick={() => setHubMatchGroup(!hubMatchGroup)}
        className={`flex min-w-0 flex-1 items-center gap-1 rounded-md px-1.5 py-1 text-[10px] font-medium transition ${
          hubMatchGroup
            ? "bg-accent/15 text-ink"
            : "text-ink-faint hover:bg-surface-raised hover:text-ink"
        }`}
        title={
          activeGroupName
            ? `Filtruj hub do grupy „${activeGroupName}”`
            : "Wybierz grupę w railu po prawej, potem włącz filtr"
        }
        aria-pressed={hubMatchGroup}
      >
        <Filter size={11} className="shrink-0" />
        <span className="truncate">
          {hubMatchGroup
            ? activeGroupName
              ? `Grupa: ${activeGroupName}`
              : "Filtr grupy (wybierz w railu)"
            : "Filtr grupy"}
        </span>
      </button>
      <button
        type="button"
        onClick={() => setShowVisibility((v) => !v)}
        className={`shrink-0 rounded-md p-1.5 transition ${
          showVisibility
            ? "bg-accent/15 text-ink"
            : "text-ink-faint hover:bg-surface-raised hover:text-ink"
        }`}
        title="Widoczność zakładek"
        aria-pressed={showVisibility}
      >
        <Eye size={12} />
      </button>
      <button
        type="button"
        onClick={() => toggleHubExpanded()}
        className={`shrink-0 rounded-md p-1.5 transition ${
          hubExpanded
            ? "bg-accent/15 text-ink"
            : "text-ink-faint hover:bg-surface-raised hover:text-ink"
        }`}
        title={hubExpanded ? "Zmniejsz hub (Alt+E)" : "Rozwiń hub (Alt+E)"}
        aria-pressed={hubExpanded}
      >
        {hubExpanded ? <Minimize2 size={12} /> : <Maximize2 size={12} />}
      </button>
      {showVisibility && (
        <>
          <button
            type="button"
            className="fixed inset-0 z-40 cursor-default"
            aria-label="Zamknij"
            onClick={() => setShowVisibility(false)}
          />
          <div className="absolute right-2 top-full z-50 mt-1 w-48 rounded-lg border border-line bg-surface-overlay p-1.5 shadow-pop">
            <p className="px-1.5 pb-1 text-[10px] font-medium uppercase tracking-wide text-ink-faint">
              Widoczne zakładki
            </p>
            {RAIL.map((t) => {
              const hidden = hubHiddenTabs.includes(t.id);
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => toggleHubTabHidden(t.id)}
                  className="flex w-full items-center gap-2 rounded-md px-1.5 py-1.5 text-left text-[11px] text-ink hover:bg-surface-raised"
                >
                  {hidden ? (
                    <EyeOff size={12} className="text-ink-faint" />
                  ) : (
                    <Eye size={12} className="text-accent" />
                  )}
                  <span className={hidden ? "text-ink-faint line-through" : ""}>
                    {t.label}
                  </span>
                </button>
              );
            })}
          </div>
        </>
      )}
    </div>
  );

  const chatToolbar = (
    <div className="flex items-center gap-1 border-b border-line px-2 py-1.5">
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
          placeholder="Szukaj w czacie…"
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
        onClick={() => {
          const name = window.prompt("Nazwa folderu:");
          if (name?.trim()) addHubChatFolder(name);
        }}
        className="shrink-0 rounded-md border border-line p-1.5 text-ink-faint transition hover:text-ink"
        aria-label="Nowy folder"
        title="Nowy folder rozmów"
      >
        <FolderPlus size={13} />
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

  const chatList =
    results !== null ? (
      searching ? (
        <div className="px-3 py-4 text-center text-[11px] text-ink-faint">Szukam…</div>
      ) : results.length === 0 ? (
        <div className="px-4 py-6 text-center text-xs text-ink-faint">Brak wyników.</div>
      ) : (
        <div className="thin-scrollbar min-h-0 flex-1 overflow-y-auto">
          {results.map((r) => (
            <button
              key={`${r.resultType}-${r.id}`}
              type="button"
              onClick={() => {
                setResults(null);
                setQuery("");
                if (r.resultType === "item" && r.itemId) {
                  useStore.getState().setEditing(r.itemId);
                } else if (r.conversationId) {
                  void openConversation(r.conversationId).then(() => {
                    if (r.resultType === "message") {
                      void jumpToMessage(r.conversationId!, r.id);
                    }
                  });
                  setRouteHash({
                    view: "conversation",
                    conversationId: r.conversationId,
                  });
                }
              }}
              className="flex w-full flex-col gap-0.5 border-b border-line/50 px-3 py-2.5 text-left transition hover:bg-surface-raised"
            >
              <span className="line-clamp-2 text-sm text-ink">
                {r.title || r.snippet || "(bez tytułu)"}
              </span>
              <span className="text-[10px] text-ink-faint">
                {r.resultType === "message"
                  ? "wiadomość"
                  : r.resultType === "item"
                    ? "wpis"
                    : "plik"}
                {r.createdAt ? ` · ${formatMessageTime(r.createdAt)}` : ""}
              </span>
            </button>
          ))}
        </div>
      )
    ) : (
      <div className="thin-scrollbar min-h-0 flex-1 overflow-y-auto">
        {filteredOverview.length === 0 && hubChatFolders.length === 0 && (
          <div className="px-6 py-10 text-center text-xs leading-relaxed text-ink-faint">
            {hubMatchGroup && activeGroupFilter
              ? "Brak dyskusji wpisów w tej grupie."
              : "Nie masz jeszcze rozmów."}
            {!hubMatchGroup && (
              <>
                <br />
                Zacznij od <span className="text-ink-light">+</span>.
              </>
            )}
          </div>
        )}
        {hubChatFolders.map((folder) => {
          const entries = folder.conversationIds
            .map((id) => filteredOverview.find((c) => c.id === id))
            .filter((e): e is ChatOverviewEntry => Boolean(e));
          const key = `folder:${folder.id}`;
          return (
            <CollapsibleSection
              key={folder.id}
              sectionKey={key}
              label={folder.name}
              collapsed={Boolean(hubCollapsedSections[key])}
              onToggle={toggleHubSectionCollapsed}
              actions={
                <button
                  type="button"
                  onClick={() => {
                    if (confirm(`Usunąć folder „${folder.name}”?`)) {
                      removeHubChatFolder(folder.id);
                    }
                  }}
                  className="rounded px-1 text-[10px] text-ink-faint hover:text-red-400"
                  title="Usuń folder"
                >
                  <X size={11} />
                </button>
              }
            >
              {entries.length === 0 ? (
                <div className="px-3 py-2 text-[11px] text-ink-faint">
                  Pusty — dodaj rozmowę przez ⋯
                </div>
              ) : (
                entries.map((e) => renderConvRow(e, { inFolderId: folder.id }))
              )}
            </CollapsibleSection>
          );
        })}
        {pinned.length > 0 && (
          <CollapsibleSection
            sectionKey="pinned"
            label="Przypięte"
            collapsed={Boolean(hubCollapsedSections.pinned)}
            onToggle={toggleHubSectionCollapsed}
          >
            {pinned.map((e) => renderConvRow(e))}
          </CollapsibleSection>
        )}
        {frequent.filter((e) => !folderIdsInUse.has(e.id)).length > 0 && (
          <CollapsibleSection
            sectionKey="frequent"
            label="Najczęstsze"
            collapsed={Boolean(hubCollapsedSections.frequent)}
            onToggle={toggleHubSectionCollapsed}
          >
            {frequent
              .filter((e) => !folderIdsInUse.has(e.id))
              .map((e) => renderConvRow(e))}
          </CollapsibleSection>
        )}
        {more.filter((e) => !folderIdsInUse.has(e.id)).length > 0 && (
          <CollapsibleSection
            sectionKey="more"
            label="Pozostałe"
            collapsed={Boolean(hubCollapsedSections.more)}
            onToggle={toggleHubSectionCollapsed}
          >
            {more.filter((e) => !folderIdsInUse.has(e.id)).map((e) => renderConvRow(e))}
          </CollapsibleSection>
        )}
        {discoverable.length > 0 && (
          <CollapsibleSection
            sectionKey="channels"
            label="Kanały publiczne"
            collapsed={Boolean(hubCollapsedSections.channels)}
            onToggle={toggleHubSectionCollapsed}
          >
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
          </CollapsibleSection>
        )}
      </div>
    );

  const registryList = (kind: "decision" | "note") => {
    const list = kind === "decision" ? decisions : notes;
    const focusId = registryFocus?.kind === kind ? registryFocus.id : null;
    if (list === null) {
      return (
        <div className="px-4 py-6 text-center text-xs text-ink-faint">Wczytywanie…</div>
      );
    }
    if (!list.length) {
      return (
        <div className="px-6 py-10 text-center text-xs leading-relaxed text-ink-faint">
          {kind === "decision" ? "Brak zapisanych decyzji." : "Brak zapisanych notatek."}
          <br />
          Zapisz je z menu wiadomości w rozmowie.
        </div>
      );
    }
    return (
      <div className="thin-scrollbar min-h-0 flex-1 overflow-y-auto">
        {list.map((row) => {
          const conv = overview.find((c) => c.id === row.conversationId);
          const at =
            kind === "decision"
              ? (row as ChatDecision).decidedAt
              : (row as ChatNote).notedAt;
          const author =
            profiles[row.createdBy]?.displayName ||
            conv?.members.find((m) => m.userId === row.createdBy)?.displayName ||
            "Nieznany";
          const active = focusId === row.id;
          return (
            <button
              key={row.id}
              type="button"
              onClick={() =>
                openRegistryInPanel({
                  kind,
                  id: row.id,
                  conversationId: row.conversationId,
                  messageId: row.messageId,
                  body: row.body,
                  createdBy: row.createdBy,
                  at,
                })
              }
              className={`flex w-full flex-col gap-0.5 border-b border-line/50 px-3 py-2.5 text-left transition ${
                active ? "bg-accent/10" : "hover:bg-surface-raised"
              }`}
            >
              <span className="line-clamp-2 text-sm text-ink">{row.body}</span>
              <span className="truncate text-[10px] text-ink-faint">
                {author}
                {conv ? ` · ${titleOf(conv)}` : ""} · {formatMessageTime(at)}
              </span>
            </button>
          );
        })}
      </div>
    );
  };

  const threadsList = () => {
    if (threads === null || pinnedThreads === null) {
      return (
        <div className="px-4 py-6 text-center text-xs text-ink-faint">Wczytywanie…</div>
      );
    }
    if (!threads.length && !pinnedThreads.length) {
      return (
        <div className="px-6 py-10 text-center text-xs leading-relaxed text-ink-faint">
          Brak wątków.
        </div>
      );
    }
    const pinnedIds = new Set(pinnedThreads.map((m) => m.id));
    return (
      <div className="thin-scrollbar min-h-0 flex-1 overflow-y-auto">
        {pinnedThreads.length > 0 && (
          <>
            <div className="px-3 pb-1 pt-3 text-[11px] font-medium uppercase tracking-wide text-ink-faint">
              Przypięte
            </div>
            {pinnedThreads.map((root) => {
              const conv = overview.find((c) => c.id === root.conversationId);
              return (
                <button
                  key={`pin-${root.id}`}
                  type="button"
                  onClick={() => openThreadRow(root.conversationId, root.id)}
                  className="flex w-full flex-col gap-0.5 border-b border-line/50 px-3 py-2.5 text-left transition hover:bg-surface-raised"
                >
                  <span className="flex items-center gap-1 text-sm text-ink">
                    <Pin size={11} className="shrink-0 text-accent" />
                    <span className="line-clamp-2">
                      {threadDisplayTitle(root)}
                    </span>
                  </span>
                  <span className="truncate text-[10px] text-ink-faint">
                    {conv ? titleOf(conv) : "Rozmowa"} · {formatMessageTime(root.createdAt)}
                  </span>
                </button>
              );
            })}
          </>
        )}
        {threads.filter((t) => !pinnedIds.has(t.root.id)).length > 0 && (
          <>
            <div className="px-3 pb-1 pt-3 text-[11px] font-medium uppercase tracking-wide text-ink-faint">
              Ostatnie
            </div>
            {threads
              .filter((t) => !pinnedIds.has(t.root.id))
              .map(({ root, replyCount, conversationId }) => {
                const conv = overview.find((c) => c.id === conversationId);
                return (
                  <button
                    key={root.id}
                    type="button"
                    onClick={() => openThreadRow(conversationId, root.id)}
                    className="flex w-full flex-col gap-0.5 border-b border-line/50 px-3 py-2.5 text-left transition hover:bg-surface-raised"
                  >
                    <span className="line-clamp-2 text-sm text-ink">
                      {threadDisplayTitle(root)}
                    </span>
                    <span className="truncate text-[10px] text-ink-faint">
                      {conv ? titleOf(conv) : "Rozmowa"} · {replyCount} odp. ·{" "}
                      {formatMessageTime(root.createdAt)}
                    </span>
                  </button>
                );
              })}
          </>
        )}
      </div>
    );
  };

  const mediaList = () => {
    if (media === null) {
      return (
        <div className="px-4 py-6 text-center text-xs text-ink-faint">Wczytywanie…</div>
      );
    }
    if (!media.length) {
      return (
        <div className="px-6 py-10 text-center text-xs leading-relaxed text-ink-faint">
          Brak załączników.
        </div>
      );
    }
    return (
      <div className="thin-scrollbar min-h-0 flex-1 overflow-y-auto">
        {media.map((att) => {
          const conv = overview.find((c) => c.id === att.conversationId);
          return (
            <button
              key={att.id}
              type="button"
              onClick={() => openMediaInPanel(att.conversationId)}
              className="flex w-full items-center gap-2.5 border-b border-line/50 px-3 py-2 text-left transition hover:bg-surface-raised"
            >
              <MediaThumb att={att} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm text-ink">{att.fileName}</span>
                <span className="truncate text-[10px] text-ink-faint">
                  {conv ? titleOf(conv) : "Rozmowa"} · {formatFileSize(att.sizeBytes)} ·{" "}
                  {formatMessageTime(att.createdAt)}
                </span>
              </span>
            </button>
          );
        })}
      </div>
    );
  };

  const mentionsList = () => {
    if (mentions === null) {
      return (
        <div className="px-4 py-6 text-center text-xs text-ink-faint">Wczytywanie…</div>
      );
    }
    if (!mentions.length) {
      return (
        <div className="px-6 py-10 text-center text-xs leading-relaxed text-ink-faint">
          Brak wzmianek.
        </div>
      );
    }
    return (
      <div className="thin-scrollbar min-h-0 flex-1 overflow-y-auto">
        {mentions.map((msg) => {
          const conv = overview.find((c) => c.id === msg.conversationId);
          return (
            <button
              key={msg.id}
              type="button"
              onClick={() => {
                void openConversation(msg.conversationId).then(() => {
                  void jumpToMessage(msg.conversationId, msg.threadRootId ?? msg.id);
                });
                setRouteHash({
                  view: "conversation",
                  conversationId: msg.conversationId,
                });
              }}
              className="flex w-full flex-col gap-0.5 border-b border-line/50 px-3 py-2.5 text-left transition hover:bg-surface-raised"
            >
              <span className="truncate text-[11px] text-ink-faint">
                {profiles[msg.authorUserId]?.displayName || "Nieznany"}
                {conv ? ` · ${titleOf(conv)}` : ""}
              </span>
              <span className="line-clamp-2 text-sm text-ink">
                {msg.body || "(załącznik)"}
              </span>
              <span className="text-[10px] text-ink-faint">
                {formatMessageTime(msg.createdAt)}
              </span>
            </button>
          );
        })}
      </div>
    );
  };

  const railBadge = (id: HubTab): number | null => {
    if (id === "chat" && unread > 0) return unread;
    if (id === "mentions" && mentionCount > 0) return mentionCount;
    return null;
  };

  return (
    <div className="flex h-full min-h-0">
      <nav className="thin-scrollbar flex w-14 shrink-0 flex-col gap-0.5 overflow-y-auto border-r border-line bg-surface-raised/40 p-1">
        {RAIL.filter((t) => !hubHiddenTabs.includes(t.id)).map(({ id, label, icon: Icon }) => {
          const badge = railBadge(id);
          return (
            <button
              key={id}
              type="button"
              onClick={() => setHubTab(id)}
              title={`${label} (Alt+${RAIL.findIndex((t) => t.id === id) + 1})`}
              aria-label={label}
              aria-pressed={hubTab === id}
              className={`relative flex flex-col items-center gap-0.5 rounded-lg px-1 py-1.5 text-[9px] font-medium transition ${
                hubTab === id
                  ? "bg-accent/15 text-ink"
                  : "text-ink-faint hover:bg-surface-raised hover:text-ink"
              }`}
            >
              <Icon size={15} />
              <span className="truncate">{label}</span>
              {badge != null && (
                <span className="absolute right-0.5 top-0.5 flex h-3.5 min-w-[0.875rem] items-center justify-center rounded-full bg-accent px-0.5 text-[8px] font-semibold text-white">
                  {badge > 99 ? "99+" : badge}
                </span>
              )}
            </button>
          );
        })}
      </nav>

      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        {groupFilterBar}
        {hubTab === "today" && (
          <>
            <div className="border-b border-line px-3 py-2 text-xs font-semibold text-ink">
              Dziś
              <span className="ml-2 font-normal text-ink-faint">Alt+1…9 · Alt+E</span>
            </div>
            <HubTodayInbox />
          </>
        )}
        {hubTab === "chat" && (
          <>
            {chatToolbar}
            {chatList}
          </>
        )}
        {hubTab === "threads" && (
          <>
            <div className="border-b border-line px-3 py-2 text-xs font-semibold text-ink">
              Wątki
            </div>
            {threadsList()}
          </>
        )}
        {hubTab === "decisions" && (
          <>
            <div className="border-b border-line px-3 py-2 text-xs font-semibold text-ink">
              Decyzje
            </div>
            {registryList("decision")}
          </>
        )}
        {hubTab === "notes" && (
          <>
            <div className="border-b border-line px-3 py-2 text-xs font-semibold text-ink">
              Notatki
            </div>
            {registryList("note")}
          </>
        )}
        {hubTab === "media" && (
          <>
            <div className="border-b border-line px-3 py-2 text-xs font-semibold text-ink">
              Media
            </div>
            {mediaList()}
          </>
        )}
        {hubTab === "mentions" && (
          <>
            <div className="border-b border-line px-3 py-2 text-xs font-semibold text-ink">
              Wzmianki
            </div>
            {mentionsList()}
          </>
        )}
        {hubTab === "search" && <HubSearchPane />}
        {hubTab === "links" && (
          <>
            <div className="border-b border-line px-3 py-2 text-xs font-semibold text-ink">
              Powiązania
            </div>
            <HubLinksPane />
          </>
        )}
      </div>

      <NewConversationDialog open={showNew} onClose={() => setShowNew(false)} />
    </div>
  );
}
