import { create } from "zustand";
import { uid } from "@/lib/factory";
import * as api from "@/lib/boards/api";
import type { TopicPatch } from "@/lib/boards/api";
import {
  addBoardConversationRef,
  clearBoardConversationRefs,
} from "@/lib/chat/boardBridge";
import type { ChatMessage } from "@/lib/chat/types";
import {
  normalizeBoardName,
  normalizeTopicCode,
  normalizeTopicTitle,
} from "@/lib/boards/sections";
import type {
  Board,
  BoardTopic,
  LinkedItemType,
} from "@/lib/boards/types";

/**
 * Stan modułu Tablice (tylko w pamięci — źródłem prawdy jest Supabase).
 * Dane są zawsze przypisane do (orgId, userId): zmiana workspace'u czyści stan,
 * a spóźnione odpowiedzi ze starego zakresu są odrzucane (`generation`).
 */

type LoadStatus = "idle" | "loading" | "ready" | "error";

export interface BoardsState {
  orgId: string | null;
  userId: string | null;
  generation: number;

  boards: Board[];
  boardsStatus: LoadStatus;
  boardsError: string | null;

  topicsByBoard: Record<string, BoardTopic[]>;
  topicsStatus: Record<string, LoadStatus>;
  topicsError: Record<string, string>;

  activeBoardId: string | null;
  activeTopicId: string | null;

  /** Kiedy (ms, lokalnie) otworzyłem temat — gasi licznik zanim RPC odczytu wróci. */
  locallyReadAt: Record<string, number>;
  /** Krótki komunikat (np. „Temat otwarty ponownie”). */
  notice: string | null;

  setScope: (orgId: string | null, userId: string | null) => void;
  reset: () => void;
  loadBoards: () => Promise<void>;
  loadTopics: (boardId: string) => Promise<void>;
  selectBoard: (boardId: string | null) => void;
  selectTopic: (topicId: string | null) => void;
  setNotice: (notice: string | null) => void;

  createBoard: (input: { name: string; memberIds: string[] }) => Promise<{
    id?: string;
    error?: string;
  }>;
  renameBoard: (boardId: string, name: string) => Promise<{ error?: string }>;
  addMembers: (boardId: string, userIds: string[]) => Promise<{ error?: string }>;
  removeMember: (boardId: string, userId: string) => Promise<{ error?: string }>;
  archiveBoard: (boardId: string) => Promise<{ error?: string }>;

  addTopic: (boardId: string, rawTitle: string) => string | null;
  retryTopic: (topicId: string) => void;
  discardLocalTopic: (topicId: string) => void;
  updateTopic: (topicId: string, patch: TopicPatch) => Promise<{ error?: string }>;
  reorderTopics: (boardId: string, orderedIds: string[]) => Promise<{ error?: string }>;
  deleteTopic: (topicId: string) => Promise<{ error?: string }>;
  markTopicRead: (topicId: string) => void;
  linkItem: (input: {
    topicId: string;
    itemId: string;
    itemType: LinkedItemType;
  }) => Promise<{ error?: string }>;
  unlinkItem: (topicId: string, itemId: string) => Promise<{ error?: string }>;

  /** Komentarz z czatu (realtime) → podgląd, aktywność, unread (optymistycznie). */
  noteIncomingComment: (
    message: ChatMessage,
    ref: { boardId: string; topicId: string },
  ) => void;
  scheduleReload: (boardId?: string | null) => void;
}

const INITIAL = {
  orgId: null as string | null,
  userId: null as string | null,
  boards: [] as Board[],
  boardsStatus: "idle" as LoadStatus,
  boardsError: null as string | null,
  topicsByBoard: {} as Record<string, BoardTopic[]>,
  topicsStatus: {} as Record<string, LoadStatus>,
  topicsError: {} as Record<string, string>,
  activeBoardId: null as string | null,
  activeTopicId: null as string | null,
  locallyReadAt: {} as Record<string, number>,
  notice: null as string | null,
};

/** Tematy z trwającą lokalną zmianą — reload z serwera nie nadpisuje ich w trakcie. */
const inFlightTopics = new Map<string, number>();
/** Zapisy nowych tematów idą jeden po drugim (kolejność = kolejność wpisywania). */
let addQueue: Promise<unknown> = Promise.resolve();
let reloadTimer: ReturnType<typeof setTimeout> | null = null;
const reloadBoardIds = new Set<string>();
let reloadAllBoards = false;

