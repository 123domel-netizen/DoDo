import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  BellOff,
  ChevronDown,
  ChevronRight,
  Eye,
  EyeOff,
  Filter,
  FolderOpen,
  FolderPlus,
  Image as ImageIcon,
  Link2,
  Maximize2,
  Minimize2,
  MessageSquare,
  MoreHorizontal,
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
import {
  filterOverviewForHubGroup,
  isMuted,
  overviewTitle,
  sortFavoritesAndNew,
  sortOverview,
  totalUnread,
} from "@/lib/chat/feed";
import {
  jumpToMessage,
  openConversation,
  openMediaInPanel,
  openRegistryInPanel,
} from "@/lib/chat/init";
import {
  fetchAttachmentsForConversations,
  fetchDecisionsForConversations,
  fetchMessageCountsSince,
  fetchNotesForConversations,
  fetchPublicChannels,
  joinChannel,
  searchAll,
  type ConversationAttachment,
} from "@/lib/chat/api";
import { isOnline } from "@/lib/chat/presence";
import { setRouteHash } from "@/lib/navigation";
import type {
  ChatDecision,
  ChatNote,
  ChatOverviewEntry,
  ChatSearchResult,
  PublicChannelInfo,
} from "@/lib/chat/types";
import { messagePreviewLabel } from "@/lib/chat/types";
import { NewConversationDialog } from "@/components/chat/NewConversationDialog";
import { ChannelIcon } from "@/components/chat/ChannelIcon";
import { HubThreadsStrip } from "@/components/hub/HubThreadsStrip";
import { formatMessageTime, useSignedUrl } from "@/components/chat/MessageBubble";
import { formatFileSize } from "@/lib/chat/upload";
import { HubSearchPane } from "@/components/hub/HubSearchPane";
import { HubLinksPane } from "@/components/hub/HubLinksPane";
import {
  RAIL,
  RAIL_CHAT,
  RAIL_TREE,
  type ChatBrowseTab,
  type MediaSubTab,
} from "@/components/hub/hubRail";

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
        active
          ? "bg-accent/10"
          : showUnread
            ? "bg-accent/[0.07]"
            : "hover:bg-surface-raised"
      } ${showUnread ? "before:absolute before:inset-y-1 before:left-0 before:w-[3px] before:rounded-full before:bg-accent" : ""}`}
    >
      <button
        type="button"
        onClick={onOpen}
        className="flex min-w-0 flex-1 items-center gap-2 px-3 py-1.5 text-left"
      >
        <span
          className={`relative flex h-7 w-7 shrink-0 items-center justify-center overflow-hidden rounded-full border bg-surface-raised text-ink-faint ${
            showUnread ? "border-accent/50 ring-2 ring-accent/25" : "border-line"
          }`}
        >
          {entry.kind === "channel" ? (
            <ChannelIcon iconUrl={entry.iconUrl} size={entry.iconUrl ? 28 : 14} />
          ) : entry.kind === "item" ? (
            <MessageSquare size={14} />
          ) : entry.members.length > 2 ? (
            <Users size={14} />
          ) : (
            <User size={14} />
          )}
          {online && (
            <span className="absolute -bottom-0.5 -right-0.5 h-2 w-2 rounded-full border-2 border-surface bg-green-500" />
          )}
          {showUnread && !online && (
            <span className="absolute -bottom-0.5 -right-0.5 h-2 w-2 rounded-full border-2 border-surface bg-accent" />
          )}
        </span>
        <span className="min-w-0 flex-1 leading-tight">
          <span className="flex items-baseline justify-between gap-2">
            <span
              className={`flex min-w-0 items-center gap-1 truncate text-[13px] ${
                showUnread ? "font-semibold text-ink" : "font-medium text-ink"
              }`}
            >
              {entry.myPinnedAt && <Pin size={11} className="shrink-0 text-accent" />}
              <span className="truncate">{title}</span>
              {muted && <BellOff size={11} className="shrink-0 text-ink-faint" />}
            </span>
            {entry.lastMessageAt && (
              <span
                className={`shrink-0 text-[10px] ${
                  showUnread ? "font-semibold text-accent" : "text-ink-faint"
                }`}
              >
                {formatMessageTime(entry.lastMessageAt)}
              </span>
            )}
          </span>
          <span className="mt-px flex items-center justify-between gap-2">
            <span
              className={`min-w-0 flex-1 truncate text-[11px] ${
                showUnread ? "font-medium text-ink" : "text-ink-faint"
              }`}
            >
              {preview}
            </span>
            {entry.unreadCount > 0 ? (
              <span className="flex h-4 min-w-4 shrink-0 items-center justify-center rounded-full bg-accent px-1 text-[9px] font-bold text-white shadow-sm">
                {entry.unreadCount > 99 ? "99+" : entry.unreadCount}
              </span>
            ) : entry.myMarkedUnread ? (
              <span className="h-2 w-2 shrink-0 rounded-full bg-accent shadow-sm" />
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
  const visual =
    att.mimeType.startsWith("image/") || att.mimeType.startsWith("video/");
  if (!visual) {
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
 * Desktop hub pod kalendarzem: Czat / Decyzje / Notatki / Media / Wyszukaj.
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
  const tags = useStore((s) => s.tags);

  const [showNew, setShowNew] = useState(false);
  const [showVisibility, setShowVisibility] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<ChatSearchResult[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [globalQuery, setGlobalQuery] = useState("");
  const [globalResults, setGlobalResults] = useState<ChatSearchResult[] | null>(null);
  const [globalSearching, setGlobalSearching] = useState(false);
  const [publicChannels, setPublicChannels] = useState<PublicChannelInfo[]>([]);
  const [decisions, setDecisions] = useState<ChatDecision[] | null>(null);
  const [notes, setNotes] = useState<ChatNote[] | null>(null);
  const [media, setMedia] = useState<(ConversationAttachment & { conversationId: string })[] | null>(
    null,
  );
  const [mediaSubTab, setMediaSubTab] = useState<MediaSubTab>("media");
  const [chatBrowse, setChatBrowse] = useState<ChatBrowseTab>("all");
  const [monthCounts, setMonthCounts] = useState<Record<string, number> | null>(null);
  /** Filtr tagu na listach Decyzje / Notatki (null = wszystkie). */
  const [hubTagFilter, setHubTagFilter] = useState<string | null>(null);

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
  const allByRecent = useMemo(
    () =>
      [...filteredOverview].sort((a, b) =>
        (b.lastMessageAt ?? b.createdAt).localeCompare(a.lastMessageAt ?? a.createdAt),
      ),
    [filteredOverview],
  );
  const favorites = useMemo(
    () => sortFavoritesAndNew(filteredOverview, new Date(), monthCounts ?? undefined),
    [filteredOverview, monthCounts],
  );
  const people = sorted.filter((c) => c.kind === "dm");
  const channels = sorted.filter((c) => c.kind === "channel");
  const convIds = useMemo(() => filteredOverview.map((c) => c.id), [filteredOverview]);
  const convIdsKey = convIds.join(",");
  /** Decyzje/notatki: wszystkie rozmowy — filtr grupy działa po etykiecie wpisu. */
  const registryConvIds = useMemo(() => overview.map((c) => c.id), [overview]);
  const registryConvIdsKey = registryConvIds.join(",");
  const unread = totalUnread(filteredOverview);
  const activeGroupName = activeGroupFilter
    ? groups.find((g) => g.id === activeGroupFilter)?.name
    : null;
  const allUserTags = useMemo(
    () => Object.values(tags).sort((a, b) => a.name.localeCompare(b.name, "pl")),
    [tags],
  );

  // Gdy aktywna zakładka jest ukryta / usunięta — przełącz na pierwszą widoczną.
  useEffect(() => {
    const onRail = RAIL.some((t) => t.id === hubTab);
    if (onRail && !hubHiddenTabs.includes(hubTab)) return;
    const next = RAIL.find((t) => !hubHiddenTabs.includes(t.id));
    if (next) setHubTab(next.id);
  }, [hubTab, hubHiddenTabs, setHubTab]);

  useEffect(() => {
    if (cloudEnabled) void fetchPublicChannels().then(setPublicChannels);
  }, []);

  // Ranking „Ulubione”: wolumen wiadomości z ostatniego miesiąca.
  useEffect(() => {
    if (!cloudEnabled || !myUserId || hubTab !== "chat") return;
    let cancelled = false;
    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    void fetchMessageCountsSince(since).then((counts) => {
      if (!cancelled) setMonthCounts(counts);
    });
    return () => {
      cancelled = true;
    };
  }, [myUserId, hubTab, registryEpoch]);

  useEffect(() => {
    if (hubTab !== "decisions") return;
    let cancelled = false;
    setDecisions(null);
    void fetchDecisionsForConversations(registryConvIds).then((list) => {
      if (!cancelled) setDecisions(list);
    });
    return () => {
      cancelled = true;
    };
  }, [hubTab, registryConvIdsKey, registryEpoch]);

  useEffect(() => {
    if (hubTab !== "notes") return;
    let cancelled = false;
    setNotes(null);
    void fetchNotesForConversations(registryConvIds).then((list) => {
      if (!cancelled) setNotes(list);
    });
    return () => {
      cancelled = true;
    };
  }, [hubTab, registryConvIdsKey, registryEpoch]);

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

  const runGlobalSearch = async () => {
    const q = globalQuery.trim();
    if (!q) {
      setGlobalResults(null);
      return;
    }
    setGlobalSearching(true);
    try {
      setGlobalResults(await searchAll(q));
    } finally {
      setGlobalSearching(false);
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

  const visibilityMenu = showVisibility ? (
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
  ) : null;

  /** Jedna belka dla wszystkich zakładek hubu. */
  const hubChrome = (
    <div className="relative flex items-center gap-1 border-b border-line px-2 py-1">
      <button
        type="button"
        onClick={() => setHubMatchGroup(!hubMatchGroup)}
        className={`flex max-w-[7.5rem] shrink-0 items-center gap-1 rounded-md px-1.5 py-1 text-[10px] font-medium transition ${
          hubMatchGroup
            ? "bg-accent/15 text-ink"
            : "text-ink-faint hover:bg-surface-raised hover:text-ink"
        }`}
        title={
          hubTab === "decisions" || hubTab === "notes"
            ? activeGroupName
              ? `Pokaż tylko decyzje/notatki z grupą „${activeGroupName}”`
              : "Wybierz grupę w railu, potem włącz filtr"
            : activeGroupName
              ? `Filtruj hub do grupy „${activeGroupName}”`
              : "Wybierz grupę w railu po prawej, potem włącz filtr"
        }
        aria-pressed={hubMatchGroup}
      >
        <Filter size={11} className="shrink-0" />
        <span className="truncate">
          {hubMatchGroup
            ? activeGroupName
              ? activeGroupName
              : "Wybierz grupę"
            : "Grupa"}
        </span>
      </button>

      {hubTab === "chat" && (
        <>
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
              placeholder={
                chatBrowse === "people"
                  ? "Szukaj wśród osób…"
                  : chatBrowse === "channels"
                    ? "Szukaj w kanałach…"
                    : chatBrowse === "all"
                      ? "Szukaj we wszystkich…"
                      : "Szukaj w czacie…"
              }
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
        </>
      )}

      {(hubTab === "decisions" || hubTab === "notes") && (
        <>
          <span className="min-w-0 flex-1 truncate px-1 text-xs font-semibold text-ink">
            {hubTab === "decisions" ? "Decyzje" : "Notatki"}
          </span>
          {allUserTags.length > 0 && (
            <div className="flex max-w-[45%] shrink-0 items-center gap-0.5 overflow-x-auto">
              <button
                type="button"
                onClick={() => setHubTagFilter(null)}
                className={`shrink-0 rounded-md px-1.5 py-0.5 text-[10px] font-medium transition ${
                  hubTagFilter === null
                    ? "bg-accent/15 text-ink"
                    : "text-ink-faint hover:bg-surface-raised hover:text-ink"
                }`}
              >
                Tagi
              </button>
              {allUserTags.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  title={t.name}
                  onClick={() =>
                    setHubTagFilter((cur) => (cur === t.id ? null : t.id))
                  }
                  className={`inline-flex max-w-[5.5rem] shrink-0 items-center gap-1 truncate rounded-md px-1.5 py-0.5 text-[10px] font-medium transition ${
                    hubTagFilter === t.id
                      ? "bg-accent/15 text-ink"
                      : "text-ink-faint hover:bg-surface-raised hover:text-ink"
                  }`}
                >
                  <span
                    className="h-1.5 w-1.5 shrink-0 rounded-full"
                    style={{ background: t.color }}
                  />
                  <span className="truncate">{t.name}</span>
                </button>
              ))}
            </div>
          )}
        </>
      )}

      {hubTab === "media" && (
        <div
          className="flex min-w-0 flex-1 items-center gap-0.5"
          role="tablist"
          aria-label="Media"
        >
          {(
            [
              { id: "media" as const, label: "Media", icon: ImageIcon },
              { id: "files" as const, label: "Pliki", icon: FolderOpen },
              { id: "links" as const, label: "Linki", icon: Link2 },
            ] as const
          ).map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={mediaSubTab === id}
              onClick={() => setMediaSubTab(id)}
              className={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium transition ${
                mediaSubTab === id
                  ? "bg-accent/15 text-ink"
                  : "text-ink-faint hover:bg-surface-raised hover:text-ink"
              }`}
            >
              <Icon size={12} />
              {label}
            </button>
          ))}
        </div>
      )}

      {hubTab === "search" && (
        <div className="relative min-w-0 flex-1">
          <Search
            size={12}
            className="pointer-events-none absolute left-1.5 top-1/2 -translate-y-1/2 text-ink-faint"
          />
          <input
            value={globalQuery}
            autoFocus
            onChange={(e) => {
              setGlobalQuery(e.target.value);
              if (!e.target.value.trim()) setGlobalResults(null);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") void runGlobalSearch();
            }}
            placeholder="Szukaj wszędzie…"
            className="w-full rounded-md border border-line bg-surface-raised py-1 pl-6 pr-6 text-[12px] text-ink outline-none placeholder:text-ink-faint focus:border-accent/50"
          />
          {globalQuery && (
            <button
              type="button"
              onClick={() => {
                setGlobalQuery("");
                setGlobalResults(null);
              }}
              className="absolute right-1 top-1/2 -translate-y-1/2 text-ink-faint hover:text-ink"
              aria-label="Wyczyść"
            >
              <X size={11} />
            </button>
          )}
        </div>
      )}

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
      {visibilityMenu}
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
      <div className="thin-scrollbar flex min-h-0 flex-1 flex-col overflow-hidden">
        {hubChatFolders.length > 0 && (
          <div className="shrink-0 border-b border-line/60">
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
          </div>
        )}

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

          {chatBrowse === "all" && (
            <>
              {allByRecent.filter((e) => !folderIdsInUse.has(e.id)).length === 0 ? (
                <div className="px-6 py-10 text-center text-xs leading-relaxed text-ink-faint">
                  {filteredOverview.length === 0
                    ? hubMatchGroup && activeGroupFilter
                      ? "Brak dyskusji wpisów w tej grupie."
                      : "Nie masz jeszcze rozmów."
                    : "Brak rozmów poza folderami."}
                </div>
              ) : (
                allByRecent
                  .filter((e) => !folderIdsInUse.has(e.id))
                  .map((e) => renderConvRow(e))
              )}
            </>
          )}

          {chatBrowse === "favorites" && (
            <>
              {favorites.filter((e) => !folderIdsInUse.has(e.id)).length === 0 ? (
                <div className="px-6 py-10 text-center text-xs leading-relaxed text-ink-faint">
                  {filteredOverview.length === 0
                    ? hubMatchGroup && activeGroupFilter
                      ? "Brak dyskusji wpisów w tej grupie."
                      : "Nie masz jeszcze rozmów."
                    : "Brak rozmów poza folderami."}
                </div>
              ) : (
                favorites
                  .filter((e) => !folderIdsInUse.has(e.id))
                  .map((e) => renderConvRow(e))
              )}
            </>
          )}

          {chatBrowse === "people" && (
            <>
              {people.length === 0 ? (
                <div className="px-6 py-10 text-center text-xs leading-relaxed text-ink-faint">
                  Brak rozmów prywatnych.
                  <br />
                  Dodaj osobę przez <span className="text-ink-light">+</span>.
                </div>
              ) : (
                people.map((e) => renderConvRow(e))
              )}
            </>
          )}

          {chatBrowse === "channels" && (
            <>
              {channels.length === 0 && discoverable.length === 0 ? (
                <div className="px-6 py-10 text-center text-xs leading-relaxed text-ink-faint">
                  Brak kanałów.
                  <br />
                  Tu pojawią się grupy firmowe i kanały publiczne.
                </div>
              ) : (
                <>
                  {channels.map((e) => renderConvRow(e))}
                  {discoverable.length > 0 && (
                    <>
                      <div className="px-3 pb-1 pt-3 text-[10px] font-medium uppercase tracking-wide text-ink-faint">
                        Do odkrycia
                      </div>
                      {discoverable.map((c) => (
                        <div
                          key={c.id}
                          className="flex items-center gap-2.5 border-b border-line/50 px-3 py-2"
                        >
                          <span className="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-full border border-dashed border-line text-ink-faint">
                            <ChannelIcon iconUrl={c.iconUrl} size={c.iconUrl ? 32 : 15} />
                          </span>
                          <span className="min-w-0 flex-1 truncate text-sm text-ink">
                            {c.name}
                          </span>
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
              )}
            </>
          )}
        </div>
        <HubThreadsStrip conversationId={activeId} />
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
    const filtered = list.filter((row) => {
      if (hubMatchGroup && activeGroupFilter && row.groupId !== activeGroupFilter) {
        return false;
      }
      if (hubTagFilter && !row.tagIds.includes(hubTagFilter)) return false;
      return true;
    });
    if (!list.length) {
      return (
        <div className="px-6 py-10 text-center text-xs leading-relaxed text-ink-faint">
          {kind === "decision" ? "Brak zapisanych decyzji." : "Brak zapisanych notatek."}
          <br />
          Zapisz je z menu wiadomości w rozmowie.
        </div>
      );
    }
    if (!filtered.length) {
      return (
        <div className="px-6 py-10 text-center text-xs leading-relaxed text-ink-faint">
          Brak wpisów dla wybranego filtra grupy/tagu.
          <br />
          Wyłącz „Grupa” lub filtr tagu, albo przypisz etykiety w szczegółach.
        </div>
      );
    }
    return (
      <div className="thin-scrollbar min-h-0 flex-1 overflow-y-auto">
        {filtered.map((row) => {
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
          const group = row.groupId
            ? groups.find((g) => g.id === row.groupId)
            : null;
          const rowTags = row.tagIds
            .map((id) => tags[id])
            .filter((t): t is NonNullable<typeof t> => Boolean(t));
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
                  title: kind === "note" ? (row as ChatNote).title : undefined,
                  body: row.body,
                  note: kind === "decision" ? (row as ChatDecision).note : undefined,
                  createdBy: row.createdBy,
                  at,
                  groupId: row.groupId,
                  tagIds: row.tagIds,
                })
              }
              className={`flex w-full flex-col gap-0.5 border-b border-line/50 px-3 py-2.5 text-left transition ${
                active ? "bg-accent/10" : "hover:bg-surface-raised"
              }`}
            >
              <span className="line-clamp-2 text-sm text-ink">
                {kind === "note"
                  ? (row as ChatNote).title || row.body
                  : row.body}
              </span>
              {kind === "note" && (row as ChatNote).body.trim() && (
                <span className="line-clamp-1 text-[11px] text-ink-faint">
                  {(row as ChatNote).body}
                </span>
              )}
              {(group || rowTags.length > 0) && (
                <span className="flex flex-wrap items-center gap-1">
                  {group && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-surface-raised px-1.5 py-0.5 text-[9px] font-medium text-ink-light">
                      <span
                        className="h-1.5 w-1.5 rounded-full"
                        style={{ background: group.color }}
                      />
                      {group.name}
                    </span>
                  )}
                  {rowTags.map((t) => (
                    <span
                      key={t.id}
                      className="inline-flex max-w-[6rem] items-center gap-1 truncate rounded-full px-1.5 py-0.5 text-[9px] font-medium text-ink"
                      style={{
                        background: `${t.color}22`,
                        border: `1px solid ${t.color}55`,
                      }}
                    >
                      <span className="truncate">{t.name}</span>
                    </span>
                  ))}
                </span>
              )}
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

  const isVisualMedia = (mime: string) =>
    mime.startsWith("image/") || mime.startsWith("video/");

  const mediaAttachmentList = (kind: "media" | "files") => {
    if (media === null) {
      return (
        <div className="px-4 py-6 text-center text-xs text-ink-faint">Wczytywanie…</div>
      );
    }
    const list =
      kind === "media"
        ? media.filter((a) => isVisualMedia(a.mimeType))
        : media.filter((a) => !isVisualMedia(a.mimeType));
    if (!list.length) {
      return (
        <div className="px-6 py-10 text-center text-xs leading-relaxed text-ink-faint">
          {kind === "media" ? "Brak zdjęć i filmów." : "Brak innych plików."}
        </div>
      );
    }
    return (
      <div className="thin-scrollbar min-h-0 flex-1 overflow-y-auto">
        {list.map((att) => {
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

  return (
    <div className="flex h-full min-h-0">
      <nav className="thin-scrollbar flex w-36 shrink-0 flex-col overflow-y-auto border-r border-line bg-surface-raised/40 p-1.5">
        {!hubHiddenTabs.includes("chat") && (
          <button
            type="button"
            onClick={() => {
              setHubTab("chat");
              setChatBrowse("all");
            }}
            title={`${RAIL_CHAT.label} — wszystkie rozmowy (Alt+1)`}
            aria-label={RAIL_CHAT.label}
            className={`relative flex items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[12px] font-semibold transition ${
              hubTab === "chat"
                ? "text-ink"
                : "text-ink-light hover:bg-surface-raised hover:text-ink"
            }`}
          >
            <RAIL_CHAT.icon size={15} className="shrink-0" />
            <span className="min-w-0 flex-1 truncate">{RAIL_CHAT.label}</span>
            {unread > 0 && (
              <span className="flex h-4 min-w-[1rem] shrink-0 items-center justify-center rounded-full bg-accent px-1 text-[9px] font-semibold text-white">
                {unread > 99 ? "99+" : unread}
              </span>
            )}
          </button>
        )}

        <div
          className="ml-2.5 mt-0.5 flex flex-col gap-0.5 border-l border-line/70 pl-1.5"
          role="group"
          aria-label="Sekcje hubu"
        >
          {RAIL_TREE.filter((item) =>
            item.kind === "browse"
              ? !hubHiddenTabs.includes("chat")
              : !hubHiddenTabs.includes(item.id),
          ).map((item) => {
            const Icon = item.icon;
            if (item.kind === "browse") {
              const active = hubTab === "chat" && chatBrowse === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => {
                    setHubTab("chat");
                    setChatBrowse(item.id);
                  }}
                  title={item.title}
                  aria-label={item.label}
                  aria-pressed={active}
                  className={`relative flex items-center gap-1.5 rounded-md px-1.5 py-1 text-left text-[11px] font-medium transition ${
                    active
                      ? "bg-accent/15 text-ink"
                      : "text-ink-faint hover:bg-surface-raised hover:text-ink"
                  }`}
                >
                  <Icon size={13} className="shrink-0 opacity-80" />
                  <span className="min-w-0 flex-1 truncate">{item.label}</span>
                </button>
              );
            }
            const idx = RAIL.findIndex((t) => t.id === item.id);
            const active = hubTab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setHubTab(item.id)}
                title={`${item.label} (Alt+${idx + 1})`}
                aria-label={item.label}
                aria-pressed={active}
                className={`relative flex items-center gap-1.5 rounded-md px-1.5 py-1 text-left text-[11px] font-medium transition ${
                  active
                    ? "bg-accent/15 text-ink"
                    : "text-ink-faint hover:bg-surface-raised hover:text-ink"
                }`}
              >
                <Icon size={13} className="shrink-0 opacity-80" />
                <span className="min-w-0 flex-1 truncate">{item.label}</span>
              </button>
            );
          })}
        </div>
      </nav>

      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        {hubChrome}
        {hubTab === "chat" && chatList}
        {hubTab === "decisions" && registryList("decision")}
        {hubTab === "notes" && registryList("note")}
        {hubTab === "media" &&
          (mediaSubTab === "links" ? (
            <HubLinksPane />
          ) : (
            mediaAttachmentList(mediaSubTab)
          ))}
        {hubTab === "search" && (
          <HubSearchPane results={globalResults} searching={globalSearching} />
        )}
      </div>

      <NewConversationDialog open={showNew} onClose={() => setShowNew(false)} />
    </div>
  );
}
