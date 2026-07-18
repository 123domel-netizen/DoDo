import type { ChatMessage, ChatOverviewEntry, FocusFeed } from "@/lib/chat/types";

/** Klucz porządku feedu: czas serwera, remis rozstrzyga id. */
function isAfter(a: ChatMessage, b: ChatMessage): boolean {
  if (a.createdAt !== b.createdAt) return a.createdAt > b.createdAt;
  return a.id > b.id;
}

/**
 * Scal wiadomość z listą (rosnąco po createdAt). Ten sam id → podmiana z
 * zachowaniem zagnieżdżeń (links/attachments), których event realtime nie niesie.
 */
export function upsertMessageInList(list: ChatMessage[], msg: ChatMessage): ChatMessage[] {
  const idx = list.findIndex((m) => m.id === msg.id);
  if (idx >= 0) {
    const prev = list[idx];
    const merged: ChatMessage = {
      ...prev,
      ...msg,
      links: msg.links ?? prev.links,
      attachments: msg.attachments ?? prev.attachments,
      sendState: msg.sendState,
    };
    const next = [...list];
    next[idx] = merged;
    return next;
  }
  // wstaw we właściwe miejsce (zwykle koniec)
  let insertAt = list.length;
  while (insertAt > 0 && isAfter(list[insertAt - 1], msg)) insertAt--;
  const next = [...list];
  next.splice(insertAt, 0, msg);
  return next;
}

export function mergeMessages(list: ChatMessage[], incoming: ChatMessage[]): ChatMessage[] {
  let next = list;
  for (const msg of incoming) next = upsertMessageInList(next, msg);
  return next;
}

/** Przytnij cache do ostatnich `max` wiadomości (offline czyta ogon). */
export function trimList(list: ChatMessage[], max: number): ChatMessage[] {
  return list.length <= max ? list : list.slice(list.length - max);
}

/** Merge z zachowaniem zagnieżdżeń, których event realtime nie niesie. */
export function mergeKnownNested(prev: ChatMessage, msg: ChatMessage): ChatMessage {
  return {
    ...prev,
    ...msg,
    links: msg.links ?? prev.links,
    attachments: msg.attachments ?? prev.attachments,
    reactions: msg.reactions ?? prev.reactions,
    votes: msg.votes ?? prev.votes,
    sendState: msg.sendState,
  };
}

/**
 * Lista przypiętych wątków rozmowy po zmianie stanu wiadomości
 * (pin/unpin/delete). Zwraca null, gdy lista nie wymaga zmiany.
 * Porządek: najnowsze przypięcie pierwsze.
 */
export function reconcilePinnedList(
  list: ChatMessage[] | undefined,
  msg: ChatMessage,
): ChatMessage[] | null {
  const shouldBePinned = Boolean(msg.pinnedAt) && !msg.deletedAt && !msg.threadRootId;
  const idx = (list ?? []).findIndex((m) => m.id === msg.id);
  if (!shouldBePinned) {
    if (!list || idx < 0) return null;
    return list.filter((m) => m.id !== msg.id);
  }
  const base = list ?? [];
  const merged = idx >= 0 ? mergeKnownNested(base[idx], msg) : msg;
  return [...base.filter((m) => m.id !== msg.id), merged].sort((a, b) =>
    (b.pinnedAt ?? "").localeCompare(a.pinnedAt ?? ""),
  );
}

/**
 * Dopisz przychodzącą wiadomość do okna kontekstowego doładowanego do końca
 * (hasNewer=false) — przewijanie w dół schodzi płynnie do teraźniejszości.
 * Zwraca null, gdy okno nie wymaga zmiany.
 */
export function applyFocusIncoming(
  focus: FocusFeed | null,
  msg: ChatMessage,
): FocusFeed | null {
  if (!focus || focus.conversationId !== msg.conversationId) return null;
  if (focus.hasNewer || msg.threadRootId !== null) return null;
  if (focus.messages.some((m) => m.id === msg.id)) return null;
  return { ...focus, messages: upsertMessageInList(focus.messages, msg) };
}

export interface OverviewApplyOptions {
  myUserId: string | null;
  activeConversationId: string | null;
  documentVisible: boolean;
}

/**
 * Zastosuj przychodzącą wiadomość do listy rozmów: podbij lastMessage,
 * lastMessageAt i unread (nie dla własnych; nie dla aktywnej, widocznej rozmowy;
 * nie dla odpowiedzi w wątkach — spójnie z serwerowym licznikiem).
 */