function holdTopic(id: string) {
  inFlightTopics.set(id, (inFlightTopics.get(id) ?? 0) + 1);
}
function releaseTopic(id: string) {
  const n = (inFlightTopics.get(id) ?? 1) - 1;
  if (n <= 0) inFlightTopics.delete(id);
  else inFlightTopics.set(id, n);
}

export function resetBoardsRuntimeForTests() {
  inFlightTopics.clear();
  addQueue = Promise.resolve();
  if (reloadTimer) clearTimeout(reloadTimer);
  reloadTimer = null;
  reloadBoardIds.clear();
  reloadAllBoards = false;
}

/** Złącz odpowiedź serwera z lokalnymi tematami w trakcie zapisu / edycji. */
export function mergeTopics(local: BoardTopic[], server: BoardTopic[]): BoardTopic[] {
  const localById = new Map(local.map((t) => [t.id, t]));
  const serverIds = new Set(server.map((t) => t.id));
  const merged = server.map((t) =>
    inFlightTopics.has(t.id) ? (localById.get(t.id) ?? t) : t,
  );
  // Tematy jeszcze niezapisane / nieudane zostają na liście.
  for (const t of local) {
    if (t.sendState && !serverIds.has(t.id)) merged.push(t);
  }
  return merged;
}

export function applyTopicPatchLocal(topic: BoardTopic, patch: TopicPatch): BoardTopic {
  const next: BoardTopic = { ...topic };
  if (patch.title !== undefined) next.title = patch.title;
  if (patch.description !== undefined) next.description = patch.description;
  if (patch.code !== undefined) next.code = patch.code;
  if (patch.pinned_at !== undefined) next.pinnedAt = patch.pinned_at;
  if (patch.snoozed_until !== undefined) next.snoozedUntil = patch.snoozed_until;
  if (patch.closed_at !== undefined) next.closedAt = patch.closed_at;
  return next;
}

