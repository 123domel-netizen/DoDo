import type { RealtimePostgresChangesPayload } from "@supabase/supabase-js";
import { useStore } from "@/state/store";
import { supabase } from "@/lib/supabase";
import { groupIdForNewItem } from "@/lib/groups";
import { setBoardChatListener, type BoardChatEvent } from "@/lib/chat/boardBridge";
import { loadConversationMessages, markRead, showTodoInPanel } from "@/lib/chat/init";
import { playIncomingMessageAlert } from "@/lib/chat/notifySound";
import {
  navigateTo,
  onRouteChange,
  parseAppHash,
  setRouteHash,
  type AppRoute,
  type HistoryMode,
} from "@/lib/navigation";
import { hasActivePushSubscription, showLocalNotification } from "@/lib/push";
import { draftFromTopic } from "@/lib/boards/itemDraft";
import { shouldReopenOnComment } from "@/lib/boards/sections";
import { useBoardsStore } from "@/lib/boards/store";
import type { BoardTopic, LinkedItemType } from "@/lib/boards/types";

/**
 * Efekty uboczne modułu Tablice: realtime, most z Czatem (komentarze), deep-linki,
 * tworzenie zadania/wydarzenia z tematu. Sam stan żyje w `store.ts`.
 */

// ---------------------------------------------------------------------------
// Który temat jest teraz faktycznie oglądany (komentarze wtedy od razu „przeczytane”)
// ---------------------------------------------------------------------------

let viewingTopicId: string | null = null;

export function setViewingTopic(topicId: string | null): void {
  viewingTopicId = topicId;
}

function documentVisible(): boolean {
  return typeof document === "undefined" || document.visibilityState === "visible";
}

// ---------------------------------------------------------------------------
// Nawigacja (hash #/tablice/{board}/{topic})
// ---------------------------------------------------------------------------

export function navigateToBoards(
  route: { boardId?: string; topicId?: string },
  mode: HistoryMode = "replace",
): void {
  navigateTo({ view: "board", ...route }, mode);
}

/** Wyjście z trybu Tablice (inna zakładka): zdejmij hash #/tablice, żeby odświeżenie nie wracało. */
export function leaveBoardsRoute(): void {
  if (typeof window === "undefined") return;
  if (window.location.hash.startsWith("#/tablice")) setRouteHash(null);
}

function applyBoardRoute(route: AppRoute | null): void {
  if (!route || route.view !== "board") return;
  const app = useStore.getState();
  // Bez chmury / organizacji moduł jest ukryty — hash nic nie robi.
  if (!app.authUserId || !app.activeOrgId) return;
  const store = useBoardsStore.getState();
  app.setSettings({ mainAreaMode: "boards" });
  // Temat ma pierwszeństwo w prawym panelu nad ostatnio otwartym detalem czatu.
  if (route.topicId) showTodoInPanel();
  useBoardsStore.setState({
    activeBoardId: route.boardId ?? store.activeBoardId,
    activeTopicId: route.topicId ?? null,
  });
}

// ---------------------------------------------------------------------------
// Komentarze (zdarzenia z mostu Czatu)
// ---------------------------------------------------------------------------

function findTopic(topicId: string): BoardTopic | undefined {
  for (const list of Object.values(useBoardsStore.getState().topicsByBoard)) {
    const hit = list.find((t) => t.id === topicId);
    if (hit) return hit;
  }
  return undefined;
}

function alertForComment(event: Extract<BoardChatEvent, { type: "message" }>): void {
  const { message, ref } = event;
  const state = useBoardsStore.getState();
  const board = state.boards.find((b) => b.id === ref.boardId);
  const topic = findTopic(ref.topicId);
  if (documentVisible()) {
    playIncomingMessageAlert();
    return;
  }
  // Karta w tle: push z serwera, a bez subskrypcji — lokalny toast.
  void (async () => {
    if (await hasActivePushSubscription()) return;
    playIncomingMessageAlert();
    const author =
      board?.members.find((m) => m.userId === message.authorUserId)?.displayName || "Ktoś";
    showLocalNotification(
      `Tablica: ${board?.name ?? "Tablice"} · ${topic?.title ?? "temat"}`,
      `${author}: ${message.body.slice(0, 140)}`,
      { tag: `board-${ref.topicId}`, url: `/#/tablice/${ref.boardId}/${ref.topicId}` },
    );
  })();
}

function handleComment(event: Extract<BoardChatEvent, { type: "message" }>): void {
  const { message, ref } = event;
  if (message.kind === "system" || message.deletedAt) return;
  const store = useBoardsStore.getState();
  const mine = message.authorUserId === store.userId;
  const topicBefore = findTopic(ref.topicId);

  store.noteIncomingComment(message, ref);

  // Komentarz w zamkniętym temacie otwiera go ponownie (robi to klient autora).
  if (mine && topicBefore && shouldReopenOnComment(topicBefore)) {
    void store.updateTopic(ref.topicId, { closed_at: null }).then((res) => {
      if (!res.error) {
        useBoardsStore.getState().setNotice("Temat został otwarty ponownie po nowym komentarzu.");
      }
    });
  }

  if (mine) return;

  const watching = viewingTopicId === ref.topicId && documentVisible();
  if (watching) {
    useBoardsStore.getState().markTopicRead(ref.topicId);
    markRead(message.conversationId);
    return;
  }
  alertForComment(event);
}

