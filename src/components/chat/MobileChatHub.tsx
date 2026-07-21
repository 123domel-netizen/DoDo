import { Fragment, useEffect, useState } from "react";
import {
  AtSign,
  BellOff,
  FolderOpen,
  Image as ImageIcon,
  Link2,
  MessageSquare,
  Pin,
  Plus,
  Search,
  User,
  Users,
  X,
} from "lucide-react";
import { useStore } from "@/state/store";
import { useChatStore } from "@/lib/chat/store";
import { isMuted, overviewTitle } from "@/lib/chat/feed";
import { jumpToMessage, openConversation } from "@/lib/chat/init";
import { fetchMyMentions, joinChannel, searchAll } from "@/lib/chat/api";
import { usePresenceNow, dmPeerPresence } from "@/lib/chat/presence";
import { ConversationKindMark } from "@/components/chat/PresenceDot";
import { ReadReceiptTicks } from "@/components/chat/ReadReceiptTicks";
import { setRouteHash } from "@/lib/navigation";
import { formatFileSize } from "@/lib/chat/upload";
import type {
  ChatDecision,
  ChatMessage,
  ChatNote,
  ChatOverviewEntry,
  ChatSearchResult,
} from "@/lib/chat/types";
import { messagePreviewLabel } from "@/lib/chat/types";
import { ChannelIcon } from "@/components/chat/ChannelIcon";
import { PersonAvatar } from "@/components/chat/PersonAvatar";
import { conversationRowAvatarLayout } from "@/lib/chat/conversationRowVisual";
import { dmPeerMember } from "@/lib/avatar";
import { NewConversationDialog } from "@/components/chat/NewConversationDialog";
import { formatMessageTime, useSignedUrl } from "@/components/chat/MessageBubble";
import { ConversationMediaView } from "@/components/chat/ConversationMediaView";
import { RegistryDetailSheet } from "@/components/hub/RegistryDetailPanel";
import { HubSearchPane } from "@/components/hub/HubSearchPane";
import { HubLinksPane } from "@/components/hub/HubLinksPane";
import {
  RAIL_TREE,
  isMobileHubModeActive,
  type MobileHubMode,
} from "@/components/hub/hubRail";
import { useHubRegistryLists } from "@/hooks/useHubRegistryLists";

type RegistryFocus = NonNullable<ReturnType<typeof useChatStore.getState>["registryFocus"]>;

function MediaThumb({
  att,
}: {
  att: { mimeType: string; thumbPath: string | null; bucketPath: string };
}) {
  const url = useSignedUrl(att.thumbPath ?? att.bucketPath);
  const visual = att.mimeType.startsWith("image/") || att.mimeType.startsWith("video/");
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

function ConversationRow({
  entry,
  title,
  authorName,
  myUserId,
  onOpen,
}: {
  entry: ChatOverviewEntry;
  title: string;
  authorName: string | null;
  myUserId: string | null;
  onOpen: () => void;
}) {
  const presenceNow = usePresenceNow();
  const profiles = useChatStore((s) => s.profiles);
  const presence = dmPeerPresence(entry, myUserId, profiles, presenceNow);
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
  const avatarLayout = conversationRowAvatarLayout(showUnread);
  const peer = dmPeerMember(entry.members, myUserId, entry.kind);
  const peerAvatar = peer
    ? (profiles[peer.userId]?.avatarUrl ?? peer.avatarUrl)
    : null;

  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex w-full items-center gap-2.5 border-b border-line/50 px-3 py-2.5 text-left transition hover:bg-surface-raised"
    >
      <span
        className={`relative flex shrink-0 items-center justify-center overflow-hidden rounded-full border bg-surface-raised text-ink-faint transition-all duration-200 ease-out ${avatarLayout.shell} ${
          showUnread ? "border-accent/50 ring-2 ring-accent/25" : "border-line"
        }`}
      >
        {entry.kind === "channel" ? (
          <ChannelIcon
            iconUrl={entry.iconUrl}
            size={entry.iconUrl ? avatarLayout.person : avatarLayout.fallback}
          />
        ) : entry.kind === "item" ? (
          <MessageSquare size={avatarLayout.fallback} />
        ) : entry.members.length > 2 ? (
          <Users size={avatarLayout.fallback} />
        ) : peer ? (
          <PersonAvatar
            userId={peer.userId}
            avatarUrl={peerAvatar}
            size={avatarLayout.person}
            className="border-0"
          />
        ) : (
          <User size={avatarLayout.fallback} />
        )}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline justify-between gap-2">
          <span
            className={`flex min-w-0 items-center gap-1 truncate text-sm ${
              showUnread ? "font-semibold text-ink" : "font-medium text-ink"
            }`}
          >
            <ConversationKindMark kind={entry.kind} presence={presence} />
            {entry.myPinnedAt && <Pin size={11} className="shrink-0 text-accent" />}
            <span className="truncate">{title}</span>
            {muted && <BellOff size={11} className="shrink-0 text-ink-faint" />}
          </span>
          {entry.lastMessageAt && (
            <span className="flex shrink-0 items-center gap-1 text-[10px] text-ink-faint">
              <ReadReceiptTicks entry={entry} myUserId={myUserId} />
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
            <span className="text-[10px] text-ink-faint">{formatMessageTime(msg.createdAt)}</span>
          </button>
        );
      })}
    </div>
  );
}

