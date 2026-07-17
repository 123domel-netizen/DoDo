import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { idbStorage } from "@/lib/idbStorage";
import {
  applyMessageToOverview,
  markOverviewRead,
  mergeMessages,
  trimList,
  upsertMessageInList,
} from "@/lib/chat/feed";
import type {
  ChatAttachment,
  ChatItemLink,
  ChatMessage,
  ChatOverviewEntry,
  ChatProfile,
  OutboxEntry,
} from "@/lib/chat/types";

/** Cache: ogon rozmowy czytelny offline; twardy limit na rozmowę. */
const CACHE_PER_CONVERSATION = 50;

interface ChatState {
  hydrated: boolean;
  userId: string | null;
  overview: ChatOverviewEntry[];
  profiles: Record<string, ChatProfile>;
  messagesByConv: Record<string, ChatMessage[]>;
  hasMoreByConv: Record<string, boolean>;
  replyCounts: Record<string, number>;
  threadByRoot: Record<string, ChatMessage[]>;
  outbox: OutboxEntry[];
  activeConversationId: string | null;
  activeThreadRootId: string | null;
  /** Desktop: tryb prawego panelu. */
  panelMode: "todo" | "chat";

  setUser: (userId: string | null) => void;
  setOverview: (overview: ChatOverviewEntry[]) => void;
  setProfiles: (profiles: Record<string, ChatProfile>) => void;
  upsertConvMessages: (
    conversationId: string,
    messages: ChatMessage[],
    hasMore?: boolean,
  ) => void;
  applyIncomingMessage: (msg: ChatMessage, documentVisible: boolean) => boolean;
  setThreadMessages: (rootId: string, messages: ChatMessage[]) => void;
  setReplyCounts: (counts: Record<string, number>) => void;
  enqueueOutbox: (entry: OutboxEntry) => void;
  updateOutbox: (messageId: string, patch: Partial<OutboxEntry>) => void;
  removeFromOutbox: (messageId: string) => void;
  markMessageState: (msg: ChatMessage) => void;
  attachToMessage: (att: ChatAttachment) => void;
  linkToMessage: (messageId: string, link: ChatItemLink) => void;
  setActiveConversation: (id: string | null) => void;
  setActiveThread: (rootId: string | null) => void;
  markReadLocal: (conversationId: string, atIso: string) => void;
  setPanelMode: (mode: "todo" | "chat") => void;
  reset: () => void;
}

function emptyState() {
  return {
    overview: [] as ChatOverviewEntry[],
    profiles: {} as Record<string, ChatProfile>,
    messagesByConv: {} as Record<string, ChatMessage[]>,
    hasMoreByConv: {} as Record<string, boolean>,
    replyCounts: {} as Record<string, number>,
    threadByRoot: {} as Record<string, ChatMessage[]>,
    outbox: [] as OutboxEntry[],
    activeConversationId: null as string | null,
    activeThreadRootId: null as string | null,
  };
}

/** Zaktualizuj wiadomość wszędzie tam, gdzie jest w cache (feed + wątki). */
function patchEverywhere(
  s: Pick<ChatState, "messagesByConv" | "threadByRoot">,
  msg: ChatMessage,
): Partial<Pick<ChatState, "messagesByConv" | "threadByRoot">> {
  const out: Partial<Pick<ChatState, "messagesByConv" | "threadByRoot">> = {};
  const feed = s.messagesByConv[msg.conversationId];
  if (feed && msg.threadRootId === null) {
    out.messagesByConv = {
      ...s.messagesByConv,
      [msg.conversationId]: upsertMessageInList(feed, msg),
    };
  }
  const rootId = msg.threadRootId ?? msg.id;
  const thread = s.threadByRoot[rootId];
  if (thread) {
    out.threadByRoot = {
      ...s.threadByRoot,
      [rootId]: upsertMessageInList(thread, msg),
    };
  }
  return out;
}

