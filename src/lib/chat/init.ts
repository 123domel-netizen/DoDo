import type { RealtimeChannel } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";
import { uid } from "@/lib/factory";
import { useStore } from "@/state/store";
import { onRouteChange } from "@/lib/navigation";
import * as api from "@/lib/chat/api";
import { uploadAttachmentsForMessage } from "@/lib/chat/upload";
import { useChatStore, switchChatPersistUser } from "@/lib/chat/store";
import { firstUrl } from "@/lib/chat/markdown";
import type {
  ChatItemLink,
  ChatMessage,
  ChatReaction,
  MessageKind,
  MessagePayload,
  PollOption,
} from "@/lib/chat/types";

/**
 * CHAT1-CORE: orkiestracja czatu — auth, realtime, outbox, mark-read.
 * Świadomie NIEZALEŻNE od lib/cloud.ts (Sync v2 jest snapshotowy; czat jest
 * append-only ze strumieniem) — jedyny punkt styku to authUserId w głównym store.
 */

let booted = false;
let currentUserId: string | null = null;
let channel: RealtimeChannel | null = null;
let overviewTimer: ReturnType<typeof setTimeout> | null = null;
const readTimers = new Map<string, ReturnType<typeof setTimeout>>();
const pendingReadAt = new Map<string, string>();

const MAX_SEND_ATTEMPTS = 3;

function documentVisible(): boolean {
  return typeof document === "undefined" || document.visibilityState === "visible";
}

// ---------------------------------------------------------------------------
// Odświeżanie danych
// ---------------------------------------------------------------------------

export async function refreshChat() {
  if (!api.chatAvailable() || !currentUserId) return;
  const [profiles, overview] = await Promise.all([
    api.fetchProfiles(),
    api.fetchOverview(),
  ]);
  const st = useChatStore.getState();
  st.setProfiles(profiles);
  st.setOverview(overview);
}

async function refreshOverview() {
  if (!api.chatAvailable() || !currentUserId) return;
  const overview = await api.fetchOverview();
  useChatStore.getState().setOverview(overview);
}

export function scheduleOverviewRefresh(delayMs = 800) {
  if (overviewTimer) clearTimeout(overviewTimer);
  overviewTimer = setTimeout(() => {
    overviewTimer = null;
    void refreshOverview();
  }, delayMs);
}

// ---------------------------------------------------------------------------
// Mark-read (lokalnie od razu, RPC z debounce)
// ---------------------------------------------------------------------------

export function markRead(conversationId: string) {
  const at = new Date().toISOString();
  useChatStore.getState().markReadLocal(conversationId, at);
  pendingReadAt.set(conversationId, at);

  const existing = readTimers.get(conversationId);
  if (existing) clearTimeout(existing);
  readTimers.set(
    conversationId,
    setTimeout(() => {
      readTimers.delete(conversationId);
      const latest = pendingReadAt.get(conversationId);
      pendingReadAt.delete(conversationId);
      if (latest) void api.markConversationRead(conversationId, latest);
    }, 800),
  );
}

// ---------------------------------------------------------------------------
// Otwieranie rozmów / wątków / paginacja
// ---------------------------------------------------------------------------

/** Załaduj pierwszą stronę feedu bez zmiany aktywnej rozmowy (dyskusje itemów). */
export async function loadConversationMessages(conversationId: string) {
  const { messages, hasMore } = await api.fetchMessagesPage(conversationId);
  useChatStore.getState().upsertConvMessages(conversationId, messages, hasMore);
  const counts = await api.fetchReplyCounts(messages.map((m) => m.id));
  if (Object.keys(counts).length) useChatStore.getState().setReplyCounts(counts);
}

export async function openConversation(conversationId: string) {
  const st = useChatStore.getState();
  st.setActiveConversation(conversationId);
  markRead(conversationId);
  await loadConversationMessages(conversationId);
  void loadPinnedMessages(conversationId);
}

export async function loadPinnedMessages(conversationId: string) {
  const pinned = await api.fetchPinnedMessages(conversationId);
  useChatStore.getState().setPinnedMessages(conversationId, pinned);
}