/**
 * Mobile Czat: mini-pasek hubu (ALL / Osoby / Kanały / Decyzje / …) + listy.
 */
export function MobileChatHub() {
  const myUserId = useChatStore((s) => s.userId)!;
  const profiles = useChatStore((s) => s.profiles);
  const items = useStore((s) => s.items);

  const [mode, setMode] = useState<MobileHubMode>({ kind: "browse", id: "all" });
  const [showNew, setShowNew] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<ChatSearchResult[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [showMentions, setShowMentions] = useState(false);
  const [globalQuery, setGlobalQuery] = useState("");
  const [globalResults, setGlobalResults] = useState<ChatSearchResult[] | null>(null);
  const [globalSearching, setGlobalSearching] = useState(false);
  const [registryDetail, setRegistryDetail] = useState<RegistryFocus | null>(null);
  const [mediaConvId, setMediaConvId] = useState<string | null>(null);

  const hubTab = mode.kind === "tab" ? mode.id : "chat";
  const {
    overview,
    groups,
    tags,
    allUserTags,
    discoverable,
    browseList,
    decisions,
    notes,
    media,
    mediaSubTab,
    setMediaSubTab,
    hubTagFilter,
    setHubTagFilter,
  } = useHubRegistryLists({ hubTab, enabled: true });

  const titleOf = (entry: ChatOverviewEntry) =>
    overviewTitle(entry, myUserId, (id) => items[id]?.title);

  const openRow = (entry: ChatOverviewEntry) => {
    void openConversation(entry.id);
    setRouteHash({ view: "conversation", conversationId: entry.id });
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

  const openMention = (msg: ChatMessage) => {
    setShowMentions(false);
    void openConversation(msg.conversationId).then(() => {
      void jumpToMessage(msg.conversationId, msg.threadRootId ?? msg.id);
    });
    setRouteHash({ view: "conversation", conversationId: msg.conversationId });
  };

  const runListSearch = async () => {
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

  const renderMobileRow = (entry: ChatOverviewEntry) => {
    const last = entry.lastMessage;
    const authorName =
      last && last.kind !== "system"
        ? last.authorUserId === myUserId
          ? "Ty"
          : (entry.members.find((m) => m.userId === last.authorUserId)?.displayName ?? null)
        : null;
    return (
      <ConversationRow
        key={entry.id}
        entry={entry}
        title={titleOf(entry)}
        authorName={authorName}
        myUserId={myUserId}
        onOpen={() => openRow(entry)}
      />
    );
  };

  const openRegistryRow = (kind: "decision" | "note", row: ChatDecision | ChatNote) => {
    const at = kind === "decision" ? (row as ChatDecision).decidedAt : (row as ChatNote).notedAt;
    setRegistryDetail({
      kind,
      id: row.id,
      conversationId: row.conversationId,
      messageId: row.messageId,
      title:
        kind === "note"
          ? (row as ChatNote).title?.trim() ||
            row.body.trim().split(/\n/)[0]?.trim().slice(0, 120) ||
            "Notatka"
          : "",
      body: row.body,
      note: kind === "decision" ? (row as ChatDecision).note ?? "" : "",
      createdBy: row.createdBy,
      at,
      groupId: row.groupId ?? null,
      tagIds: row.tagIds ?? [],
    });
  };

  const isVisualMedia = (mime: string) =>
    mime.startsWith("image/") || mime.startsWith("video/");

  const browseBody = () => {
    if (mode.kind !== "browse") return null;
    const list = browseList(mode.id);
    const pinned = list.filter((c) => c.myPinnedAt);
    const unpinned = list.filter((c) => !c.myPinnedAt);

    if (mode.id === "channels") {
      if (list.length === 0 && discoverable.length === 0) {
        return (
          <div className="px-6 py-10 text-center text-xs leading-relaxed text-ink-faint">
            Brak kanałów.
            <br />
            Tu pojawią się grupy firmowe i kanały publiczne.
          </div>
        );
      }
      return (
        <>
          {list.map(renderMobileRow)}
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
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-full border border-dashed border-line text-ink-faint">
                    <ChannelIcon iconUrl={c.iconUrl} size={c.iconUrl ? 32 : 15} />
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
      );
    }

    if (mode.id === "people" && list.length === 0) {
      return (
        <div className="px-6 py-10 text-center text-xs leading-relaxed text-ink-faint">
          Brak rozmów prywatnych.
          <br />
          Dodaj osobę przez <span className="text-ink-light">+</span>.
        </div>
      );
    }

    if (mode.id === "archive" && list.length === 0) {
      return (
        <div className="px-6 py-10 text-center text-xs leading-relaxed text-ink-faint">
          Brak zarchiwizowanych rozmów.
          <br />
          Archiwizuj rozmowę z menu opcji, aby trafiła tutaj.
        </div>
      );
    }

    if (list.length === 0) {
      return (
        <div className="px-6 py-10 text-center text-xs leading-relaxed text-ink-faint">
          Nie masz jeszcze rozmów.
        </div>
      );
    }

    return (
      <>
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
      </>
    );
  };

  const registryBody = (kind: "decision" | "note") => {
    const list = kind === "decision" ? decisions : notes;
    if (list === null) {
      return <div className="px-4 py-6 text-center text-xs text-ink-faint">Wczytywanie…</div>;
    }
    const filtered = list.filter((row) => {
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
          Brak wpisów dla wybranego filtra tagu.
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
          const group = row.groupId ? groups.find((g) => g.id === row.groupId) : null;
          const rowTags = row.tagIds
            .map((id) => tags[id])
            .filter((t): t is NonNullable<typeof t> => Boolean(t));
          return (
            <button
              key={row.id}
              type="button"
              onClick={() => openRegistryRow(kind, row)}
              className="flex w-full flex-col gap-0.5 border-b border-line/50 px-3 py-2.5 text-left transition hover:bg-surface-raised"
            >
              <span className="line-clamp-2 text-sm text-ink">
                {kind === "note" ? (row as ChatNote).title || row.body : row.body}
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

  const mediaBody = (kind: "media" | "files") => {
    if (media === null) {
      return <div className="px-4 py-6 text-center text-xs text-ink-faint">Wczytywanie…</div>;
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
              onClick={() => setMediaConvId(att.conversationId)}
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

  const showBrowseChrome = mode.kind === "browse";

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Mini-pasek hubu — pełna szerokość, duże cele dotykowe */}
      <div
        className="flex w-full shrink-0 items-stretch gap-px border-b border-line px-1 py-1"
        role="tablist"
        aria-label="Sekcje czatu"
      >
        {RAIL_TREE.filter((item) => !(item.kind === "tab" && item.id === "search")).map(
          (item, i) => {
          const Icon = item.icon;
          const active = isMobileHubModeActive(mode, item);
          const showSep = i === 3;
          return (
            <Fragment key={`${item.kind}-${item.id}`}>
              {showSep && (
                <span className="mx-0.5 my-2 w-px shrink-0 self-stretch bg-line" aria-hidden />
              )}
              <button
                type="button"
                role="tab"
                aria-selected={active}
                title={item.kind === "browse" ? item.title : item.label}
                onClick={() => {
                  setShowMentions(false);
                  setResults(null);
                  setQuery("");
                  if (item.kind === "browse") {
                    setMode({ kind: "browse", id: item.id });
                  } else {
                    setMode({ kind: "tab", id: item.id });
                  }
                }}
                className={`flex min-h-[48px] min-w-0 flex-1 flex-col items-center justify-center gap-0.5 rounded-lg px-0.5 py-1.5 transition ${
                  active
                    ? "bg-accent/15 text-accent"
                    : "text-ink-faint hover:bg-surface-raised hover:text-ink"
                }`}
              >
                <Icon size={20} strokeWidth={active ? 2.25 : 1.75} />
                <span
                  className={`max-w-full truncate px-0.5 text-center text-[10px] leading-tight ${
                    active ? "font-semibold" : "font-medium"
                  }`}
                >
                  {item.label}
                </span>
              </button>
            </Fragment>
          );
        },
        )}
      </div>

      {/* Toolbar zależny od trybu */}
      {showBrowseChrome && (
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
                if (e.key === "Enter") void runListSearch();
              }}
              placeholder={
                mode.kind === "browse" && mode.id === "people"
                  ? "Szukaj wśród osób…"
                  : mode.kind === "browse" && mode.id === "channels"
                    ? "Szukaj w kanałach…"
                    : "Szukaj…"
              }
              className="w-full rounded-md border border-line bg-surface-raised py-1.5 pl-6 pr-6 text-[12px] text-ink outline-none placeholder:text-ink-faint focus:border-accent/50"
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
      )}

      {(mode.kind === "tab" && (mode.id === "decisions" || mode.id === "notes")) &&
        allUserTags.length > 0 && (
          <div className="flex items-center gap-0.5 overflow-x-auto border-b border-line px-2 py-1.5 no-scrollbar">
            <button
              type="button"
              onClick={() => setHubTagFilter(null)}
              className={`shrink-0 rounded-md px-2 py-0.5 text-[10px] font-medium transition ${
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
                onClick={() => setHubTagFilter((cur) => (cur === t.id ? null : t.id))}
                className={`inline-flex max-w-[5.5rem] shrink-0 items-center gap-1 truncate rounded-md px-1.5 py-0.5 text-[10px] font-medium transition ${
                  hubTagFilter === t.id
                    ? "bg-accent/15 text-ink"
                    : "text-ink-faint hover:bg-surface-raised hover:text-ink"
                }`}
              >
                <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: t.color }} />
                <span className="truncate">{t.name}</span>
              </button>
            ))}
          </div>
        )}

      {mode.kind === "tab" && mode.id === "media" && (
        <div
          className="flex items-center gap-0.5 border-b border-line px-2 py-1.5"
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
              className={`inline-flex flex-1 items-center justify-center gap-1 rounded-md px-2 py-1.5 text-[11px] font-medium transition ${
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

      {mode.kind === "tab" && mode.id === "search" && (
        <div className="relative border-b border-line px-2 py-1.5">
          <Search
            size={12}
            className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-faint"
          />
          <input
            value={globalQuery}
            onChange={(e) => {
              setGlobalQuery(e.target.value);
              if (!e.target.value.trim()) setGlobalResults(null);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") void runGlobalSearch();
            }}
            placeholder="Szukaj wszędzie…"
            className="w-full rounded-md border border-line bg-surface-raised py-1.5 pl-7 pr-7 text-[12px] text-ink outline-none placeholder:text-ink-faint focus:border-accent/50"
          />
          {globalQuery && (
            <button
              type="button"
              onClick={() => {
                setGlobalQuery("");
                setGlobalResults(null);
              }}
              className="absolute right-3.5 top-1/2 -translate-y-1/2 text-ink-faint hover:text-ink"
              aria-label="Wyczyść"
            >
              <X size={11} />
            </button>
          )}
        </div>
      )}

      {/* Treść */}
      <div className="flex min-h-0 flex-1 flex-col">
        {showMentions && showBrowseChrome ? (
          <MentionsList onOpen={openMention} />
        ) : results !== null && showBrowseChrome ? (
          searching ? (
            <div className="px-3 py-4 text-center text-[11px] text-ink-faint">Szukam…</div>
          ) : (
            <SearchResults results={results} onClose={() => setResults(null)} />
          )
        ) : mode.kind === "browse" ? (
          <div className="thin-scrollbar min-h-0 flex-1 overflow-y-auto pb-1">
            {browseBody()}
          </div>
        ) : mode.id === "decisions" ? (
          registryBody("decision")
        ) : mode.id === "notes" ? (
          registryBody("note")
        ) : mode.id === "media" ? (
          mediaSubTab === "links" ? (
            <HubLinksPane />
          ) : (
            mediaBody(mediaSubTab)
          )
        ) : (
          <HubSearchPane results={globalResults} searching={globalSearching} />
        )}
      </div>

      <NewConversationDialog open={showNew} onClose={() => setShowNew(false)} />

      {registryDetail && (
        <RegistryDetailSheet
          focus={registryDetail}
          onClose={() => setRegistryDetail(null)}
        />
      )}

      {mediaConvId && (
        <ConversationMediaView
          conversationId={mediaConvId}
          onClose={() => setMediaConvId(null)}
          onJumpTo={(messageId) => {
            const cid = mediaConvId;
            setMediaConvId(null);
            void openConversation(cid).then(() => {
              void jumpToMessage(cid, messageId);
            });
            setRouteHash({ view: "conversation", conversationId: cid });
          }}
        />
      )}
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

  if (!results.length) {
    return (
      <div className="px-4 py-6 text-center text-xs text-ink-faint">
        Brak wyników.
        <button type="button" onClick={onClose} className="ml-2 text-accent">
          Wyczyść
        </button>
      </div>
    );
  }

  return (
    <div className="thin-scrollbar min-h-0 flex-1 overflow-y-auto">
      {results.map((r) => (
        <button
          key={`${r.resultType}-${r.id}`}
          type="button"
          onClick={() => {
            if (r.resultType === "item" && r.itemId) {
              setEditing(r.itemId);
              return;
            }
            if (!r.conversationId) return;
            void openConversation(r.conversationId).then(() => {
              if (r.resultType === "message") void jumpToMessage(r.conversationId!, r.id);
            });
            setRouteHash({ view: "conversation", conversationId: r.conversationId });
          }}
          className="flex w-full flex-col gap-0.5 border-b border-line/50 px-3 py-2.5 text-left transition hover:bg-surface-raised"
        >
          <span className="line-clamp-2 text-sm text-ink">{r.title || r.snippet || r.id}</span>
          <span className="block text-[10px] text-ink-faint">
            {r.resultType === "message"
              ? "wiadomość"
              : r.resultType === "file"
                ? "plik"
                : "wpis"}{" "}
            · {formatMessageTime(r.createdAt)}
          </span>
        </button>
      ))}
    </div>
  );
}
