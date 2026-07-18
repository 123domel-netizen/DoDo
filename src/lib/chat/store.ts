import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { idbStorage } from "@/lib/idbStorage";
import {
  applyFocusIncoming,
  applyMessageToOverview,
  markOverviewRead,
  mergeMessages,
  reconcilePinnedList,
  trimList,
  upsertMessageInList,
} from "@/lib/chat/feed";
import type {
  ChatAttachment,
  ChatItemLink,
  ChatMessage,
  ChatOverviewEntry,
  ChatProfile,
  ChatReaction,
  FocusFeed,
  OutboxEntry,
  PollVote,
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
  /** Przypięte wątki per rozmowa (porządek: najnowsze przypięcie pierwsze). */
  pinnedByConv: Record<string, ChatMessage[]>;
  /** Okno kontekstowe wokół kotwicy (skok do starej wiadomości). */
  focusFeed: FocusFeed | null;
  outbox: OutboxEntry[];
  activeConversationId: string | null;
  activeThreadRootId: string | null;
  /** Wiadomość do podświetlenia po skoku (cytat / wynik wyszukiwania). */
  flashMessageId: string | null;
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
  setPinnedMessages: (conversationId: string, messages: ChatMessage[]) => void;
  setFocusFeed: (feed: FocusFeed | null) => void;
  prependFocusMessages: (messages: ChatMessage[], hasOlder: boolean) => void;
  appendFocusMessages: (messages: ChatMessage[], hasNewer: boolean) => void;
  enqueueOutbox: (entry: OutboxEntry) => void;
  updateOutbox: (messageId: string, patch: Partial<OutboxEntry>) => void;
  removeFromOutbox: (messageId: string) => void;
  markMessageState: (msg: ChatMessage) => void;
  attachToMessage: (att: ChatAttachment) => void;
  linkToMessage: (messageId: string, link: ChatItemLink) => void;
  applyReactionChange: (reaction: ChatReaction, removed: boolean) => void;
  applyVoteChange: (vote: PollVote, removed: boolean) => void;
  patchOverviewEntry: (
    conversationId: string,
    patch: Partial<ChatOverviewEntry>,
  ) => void;
  setFlashMessage: (id: string | null) => void;
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
    pinnedByConv: {} as Record<string, ChatMessage[]>,
    focusFeed: null as FocusFeed | null,
    outbox: [] as OutboxEntry[],
    activeConversationId: null as string | null,
    activeThreadRootId: null as string | null,
    flashMessageId: null as string | null,
  };
}

type CacheSlices = Pick<
  ChatState,
  "messagesByConv" | "threadByRoot" | "pinnedByConv" | "focusFeed"
>;

/** Zastosuj zmianę do wiadomości o danym id wszędzie w cache (feed + wątki + przypięte + okno kontekstowe). */
function patchMessageById(
  s: CacheSlices,
  messageId: string,
  update: (msg: ChatMessage) => ChatMessage,
): Partial<CacheSlices> {
  const out: Partial<CacheSlices> = {};
  for (const [convId, list] of Object.entries(s.messagesByConv)) {
    const idx = list.findIndex((m) => m.id === messageId);
    if (idx < 0) continue;
    const next = [...list];
    next[idx] = update(next[idx]);
    out.messagesByConv = { ...s.messagesByConv, [convId]: next };
    break;
  }
  for (const [rootId, list] of Object.entries(s.threadByRoot)) {
    const idx = list.findIndex((m) => m.id === messageId);
    if (idx < 0) continue;
    const next = [...list];
    next[idx] = update(next[idx]);
    out.threadByRoot = {
      ...(out.threadByRoot ?? s.threadByRoot),
      [rootId]: next,
    };
  }
  for (const [convId, list] of Object.entries(s.pinnedByConv)) {
    const idx = list.findIndex((m) => m.id === messageId);
    if (idx < 0) continue;
    const next = [...list];
    next[idx] = update(next[idx]);
    out.pinnedByConv = { ...s.pinnedByConv, [convId]: next };
    break;
  }
  if (s.focusFeed) {
    const idx = s.focusFeed.messages.findIndex((m) => m.id === messageId);
    if (idx >= 0) {
      const next = [...s.focusFeed.messages];
      next[idx] = update(next[idx]);
      out.focusFeed = { ...s.focusFeed, messages: next };
    }
  }
  return out;
}

