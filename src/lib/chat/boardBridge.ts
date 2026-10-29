import type { ChatMessage, ChatOverviewEntry } from "@/lib/chat/types";

/**
 * Most między Czatem a modułem Tablice.
 *
 * Komentarze tematów Tablic to zwykłe `messages` w rozmowach `kind = 'board_topic'`.
 * Czat (init.ts) nie importuje modułu Tablic (brak cyklu zależności) — zamiast tego
 * pyta ten rejestr, czy rozmowa należy do Tablicy, i przekazuje jej zdarzenia dalej.
 */

export interface BoardConversationRef {
  boardId: string;
  topicId: string;
}

/**
 * Rodzaje rozmów, które wolno pokazywać na liście Czatu.
 * Selektor „u źródła” — używany przy mapowaniu odpowiedzi overview, niezależnie
 * od filtra w SQL (obrona w głąb).
 */
export function isChatListConversationKind(kind: string): boolean {
  return kind === "channel" || kind === "dm" || kind === "item";
}

export function filterChatListEntries<T extends Pick<ChatOverviewEntry, "kind">>(
  entries: T[],
): T[] {
  return entries.filter((e) => isChatListConversationKind(e.kind));
}

const refs = new Map<string, BoardConversationRef>();

export function setBoardConversationRefs(
  entries: Iterable<[conversationId: string, ref: BoardConversationRef]>,
): void {
  refs.clear();
  for (const [conversationId, ref] of entries) refs.set(conversationId, ref);
}

export function addBoardConversationRef(
  conversationId: string,
  ref: BoardConversationRef,
): void {
  refs.set(conversationId, ref);
}

export function getBoardConversationRef(
  conversationId: string,
): BoardConversationRef | undefined {
  return refs.get(conversationId);
}

export function clearBoardConversationRefs(): void {
  refs.clear();
}

export type BoardChatEvent =
  | { type: "message"; message: ChatMessage; ref: BoardConversationRef }
  | { type: "membership"; conversationId: string; ref: BoardConversationRef }
  /** Z komentarza tematu utworzono zadanie / wydarzenie (konwersja czatu). */
  | {
      type: "item-created";
      conversationId: string;
      itemId: string;
      itemType: "task" | "event";
      ref: BoardConversationRef;
    };

type BoardChatListener = (event: BoardChatEvent) => void;

let listener: BoardChatListener | null = null;

export function setBoardChatListener(fn: BoardChatListener | null): void {
  listener = fn;
}

export function emitBoardChatEvent(event: BoardChatEvent): void {
  listener?.(event);
}