function handleChatEvent(event: BoardChatEvent): void {
  const store = useBoardsStore.getState();
  switch (event.type) {
    case "message":
      handleComment(event);
      break;
    case "membership":
      store.scheduleReload(event.ref.boardId);
      break;
    case "item-created":
      void store
        .linkItem({
          topicId: event.ref.topicId,
          itemId: event.itemId,
          itemType: event.itemType,
        })
        .then((res) => {
          if (res.error) {
            useBoardsStore
              .getState()
              .setNotice(`Element utworzono, ale nie powiązano z tematem: ${res.error}`);
          }
        });
      break;
  }
}

// ---------------------------------------------------------------------------
// Otwarcie tematu: wiadomości + odczyt
// ---------------------------------------------------------------------------

export function openTopicConversation(topic: Pick<BoardTopic, "id" | "conversationId">): void {
  useBoardsStore.getState().markTopicRead(topic.id);
  if (!topic.conversationId) return;
  void loadConversationMessages(topic.conversationId);
  markRead(topic.conversationId);
}

// ---------------------------------------------------------------------------
// Zadanie / wydarzenie z tematu (przez istniejący edytor)
// ---------------------------------------------------------------------------

let pendingItemUnsub: (() => void) | null = null;

function clearPendingItem(): void {
  pendingItemUnsub?.();
  pendingItemUnsub = null;
}

export function startItemFromTopic(
  topic: BoardTopic,
  type: LinkedItemType,
  boardName: string,
): void {
  const app = useStore.getState();
  app.startDraft({
    ...draftFromTopic(topic, type, boardName),
    groupId: groupIdForNewItem(),
  });
  const draft = useStore.getState().draft;
  if (!draft) return;

  clearPendingItem();
  const itemId = draft.id;
  pendingItemUnsub = useStore.subscribe((s) => {
    if (s.items[itemId]) {
      clearPendingItem();
      void useBoardsStore
        .getState()
        .linkItem({ topicId: topic.id, itemId, itemType: type })
        .then((res) => {
          if (res.error) {
            useBoardsStore
              .getState()
              .setNotice(`Element utworzono, ale nie powiązano z tematem: ${res.error}`);
          }
        });
      return;
    }
    // Draft porzucony bez zapisu → bez powiązania.
    if ((!s.draft || s.draft.id !== itemId) && s.editingId !== itemId) clearPendingItem();
  });
}

// ---------------------------------------------------------------------------
// Realtime + cykl życia
// ---------------------------------------------------------------------------

type ChangePayload = RealtimePostgresChangesPayload<Record<string, unknown>>;

function boardIdFromChange(table: string, payload: ChangePayload): string | null {
  const row = (
    payload.new && Object.keys(payload.new).length > 0 ? payload.new : payload.old
  ) as Record<string, unknown> | undefined;
  if (!row) return null;
  const id = table === "boards" ? row.id : row.board_id;
  return typeof id === "string" ? id : null;
}

/** Słuchacz nawigacji (#/tablice/...) — montowany raz, niezależnie od dostępności modułu. */
export function installBoardsRouteListener(): () => void {
  return onRouteChange(applyBoardRoute);
}

/** Start modułu dla (userId, orgId); zwraca funkcję sprzątającą. */
export function startBoardsRuntime(userId: string, orgId: string): () => void {
  const store = useBoardsStore.getState();
  store.setScope(orgId, userId);
  void store.loadBoards();

  setBoardChatListener(handleChatEvent);
  // Start z deep-linkiem (#/tablice/...) zanim organizacja była znana.
  applyBoardRoute(parseAppHash(window.location.hash));

  const onVisible = () => {
    if (documentVisible()) useBoardsStore.getState().scheduleReload();
  };
  document.addEventListener("visibilitychange", onVisible);
  window.addEventListener("online", onVisible);

  let channel: ReturnType<NonNullable<typeof supabase>["channel"]> | null = null;
  if (supabase) {
    const sb = supabase;
    const onChange = (table: string) => (payload: ChangePayload) => {
      useBoardsStore.getState().scheduleReload(boardIdFromChange(table, payload));
    };
    channel = sb
      .channel(`boards-${userId}-${orgId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "boards", filter: `org_id=eq.${orgId}` },
        onChange("boards"),
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "board_members" },
        onChange("board_members"),
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "board_topics" },
        onChange("board_topics"),
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "board_topic_items" },
        onChange("board_topic_items"),
      )
      .subscribe();
  }

  return () => {
    setBoardChatListener(null);
    document.removeEventListener("visibilitychange", onVisible);
    window.removeEventListener("online", onVisible);
    if (channel && supabase) void supabase.removeChannel(channel);
    clearPendingItem();
    setViewingTopic(null);
  };
}