export const useBoardsStore = create<BoardsState>()((set, get) => {
  const replaceTopic = (topicId: string, fn: (t: BoardTopic) => BoardTopic) => {
    set((s) => {
      const next: Record<string, BoardTopic[]> = {};
      let changed = false;
      for (const [boardId, list] of Object.entries(s.topicsByBoard)) {
        if (!list.some((t) => t.id === topicId)) {
          next[boardId] = list;
          continue;
        }
        changed = true;
        next[boardId] = list.map((t) => (t.id === topicId ? fn(t) : t));
      }
      return changed ? { topicsByBoard: next } : {};
    });
  };

  const findTopic = (topicId: string): BoardTopic | undefined => {
    for (const list of Object.values(get().topicsByBoard)) {
      const hit = list.find((t) => t.id === topicId);
      if (hit) return hit;
    }
    return undefined;
  };

  const registerRefs = (topics: BoardTopic[]) => {
    for (const t of topics) {
      if (t.conversationId) {
        addBoardConversationRef(t.conversationId, { boardId: t.boardId, topicId: t.id });
      }
    }
  };

  const runAdd = async (topicId: string) => {
    const gen = get().generation;
    const topic = findTopic(topicId);
    if (!topic) return;
    const res = await api.createTopic({
      id: topic.id,
      boardId: topic.boardId,
      title: topic.title,
    });
    if (get().generation !== gen) return;
    if (res.error || !res.conversationId) {
      replaceTopic(topicId, (t) => ({
        ...t,
        sendState: "failed",
        sendError: res.error ?? "Nie udało się zapisać tematu.",
      }));
      return;
    }
    const conversationId = res.conversationId;
    addBoardConversationRef(conversationId, { boardId: topic.boardId, topicId: topic.id });
    replaceTopic(topicId, (t) => ({
      ...t,
      conversationId,
      sendState: undefined,
      sendError: undefined,
    }));
  };

  const enqueueAdd = (topicId: string) => {
    holdTopic(topicId);
    addQueue = addQueue
      .then(() => runAdd(topicId))
      .catch((e) => {
        console.warn("[boards] add topic failed:", e);
        replaceTopic(topicId, (t) => ({
          ...t,
          sendState: "failed",
          sendError: "Nie udało się zapisać tematu.",
        }));
      })
      .finally(() => releaseTopic(topicId));
  };

  return {
    ...INITIAL,
    generation: 0,

    setScope: (orgId, userId) => {
      const s = get();
      if (s.orgId === orgId && s.userId === userId) return;
      inFlightTopics.clear();
      clearBoardConversationRefs();
      // Pierwsze ustawienie zakresu (start aplikacji) zachowuje wybór z deep-linku.
      const keepSelection = s.orgId === null && s.userId === null;
      set({
        ...INITIAL,
        orgId,
        userId,
        generation: s.generation + 1,
        activeBoardId: keepSelection ? s.activeBoardId : null,
        activeTopicId: keepSelection ? s.activeTopicId : null,
      });
    },

    reset: () => {
      inFlightTopics.clear();
      clearBoardConversationRefs();
      set({ ...INITIAL, generation: get().generation + 1 });
    },

    loadBoards: async () => {
      const { orgId, userId, generation } = get();
      if (!orgId || !userId) return;
      if (get().boardsStatus === "idle") set({ boardsStatus: "loading" });
      const res = await api.fetchBoards(orgId);
      if (get().generation !== generation) return;
      if (res.error) {
        set({ boardsStatus: "error", boardsError: res.error });
        return;
      }
      set((s) => {
        const activeStillExists =
          s.activeBoardId && res.boards.some((b) => b.id === s.activeBoardId);
        return {
          boards: res.boards,
          boardsStatus: "ready",
          boardsError: null,
          activeBoardId: activeStillExists ? s.activeBoardId : null,
          activeTopicId: activeStillExists ? s.activeTopicId : null,
        };
      });
    },

    loadTopics: async (boardId) => {
      const { generation } = get();
      if (!get().topicsStatus[boardId]) {
        set((s) => ({ topicsStatus: { ...s.topicsStatus, [boardId]: "loading" } }));
      }
      const res = await api.fetchTopics(boardId);
      if (get().generation !== generation) return;
      if (res.error) {
        set((s) => ({
          topicsStatus: { ...s.topicsStatus, [boardId]: "error" },
          topicsError: { ...s.topicsError, [boardId]: res.error! },
        }));
        return;
      }
      registerRefs(res.topics);
      set((s) => ({
        topicsByBoard: {
          ...s.topicsByBoard,
          [boardId]: mergeTopics(s.topicsByBoard[boardId] ?? [], res.topics),
        },
        topicsStatus: { ...s.topicsStatus, [boardId]: "ready" },
        topicsError: { ...s.topicsError, [boardId]: "" },
      }));
    },

    selectBoard: (boardId) =>
      set((s) => (s.activeBoardId === boardId ? {} : { activeBoardId: boardId, activeTopicId: null })),

    selectTopic: (topicId) => set({ activeTopicId: topicId }),

    setNotice: (notice) => set({ notice }),

    createBoard: async ({ name, memberIds }) => {
      const { orgId, userId, generation } = get();
      const clean = normalizeBoardName(name);
      if (!orgId || !userId) return { error: "Brak aktywnej organizacji." };
      if (!clean) return { error: "Podaj nazwę tablicy." };
      const id = uid();
      const res = await api.createBoard({
        id,
        orgId,
        name: clean,
        memberIds: memberIds.filter((m) => m !== userId),
      });
      if (get().generation !== generation) return { error: "Zmieniono organizację." };
      if (res.error) return { error: res.error };
      await get().loadBoards();
      set({ activeBoardId: id, activeTopicId: null });
      return { id };
    },

    renameBoard: async (boardId, name) => {
      const clean = normalizeBoardName(name);
      if (!clean) return { error: "Podaj nazwę tablicy." };
      const prev = get().boards;
      set((s) => ({
        boards: s.boards.map((b) => (b.id === boardId ? { ...b, name: clean } : b)),
      }));
      const res = await api.renameBoard(boardId, clean);
      if (res.error) set({ boards: prev });
      return res;
    },

    addMembers: async (boardId, userIds) => {
      if (userIds.length === 0) return {};
      const res = await api.addBoardMembers(boardId, userIds);
      if (!res.error) await get().loadBoards();
      return res;
    },

    removeMember: async (boardId, userId) => {
      const res = await api.removeBoardMember(boardId, userId);
      if (res.error) return res;
      if (userId === get().userId) {
        // Opuściłem tablicę — znika z listy.
        set((s) => ({
          activeBoardId: s.activeBoardId === boardId ? null : s.activeBoardId,
          activeTopicId: s.activeBoardId === boardId ? null : s.activeTopicId,
        }));
      }
      await get().loadBoards();
      return res;
    },

    archiveBoard: async (boardId) => {
      const res = await api.setBoardArchived(boardId, true);
      if (res.error) return res;
      set((s) => ({
        activeBoardId: s.activeBoardId === boardId ? null : s.activeBoardId,
        activeTopicId: s.activeBoardId === boardId ? null : s.activeTopicId,
      }));
      await get().loadBoards();
      return res;
    },

    addTopic: (boardId, rawTitle) => {
      const { userId } = get();
      const title = normalizeTopicTitle(rawTitle);
      if (!userId || !title) return null;
      const now = new Date().toISOString();
      const existing = get().topicsByBoard[boardId] ?? [];
      const maxPos = existing.reduce((m, t) => Math.max(m, t.position), 0);
      const topic: BoardTopic = {
        id: uid(),
        boardId,
        title,
        description: "",
        code: null,
        position: maxPos + 1,
        createdBy: userId,
        pinnedAt: null,
        snoozedUntil: null,
        closedAt: null,
        closedBy: null,
        createdAt: now,
        updatedAt: now,
        conversationId: "",
        lastActivityAt: now,
        commentCount: 0,
        unreadCount: 0,
        lastComment: null,
        items: [],
        sendState: "pending",
      };
      set((s) => ({
        topicsByBoard: {
          ...s.topicsByBoard,
          // Nowe tematy na końcu listy (position); groupTopics sortuje po position.
          [boardId]: [...(s.topicsByBoard[boardId] ?? []), topic],
        },
      }));
      enqueueAdd(topic.id);
      return topic.id;
    },

    retryTopic: (topicId) => {
      const t = findTopic(topicId);
      if (!t || t.sendState !== "failed") return;
      replaceTopic(topicId, (x) => ({ ...x, sendState: "pending", sendError: undefined }));
      enqueueAdd(topicId);
    },

    discardLocalTopic: (topicId) => {
      const t = findTopic(topicId);
      if (!t || !t.sendState) return;
      set((s) => ({
        topicsByBoard: {
          ...s.topicsByBoard,
          [t.boardId]: (s.topicsByBoard[t.boardId] ?? []).filter((x) => x.id !== topicId),
        },
        activeTopicId: s.activeTopicId === topicId ? null : s.activeTopicId,
      }));
    },

    updateTopic: async (topicId, patch) => {
      const before = findTopic(topicId);
      if (!before || before.sendState) return { error: "Temat nie jest jeszcze zapisany." };
      if (patch.title !== undefined) {
        const clean = normalizeTopicTitle(patch.title);
        if (!clean) return { error: "Tytuł nie może być pusty." };
        patch = { ...patch, title: clean };
      }
      if (patch.code !== undefined) {
        patch = { ...patch, code: patch.code === null ? null : normalizeTopicCode(patch.code) };
      }
      holdTopic(topicId);
      replaceTopic(topicId, (t) => applyTopicPatchLocal(t, patch));
      const res = await api.updateTopic(topicId, patch);
      releaseTopic(topicId);
      if (res.error) {
        replaceTopic(topicId, () => before);
        return res;
      }
      get().scheduleReload(before.boardId);
      return {};
    },

    reorderTopics: async (boardId, orderedIds) => {
      const before = get().topicsByBoard[boardId] ?? [];
      if (before.length === 0) return {};
      if (orderedIds.length !== before.length) {
        return { error: "Nie udało się zmienić kolejności tematów." };
      }
      const byId = new Map(before.map((t) => [t.id, t]));
      if (orderedIds.some((id) => !byId.has(id))) {
        return { error: "Nie udało się zmienić kolejności tematów." };
      }
      const next = orderedIds.map((id, i) => {
        const t = byId.get(id)!;
        return t.position === i + 1 ? t : { ...t, position: i + 1 };
      });
      for (const t of next) holdTopic(t.id);
      set((s) => ({
        topicsByBoard: { ...s.topicsByBoard, [boardId]: next },
      }));
      const res = await api.reorderTopics(boardId, orderedIds);
      for (const t of next) releaseTopic(t.id);
      if (res.error) {
        set((s) => ({
          topicsByBoard: { ...s.topicsByBoard, [boardId]: before },
        }));
        return res;
      }
      get().scheduleReload(boardId);
      return {};
    },

    deleteTopic: async (topicId) => {
      const t = findTopic(topicId);
      if (!t) return {};
      if (t.sendState) {
        get().discardLocalTopic(topicId);
        return {};
      }
      const res = await api.deleteTopic(topicId);
      if (res.error) return res;
      set((s) => ({
        topicsByBoard: {
          ...s.topicsByBoard,
          [t.boardId]: (s.topicsByBoard[t.boardId] ?? []).filter((x) => x.id !== topicId),
        },
        activeTopicId: s.activeTopicId === topicId ? null : s.activeTopicId,
      }));
      return {};
    },

    markTopicRead: (topicId) => {
      const t = findTopic(topicId);
      if (!t) return;
      const cleared = t.unreadCount;
      set((s) => ({
        locallyReadAt: { ...s.locallyReadAt, [topicId]: Date.now() },
        boards:
          cleared > 0
            ? s.boards.map((b) =>
                b.id === t.boardId
                  ? { ...b, unreadCount: Math.max(0, b.unreadCount - cleared) }
                  : b,
              )
            : s.boards,
      }));
      if (cleared > 0) replaceTopic(topicId, (x) => ({ ...x, unreadCount: 0 }));
    },

    linkItem: async ({ topicId, itemId, itemType }) => {
      const { userId } = get();
      if (!userId) return { error: "Brak zalogowanego użytkownika." };
      const t = findTopic(topicId);
      // Bez duplikatu: powiązanie istnieje — nic nie robimy.
      if (t?.items.some((i) => i.itemId === itemId)) return {};
      const res = await api.linkTopicItem({ topicId, itemId, itemType, userId });
      if (res.error) return res;
      replaceTopic(topicId, (x) =>
        x.items.some((i) => i.itemId === itemId)
          ? x
          : { ...x, items: [...x.items, { itemId, itemType }] },
      );
      return {};
    },

    unlinkItem: async (topicId, itemId) => {
      const res = await api.unlinkTopicItem(topicId, itemId);
      if (res.error) return res;
      replaceTopic(topicId, (x) => ({
        ...x,
        items: x.items.filter((i) => i.itemId !== itemId),
      }));
      return {};
    },

    noteIncomingComment: (message, ref) => {
      if (message.kind === "system" || message.deletedAt) return;
      const { userId } = get();
      const topic = findTopic(ref.topicId);
      if (!topic) {
        get().scheduleReload(ref.boardId);
        return;
      }
      // Ten sam komentarz może przyjść dwa razy (realtime + reconcile).
      if (topic.lastComment?.id === message.id) return;
      const mine = message.authorUserId === userId;
      replaceTopic(ref.topicId, (t) => ({
        ...t,
        commentCount: t.commentCount + 1,
        unreadCount: mine ? t.unreadCount : t.unreadCount + 1,
        lastActivityAt:
          message.createdAt > t.lastActivityAt ? message.createdAt : t.lastActivityAt,
        lastComment: {
          id: message.id,
          kind: message.kind,
          body: message.body.slice(0, 300),
          authorUserId: message.authorUserId,
          createdAt: message.createdAt,
        },
      }));
      if (!mine) {
        set((s) => ({
          boards: s.boards.map((b) =>
            b.id === ref.boardId ? { ...b, unreadCount: b.unreadCount + 1 } : b,
          ),
        }));
      }
      // Serwer jest źródłem prawdy (liczniki, usunięte komentarze).
      get().scheduleReload(ref.boardId);
    },

    scheduleReload: (boardId) => {
      if (boardId) reloadBoardIds.add(boardId);
      else reloadAllBoards = true;
      if (reloadTimer) return;
      reloadTimer = setTimeout(() => {
        reloadTimer = null;
        const ids = [...reloadBoardIds];
        const all = reloadAllBoards;
        reloadBoardIds.clear();
        reloadAllBoards = false;
        const s = get();
        void s.loadBoards();
        const targets = all
          ? Object.keys(get().topicsByBoard)
          : ids.filter((id) => id in get().topicsByBoard);
        for (const id of targets) void get().loadTopics(id);
      }, 700);
    },
  };
});
