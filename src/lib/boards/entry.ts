import type { ChatOverviewEntry } from "@/lib/chat/types";
import type { Board, BoardTopic } from "@/lib/boards/types";

/**
 * Wpis „overview” dla rozmowy tematu — rozmowy Tablic nie trafiają do listy Czatu,
 * więc `ConversationView` dostaje go wprost (uczestnicy do @wzmianek i ptaszków).
 */
export function topicConversationEntry(topic: BoardTopic, board: Board): ChatOverviewEntry {
  return {
    id: topic.conversationId,
    kind: "board_topic",
    name: topic.title,
    description: null,
    isPublic: false,
    itemId: null,
    createdBy: topic.createdBy ?? "",
    lastMessageAt: topic.lastActivityAt,
    createdAt: topic.createdAt,
    iconUrl: null,
    myLastReadAt: null,
    myNotify: "all",
    myRole: "member",
    myPinnedAt: null,
    myMutedUntil: null,
    myArchivedAt: null,
    myMarkedUnread: false,
    unreadCount: 0,
    lastMessage: null,
    members: board.members.map((m) => ({
      userId: m.userId,
      role: m.role === "owner" ? "owner" : "member",
      displayName: m.displayName,
      avatarUrl: m.avatarUrl,
      lastReadAt: null,
    })),
  };
}