export function applyMessageToOverview(
  overview: ChatOverviewEntry[],
  msg: ChatMessage,
  opts: OverviewApplyOptions,
): { overview: ChatOverviewEntry[]; known: boolean } {
  const idx = overview.findIndex((c) => c.id === msg.conversationId);
  if (idx < 0) return { overview, known: false };

  const entry = overview[idx];
  const isThreadReply = msg.threadRootId !== null;
  const isNewer = !entry.lastMessageAt || msg.createdAt >= entry.lastMessageAt;

  let unread = entry.unreadCount;
  const activeVisible =
    opts.activeConversationId === msg.conversationId && opts.documentVisible;
  if (
    !isThreadReply &&
    !msg.deletedAt &&
    msg.authorUserId !== opts.myUserId &&
    !activeVisible &&
    (!entry.myLastReadAt || msg.createdAt > entry.myLastReadAt)
  ) {
    unread = entry.unreadCount + 1;
  }

  const updated: ChatOverviewEntry = {
    ...entry,
    unreadCount: unread,
    ...(isThreadReply
      ? {}
      : {
          lastMessageAt: isNewer ? msg.createdAt : entry.lastMessageAt,
          lastMessage: isNewer
            ? {
                id: msg.id,
                kind: msg.kind,
                body: msg.body,
                authorUserId: msg.authorUserId,
                createdAt: msg.createdAt,
                deletedAt: msg.deletedAt,
              }
            : entry.lastMessage,
        }),
  };

  const next = [...overview];
  next[idx] = updated;
  next.sort((a, b) =>
    (b.lastMessageAt ?? b.createdAt).localeCompare(a.lastMessageAt ?? a.createdAt),
  );
  return { overview: next, known: true };
}

export function markOverviewRead(
  overview: ChatOverviewEntry[],
  conversationId: string,
  atIso: string,
): ChatOverviewEntry[] {
  return overview.map((c) =>
    c.id === conversationId
      ? {
          ...c,
          unreadCount: 0,
          myMarkedUnread: false,
          myLastReadAt:
            c.myLastReadAt && c.myLastReadAt > atIso ? c.myLastReadAt : atIso,
        }
      : c,
  );
}

export function totalUnread(overview: ChatOverviewEntry[]): number {
  return overview.reduce(
    (sum, c) => sum + (c.unreadCount || 0) + (c.myMarkedUnread && !c.unreadCount ? 1 : 0),
    0,
  );
}

/**
 * Hub: zawężenie do dyskusji wpisów z aktywnej grupy (GroupRail).
 * Kanały i DM są ukrywane, gdy filtr jest włączony i grupa wybrana.
 */
export function filterOverviewForHubGroup(
  overview: ChatOverviewEntry[],
  opts: {
    matchGroup: boolean;
    activeGroupFilter: string | null;
    itemGroupId: (itemId: string) => string | null | undefined;
  },
): ChatOverviewEntry[] {
  if (!opts.matchGroup || !opts.activeGroupFilter) return overview;
  return overview.filter((e) => {
    if (e.kind !== "item" || !e.itemId) return false;
    return opts.itemGroupId(e.itemId) === opts.activeGroupFilter;
  });
}

/** Czy rozmowa jest aktualnie wyciszona ("infinity" = na zawsze). */
export function isMuted(entry: ChatOverviewEntry, now: Date = new Date()): boolean {
  if (!entry.myMutedUntil) return false;
  if (entry.myMutedUntil === "infinity") return true;
  const until = new Date(entry.myMutedUntil);
  return !Number.isNaN(until.getTime()) && until > now;
}

/** Ulubione (przypięte) na górze, wewnątrz sekcji porządek po aktywności. */
export function sortOverview(overview: ChatOverviewEntry[]): ChatOverviewEntry[] {
  return [...overview].sort((a, b) => {
    const ap = a.myPinnedAt ? 1 : 0;
    const bp = b.myPinnedAt ? 1 : 0;
    if (ap !== bp) return bp - ap;
    return (b.lastMessageAt ?? b.createdAt).localeCompare(a.lastMessageAt ?? a.createdAt);
  });
}

/** Nazwa rozmowy do wyświetlenia. */
export function overviewTitle(
  entry: ChatOverviewEntry,
  myUserId: string | null,
  itemTitleLookup: (itemId: string) => string | undefined,
): string {
  if (entry.kind === "channel") return entry.name ?? "Kanał";
  if (entry.kind === "item") {
    const title = entry.itemId ? itemTitleLookup(entry.itemId) : undefined;
    return title?.trim() ? title : "Dyskusja wpisu";
  }
  const others = entry.members.filter((m) => m.userId !== myUserId);
  if (!others.length) return "Notatki (ja)";
  return others.map((m) => m.displayName || "Bez nazwy").join(", ");
}

/** Domyślna nazwa wątku z treści wiadomości-rootu (do formularza). */
export function defaultThreadTitle(msg: ChatMessage): string {
  if (msg.kind === "voice") return "Wiadomość głosowa";
  if (msg.kind === "gif") return "GIF";
  if (msg.kind === "poll") {
    const q = msg.body.trim().replace(/\s+/g, " ");
    return (q || "Ankieta").slice(0, 120);
  }
  const t = msg.body.trim().replace(/\s+/g, " ");
  return (t || "Wątek").slice(0, 120);
}

/** Tytuł wątku do UI: zapisana nazwa albo treść rootu. */
export function threadDisplayTitle(root: ChatMessage | null | undefined): string {
  if (!root || root.deletedAt) return "Wątek";
  const named = root.threadTitle?.trim();
  if (named) return named;
  return defaultThreadTitle(root);
}
