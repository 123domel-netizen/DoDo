import { cloudEnabled, supabase } from "@/lib/supabase";
import type {
  ChatAttachment,
  ChatItemLink,
  ChatMemberInfo,
  ChatMessage,
  ChatOverviewEntry,
  ChatProfile,
  ChatSearchResult,
  PublicChannelInfo,
} from "@/lib/chat/types";

export const MESSAGES_PAGE_SIZE = 40;

/** Zagnieżdżone selecty: linki do itemów + załączniki jednym zapytaniem. */
const MESSAGE_SELECT =
  "*, message_item_links(item_id, kind), message_attachments(*)";

type Row = Record<string, unknown>;

function rowToAttachment(row: Row): ChatAttachment {
  return {
    id: row.id as string,
    messageId: row.message_id as string,
    bucketPath: row.bucket_path as string,
    thumbPath: (row.thumb_path as string | null) ?? null,
    fileName: (row.file_name as string) ?? "",
    mimeType: (row.mime_type as string) ?? "application/octet-stream",
    sizeBytes: (row.size_bytes as number) ?? 0,
    width: (row.width as number | null) ?? null,
    height: (row.height as number | null) ?? null,
  };
}

export function rowToMessage(row: Row, withNested: boolean): ChatMessage {
  const msg: ChatMessage = {
    id: row.id as string,
    conversationId: row.conversation_id as string,
    authorUserId: row.author_user_id as string,
    kind: ((row.kind as string) ?? "text") as ChatMessage["kind"],
    body: (row.body as string) ?? "",
    threadRootId: (row.thread_root_id as string | null) ?? null,
    replyToMessageId: (row.reply_to_message_id as string | null) ?? null,
    createdAt: row.created_at as string,
    editedAt: (row.edited_at as string | null) ?? null,
    deletedAt: (row.deleted_at as string | null) ?? null,
  };
  if (withNested) {
    const links = (row.message_item_links as Row[] | null) ?? [];
    msg.links = links.map((l) => ({
      itemId: l.item_id as string,
      kind: (l.kind as ChatItemLink["kind"]) ?? "reference",
    }));
    const atts = (row.message_attachments as Row[] | null) ?? [];
    msg.attachments = atts.map(rowToAttachment);
  }
  return msg;
}

function rowToOverviewEntry(row: Row): ChatOverviewEntry {
  const last = row.last_message as Row | null;
  const members = (row.members as Row[] | null) ?? [];
  return {
    id: row.id as string,
    kind: row.kind as ChatOverviewEntry["kind"],
    name: (row.name as string | null) ?? null,
    description: (row.description as string | null) ?? null,
    isPublic: (row.is_public as boolean) ?? false,
    itemId: (row.item_id as string | null) ?? null,
    createdBy: row.created_by as string,
    lastMessageAt: (row.last_message_at as string | null) ?? null,
    createdAt: row.created_at as string,
    myLastReadAt: (row.my_last_read_at as string | null) ?? null,
    myNotify: ((row.my_notify as string) ?? "all") as ChatOverviewEntry["myNotify"],
    myRole: ((row.my_role as string) ?? "member") as ChatOverviewEntry["myRole"],
    unreadCount: Number(row.unread_count ?? 0),
    lastMessage: last
      ? {
          id: last.id as string,
          kind: ((last.kind as string) ?? "text") as "text" | "system",
          body: (last.body as string) ?? "",
          authorUserId: last.author_user_id as string,
          createdAt: last.created_at as string,
          deletedAt: (last.deleted_at as string | null) ?? null,
        }
      : null,
    members: members.map((m) => ({
      userId: m.userId as string,
      role: ((m.role as string) ?? "member") as ChatMemberInfo["role"],
      displayName: (m.displayName as string) ?? "",
      avatarUrl: (m.avatarUrl as string | null) ?? null,
    })),
  };
}

export function chatAvailable(): boolean {
  return cloudEnabled && Boolean(supabase);
}

export async function fetchOverview(): Promise<ChatOverviewEntry[]> {
  if (!supabase) return [];
  const { data, error } = await supabase.rpc("get_conversation_overview");
  if (error) {
    console.warn("[chat] overview fetch failed:", error.message);
    return [];
  }
  return ((data as Row[]) ?? []).map(rowToOverviewEntry);
}

