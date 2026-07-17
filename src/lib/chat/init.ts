import type { RealtimeChannel } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";
import { uid } from "@/lib/factory";
import { useStore } from "@/state/store";
import { onRouteChange } from "@/lib/navigation";
import * as api from "@/lib/chat/api";
import { uploadAttachmentsForMessage } from "@/lib/chat/upload";
import { useChatStore, switchChatPersistUser } from "@/lib/chat/store";
import type { ChatItemLink, ChatMessage } from "@/lib/chat/types";

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
  kind?: "text" | "system";
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
    threadRootId: opts.threadRootId ?? null,
    replyToMessageId: opts.replyToMessageId ?? null,
    createdAt: new Date().toISOString(),
    editedAt: null,
    deletedAt: null,
    links: [],
    attachments: [],
    sendState: "pending",
  };
}

export function sendChatMessage(opts: SendOptions): ChatMessage | null {
  const st = useChatStore.getState();
  if (!st.userId) return null;
  const body = opts.body.trim();
  if (!body) return null;

  const msg = buildOutgoingMessage({ ...opts, body }, st.userId);
  st.enqueueOutbox({ message: msg, attempts: 0 });
  st.applyIncomingMessage(msg, true);
  void flushOutbox();
  return msg;
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
  return errors.length ? { error: errors.join("\n") } : {};
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

export async function editChatMessage(msg: ChatMessage, body: string) {
  const st = useChatStore.getState();
  st.markMessageState({ ...msg, body, editedAt: new Date().toISOString() });
  const { error } = await api.updateMessageBody(msg.id, body);
  if (error) console.warn("[chat] edit failed:", error);
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
// Bootstrap
// ---------------------------------------------------------------------------

async function handleChatUser(userId: string | null) {
  teardownRealtime();
  currentUserId = userId;
  await switchChatPersistUser(userId);
  if (!userId || !api.chatAvailable()) return;
  await refreshChat();
  setupRealtime(userId);
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
