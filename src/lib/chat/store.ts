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
  /** Desktop: tryb prawego panelu (hub otwiera detal). */
  panelMode: "todo" | "conversation" | "decision" | "note" | "media";
  /** Desktop: aktywna zakładka hubu pod kalendarzem. */
  hubTab:
    | "today"
    | "chat"
    | "threads"
    | "decisions"
    | "notes"
    | "media"
    | "mentions"
    | "search"
    | "links";
  /** Hub zajmuje więcej wysokości (kalendarz się kurczy). */
  hubExpanded: boolean;
  /** Hub: zawężaj listy do aktywnej grupy z GroupRail. */
  hubMatchGroup: boolean;
  /** Ukryte zakładki hubu (widoczność per użytkownik; filtr grupy dodatkowo zawęża treść). */
  hubHiddenTabs: Array<
    | "today"
    | "chat"
    | "threads"
    | "decisions"
    | "notes"
    | "media"
    | "mentions"
    | "search"
    | "links"
  >;
  /** Własne foldery rozmów w zakładce Czat. */
  hubChatFolders: { id: string; name: string; conversationIds: string[] }[];
  /** Zwińnięte sekcje listy czatu (pinned, frequent, more, channels, folder:id). */
  hubCollapsedSections: Record<string, boolean>;
  /** Bump po zapisie/usunięciu decyzji/notatki — odświeża listy hubu. */
  registryEpoch: number;
  /** Rozmowa, której media pokazać w prawym panelu. */
  mediaConversationId: string | null;
  /** Aktywna decyzja/notatka w prawym panelu. */
  registryFocus: {
    kind: "decision" | "note";
    id: string;
    conversationId: string;
    messageId: string | null;
    body: string;
    createdBy: string;
    at: string;
  } | null;

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
  setPanelMode: (mode: ChatState["panelMode"]) => void;
  setHubTab: (tab: ChatState["hubTab"]) => void;
  setHubExpanded: (on: boolean) => void;
  toggleHubExpanded: () => void;
  setHubMatchGroup: (on: boolean) => void;
  toggleHubTabHidden: (tab: ChatState["hubTab"]) => void;
  setMediaConversationId: (id: string | null) => void;
  bumpRegistryEpoch: () => void;
  setRegistryFocus: (focus: ChatState["registryFocus"]) => void;
  addHubChatFolder: (name: string) => string;
  renameHubChatFolder: (id: string, name: string) => void;
  removeHubChatFolder: (id: string) => void;
  addConversationToHubFolder: (folderId: string, conversationId: string) => void;
  removeConversationFromHubFolder: (folderId: string, conversationId: string) => void;
  toggleHubSectionCollapsed: (sectionKey: string) => void;
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
  // Odpowiedzi w wątku: zawsze utrzymuj cache wątku (nawet gdy dopiero
  // otwieramy widok / fetch jeszcze nie wrócił) — inaczej optimistic send
  // znika z UI.
  if (msg.threadRootId) {
    const thread = s.threadByRoot[msg.threadRootId] ?? [];
    out.threadByRoot = {
      ...s.threadByRoot,
      [msg.threadRootId]: upsertMessageInList(thread, msg),
    };
  } else if (s.threadByRoot[msg.id]) {
    out.threadByRoot = {
      ...s.threadByRoot,
      [msg.id]: upsertMessageInList(s.threadByRoot[msg.id], msg),
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
      hubTab: "chat",
      hubExpanded: false,
      hubMatchGroup: false,
      hubHiddenTabs: [],
      hubChatFolders: [],
      hubCollapsedSections: {},
      registryEpoch: 0,
      mediaConversationId: null,
      registryFocus: null,
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
        set((s) => ({
          activeConversationId: id,
          // Przy tej samej rozmowie nie zamykaj wątku (wyścig z openThread).
          activeThreadRootId:
            id !== null && s.activeConversationId === id ? s.activeThreadRootId : null,
          focusFeed: id !== null && s.activeConversationId === id ? s.focusFeed : null,
        })),

      setActiveThread: (rootId) => set({ activeThreadRootId: rootId }),

      markReadLocal: (conversationId, atIso) =>
        set((s) => ({
          overview: markOverviewRead(s.overview, conversationId, atIso),
        })),

      setPanelMode: (mode) =>
        set({
          panelMode: mode,
          ...(mode === "todo"
            ? { registryFocus: null, mediaConversationId: null }
            : mode !== "media"
              ? { mediaConversationId: null }
              : {}),
        }),

      setHubTab: (tab) => set({ hubTab: tab }),

      setHubExpanded: (on) => set({ hubExpanded: on }),

      toggleHubExpanded: () => set((s) => ({ hubExpanded: !s.hubExpanded })),

      setHubMatchGroup: (on) => set({ hubMatchGroup: on }),

      toggleHubTabHidden: (tab) =>
        set((s) => {
          const isHidden = s.hubHiddenTabs.includes(tab);
          if (!isHidden) {
            // Zostaw przynajmniej jedną widoczną zakładkę.
            const totalTabs = 9;
            if (totalTabs - s.hubHiddenTabs.length <= 1) return {};
          }
          const hidden = isHidden
            ? s.hubHiddenTabs.filter((t) => t !== tab)
            : [...s.hubHiddenTabs, tab];
          return { hubHiddenTabs: hidden };
        }),

      setMediaConversationId: (id) => set({ mediaConversationId: id }),

      bumpRegistryEpoch: () => set((s) => ({ registryEpoch: s.registryEpoch + 1 })),

      setRegistryFocus: (focus) => set({ registryFocus: focus }),

      addHubChatFolder: (name) => {
        const id =
          typeof crypto !== "undefined" && crypto.randomUUID
            ? crypto.randomUUID()
            : `folder-${Date.now()}`;
        const trimmed = name.trim() || "Folder";
        set((s) => ({
          hubChatFolders: [
            ...s.hubChatFolders,
            { id, name: trimmed, conversationIds: [] },
          ],
        }));
        return id;
      },

      renameHubChatFolder: (id, name) =>
        set((s) => ({
          hubChatFolders: s.hubChatFolders.map((f) =>
            f.id === id ? { ...f, name: name.trim() || f.name } : f,
          ),
        })),

      removeHubChatFolder: (id) =>
        set((s) => ({
          hubChatFolders: s.hubChatFolders.filter((f) => f.id !== id),
        })),

      addConversationToHubFolder: (folderId, conversationId) =>
        set((s) => ({
          hubChatFolders: s.hubChatFolders.map((f) => {
            if (f.id !== folderId) return f;
            if (f.conversationIds.includes(conversationId)) return f;
            return { ...f, conversationIds: [...f.conversationIds, conversationId] };
          }),
        })),

      removeConversationFromHubFolder: (folderId, conversationId) =>
        set((s) => ({
          hubChatFolders: s.hubChatFolders.map((f) =>
            f.id !== folderId
              ? f
              : {
                  ...f,
                  conversationIds: f.conversationIds.filter((cid) => cid !== conversationId),
                },
          ),
        })),

      toggleHubSectionCollapsed: (sectionKey) =>
        set((s) => ({
          hubCollapsedSections: {
            ...s.hubCollapsedSections,
            [sectionKey]: !s.hubCollapsedSections[sectionKey],
          },
        })),

      reset: () =>
        set({
          userId: null,
          panelMode: "todo",
          hubTab: "chat",
          hubExpanded: false,
          hubMatchGroup: false,
          hubHiddenTabs: [],
          hubChatFolders: [],
          hubCollapsedSections: {},
          registryEpoch: 0,
          mediaConversationId: null,
          registryFocus: null,
          ...emptyState(),
        }),
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
        panelMode: s.panelMode === "media" ? "todo" : s.panelMode,
        hubTab: s.hubTab,
        hubExpanded: s.hubExpanded,
        hubMatchGroup: s.hubMatchGroup,
        hubHiddenTabs: s.hubHiddenTabs,
        hubChatFolders: s.hubChatFolders,
        hubCollapsedSections: s.hubCollapsedSections,
      }),
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Record<string, unknown>;
        let panelMode = (p.panelMode as string | undefined) ?? current.panelMode;
        // Migracja ze starego "chat".
        if (panelMode === "chat") panelMode = "conversation";
        if (
          panelMode !== "todo" &&
          panelMode !== "conversation" &&
          panelMode !== "decision" &&
          panelMode !== "note" &&
          panelMode !== "media"
        ) {
          panelMode = "todo";
        }
        const hubTabRaw = p.hubTab as string | undefined;
        const hubTabs = [
          "today",
          "chat",
          "threads",
          "decisions",
          "notes",
          "media",
          "mentions",
          "search",
          "links",
        ] as const;
        const hubTab = hubTabs.includes(hubTabRaw as (typeof hubTabs)[number])
          ? (hubTabRaw as ChatState["hubTab"])
          : current.hubTab;
        const foldersRaw = p.hubChatFolders;
        const hubChatFolders = Array.isArray(foldersRaw)
          ? (foldersRaw as ChatState["hubChatFolders"]).filter(
              (f) =>
                f &&
                typeof f.id === "string" &&
                typeof f.name === "string" &&
                Array.isArray(f.conversationIds),
            )
          : current.hubChatFolders;
        const collapsedRaw = p.hubCollapsedSections;
        const hubCollapsedSections =
          collapsedRaw && typeof collapsedRaw === "object" && !Array.isArray(collapsedRaw)
            ? (collapsedRaw as Record<string, boolean>)
            : current.hubCollapsedSections;
        const hiddenRaw = p.hubHiddenTabs;
        const hubHiddenTabs = Array.isArray(hiddenRaw)
          ? (hiddenRaw as ChatState["hubHiddenTabs"]).filter((t) =>
              hubTabs.includes(t as (typeof hubTabs)[number]),
            )
          : current.hubHiddenTabs;
        return {
          ...current,
          ...(p as Partial<ChatState>),
          panelMode: panelMode as ChatState["panelMode"],
          hubTab,
          hubExpanded: Boolean(p.hubExpanded ?? current.hubExpanded),
          hubMatchGroup: Boolean(p.hubMatchGroup ?? current.hubMatchGroup),
          hubHiddenTabs,
          hubChatFolders,
          hubCollapsedSections,
          registryFocus: null,
          mediaConversationId: null,
          registryEpoch: 0,
        };
      },
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
