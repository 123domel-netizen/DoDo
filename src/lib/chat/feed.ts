import type {
  ChatAttachment,
  ChatLastMessage,
  ChatMessage,
  ChatOverviewEntry,
  FocusFeed,
} from "@/lib/chat/types";

/** Klucz porządku feedu: czas serwera, remis rozstrzyga id. */
function isAfter(a: ChatMessage, b: ChatMessage): boolean {
  if (a.createdAt !== b.createdAt) return a.createdAt > b.createdAt;
  return a.id > b.id;
}

/**
 * Nie nadpisuj znanych załączników pustą tablicą (np. race outbox / realtime
 * bez zagnieżdżeń). Niepusty `next` zawsze wygrywa.
 */
export function mergeAttachments(
  prev: ChatAttachment[] | undefined,
  next: ChatAttachment[] | undefined,
): ChatAttachment[] | undefined {
  if (next === undefined) return prev;
  if (next.length > 0) return next;
  if (prev && prev.length > 0) return prev;
  return next;
}

/**
 * Realtime / rowToMessage nie mają klucza `sendState` → zachowaj lokalne
 * pending/failed (upload pliku trwa po INSERT). Jawne `sendState: undefined`
 * (Object.hasOwn) czyści stan po sukcesie / outbox flush.
 */
export function mergeSendState(
  prev: ChatMessage["sendState"],
  msg: ChatMessage,
): ChatMessage["sendState"] {
  if (Object.prototype.hasOwnProperty.call(msg, "sendState")) return msg.sendState;
  return prev;
}

/**
 * Scal wiadomość z listą (rosnąco po createdAt). Ten sam id → podmiana z
 * zachowaniem zagnieżdżeń (links/attachments), których event realtime nie niesie.
 */