export async function fetchProfiles(): Promise<Record<string, ChatProfile>> {
  if (!supabase) return {};
  const { data, error } = await supabase.from("profiles").select("*");
  if (error) {
    console.warn("[chat] profiles fetch failed:", error.message);
    return {};
  }
  const out: Record<string, ChatProfile> = {};
  for (const row of (data as Row[]) ?? []) {
    out[row.user_id as string] = {
      userId: row.user_id as string,
      displayName: (row.display_name as string) ?? "",
      avatarUrl: (row.avatar_url as string | null) ?? null,
    };
  }
  return out;
}

export async function fetchMessagesPage(
  conversationId: string,
  before?: { createdAt: string },
): Promise<{ messages: ChatMessage[]; hasMore: boolean }> {
  if (!supabase) return { messages: [], hasMore: false };
  let query = supabase
    .from("messages")
    .select(MESSAGE_SELECT)
    .eq("conversation_id", conversationId)
    .is("thread_root_id", null)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(MESSAGES_PAGE_SIZE);
  if (before) query = query.lt("created_at", before.createdAt);

  const { data, error } = await query;
  if (error) {
    console.warn("[chat] messages fetch failed:", error.message);
    return { messages: [], hasMore: false };
  }
  const rows = (data as Row[]) ?? [];
  const messages = rows.map((r) => rowToMessage(r, true)).reverse();
  return { messages, hasMore: rows.length === MESSAGES_PAGE_SIZE };
}

export async function fetchThreadMessages(rootId: string): Promise<ChatMessage[]> {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from("messages")
    .select(MESSAGE_SELECT)
    .or(`id.eq.${rootId},thread_root_id.eq.${rootId}`)
    .order("created_at", { ascending: true })
    .order("id", { ascending: true });
  if (error) {
    console.warn("[chat] thread fetch failed:", error.message);
    return [];
  }
  return ((data as Row[]) ?? []).map((r) => rowToMessage(r, true));
}

/** Liczby odpowiedzi w wątkach dla widocznych rootów (jedno zapytanie). */
export async function fetchReplyCounts(
  rootIds: string[],
): Promise<Record<string, number>> {
  if (!supabase || !rootIds.length) return {};
  const { data, error } = await supabase
    .from("messages")
    .select("thread_root_id")
    .in("thread_root_id", rootIds)
    .is("deleted_at", null);
  if (error) return {};
  const counts: Record<string, number> = {};
  for (const row of (data as Row[]) ?? []) {
    const id = row.thread_root_id as string;
    counts[id] = (counts[id] ?? 0) + 1;
  }
  return counts;
}

/** Insert idempotentny — duplikat id (retry outboxa) traktujemy jak sukces. */
export async function insertMessage(msg: ChatMessage): Promise<{ error?: string }> {
  if (!supabase) return { error: "Brak chmury." };
  const { error } = await supabase.from("messages").insert({
    id: msg.id,
    conversation_id: msg.conversationId,
    author_user_id: msg.authorUserId,
    kind: msg.kind,
    body: msg.body,
    thread_root_id: msg.threadRootId,
    reply_to_message_id: msg.replyToMessageId,
  });
  if (error && error.code !== "23505") return { error: error.message };
  return {};
}

export async function updateMessageBody(
  id: string,
  body: string,
): Promise<{ error?: string }> {
  if (!supabase) return { error: "Brak chmury." };
  const { error } = await supabase
    .from("messages")
    .update({ body, edited_at: new Date().toISOString() })
    .eq("id", id);
  return error ? { error: error.message } : {};
}

export async function softDeleteMessage(
  id: string,
  byUserId: string,
): Promise<{ error?: string }> {
  if (!supabase) return { error: "Brak chmury." };
  const { error } = await supabase
    .from("messages")
    .update({ deleted_at: new Date().toISOString(), deleted_by: byUserId })
    .eq("id", id);
  return error ? { error: error.message } : {};
}

export async function createConversation(
  kind: "channel" | "dm",
  opts: { name?: string; isPublic?: boolean; memberIds: string[] },
): Promise<{ id?: string; error?: string }> {
  if (!supabase) return { error: "Brak chmury." };
  const { data, error } = await supabase.rpc("create_conversation", {
    p_kind: kind,
    p_name: opts.name ?? null,
    p_is_public: opts.isPublic ?? false,
    p_member_ids: opts.memberIds,
  });
  if (error) return { error: error.message };
  return { id: (data as Row).id as string };
}

