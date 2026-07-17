export type ConversationKind = "channel" | "dm" | "item";

export interface ChatProfile {
  userId: string;
  displayName: string;
  avatarUrl: string | null;
}

export interface ChatMemberInfo {
  userId: string;
  role: "owner" | "admin" | "member";
  displayName: string;
  avatarUrl: string | null;
}

export interface ChatLastMessage {
  id: string;
  kind: "text" | "system";
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
  myLastReadAt: string | null;
  myNotify: "all" | "mentions" | "none";
  myRole: "owner" | "admin" | "member";
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

export type MessageSendState = "pending" | "failed";

export interface ChatMessage {
  id: string;
  conversationId: string;
  authorUserId: string;
  kind: "text" | "system";
  body: string;
  threadRootId: string | null;
  replyToMessageId: string | null;
  createdAt: string;
  editedAt: string | null;
  deletedAt: string | null;
  /** undefined = nieznane (np. event realtime bez zagnieżdżeń) — nie nadpisywać. */
  links?: ChatItemLink[];
  attachments?: ChatAttachment[];
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
}