/** Przypnij/odepnij wątek (optimistic; realtime UPDATE dosynchronizuje innych). */
export async function pinThreadMessage(msg: ChatMessage, pinned: boolean) {
  const st = useChatStore.getState();
  if (msg.sendState) return;
  const optimistic: ChatMessage = {
    ...msg,
    pinnedAt: pinned ? new Date().toISOString() : null,
    pinnedBy: pinned ? st.userId : null,
  };
  st.markMessageState(optimistic);
  const { error } = await api.setMessagePinned(msg.id, pinned);
  if (error) {
    console.warn("[chat] pin thread failed:", error);
    st.markMessageState(msg);
  }
}

export async function loadOlderMessages(conversationId: string) {
  const list = useChatStore.getState().messagesByConv[conversationId] ?? [];
  const oldest = list.find((m) => !m.sendState);
  if (!oldest) return;
  const { messages, hasMore } = await api.fetchMessagesPage(conversationId, {
    createdAt: oldest.createdAt,
  });
  useChatStore.getState().upsertConvMessages(conversationId, messages, hasMore);
  const counts = await api.fetchReplyCounts(messages.map((m) => m.id));
  if (Object.keys(counts).length) useChatStore.getState().setReplyCounts(counts);
}

export async function openThread(rootId: string) {
  useChatStore.getState().setActiveThread(rootId);
  const msgs = await api.fetchThreadMessages(rootId);
  if (msgs.length) useChatStore.getState().setThreadMessages(rootId, msgs);
}

// ---------------------------------------------------------------------------
// Wysyłka + outbox (idempotentna dzięki UUID klienta)
// ---------------------------------------------------------------------------

export interface SendOptions {
  conversationId: string;
  body: string;
  kind?: MessageKind;
  payload?: MessagePayload;
  mentions?: string[];
  threadRootId?: string | null;
  replyToMessageId?: string | null;
}

export function buildOutgoingMessage(opts: SendOptions, userId: string): ChatMessage {
  return {
    id: uid(),
    conversationId: opts.conversationId,
    authorUserId: userId,
    kind: opts.kind ?? "text",
    body: opts.body.trim(),
    payload: opts.payload ?? {},
    mentions: opts.mentions ?? [],
    threadRootId: opts.threadRootId ?? null,
    replyToMessageId: opts.replyToMessageId ?? null,
    createdAt: new Date().toISOString(),
    editedAt: null,
    deletedAt: null,
    pinnedAt: null,
    pinnedBy: null,
    links: [],
    attachments: [],
    reactions: [],
    votes: [],
    sendState: "pending",
  };
}

export function sendChatMessage(opts: SendOptions): ChatMessage | null {
  const st = useChatStore.getState();
  if (!st.userId) return null;
  const body = opts.body.trim();
  // GIF niesie treść w payloadzie; pozostałe kindy wymagają tekstu.
  if (!body && opts.kind !== "gif") return null;

  const msg = buildOutgoingMessage({ ...opts, body }, st.userId);
  st.enqueueOutbox({ message: msg, attempts: 0 });
  st.applyIncomingMessage(msg, true);
  void flushOutbox();
  return msg;
}

/** Ankieta: pytanie w body, opcje w payload.poll (głosy w poll_votes). */
export function sendPollMessage(
  conversationId: string,
  question: string,
  optionLabels: string[],
  threadRootId: string | null = null,
): ChatMessage | null {
  const options: PollOption[] = optionLabels
    .map((label) => label.trim())
    .filter(Boolean)
    .map((label) => ({ id: uid(), label }));
  if (options.length < 2) return null;
  return sendChatMessage({
    conversationId,
    body: question,
    kind: "poll",
    payload: { poll: { options } },
    threadRootId,
  });
}

export function sendGifMessage(
  conversationId: string,
  url: string,
  threadRootId: string | null = null,
): ChatMessage | null {
  return sendChatMessage({
    conversationId,
    body: "",
    kind: "gif",
    payload: { gif: { url } },
    threadRootId,
  });
}