export const useChatStore = create<ChatState>()(
  persist(
    (set, get) => ({
      hydrated: false,
      userId: null,
      panelMode: "todo",
      ...emptyState(),

      setUser: (userId) => set({ userId }),

      setOverview: (overview) => set({ overview }),

      setProfiles: (profiles) => set({ profiles }),

      upsertConvMessages: (conversationId, messages, hasMore) =>
        set((s) => ({
          messagesByConv: {
            ...s.messagesByConv,
            [conversationId]: mergeMessages(
              s.messagesByConv[conversationId] ?? [],
              messages,
            ),
          },
          ...(hasMore === undefined
            ? {}
            : { hasMoreByConv: { ...s.hasMoreByConv, [conversationId]: hasMore } }),
        })),

      /** Zwraca false, gdy rozmowa nieznana (→ potrzebny refresh overview). */
      applyIncomingMessage: (msg, documentVisible) => {
        const s = get();
        const { overview, known } = applyMessageToOverview(s.overview, msg, {
          myUserId: s.userId,
          activeConversationId: s.activeConversationId,
          documentVisible,
        });

        const patches = patchEverywhere(s, msg);
        const replyCounts =
          msg.threadRootId && !msg.deletedAt
            ? {
                ...s.replyCounts,
                [msg.threadRootId]:
                  (s.threadByRoot[msg.threadRootId]?.some((m) => m.id === msg.id)
                    ? s.replyCounts[msg.threadRootId] ?? 0
                    : (s.replyCounts[msg.threadRootId] ?? 0) + 1),
              }
            : s.replyCounts;

        set({ overview, replyCounts, ...patches });
        return known;
      },

      setThreadMessages: (rootId, messages) =>
        set((s) => ({
          threadByRoot: { ...s.threadByRoot, [rootId]: messages },
          replyCounts: {
            ...s.replyCounts,
            [rootId]: Math.max(0, messages.filter((m) => m.id !== rootId && !m.deletedAt).length),
          },
        })),

      setReplyCounts: (counts) =>
        set((s) => ({ replyCounts: { ...s.replyCounts, ...counts } })),

      enqueueOutbox: (entry) =>
        set((s) => {
          const patches = patchEverywhere(s, entry.message);
          const feedPatch =
            entry.message.threadRootId === null &&
            !s.messagesByConv[entry.message.conversationId]
              ? {
                  messagesByConv: {
                    ...s.messagesByConv,
                    [entry.message.conversationId]: [entry.message],
                  },
                }
              : {};
          return {
            outbox: [...s.outbox.filter((e) => e.message.id !== entry.message.id), entry],
            ...patches,
            ...feedPatch,
          };
        }),

      updateOutbox: (messageId, patch) =>
        set((s) => ({
          outbox: s.outbox.map((e) =>
            e.message.id === messageId ? { ...e, ...patch } : e,
          ),
        })),

      removeFromOutbox: (messageId) =>
        set((s) => ({
          outbox: s.outbox.filter((e) => e.message.id !== messageId),
        })),

      markMessageState: (msg) => set((s) => patchEverywhere(s, msg)),

      attachToMessage: (att) =>
        set((s) => {
          for (const [convId, list] of Object.entries(s.messagesByConv)) {
            const idx = list.findIndex((m) => m.id === att.messageId);
            if (idx < 0) continue;
            const existing = list[idx].attachments ?? [];
            if (existing.some((a) => a.id === att.id)) return {};
            const next = [...list];
            next[idx] = { ...next[idx], attachments: [...existing, att] };
            return { messagesByConv: { ...s.messagesByConv, [convId]: next } };
          }
          return {};
        }),

      linkToMessage: (messageId, link) =>
        set((s) => {
          for (const [convId, list] of Object.entries(s.messagesByConv)) {
            const idx = list.findIndex((m) => m.id === messageId);
            if (idx < 0) continue;
            const existing = list[idx].links ?? [];
            if (existing.some((l) => l.itemId === link.itemId)) return {};
            const next = [...list];
            next[idx] = { ...next[idx], links: [...existing, link] };
            return { messagesByConv: { ...s.messagesByConv, [convId]: next } };
          }
          return {};
        }),

      setActiveConversation: (id) =>
        set({ activeConversationId: id, activeThreadRootId: null }),

      setActiveThread: (rootId) => set({ activeThreadRootId: rootId }),

      markReadLocal: (conversationId, atIso) =>
        set((s) => ({
          overview: markOverviewRead(s.overview, conversationId, atIso),
        })),

      setPanelMode: (mode) => set({ panelMode: mode }),

      reset: () => set({ userId: null, ...emptyState() }),
    }),
    {
      name: "kalendarz-todo-chat-v1-local",
      storage: createJSONStorage(() => idbStorage),
      partialize: (s) => ({
        userId: s.userId,
        overview: s.overview,
        profiles: s.profiles,
        // Persystujemy przycięty ogon — cache offline, nie pełna historia.
        messagesByConv: Object.fromEntries(
          Object.entries(s.messagesByConv).map(([k, v]) => [
            k,
            trimList(
              v.filter((m) => !m.sendState || s.outbox.some((e) => e.message.id === m.id)),
              CACHE_PER_CONVERSATION,
            ),
          ]),
        ),
        replyCounts: s.replyCounts,
        outbox: s.outbox,
        panelMode: s.panelMode,
      }),
      onRehydrateStorage: () => () => {
        useChatStore.setState({ hydrated: true });
      },
    },
  ),
);

/** Przełączenie persystencji per użytkownik (wzorzec z state/store.ts). */
export async function switchChatPersistUser(userId: string | null) {
  const name = userId
    ? `kalendarz-todo-chat-v1-${userId}`
    : "kalendarz-todo-chat-v1-local";
  useChatStore.persist.setOptions({ name });
  useChatStore.setState({ ...emptyState(), userId, hydrated: false });
  await useChatStore.persist.rehydrate();
  useChatStore.setState({ hydrated: true, userId });
}