/** Przypięte wątki rozmowy po zmianie stanu wiadomości (pin/unpin/delete). */
function reconcilePinned(
  s: Pick<ChatState, "pinnedByConv">,
  msg: ChatMessage,
): Partial<Pick<ChatState, "pinnedByConv">> {
  const next = reconcilePinnedList(s.pinnedByConv[msg.conversationId], msg);
  return next
    ? { pinnedByConv: { ...s.pinnedByConv, [msg.conversationId]: next } }
    : {};
}

/** Zaktualizuj wiadomość wszędzie tam, gdzie jest w cache (feed + wątki + okno). */
function patchEverywhere(s: CacheSlices, msg: ChatMessage): Partial<CacheSlices> {
  const out: Partial<CacheSlices> = {};
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
  if (
    s.focusFeed &&
    s.focusFeed.conversationId === msg.conversationId &&
    msg.threadRootId === null &&
    s.focusFeed.messages.some((m) => m.id === msg.id)
  ) {
    out.focusFeed = {
      ...s.focusFeed,
      messages: upsertMessageInList(s.focusFeed.messages, msg),
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

        const focusNext = applyFocusIncoming(patches.focusFeed ?? s.focusFeed, msg);
        const focusPatch = focusNext ? { focusFeed: focusNext } : {};

        set({ overview, replyCounts, ...patches, ...focusPatch });
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

      setPinnedMessages: (conversationId, messages) =>
        set((s) => ({
          pinnedByConv: { ...s.pinnedByConv, [conversationId]: messages },
        })),

      setFocusFeed: (feed) => set({ focusFeed: feed }),

      prependFocusMessages: (messages, hasOlder) =>
        set((s) =>
          s.focusFeed
            ? {
                focusFeed: {
                  ...s.focusFeed,
                  messages: mergeMessages(s.focusFeed.messages, messages),
                  hasOlder,
                },
              }
            : {},
        ),

      appendFocusMessages: (messages, hasNewer) =>
        set((s) =>
          s.focusFeed
            ? {
                focusFeed: {
                  ...s.focusFeed,
                  messages: mergeMessages(s.focusFeed.messages, messages),
                  hasNewer,
                },
              }
            : {},
        ),

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

      markMessageState: (msg) =>
        set((s) => ({ ...patchEverywhere(s, msg), ...reconcilePinned(s, msg) })),

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

      applyReactionChange: (reaction, removed) =>
        set((s) =>
          patchMessageById(s, reaction.messageId, (msg) => {
            const existing = msg.reactions ?? [];
            const without = existing.filter(
              (r) => !(r.userId === reaction.userId && r.emoji === reaction.emoji),
            );
            return {
              ...msg,
              reactions: removed ? without : [...without, reaction],
            };
          }),
        ),

      applyVoteChange: (vote, removed) =>
        set((s) =>
          patchMessageById(s, vote.messageId, (msg) => {
            const without = (msg.votes ?? []).filter((v) => v.userId !== vote.userId);
            return { ...msg, votes: removed ? without : [...without, vote] };
          }),
        ),

      patchOverviewEntry: (conversationId, patch) =>
        set((s) => ({
          overview: s.overview.map((c) =>
            c.id === conversationId ? { ...c, ...patch } : c,
          ),
        })),

      setFlashMessage: (id) => set({ flashMessageId: id }),

      setActiveConversation: (id) =>
        set({ activeConversationId: id, activeThreadRootId: null, focusFeed: null }),

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