export function upsertMessageInList(list: ChatMessage[], msg: ChatMessage): ChatMessage[] {
  const idx = list.findIndex((m) => m.id === msg.id);
  if (idx >= 0) {
    const prev = list[idx];
    const attachments =
      msg.sendState === "failed" &&
      Array.isArray(msg.attachments) &&
      msg.attachments.length === 0
        ? []
        : mergeAttachments(prev.attachments, msg.attachments);
    const merged: ChatMessage = {
      ...prev,
      ...msg,
      links: msg.links ?? prev.links,
      attachments,
      sendState: mergeSendState(prev.sendState, msg),
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
  const attachments =
    msg.sendState === "failed" &&
    Array.isArray(msg.attachments) &&
    msg.attachments.length === 0
      ? []
      : mergeAttachments(prev.attachments, msg.attachments);
  return {
    ...prev,
    ...msg,
    links: msg.links ?? prev.links,
    attachments,
    reactions: msg.reactions ?? prev.reactions,
    votes: msg.votes ?? prev.votes,
    sendState: mergeSendState(prev.sendState, msg),
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
  if (focus.hasNewer) return null;
  if (focus.messages.some((m) => m.id === msg.id)) return null;
  return { ...focus, messages: upsertMessageInList(focus.messages, msg) };
}

export interface OverviewApplyOptions {
  myUserId: string | null;
  activeConversationId: string | null;
  documentVisible: boolean;
  /** Tytuł wątku dla odpowiedzi (root może być w store / feedzie). */
  resolveThreadTitle?: (rootId: string) => string | null;
}

/**
 * Zastosuj przychodzącą wiadomość do listy rozmów: podbij lastMessage,
 * lastMessageAt i unread (nie dla własnych; nie dla aktywnej, widocznej rozmowy;
 * unread nie dla odpowiedzi w wątkach — spójnie z serwerowym licznikiem).
 * Odpowiedzi w wątku aktualizują podgląd: „nazwa wątku: treść”.
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

  const threadTitle = isThreadReply
    ? (opts.resolveThreadTitle?.(msg.threadRootId!) ?? null)
    : null;

  const nextLast: ChatLastMessage | null | undefined = isNewer
    ? {
        id: msg.id,
        kind: msg.kind,
        body: msg.body,
        authorUserId: msg.authorUserId,
        createdAt: msg.createdAt,
        deletedAt: msg.deletedAt,
        threadRootId: msg.threadRootId,
        threadTitle: isThreadReply ? threadTitle || "Wątek" : null,
      }
    : entry.lastMessage;

  const updated: ChatOverviewEntry = {
    ...entry,
    unreadCount: unread,
    lastMessageAt: isNewer ? msg.createdAt : entry.lastMessageAt,
    lastMessage: nextLast ?? entry.lastMessage,
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

/** Czy rozmowa ma nowe / nieprzeczytane wiadomości. */
export function hasUnread(entry: ChatOverviewEntry): boolean {
  return entry.unreadCount > 0 || entry.myMarkedUnread;
}

const MONTH_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Lista „Ulubione”: najpierw nowe wiadomości, potem ulubione (przypięte),
 * potem osoby/kanały z aktywnością w ostatnim miesiącu.
 * `activityCounts` = liczba wiadomości w oknie (gdy brak — sort po lastMessageAt).
 */
export function sortFavoritesAndNew(
  overview: ChatOverviewEntry[],
  now: Date = new Date(),
  activityCounts?: Record<string, number>,
): ChatOverviewEntry[] {
  const monthAgo = now.getTime() - MONTH_MS;
  const activityAt = (e: ChatOverviewEntry) => {
    const raw = e.lastMessageAt ?? e.createdAt;
    const t = new Date(raw).getTime();
    return Number.isNaN(t) ? 0 : t;
  };
  const volume = (e: ChatOverviewEntry) => activityCounts?.[e.id] ?? 0;
  return [...overview].sort((a, b) => {
    const aNew = hasUnread(a) ? 1 : 0;
    const bNew = hasUnread(b) ? 1 : 0;
    if (aNew !== bNew) return bNew - aNew;

    // Wśród nowych: najświeższa aktywność pierwsza.
    if (aNew && bNew) {
      const aAt = activityAt(a);
      const bAt = activityAt(b);
      if (aAt !== bAt) return bAt - aAt;
    }

    const aPin = a.myPinnedAt ? 1 : 0;
    const bPin = b.myPinnedAt ? 1 : 0;
    if (aPin !== bPin) return bPin - aPin;

    const aAt = activityAt(a);
    const bAt = activityAt(b);
    const aRecent = aAt >= monthAgo ? 1 : 0;
    const bRecent = bAt >= monthAgo ? 1 : 0;
    if (aRecent !== bRecent) return bRecent - aRecent;

    if (activityCounts) {
      const aVol = volume(a);
      const bVol = volume(b);
      if (aVol !== bVol) return bVol - aVol;
    }

    if (aAt !== bAt) return bAt - aAt;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
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

/** Solo-DM = prywatny Notatnik użytkownika (tylko Ty w rozmowie). */
export function isSelfNotesConversation(
  entry: Pick<ChatOverviewEntry, "kind" | "members">,
  myUserId: string | null,
): boolean {
  if (entry.kind !== "dm" || !myUserId) return false;
  const active = entry.members.filter((m) => m.userId);
  if (active.length !== 1) return false;
  return active[0]!.userId === myUserId;
}

/** Grupowy DM: więcej niż dwie osoby w rozmowie (3+). W UI jak kanał. */
export function isGroupDmConversation(
  entry: Pick<ChatOverviewEntry, "kind" | "members">,
): boolean {
  return entry.kind === "dm" && entry.members.length > 2;
}

/** DM 1:1 (co najwyżej dwie osoby). */
export function isDirectDmConversation(
  entry: Pick<ChatOverviewEntry, "kind" | "members">,
): boolean {
  return entry.kind === "dm" && entry.members.length <= 2;
}

/** Kolumna „Osoby” w hubie czatu. */
export function isHubPeopleConversation(
  entry: Pick<ChatOverviewEntry, "kind" | "members">,
): boolean {
  return isDirectDmConversation(entry);
}

/** Kolumna „Kanały” w hubie czatu (kanały + grupowe DM). */
export function isHubChannelConversation(
  entry: Pick<ChatOverviewEntry, "kind" | "members">,
): boolean {
  return entry.kind === "channel" || isGroupDmConversation(entry);
}

/** Mobile ALL: kanały + dyskusje itemów + grupowe DM. */
export function isHubChannelLikeConversation(
  entry: Pick<ChatOverviewEntry, "kind" | "members">,
): boolean {
  return (
    entry.kind === "channel" ||
    entry.kind === "item" ||
    isGroupDmConversation(entry)
  );
}

/** Znajdź wpis Notatnika w overview (jeśli już istnieje). */
export function findSelfNotesEntry(
  overview: ChatOverviewEntry[],
  myUserId: string | null,
): ChatOverviewEntry | undefined {
  if (!myUserId) return undefined;
  return overview.find((e) => isSelfNotesConversation(e, myUserId));
}

/**
 * Główna taśma Notatnika = same nagłówki (rooty).
 * Odpowiedzi wątku (`threadRootId`) ukazują się tylko w widoku szczegółów.
 * Usunięte są zawsze ukryte; zarchiwizowane — opcjonalnie.
 */
export function notebookMainFeed(
  messages: ChatMessage[],
  opts?: { includeArchived?: boolean },
): ChatMessage[] {
  const includeArchived = Boolean(opts?.includeArchived);
  return messages.filter((m) => {
    if (m.threadRootId) return false;
    if (m.deletedAt) return false;
    if (!includeArchived && m.threadArchivedAt) return false;
    return true;
  });
}

/** Najnowsza widoczna notatka (root) z feedu Notatnika. */
export function notebookLatestVisibleMessage(
  messages: ChatMessage[],
): ChatMessage | null {
  const visible = notebookMainFeed(messages);
  if (!visible.length) return null;
  return visible.reduce((latest, m) =>
    m.createdAt > latest.createdAt ? m : latest,
  );
}

/**
 * Podgląd Notatnika na dashboardzie — tylko aktywne notatki.
 * Overview.lastMessage może wskazywać archiwum lub kosz; wymaga załadowanego feedu.
 */
export function notebookDashboardPreview(
  entry: Pick<ChatOverviewEntry, "lastMessage" | "lastMessageAt">,
  messages: ChatMessage[],
): { message: ChatMessage | ChatLastMessage | null; at: string | null } {
  const latest = notebookLatestVisibleMessage(messages);
  if (latest) {
    return { message: latest, at: latest.createdAt };
  }

  if (messages.length > 0) {
    return { message: null, at: null };
  }

  const last = entry.lastMessage;
  if (!last || last.deletedAt || last.threadRootId) {
    return { message: null, at: null };
  }

  return { message: null, at: null };
}

/** Krótki tytuł wątku Notatnika z pierwszej linii nagłówka. */
export function notebookThreadTitleFromBody(body: string): string {
  const line = body.trim().split(/\n/)[0]?.trim().replace(/\s+/g, " ") ?? "";
  return (line || "Szczegóły").slice(0, 40);
}

/**
 * Notatnik: nazwa wątku/szczegółów = zawsze treść wiadomości-nagłówka
 * (nigdy osobny `threadTitle`).
 */
export function notebookThreadDisplayTitle(
  root: ChatMessage | null | undefined,
): string {
  if (!root || root.deletedAt) return "Szczegóły";
  const t = root.body.trim().replace(/\s+/g, " ");
  return (t || "Szczegóły").slice(0, 120);
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
  if (isSelfNotesConversation(entry, myUserId)) return "Notatnik";
  const others = entry.members.filter((m) => m.userId !== myUserId);
  if (!others.length) return "Notatnik";
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
  if (msg.kind === "checklist") {
    const q = msg.body.trim().replace(/\s+/g, " ");
    return (q || "Checklista").slice(0, 120);
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

/**
 * Element feedu głównego: zwykła wiadomość albo grupa kolejnych adnotacji
 * z tego samego wątku (bez przerwy innymi wiadomościami).
 */
export type ChatFeedItem =
  | { type: "message"; msg: ChatMessage }
  | { type: "threadGroup"; rootId: string; messages: ChatMessage[] };

/**
 * W feedzie głównym łączy ciągi odpowiedzi z tym samym `threadRootId`
 * w jedną grupę. Wewnątrz otwartego wątku (`inThread`) nie grupuje.
 */
export function groupThreadAnnotations(
  messages: ChatMessage[],
  inThread: boolean,
): ChatFeedItem[] {
  if (inThread) {
    return messages.map((msg) => ({ type: "message" as const, msg }));
  }

  const out: ChatFeedItem[] = [];
  let i = 0;
  while (i < messages.length) {
    const m = messages[i]!;
    const rootId = m.threadRootId;
    if (!rootId) {
      out.push({ type: "message", msg: m });
      i += 1;
      continue;
    }
    const group: ChatMessage[] = [m];
    let j = i + 1;
    while (j < messages.length && messages[j]!.threadRootId === rootId) {
      group.push(messages[j]!);
      j += 1;
    }
    out.push({ type: "threadGroup", rootId, messages: group });
    i = j;
  }
  return out;
}