/** Wiadomość głosowa: nagranie jako załącznik, czas trwania w payloadzie. */
export async function sendVoiceMessage(
  conversationId: string,
  file: File,
  durationSec: number,
  threadRootId: string | null = null,
): Promise<{ error?: string }> {
  return sendChatMessageWithFiles({
    conversationId,
    body: "",
    kind: "voice",
    payload: { voice: { durationSec } },
    threadRootId,
    files: [file],
  });
}

/**
 * Wysyłka z załącznikami — wymaga online (upload do Storage po INSERT wiersza;
 * plików nie da się bezpiecznie persystować w outboxie JSON).
 */
export async function sendChatMessageWithFiles(
  opts: SendOptions & { files: File[] },
): Promise<{ error?: string }> {
  const st = useChatStore.getState();
  if (!st.userId) return { error: "Brak zalogowanego użytkownika." };
  if (typeof navigator !== "undefined" && !navigator.onLine) {
    return { error: "Załączniki wymagają połączenia z internetem." };
  }
  const msg = buildOutgoingMessage(opts, st.userId);
  if (!msg.body && !opts.files.length) return {};

  st.enqueueOutbox({ message: msg, attempts: 0 });
  st.applyIncomingMessage(msg, true);

  const { error } = await api.insertMessage(msg);
  if (error) {
    markFailed(msg);
    return { error };
  }

  const { attachments, errors } = await uploadAttachmentsForMessage(
    msg.conversationId,
    msg.id,
    opts.files,
  );
  const after = useChatStore.getState();
  after.removeFromOutbox(msg.id);
  after.markMessageState({ ...msg, attachments, sendState: undefined });
  void enrichLinkPreview({ ...msg, attachments });
  return errors.length ? { error: errors.join("\n") } : {};
}

// ---------------------------------------------------------------------------
// Podgląd linków (OG scraping przez funkcję Edge, dopinany po wysyłce)
// ---------------------------------------------------------------------------

const enrichedPreviewIds = new Set<string>();

async function enrichLinkPreview(msg: ChatMessage) {
  if (msg.kind !== "text" || msg.payload.linkPreview) return;
  if (msg.attachments?.length) return;
  const url = firstUrl(msg.body);
  if (!url || enrichedPreviewIds.has(msg.id)) return;
  enrichedPreviewIds.add(msg.id);

  const preview = await api.fetchLinkPreview(url);
  if (!preview) return;
  const payload: MessagePayload = { ...msg.payload, linkPreview: preview };
  const { error } = await api.updateMessagePayload(msg.id, payload);
  if (error) return;
  useChatStore.getState().markMessageState({ ...msg, payload, sendState: undefined });
}

let flushing = false;

export async function flushOutbox() {
  if (flushing || !api.chatAvailable() || !currentUserId) return;
  if (typeof navigator !== "undefined" && !navigator.onLine) return;
  flushing = true;
  try {
    // snapshot — nowe wpisy w trakcie złapie kolejny flush
    const entries = [...useChatStore.getState().outbox].filter(
      (e) => e.message.sendState !== "failed",
    );
    for (const entry of entries) {
      const st = useChatStore.getState();
      try {
        const { error } = await api.insertMessage(entry.message);
        if (error) {
          // Błąd logiczny (RLS/walidacja) — retry nic nie da.
          console.warn("[chat] send rejected:", error);
          markFailed(entry.message);
          continue;
        }
        st.removeFromOutbox(entry.message.id);
        st.markMessageState({ ...entry.message, sendState: undefined });
        void enrichLinkPreview(entry.message);
      } catch (err) {
        // Błąd sieci — zostaw w outboxie; po limicie prób oznacz failed.
        const attempts = entry.attempts + 1;
        if (attempts >= MAX_SEND_ATTEMPTS) {
          markFailed(entry.message);
        } else {
          st.updateOutbox(entry.message.id, { attempts });
        }
        console.warn("[chat] send deferred:", err);
      }
    }
  } finally {
    flushing = false;
  }
}

function markFailed(msg: ChatMessage) {
  const st = useChatStore.getState();
  const failed: ChatMessage = { ...msg, sendState: "failed" };
  st.updateOutbox(msg.id, { message: failed, attempts: MAX_SEND_ATTEMPTS });
  st.markMessageState(failed);
}

