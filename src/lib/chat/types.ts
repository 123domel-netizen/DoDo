export type ConversationKind = "channel" | "dm" | "item";

export type MessageKind = "text" | "system" | "poll" | "gif" | "voice" | "gallery";

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
  /** Do ptaszków odczytu (ostatnia wiadomość vs last_read_at). */
  lastReadAt: string | null;
}

export interface ChatLastMessage {
  id: string;
  kind: MessageKind;
  body: string;
  authorUserId: string;
  createdAt: string;
  deletedAt: string | null;
  /** Gdy ostatnia aktywność to odpowiedź w wątku. */
  threadRootId?: string | null;
  /** Nazwa wątku (z rootu) — do podglądu „nazwa: treść”. */
  threadTitle?: string | null;
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
  /** Zarchiwizowana dla mnie — tylko w folderze Archiwum. */
  myArchivedAt: string | null;
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
  pipeline?: "legacy_supabase" | "r2_sp";
  r2Key?: string | null;
  r2KeyThumb?: string | null;
  r2Status?: string | null;
  spStatus?: string | null;
  spDriveItemId?: string | null;
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

/** Snapshot treści przy przekazywaniu / przenoszeniu. */
export interface MessagePreviewSnapshot {
  kind: MessageKind;
  body: string;
  payload?: MessagePayload;
  attachmentCount?: number;
  authorUserId?: string;
  createdAt?: string;
  /** Opcjonalnie — pełne metadane załączników (po przeniesieniu ze zaktualizowanymi ścieżkami). */
  attachments?: ChatAttachment[];
}

/** Meta „Przesłano dalej” — wiadomość jest od przekazującego. */
export interface MessageForwardMeta {
  fromMessageId: string;
  fromConversationId: string;
  forwardedAt: string;
  originalAuthorUserId: string;
  preview?: MessagePreviewSnapshot;
  /** Odpowiedź w przekazanym wątku — meta roota. */
  threadRootForward?: MessageForwardMeta;
}

/** Meta przeniesienia (na wiadomości w celu lub w stubie źródła). */
export interface MessageMovedMeta {
  toConversationId?: string;
  toMessageId?: string;
  fromConversationId?: string;
  movedAt: string;
  movedBy: string;
  preview?: MessagePreviewSnapshot;
}

/** Dane zależne od kindu wiadomości (kolumna messages.payload). */
export interface MessagePayload {
  poll?: { options: PollOption[] };
  gif?: { url: string; width?: number; height?: number };
  voice?: { durationSec: number };
  linkPreview?: LinkPreview;
  gallery?: { galleryId: string };
  /** System: zapisana decyzja/notatka — klik otwiera detal. */
  registry?: {
    kind: "decision" | "note";
    id: string;
  };
  /** Przekazanie — baner „Przesłano dalej”. */
  forward?: MessageForwardMeta;
  /** Stub w źródle po przeniesieniu. */
  movedStub?: boolean;
  moved?: MessageMovedMeta;
}

/** Status galerii: cały zestaw zdjęć zapisywanych w magazynie zespołu. */
export type GalleryStatus =
  | "draft"
  | "uploading"
  | "ready"
  | "partial"
  | "failed"
  | "unavailable";

export type GalleryItemStatus = "pending" | "uploading" | "ready" | "failed";

export interface GalleryItem {
  id: string;
  galleryId: string;
  sortOrder: number;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  width: number | null;
  height: number | null;
  providerItemId: string | null;
  status: GalleryItemStatus;
  errorMessage: string | null;
}

export interface Gallery {
  id: string;
  orgId: string;
  conversationId: string;
  messageId: string | null;
  createdBy: string;
  title: string;
  description: string | null;
  provider: string;
  providerFolderId: string | null;
  status: GalleryStatus;
  itemCount: number;
  failedCount: number;
  createdAt: string;
  items?: GalleryItem[];
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
    case "gallery":
      return `🖼 Galeria: ${body || "…"}`;
    default:
      return body;
  }
}

/**
 * Jedna linia podglądu w liście kanałów / DM.
 * Odpowiedź w wątku → „nazwa wątku: treść”; inaczej „Autor: treść”.
 */
export function formatConversationLastPreview(
  last: ChatLastMessage | null | undefined,
  authorName: string | null,
): string {
  if (!last) return "Brak wiadomości";
  if (last.deletedAt) return "Wiadomość usunięta";
  if (last.kind === "system") return last.body;
  const content = messagePreviewLabel(last.kind, last.body) || "(załącznik)";
  if (last.threadRootId) {
    const title = (last.threadTitle ?? "").trim() || "Wątek";
    return `${title}: ${content}`;
  }
  return `${authorName ? `${authorName}: ` : ""}${content}`;
}
