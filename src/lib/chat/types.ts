export type ConversationKind = "channel" | "dm" | "item";

export type MessageKind = "text" | "system" | "poll" | "gif" | "voice";

export interface ChatProfile {
  userId: string;
  displayName: string;
  avatarUrl: string | null;
  /** Heartbeat obecności (online = < 5 min temu). */
  lastSeenAt: string | null;
}

export interface ChatMemberInfo {
  userId: string;
  role: "owner" | "admin" | "member";
  displayName: string;
  avatarUrl: string | null;
}

export interface ChatLastMessage {
  id: string;
  kind: MessageKind;
  body: string;
  authorUserId: string;
  createdAt: string;
  deletedAt: string | null;
}

export interface ChatOverviewEntry {
  id: string;
  kind: ConversationKind;
  name: string | null;
  description: string | null;
  isPublic: boolean;
  itemId: string | null;
  createdBy: string;
  lastMessageAt: string | null;
  createdAt: string;
  /** Ścieżka w bucketcie chat-attachments (ikona kanału). */
  iconUrl: string | null;
  myLastReadAt: string | null;
  myNotify: "all" | "mentions" | "none";
  myRole: "owner" | "admin" | "member";
  /** Ulubiona (przypięta) rozmowa — zawsze na górze listy. */
  myPinnedAt: string | null;
  /** Wyciszenie do (ISO; "infinity" = na zawsze; null = brak). */
  myMutedUntil: string | null;
  /** Ręcznie oznaczona jako nieprzeczytana. */
  myMarkedUnread: boolean;
  unreadCount: number;
  lastMessage: ChatLastMessage | null;
  members: ChatMemberInfo[];
}

export interface ChatItemLink {
  itemId: string;
  kind: "created_from" | "reference";
}

export interface ChatAttachment {
  id: string;
  messageId: string;
  bucketPath: string;
  thumbPath: string | null;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  width: number | null;
  height: number | null;
}

export interface ChatReaction {
  messageId: string;
  userId: string;
  emoji: string;
}

export interface PollOption {
  id: string;
  label: string;
}

export interface PollVote {
  messageId: string;
  userId: string;
  optionId: string;
}

export interface LinkPreview {
  url: string;
  title: string | null;
  description: string | null;
  imageUrl: string | null;
  siteName: string | null;
}

/** Dane zależne od kindu wiadomości (kolumna messages.payload). */
export interface MessagePayload {
  poll?: { options: PollOption[] };
  gif?: { url: string; width?: number; height?: number };
  voice?: { durationSec: number };
  linkPreview?: LinkPreview;
  /** System: zapisana decyzja/notatka — klik otwiera detal. */
  registry?: {
    kind: "decision" | "note";
    id: string;
  };
}

export type MessageSendState = "pending" | "failed";

export interface ChatMessage {
  id: string;
  conversationId: string;
  authorUserId: string;
  kind: MessageKind;
  body: string;
  payload: MessagePayload;
  mentions: string[];
  threadRootId: string | null;
  replyToMessageId: string | null;
  createdAt: string;
  editedAt: string | null;
  deletedAt: string | null;
  /** Przypięcie wątku do rozmowy (wspólne dla wszystkich członków). */
  pinnedAt: string | null;
  pinnedBy: string | null;
  /** Nazwa wątku (tylko root; null = użyj treści wiadomości). */
  threadTitle: string | null;
  /** Archiwum wątku — ukryty na głównej liście. */
  threadArchivedAt: string | null;
  /** undefined = nieznane (np. event realtime bez zagnieżdżeń) — nie nadpisywać. */
  links?: ChatItemLink[];
  attachments?: ChatAttachment[];
  reactions?: ChatReaction[];
  votes?: PollVote[];
  /** Tylko lokalnie (outbox). */
  sendState?: MessageSendState;
}

export interface OutboxEntry {
  message: ChatMessage;
  attempts: number;
}

export interface ChatSearchResult {
  resultType: "message" | "item" | "file";
  id: string;
  conversationId: string | null;
  itemId: string | null;
  title: string | null;
  snippet: string | null;
  createdAt: string;
  rank: number;
}

export interface PublicChannelInfo {
  id: string;
  name: string;
  description: string | null;
  iconUrl: string | null;
}

export interface MessageRevision {
  id: string;
  messageId: string;
  body: string;
  editedAt: string;
  editedBy: string | null;
}

export interface ChatDecision {
  id: string;
  conversationId: string;
  messageId: string | null;
  body: string;
  /** Notatka do decyzji (wspólna dla członków rozmowy). */
  note: string;
  createdBy: string;
  decidedAt: string;
  /** Prywatna etykieta grupy bieżącego użytkownika. */
  groupId: string | null;
  /** Prywatne tagi bieżącego użytkownika. */
  tagIds: string[];
}

export interface ChatNote {
  id: string;
  conversationId: string;
  messageId: string | null;
  title: string;
  body: string;
  createdBy: string;
  notedAt: string;
  /** Prywatna etykieta grupy bieżącego użytkownika. */
  groupId: string | null;
  /** Prywatne tagi bieżącego użytkownika. */
  tagIds: string[];
}

/** Wpis listy wątków rozmowy (root + liczba odpowiedzi). */
export interface ThreadListEntry {
  root: ChatMessage;
  replyCount: number;
}

/**
 * Feed kontekstowy: okno wiadomości wokół kotwicy (skok do decyzji/notatki/
 * cytatu spoza ogona) — doładowywane w obie strony, niezależne od ogona.
 */
export interface FocusFeed {
  conversationId: string;
  anchorId: string;
  messages: ChatMessage[];
  hasOlder: boolean;
  hasNewer: boolean;
}

/** Krótka etykieta podglądu dla kindów specjalnych (lista rozmów, push). */
export function messagePreviewLabel(kind: MessageKind, body: string): string {
  switch (kind) {
    case "poll":
      return `📊 Ankieta: ${body}`;
    case "gif":
      return "GIF";
    case "voice":
      return "🎤 Wiadomość głosowa";
    default:
      return body;
  }
}