export function retryFailedMessage(messageId: string) {
  const st = useChatStore.getState();
  const entry = st.outbox.find((e) => e.message.id === messageId);
  if (!entry) return;
  const pending: ChatMessage = { ...entry.message, sendState: "pending" };
  st.updateOutbox(messageId, { message: pending, attempts: 0 });
  st.markMessageState(pending);
  void flushOutbox();
}

export function discardFailedMessage(messageId: string) {
  const st = useChatStore.getState();
  const entry = st.outbox.find((e) => e.message.id === messageId);
  st.removeFromOutbox(messageId);
  if (entry) {
    st.markMessageState({
      ...entry.message,
      deletedAt: new Date().toISOString(),
      sendState: undefined,
    });
  }
}

// ---------------------------------------------------------------------------
// Edycja / kasowanie (optimistic, LWW na własnym wierszu)
// ---------------------------------------------------------------------------

export async function editChatMessage(
  msg: ChatMessage,
  body: string,
  mentions: string[] = msg.mentions,
) {
  const st = useChatStore.getState();
  st.markMessageState({ ...msg, body, mentions, editedAt: new Date().toISOString() });
  const { error } = await api.updateMessageBody(msg.id, body, mentions);
  if (error) console.warn("[chat] edit failed:", error);
}

// ---------------------------------------------------------------------------
// Reakcje / głosy w ankietach (optimistic + realtime dosynchronizuje resztę)
// ---------------------------------------------------------------------------

export async function toggleReaction(msg: ChatMessage, emoji: string) {
  const st = useChatStore.getState();
  if (!st.userId || msg.sendState) return;
  const reaction: ChatReaction = { messageId: msg.id, userId: st.userId, emoji };
  const mine = (msg.reactions ?? []).some(
    (r) => r.userId === st.userId && r.emoji === emoji,
  );
  st.applyReactionChange(reaction, mine);
  const { error } = mine
    ? await api.removeReaction(reaction)
    : await api.addReaction(reaction);
  if (error) {
    console.warn("[chat] reaction failed:", error);
    st.applyReactionChange(reaction, !mine);
  }
}

/** Głos w ankiecie: ta sama opcja = cofnięcie głosu, inna = zmiana. */
export async function votePoll(msg: ChatMessage, optionId: string) {
  const st = useChatStore.getState();
  if (!st.userId || msg.sendState) return;
  const current = (msg.votes ?? []).find((v) => v.userId === st.userId);
  if (current && current.optionId === optionId) {
    st.applyVoteChange({ messageId: msg.id, userId: st.userId, optionId }, true);
    const { error } = await api.deletePollVote(msg.id, st.userId);
    if (error) st.applyVoteChange(current, false);
    return;
  }
  const vote = { messageId: msg.id, userId: st.userId, optionId };
  st.applyVoteChange(vote, false);
  const { error } = await api.upsertPollVote(vote);
  if (error) {
    console.warn("[chat] vote failed:", error);
    if (current) st.applyVoteChange(current, false);
    else st.applyVoteChange(vote, true);
  }
}

// ---------------------------------------------------------------------------
// Prefs rozmowy: ulubione / wyciszenie / oznacz nieprzeczytane
// ---------------------------------------------------------------------------

export async function pinConversation(conversationId: string, pinned: boolean) {
  useChatStore.getState().patchOverviewEntry(conversationId, {
    myPinnedAt: pinned ? new Date().toISOString() : null,
  });
  const { error } = await api.setConversationPinned(conversationId, pinned);
  if (error) console.warn("[chat] pin failed:", error);
  scheduleOverviewRefresh(400);
}

export const MUTE_PRESETS: { label: string; minutes: number | null }[] = [
  { label: "1 godzina", minutes: 60 },
  { label: "8 godzin", minutes: 8 * 60 },
  { label: "24 godziny", minutes: 24 * 60 },
  { label: "7 dni", minutes: 7 * 24 * 60 },
  { label: "Na zawsze", minutes: null },
];

