/**
 * Tablice: wspólny notes — tablica → lista tematów → komentarze pod tematem.
 * Komentarze to zwykłe wiadomości czatu w rozmowie `kind = 'board_topic'`.
 */

export const BOARD_NAME_MAX = 120;
export const TOPIC_TITLE_MAX = 200;
export const TOPIC_DESCRIPTION_MAX = 4000;
export const TOPIC_CODE_MAX = 16;

export type BoardRole = "owner" | "member";

export interface BoardMember {
  userId: string;
  role: BoardRole;
  displayName: string;
  avatarUrl: string | null;
}

export interface Board {
  id: string;
  orgId: string;
  name: string;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
  myRole: BoardRole;
  /** Nieprzeczytane komentarze innych osób w całej tablicy (per ja). */
  unreadCount: number;
  members: BoardMember[];
}

export interface TopicComment {
  id: string;
  kind: string;
  body: string;
  authorUserId: string;
  createdAt: string;
}

export type LinkedItemType = "task" | "event";

export interface TopicItemLink {
  itemId: string;
  itemType: LinkedItemType;
}

export type TopicSendState = "pending" | "failed";

export interface BoardTopic {
  id: string;
  boardId: string;
  title: string;
  description: string;
  /** Ręczny identyfikator (np. N01); null gdy brak. */
  code: string | null;
  /** Kolejność w tablicy (1..n); DnD w sekcjach przypięte/aktywne. */
  position: number;
  createdBy: string | null;
  pinnedAt: string | null;
  /** Temat wraca do aktywnych, gdy ta data minie. */
  snoozedUntil: string | null;
  closedAt: string | null;
  closedBy: string | null;
  createdAt: string;
  updatedAt: string;
  /** Rozmowa z komentarzami (kind = 'board_topic'). Pusty dla tematu w trakcie tworzenia. */
  conversationId: string;
  lastActivityAt: string;
  commentCount: number;
  unreadCount: number;
  lastComment: TopicComment | null;
  items: TopicItemLink[];
  /** Tylko lokalnie: temat jeszcze niezapisany na serwerze / zapis nieudany. */
  sendState?: TopicSendState;
  sendError?: string;
}

export type TopicSection = "pinned" | "active" | "snoozed" | "closed";

export interface GroupedTopics {
  pinned: BoardTopic[];
  active: BoardTopic[];
  snoozed: BoardTopic[];
  closed: BoardTopic[];
}