export async function ensureItemConversation(
  itemId: string,
): Promise<{ id?: string; error?: string }> {
  if (!supabase) return { error: "Brak chmury." };
  const { data, error } = await supabase.rpc("ensure_item_conversation", {
    p_item_id: itemId,
  });
  if (error) return { error: error.message };
  return { id: (data as Row).id as string };
}

export async function fetchItemConversationId(itemId: string): Promise<string | null> {
  if (!supabase) return null;
  const { data } = await supabase
    .from("conversations")
    .select("id")
    .eq("item_id", itemId)
    .eq("kind", "item")
    .maybeSingle();
  return (data?.id as string | undefined) ?? null;
}

export async function fetchPublicChannels(): Promise<PublicChannelInfo[]> {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from("conversations")
    .select("id, name, description")
    .eq("kind", "channel")
    .eq("is_public", true)
    .is("archived_at", null);
  if (error) return [];
  return ((data as Row[]) ?? []).map((r) => ({
    id: r.id as string,
    name: (r.name as string) ?? "Kanał",
    description: (r.description as string | null) ?? null,
  }));
}

export async function joinChannel(conversationId: string): Promise<{ error?: string }> {
  if (!supabase) return { error: "Brak chmury." };
  const { error } = await supabase.rpc("join_channel", {
    p_conversation_id: conversationId,
  });
  return error ? { error: error.message } : {};
}

export async function leaveConversation(
  conversationId: string,
): Promise<{ error?: string }> {
  if (!supabase) return { error: "Brak chmury." };
  const { error } = await supabase.rpc("leave_conversation", {
    p_conversation_id: conversationId,
  });
  return error ? { error: error.message } : {};
}

export async function markConversationRead(
  conversationId: string,
  atIso: string,
): Promise<{ error?: string }> {
  if (!supabase) return { error: "Brak chmury." };
  const { error } = await supabase.rpc("mark_conversation_read", {
    p_conversation_id: conversationId,
    p_at: atIso,
  });
  return error ? { error: error.message } : {};
}

export async function setConversationNotify(
  conversationId: string,
  userId: string,
  notify: "all" | "mentions" | "none",
): Promise<{ error?: string }> {
  if (!supabase) return { error: "Brak chmury." };
  const { error } = await supabase
    .from("conversation_members")
    .update({ notify })
    .eq("conversation_id", conversationId)
    .eq("user_id", userId);
  return error ? { error: error.message } : {};
}

export async function createItemLink(
  messageId: string,
  itemId: string,
  kind: ChatItemLink["kind"],
  createdBy: string,
): Promise<{ error?: string }> {
  if (!supabase) return { error: "Brak chmury." };
  const { error } = await supabase.from("message_item_links").insert({
    message_id: messageId,
    item_id: itemId,
    kind,
    created_by: createdBy,
  });
  if (error && error.code !== "23505") return { error: error.message };
  return {};
}

export interface ItemSourceLink {
  messageId: string;
  conversationId: string;
  kind: ChatItemLink["kind"];
}

/** Linki zwrotne: skąd powstał item (sekcja „Źródło" w edytorze). */
export async function fetchItemLinks(itemId: string): Promise<ItemSourceLink[]> {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from("message_item_links")
    .select("message_id, kind, messages(conversation_id)")
    .eq("item_id", itemId);
  if (error) return [];
  const out: ItemSourceLink[] = [];
  for (const row of (data as Row[]) ?? []) {
    const msg = row.messages as Row | null;
    if (!msg) continue;
    out.push({
      messageId: row.message_id as string,
      conversationId: msg.conversation_id as string,
      kind: (row.kind as ChatItemLink["kind"]) ?? "reference",
    });
  }
  return out;
}

export async function searchAll(query: string): Promise<ChatSearchResult[]> {
  if (!supabase || !query.trim()) return [];
  const { data, error } = await supabase.rpc("search_all", {
    p_query: query.trim(),
    p_limit: 20,
  });
  if (error) {
    console.warn("[chat] search failed:", error.message);
    return [];
  }
  return (((data as Row[]) ?? [])).map((r) => ({
    resultType: r.result_type as ChatSearchResult["resultType"],
    id: r.id as string,
    conversationId: (r.conversation_id as string | null) ?? null,
    itemId: (r.item_id as string | null) ?? null,
    title: (r.title as string | null) ?? null,
    snippet: (r.snippet as string | null) ?? null,
    createdAt: r.created_at as string,
    rank: Number(r.rank ?? 0),
  }));
}