/** minutes = null → na zawsze; unmute przez muteConversationOff. */
export async function muteConversation(conversationId: string, minutes: number | null) {
  const until =
    minutes === null
      ? "infinity"
      : new Date(Date.now() + minutes * 60_000).toISOString();
  useChatStore.getState().patchOverviewEntry(conversationId, { myMutedUntil: until });
  const { error } = await api.setConversationMute(conversationId, until);
  if (error) console.warn("[chat] mute failed:", error);
  scheduleOverviewRefresh(400);
}

export async function unmuteConversation(conversationId: string) {
  useChatStore.getState().patchOverviewEntry(conversationId, { myMutedUntil: null });
  const { error } = await api.setConversationMute(conversationId, null);
  if (error) console.warn("[chat] unmute failed:", error);
  scheduleOverviewRefresh(400);
}

export async function markUnread(conversationId: string) {
  useChatStore.getState().patchOverviewEntry(conversationId, { myMarkedUnread: true });
  const { error } = await api.markConversationUnread(conversationId);
  if (error) console.warn("[chat] mark unread failed:", error);
}

// ---------------------------------------------------------------------------
// Skok do wiadomości (cytat / decyzja / notatka / wynik wyszukiwania):
// wiadomość w załadowanym feedzie → flash; poza nim → okno kontekstowe ±10
// doładowywane w obie strony (bez dociągania całej historii).
// ---------------------------------------------------------------------------

export async function jumpToMessage(conversationId: string, messageId: string) {
  const st = useChatStore.getState();

  const focus = st.focusFeed;
  if (focus?.conversationId === conversationId) {
    const inFocus = focus.messages.find(
      (m) => m.id === messageId || m.threadRootId === messageId,
    );
    if (inFocus) {
      st.setFlashMessage(inFocus.threadRootId ?? messageId);
      return;
    }
  }

  const tail = st.messagesByConv[conversationId] ?? [];
  const inTail = tail.find((m) => m.id === messageId);
  if (inTail && !inTail.threadRootId) {
    st.setFocusFeed(null);
    st.setFlashMessage(messageId);
    return;
  }

  const ctx = await api.fetchMessagesAround(conversationId, messageId);
  if (!ctx || !ctx.messages.length) return;
  const after = useChatStore.getState();
  after.setFocusFeed({
    conversationId,
    anchorId: ctx.pivotId,
    messages: ctx.messages,
    hasOlder: ctx.hasOlder,
    hasNewer: ctx.hasNewer,
  });
  // Kotwica w wątku → flashuje jej root (kontekst głównego feedu).
  after.setFlashMessage(ctx.pivotId);
  const counts = await api.fetchReplyCounts(ctx.messages.map((m) => m.id));
  if (Object.keys(counts).length) useChatStore.getState().setReplyCounts(counts);
}

let focusLoading = false;

export async function loadOlderFocus() {
  const focus = useChatStore.getState().focusFeed;
  if (!focus || !focus.hasOlder || focusLoading) return;
  focusLoading = true;
  try {
    const oldest = focus.messages[0];
    if (!oldest) return;
    const { messages, hasMore } = await api.fetchMessagesPage(focus.conversationId, {
      createdAt: oldest.createdAt,
    });
    useChatStore.getState().prependFocusMessages(messages, hasMore);
  } finally {
    focusLoading = false;
  }
}

export async function loadNewerFocus() {
  const focus = useChatStore.getState().focusFeed;
  if (!focus || !focus.hasNewer || focusLoading) return;
  focusLoading = true;
  try {
    const newest = focus.messages[focus.messages.length - 1];
    if (!newest) return;
    const { messages, hasMore } = await api.fetchNewerMessages(focus.conversationId, {
      createdAt: newest.createdAt,
    });
    useChatStore.getState().appendFocusMessages(messages, hasMore);
  } finally {
    focusLoading = false;
  }
}

/** Wyjście z okna kontekstowego z powrotem do ogona rozmowy. */
export function returnToLatest(conversationId: string) {
  const st = useChatStore.getState();
  st.setFocusFeed(null);
  st.setFlashMessage(null);
  if (!(st.messagesByConv[conversationId] ?? []).length) {
    void loadConversationMessages(conversationId);
  }
}

export async function deleteChatMessage(msg: ChatMessage) {
  const st = useChatStore.getState();
  if (msg.sendState) {
    discardFailedMessage(msg.id);
    return;
  }
  if (!st.userId) return;
  st.markMessageState({ ...msg, deletedAt: new Date().toISOString() });
  const { error } = await api.softDeleteMessage(msg.id, st.userId);
  if (error) console.warn("[chat] delete failed:", error);
}

// ---------------------------------------------------------------------------
// Tworzenie rozmów
// ---------------------------------------------------------------------------

export async function startDm(memberIds: string[]): Promise<string | null> {
  const { id, error } = await api.createConversation("dm", { memberIds });
  if (error || !id) {
    console.warn("[chat] dm create failed:", error);
    return null;
  }
  await refreshOverview();
  return id;
}

export async function createChannel(
  name: string,
  isPublic: boolean,
  memberIds: string[],
): Promise<string | null> {
  const { id, error } = await api.createConversation("channel", {
    name,
    isPublic,
    memberIds,
  });
  if (error || !id) {
    console.warn("[chat] channel create failed:", error);
    return null;
  }
  await refreshOverview();
  return id;
}

// ---------------------------------------------------------------------------
// Realtime
// ---------------------------------------------------------------------------

function handleIncomingMessage(msg: ChatMessage) {
  const st = useChatStore.getState();
  const visible = documentVisible();
  const known = st.applyIncomingMessage(msg, visible);
  if (!known) scheduleOverviewRefresh();
  // patrzę na tę rozmowę → od razu przeczytane
  if (
    visible &&
    st.activeConversationId === msg.conversationId &&
    msg.authorUserId !== st.userId &&
    !msg.threadRootId
  ) {
    markRead(msg.conversationId);
  }
}

function teardownRealtime() {
  if (channel && supabase) {
    void supabase.removeChannel(channel);
    channel = null;
  }
}

function setupRealtime(userId: string) {
  if (!supabase || channel) return;
  channel = supabase
    .channel(`chat-${userId}`)
    .on(
      "postgres_changes",
      { event: "INSERT", schema: "public", table: "messages" },
      (payload) => {
        handleIncomingMessage(api.rowToMessage(payload.new as Record<string, unknown>, false));
      },
    )
    .on(
      "postgres_changes",
      { event: "UPDATE", schema: "public", table: "messages" },
      (payload) => {
        // edycja/soft delete — merge zachowuje znane zagnieżdżenia
        useChatStore
          .getState()
          .markMessageState(api.rowToMessage(payload.new as Record<string, unknown>, false));
      },
    )
    .on(
      "postgres_changes",
      { event: "INSERT", schema: "public", table: "message_attachments" },
      (payload) => {
        const row = payload.new as Record<string, unknown>;
        useChatStore.getState().attachToMessage({
          id: row.id as string,
          messageId: row.message_id as string,
          bucketPath: row.bucket_path as string,
          thumbPath: (row.thumb_path as string | null) ?? null,
          fileName: (row.file_name as string) ?? "",
          mimeType: (row.mime_type as string) ?? "application/octet-stream",
          sizeBytes: (row.size_bytes as number) ?? 0,
          width: (row.width as number | null) ?? null,
          height: (row.height as number | null) ?? null,
        });
      },
    )
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "message_reactions" },
      (payload) => {
        const row = (payload.eventType === "DELETE" ? payload.old : payload.new) as
          | Record<string, unknown>
          | null;
        if (!row?.message_id) return;
        useChatStore.getState().applyReactionChange(
          {
            messageId: row.message_id as string,
            userId: row.user_id as string,
            emoji: (row.emoji as string) ?? "",
          },
          payload.eventType === "DELETE",
        );
      },
    )
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "poll_votes" },
      (payload) => {
        const row = (payload.eventType === "DELETE" ? payload.old : payload.new) as
          | Record<string, unknown>
          | null;
        if (!row?.message_id) return;
        useChatStore.getState().applyVoteChange(
          {
            messageId: row.message_id as string,
            userId: row.user_id as string,
            optionId: (row.option_id as string) ?? "",
          },
          payload.eventType === "DELETE",
        );
      },
    )
    .on(
      "postgres_changes",
      { event: "INSERT", schema: "public", table: "message_item_links" },
      (payload) => {
        const row = payload.new as Record<string, unknown>;
        const link: ChatItemLink = {
          itemId: row.item_id as string,
          kind: ((row.kind as string) ?? "reference") as ChatItemLink["kind"],
        };
        useChatStore.getState().linkToMessage(row.message_id as string, link);
      },
    )
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "conversations" },
      (payload) => {
        // last_message_at podbija applyIncomingMessage; refresh tylko przy
        // realnych zmianach (nazwa/archiwizacja/nowa rozmowa).
        if (payload.eventType === "UPDATE") {
          const row = payload.new as Record<string, unknown>;
          const entry = useChatStore
            .getState()
            .overview.find((c) => c.id === (row.id as string));
          if (
            entry &&
            entry.name === ((row.name as string | null) ?? null) &&
            !row.archived_at
          ) {
            return;
          }
        }
        scheduleOverviewRefresh();
      },
    )
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "conversation_members" },
      (payload) => {
        const row = (payload.new ?? payload.old) as Record<string, unknown> | null;
        if (row && (row.user_id as string) === currentUserId) {
          scheduleOverviewRefresh();
        }
      },
    )
    .subscribe();
}

// ---------------------------------------------------------------------------
// Obecność online (heartbeat co 2 min przy widocznej karcie; online = < 5 min)
// ---------------------------------------------------------------------------

const PRESENCE_INTERVAL_MS = 120_000;
let presenceTimer: ReturnType<typeof setInterval> | null = null;

async function presenceBeat() {
  if (!currentUserId || !api.chatAvailable() || !documentVisible()) return;
  await api.updateMyPresence(currentUserId);
  // Przy okazji odśwież profile — zielone kropki innych osób.
  const profiles = await api.fetchProfiles();
  useChatStore.getState().setProfiles(profiles);
}

function startPresence() {
  if (presenceTimer) clearInterval(presenceTimer);
  presenceTimer = setInterval(() => void presenceBeat(), PRESENCE_INTERVAL_MS);
  void presenceBeat();
}

function stopPresence() {
  if (presenceTimer) clearInterval(presenceTimer);
  presenceTimer = null;
}

// ---------------------------------------------------------------------------
// Bootstrap
// ---------------------------------------------------------------------------

async function handleChatUser(userId: string | null) {
  teardownRealtime();
  stopPresence();
  currentUserId = userId;
  await switchChatPersistUser(userId);
  if (!userId || !api.chatAvailable()) return;
  await refreshChat();
  setupRealtime(userId);
  startPresence();
  void flushOutbox();
}

export function initChat() {
  if (booted) return;
  booted = true;
  if (!api.chatAvailable()) return;

  // Punkt styku z resztą aplikacji: authUserId w głównym store.
  useStore.subscribe((state) => {
    if (state.authUserId !== currentUserId) {
      void handleChatUser(state.authUserId);
    }
  });
  const initial = useStore.getState().authUserId;
  if (initial) void handleChatUser(initial);

  if (typeof window !== "undefined") {
    window.addEventListener("online", () => {
      void flushOutbox();
      scheduleOverviewRefresh(300);
    });
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") {
        void flushOutbox();
        scheduleOverviewRefresh(300);
        void presenceBeat();
      }
    });
  }

  // Deep-linki (#/czat/..., #/wpis/...).
  onRouteChange((route) => {
    if (route.view === "conversation") {
      useChatStore.getState().setPanelMode("chat");
      void openConversation(route.conversationId);
      if (route.threadRootId) void openThread(route.threadRootId);
    } else if (route.view === "chat") {
      useChatStore.getState().setPanelMode("chat");
      useChatStore.getState().setActiveConversation(null);
    } else if (route.view === "item") {
      useStore.getState().setEditing(route.itemId);
    }
  });
}
