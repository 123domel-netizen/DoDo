import { cloudEnabled, supabase } from "@/lib/supabase";
import type {
  ChatAttachment,
  ChatDecision,
  ChatItemLink,
  ChatMemberInfo,
  ChatMessage,
  ChatNote,
  ChatOverviewEntry,
  ChatProfile,
  ChatReaction,
  ChatSearchResult,
  LinkPreview,
  MessagePayload,
  MessageRevision,
  PollVote,
  PublicChannelInfo,
  ThreadListEntry,
} from "@/lib/chat/types";

export const MESSAGES_PAGE_SIZE = 40;

/** Zagnieżdżone selecty: linki, załączniki, reakcje i głosy jednym zapytaniem. */
const MESSAGE_SELECT =
  "*, message_item_links(item_id, kind), message_attachments(*), " +
  "message_reactions(message_id, user_id, emoji), poll_votes(message_id, user_id, option_id)";

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

export function rowToReaction(row: Row): ChatReaction {
  return {
    messageId: row.message_id as string,
    userId: row.user_id as string,
    emoji: (row.emoji as string) ?? "",
  };
}

export function rowToVote(row: Row): PollVote {
  return {
    messageId: row.message_id as string,
    userId: row.user_id as string,
    optionId: (row.option_id as string) ?? "",
  };
}

export function rowToMessage(row: Row, withNested: boolean): ChatMessage {
  const msg: ChatMessage = {
    id: row.id as string,
    conversationId: row.conversation_id as string,
    authorUserId: row.author_user_id as string,
    kind: ((row.kind as string) ?? "text") as ChatMessage["kind"],
    body: (row.body as string) ?? "",
    payload: ((row.payload as MessagePayload | null) ?? {}) as MessagePayload,
    mentions: ((row.mentions as string[] | null) ?? []) as string[],
    threadRootId: (row.thread_root_id as string | null) ?? null,
    replyToMessageId: (row.reply_to_message_id as string | null) ?? null,
    createdAt: row.created_at as string,
    editedAt: (row.edited_at as string | null) ?? null,
    deletedAt: (row.deleted_at as string | null) ?? null,
    pinnedAt: (row.pinned_at as string | null) ?? null,
    pinnedBy: (row.pinned_by as string | null) ?? null,
    threadTitle: (row.thread_title as string | null) ?? null,
  };
  if (withNested) {
    const links = (row.message_item_links as Row[] | null) ?? [];
    msg.links = links.map((l) => ({
      itemId: l.item_id as string,
      kind: (l.kind as ChatItemLink["kind"]) ?? "reference",
    }));
    const atts = (row.message_attachments as Row[] | null) ?? [];
    msg.attachments = atts.map(rowToAttachment);
    const reactions = (row.message_reactions as Row[] | null) ?? [];
    msg.reactions = reactions.map(rowToReaction);
    const votes = (row.poll_votes as Row[] | null) ?? [];
    msg.votes = votes.map(rowToVote);
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
    myPinnedAt: (row.my_pinned_at as string | null) ?? null,
    myMutedUntil: (row.my_muted_until as string | null) ?? null,
    myMarkedUnread: (row.my_marked_unread as boolean) ?? false,
    unreadCount: Number(row.unread_count ?? 0),
    lastMessage: last
      ? {
          id: last.id as string,
          kind: ((last.kind as string) ?? "text") as ChatMessage["kind"],
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
      lastSeenAt: (row.last_seen_at as string | null) ?? null,
    };
  }
  return out;
}

/** Heartbeat obecności (online = last_seen_at < 5 min temu). */
export async function updateMyPresence(userId: string): Promise<void> {
  if (!supabase) return;
  await supabase
    .from("profiles")
    .update({ last_seen_at: new Date().toISOString() })
    .eq("user_id", userId);
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
  const rows = (data as unknown as Row[]) ?? [];
  const messages = rows.map((r) => rowToMessage(r, true)).reverse();
  return { messages, hasMore: rows.length === MESSAGES_PAGE_SIZE };
}

/** Nowsze wiadomości (feed kontekstowy przewijany w dół). */
export async function fetchNewerMessages(
  conversationId: string,
  after: { createdAt: string },
  limit = MESSAGES_PAGE_SIZE,
): Promise<{ messages: ChatMessage[]; hasMore: boolean }> {
  if (!supabase) return { messages: [], hasMore: false };
  const { data, error } = await supabase
    .from("messages")
    .select(MESSAGE_SELECT)
    .eq("conversation_id", conversationId)
    .is("thread_root_id", null)
    .gt("created_at", after.createdAt)
    .order("created_at", { ascending: true })
    .order("id", { ascending: true })
    .limit(limit);
  if (error) {
    console.warn("[chat] newer fetch failed:", error.message);
    return { messages: [], hasMore: false };
  }
  const rows = (data as unknown as Row[]) ?? [];
  return {
    messages: rows.map((r) => rowToMessage(r, true)),
    hasMore: rows.length === limit,
  };
}

export const CONTEXT_WINDOW = 10;

/**
 * Okno kontekstowe wokół wiadomości: kotwica + do 10 przed i 10 po
 * (skok do decyzji/notatki/wyniku wyszukiwania bez dociągania całej historii).
 */
export async function fetchMessagesAround(
  conversationId: string,
  messageId: string,
): Promise<{
  messages: ChatMessage[];
  hasOlder: boolean;
  hasNewer: boolean;
  /** Wiadomość-kotwica w głównym feedzie (root, gdy cel był odpowiedzią w wątku). */
  pivotId: string;
} | null> {
  if (!supabase) return null;
  const { data: anchorRow } = await supabase
    .from("messages")
    .select(MESSAGE_SELECT)
    .eq("id", messageId)
    .maybeSingle();
  if (!anchorRow) return null;
  const anchor = rowToMessage(anchorRow as unknown as Row, true);

  // Kotwica w wątku → kontekstem jest jej root w głównym feedzie.
  const pivot = anchor.threadRootId
    ? await fetchMessageById(anchor.threadRootId)
    : anchor;
  if (!pivot) return null;

  const [olderRes, newerRes] = await Promise.all([
    supabase
      .from("messages")
      .select(MESSAGE_SELECT)
      .eq("conversation_id", conversationId)
      .is("thread_root_id", null)
      .lt("created_at", pivot.createdAt)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(CONTEXT_WINDOW),
    supabase
      .from("messages")
      .select(MESSAGE_SELECT)
      .eq("conversation_id", conversationId)
      .is("thread_root_id", null)
      .gt("created_at", pivot.createdAt)
      .order("created_at", { ascending: true })
      .order("id", { ascending: true })
      .limit(CONTEXT_WINDOW),
  ]);
  const olderRows = ((olderRes.data as unknown as Row[]) ?? []).map((r) =>
    rowToMessage(r, true),
  );
  const newerRows = ((newerRes.data as unknown as Row[]) ?? []).map((r) =>
    rowToMessage(r, true),
  );
  const hasOlder = olderRows.length === CONTEXT_WINDOW;
  return {
    messages: [...olderRows.reverse(), pivot, ...newerRows],
    hasOlder,
    hasNewer: newerRows.length === CONTEXT_WINDOW,
    pivotId: pivot.id,
  };
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
  return ((data as unknown as Row[]) ?? []).map((r) => rowToMessage(r, true));
}

export async function fetchMessageById(id: string): Promise<ChatMessage | null> {
  if (!supabase) return null;
  const { data } = await supabase
    .from("messages")
    .select(MESSAGE_SELECT)
    .eq("id", id)
    .maybeSingle();
  return data ? rowToMessage(data as unknown as Row, true) : null;
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
    payload: msg.payload,
    mentions: msg.mentions,
    thread_root_id: msg.threadRootId,
    reply_to_message_id: msg.replyToMessageId,
  });
  if (error && error.code !== "23505") return { error: error.message };
  return {};
}

export async function updateMessageBody(
  id: string,
  body: string,
  mentions: string[],
): Promise<{ error?: string }> {
  if (!supabase) return { error: "Brak chmury." };
  const { error } = await supabase
    .from("messages")
    .update({ body, mentions, edited_at: new Date().toISOString() })
    .eq("id", id);
  return error ? { error: error.message } : {};
}

/** Nadpisanie payloadu (np. dopięcie linkPreview po wysyłce). */
export async function updateMessagePayload(
  id: string,
  payload: MessagePayload,
): Promise<{ error?: string }> {
  if (!supabase) return { error: "Brak chmury." };
  const { error } = await supabase.from("messages").update({ payload }).eq("id", id);
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

// ---------------------------------------------------------------------------
// Reakcje / ankiety
// ---------------------------------------------------------------------------

export async function addReaction(r: ChatReaction): Promise<{ error?: string }> {
  if (!supabase) return { error: "Brak chmury." };
  const { error } = await supabase.from("message_reactions").insert({
    message_id: r.messageId,
    user_id: r.userId,
    emoji: r.emoji,
  });
  if (error && error.code !== "23505") return { error: error.message };
  return {};
}

export async function removeReaction(r: ChatReaction): Promise<{ error?: string }> {
  if (!supabase) return { error: "Brak chmury." };
  const { error } = await supabase
    .from("message_reactions")
    .delete()
    .eq("message_id", r.messageId)
    .eq("user_id", r.userId)
    .eq("emoji", r.emoji);
  return error ? { error: error.message } : {};
}

export async function upsertPollVote(v: PollVote): Promise<{ error?: string }> {
  if (!supabase) return { error: "Brak chmury." };
  const { error } = await supabase
    .from("poll_votes")
    .upsert(
      { message_id: v.messageId, user_id: v.userId, option_id: v.optionId },
      { onConflict: "message_id,user_id" },
    );
  return error ? { error: error.message } : {};
}

export async function deletePollVote(
  messageId: string,
  userId: string,
): Promise<{ error?: string }> {
  if (!supabase) return { error: "Brak chmury." };
  const { error } = await supabase
    .from("poll_votes")
    .delete()
    .eq("message_id", messageId)
    .eq("user_id", userId);
  return error ? { error: error.message } : {};
}

// ---------------------------------------------------------------------------
// Historia edycji / decyzje / wzmianki / media
// ---------------------------------------------------------------------------

export async function fetchRevisions(messageId: string): Promise<MessageRevision[]> {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from("message_revisions")
    .select("*")
    .eq("message_id", messageId)
    .order("edited_at", { ascending: false });
  if (error) return [];
  return ((data as Row[]) ?? []).map((r) => ({
    id: r.id as string,
    messageId: r.message_id as string,
    body: (r.body as string) ?? "",
    editedAt: r.edited_at as string,
    editedBy: (r.edited_by as string | null) ?? null,
  }));
}

function rowToDecision(r: Row): ChatDecision {
  return {
    id: r.id as string,
    conversationId: r.conversation_id as string,
    messageId: (r.message_id as string | null) ?? null,
    body: (r.body as string) ?? "",
    createdBy: r.created_by as string,
    decidedAt: r.decided_at as string,
  };
}

export async function fetchDecisions(conversationId: string): Promise<ChatDecision[]> {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from("decisions")
    .select("*")
    .eq("conversation_id", conversationId)
    .order("decided_at", { ascending: false });
  if (error) return [];
  return ((data as Row[]) ?? []).map(rowToDecision);
}

/** Decyzje ze wskazanych rozmów (hub — lista globalna w ramach membership). */
export async function fetchDecisionsForConversations(
  conversationIds: string[],
): Promise<ChatDecision[]> {
  if (!supabase || conversationIds.length === 0) return [];
  const { data, error } = await supabase
    .from("decisions")
    .select("*")
    .in("conversation_id", conversationIds)
    .order("decided_at", { ascending: false })
    .limit(100);
  if (error) return [];
  return ((data as Row[]) ?? []).map(rowToDecision);
}

export async function addDecision(input: {
  conversationId: string;
  messageId: string | null;
  body: string;
  createdBy: string;
}): Promise<{ decision?: ChatDecision; error?: string }> {
  if (!supabase) return { error: "Brak chmury." };
  const { data, error } = await supabase
    .from("decisions")
    .insert({
      conversation_id: input.conversationId,
      message_id: input.messageId,
      body: input.body,
      created_by: input.createdBy,
    })
    .select()
    .single();
  if (error) return { error: error.message };
  return { decision: rowToDecision(data as Row) };
}

export async function deleteDecision(id: string): Promise<{ error?: string }> {
  if (!supabase) return { error: "Brak chmury." };
  const { error } = await supabase.from("decisions").delete().eq("id", id);
  return error ? { error: error.message } : {};
}

function rowToNote(r: Row): ChatNote {
  return {
    id: r.id as string,
    conversationId: r.conversation_id as string,
    messageId: (r.message_id as string | null) ?? null,
    body: (r.body as string) ?? "",
    createdBy: r.created_by as string,
    notedAt: r.noted_at as string,
  };
}

export async function fetchNotes(conversationId: string): Promise<ChatNote[]> {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from("notes")
    .select("*")
    .eq("conversation_id", conversationId)
    .order("noted_at", { ascending: false });
  if (error) return [];
  return ((data as Row[]) ?? []).map(rowToNote);
}

/** Notatki ze wskazanych rozmów (hub — lista globalna w ramach membership). */
export async function fetchNotesForConversations(
  conversationIds: string[],
): Promise<ChatNote[]> {
  if (!supabase || conversationIds.length === 0) return [];
  const { data, error } = await supabase
    .from("notes")
    .select("*")
    .in("conversation_id", conversationIds)
    .order("noted_at", { ascending: false })
    .limit(100);
  if (error) return [];
  return ((data as Row[]) ?? []).map(rowToNote);
}

export async function addNote(input: {
  conversationId: string;
  messageId: string | null;
  body: string;
  createdBy: string;
}): Promise<{ note?: ChatNote; error?: string }> {
  if (!supabase) return { error: "Brak chmury." };
  const { data, error } = await supabase
    .from("notes")
    .insert({
      conversation_id: input.conversationId,
      message_id: input.messageId,
      body: input.body,
      created_by: input.createdBy,
    })
    .select()
    .single();
  if (error) return { error: error.message };
  return { note: rowToNote(data as Row) };
}

export async function deleteNote(id: string): Promise<{ error?: string }> {
  if (!supabase) return { error: "Brak chmury." };
  const { error } = await supabase.from("notes").delete().eq("id", id);
  return error ? { error: error.message } : {};
}

// ---------------------------------------------------------------------------
// Przypinanie wątków / lista wątków
// ---------------------------------------------------------------------------

export async function setMessagePinned(
  messageId: string,
  pinned: boolean,
): Promise<{ error?: string }> {
  if (!supabase) return { error: "Brak chmury." };
  const { error } = await supabase.rpc("set_message_pinned", {
    p_message_id: messageId,
    p_pinned: pinned,
  });
  return error ? { error: error.message } : {};
}

export async function setThreadTitle(
  messageId: string,
  title: string,
): Promise<{ error?: string }> {
  if (!supabase) return { error: "Brak chmury." };
  const { error } = await supabase.rpc("set_thread_title", {
    p_message_id: messageId,
    p_title: title,
  });
  return error ? { error: error.message } : {};
}

/** Przypięte wątki rozmowy (najnowsze przypięcia pierwsze). */
export async function fetchPinnedMessages(
  conversationId: string,
): Promise<ChatMessage[]> {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from("messages")
    .select(MESSAGE_SELECT)
    .eq("conversation_id", conversationId)
    .not("pinned_at", "is", null)
    .is("deleted_at", null)
    .order("pinned_at", { ascending: false })
    .limit(100);
  if (error) return [];
  return ((data as unknown as Row[]) ?? []).map((r) => rowToMessage(r, true));
}

/** Wątki rozmowy: rooty z ≥1 odpowiedzią + liczby odpowiedzi (2 zapytania). */
export async function fetchThreadsList(
  conversationId: string,
): Promise<ThreadListEntry[]> {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from("messages")
    .select("thread_root_id")
    .eq("conversation_id", conversationId)
    .not("thread_root_id", "is", null)
    .is("deleted_at", null);
  if (error) return [];
  const counts = new Map<string, number>();
  for (const row of (data as Row[]) ?? []) {
    const id = row.thread_root_id as string;
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  if (!counts.size) return [];
  const { data: rootRows, error: rootErr } = await supabase
    .from("messages")
    .select(MESSAGE_SELECT)
    .in("id", [...counts.keys()])
    .order("created_at", { ascending: false });
  if (rootErr) return [];
  return ((rootRows as unknown as Row[]) ?? []).map((r) => {
    const root = rowToMessage(r, true);
    return { root, replyCount: counts.get(root.id) ?? 0 };
  });
}

/** Wątki ze wskazanych rozmów (hub). */
export async function fetchThreadsForConversations(
  conversationIds: string[],
): Promise<(ThreadListEntry & { conversationId: string })[]> {
  if (!supabase || conversationIds.length === 0) return [];
  const ids = conversationIds.slice(0, 40);
  const { data, error } = await supabase
    .from("messages")
    .select("thread_root_id, conversation_id")
    .in("conversation_id", ids)
    .not("thread_root_id", "is", null)
    .is("deleted_at", null);
  if (error) return [];
  const counts = new Map<string, { conversationId: string; count: number }>();
  for (const row of (data as Row[]) ?? []) {
    const rootId = row.thread_root_id as string;
    const conversationId = row.conversation_id as string;
    const prev = counts.get(rootId);
    counts.set(rootId, {
      conversationId,
      count: (prev?.count ?? 0) + 1,
    });
  }
  if (!counts.size) return [];
  const { data: rootRows, error: rootErr } = await supabase
    .from("messages")
    .select(MESSAGE_SELECT)
    .in("id", [...counts.keys()])
    .order("created_at", { ascending: false })
    .limit(80);
  if (rootErr) return [];
  return ((rootRows as unknown as Row[]) ?? []).map((r) => {
    const root = rowToMessage(r, true);
    const meta = counts.get(root.id);
    return {
      root,
      replyCount: meta?.count ?? 0,
      conversationId: meta?.conversationId ?? root.conversationId,
    };
  });
}

/** Przypięte wątki ze wskazanych rozmów (hub). */
export async function fetchPinnedMessagesForConversations(
  conversationIds: string[],
): Promise<ChatMessage[]> {
  if (!supabase || conversationIds.length === 0) return [];
  const ids = conversationIds.slice(0, 40);
  const { data, error } = await supabase
    .from("messages")
    .select(MESSAGE_SELECT)
    .in("conversation_id", ids)
    .not("pinned_at", "is", null)
    .is("deleted_at", null)
    .order("pinned_at", { ascending: false })
    .limit(50);
  if (error) return [];
  return ((data as unknown as Row[]) ?? []).map((r) => rowToMessage(r, true));
}

/** Wiadomości, w których mnie oznaczono (filtr wzmianek). */
export async function fetchMyMentions(userId: string): Promise<ChatMessage[]> {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from("messages")
    .select("*")
    .contains("mentions", [userId])
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) return [];
  return ((data as Row[]) ?? []).map((r) => rowToMessage(r, false));
}

export interface ConversationAttachment extends ChatAttachment {
  createdAt: string;
}

/** Wszystkie załączniki rozmowy (zakładka Media). */
export async function fetchConversationAttachments(
  conversationId: string,
): Promise<ConversationAttachment[]> {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from("message_attachments")
    .select("*, messages!inner(conversation_id, deleted_at)")
    .eq("messages.conversation_id", conversationId)
    .is("messages.deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(300);
  if (error) return [];
  return ((data as Row[]) ?? []).map((r) => ({
    ...rowToAttachment(r),
    createdAt: r.created_at as string,
  }));
}

/** Załączniki ze wskazanych rozmów (hub Media). */
export async function fetchAttachmentsForConversations(
  conversationIds: string[],
): Promise<(ConversationAttachment & { conversationId: string })[]> {
  if (!supabase || conversationIds.length === 0) return [];
  const ids = conversationIds.slice(0, 40);
  const { data, error } = await supabase
    .from("message_attachments")
    .select("*, messages!inner(conversation_id, deleted_at)")
    .in("messages.conversation_id", ids)
    .is("messages.deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(100);
  if (error) return [];
  return ((data as Row[]) ?? []).map((r) => {
    const msg = r.messages as Row | Row[] | null;
    const msgRow = Array.isArray(msg) ? msg[0] : msg;
    return {
      ...rowToAttachment(r),
      createdAt: r.created_at as string,
      conversationId: (msgRow?.conversation_id as string) ?? "",
    };
  });
}

/** Wiadomości z linkami (zakładka Media → Linki); URL-e wyciąga klient. */
export async function fetchConversationLinkMessages(
  conversationId: string,
): Promise<ChatMessage[]> {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from("messages")
    .select("*")
    .eq("conversation_id", conversationId)
    .is("deleted_at", null)
    .ilike("body", "%http%")
    .order("created_at", { ascending: false })
    .limit(200);
  if (error) return [];
  return ((data as Row[]) ?? []).map((r) => rowToMessage(r, false));
}

// ---------------------------------------------------------------------------
// Rozmowy
// ---------------------------------------------------------------------------

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

export async function markConversationUnread(
  conversationId: string,
): Promise<{ error?: string }> {
  if (!supabase) return { error: "Brak chmury." };
  const { error } = await supabase.rpc("mark_conversation_unread", {
    p_conversation_id: conversationId,
  });
  return error ? { error: error.message } : {};
}

export async function setConversationPinned(
  conversationId: string,
  pinned: boolean,
): Promise<{ error?: string }> {
  if (!supabase) return { error: "Brak chmury." };
  const { error } = await supabase.rpc("set_conversation_pinned", {
    p_conversation_id: conversationId,
    p_pinned: pinned,
  });
  return error ? { error: error.message } : {};
}

/** null = wyłącz wyciszenie; "infinity" = na zawsze; inaczej ISO końca. */
export async function setConversationMute(
  conversationId: string,
  mutedUntil: string | null,
): Promise<{ error?: string }> {
  if (!supabase) return { error: "Brak chmury." };
  const { error } = await supabase.rpc("set_conversation_mute", {
    p_conversation_id: conversationId,
    p_muted_until: mutedUntil,
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

export interface RecentItemLink {
  messageId: string;
  itemId: string;
  kind: ChatItemLink["kind"];
  conversationId: string;
  createdAt: string;
  createdBy: string;
}

/** Ostatnie powiązania wiadomość ↔ wpis (hub „Powiązania”). */
export async function fetchRecentItemLinks(limit = 50): Promise<RecentItemLink[]> {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from("message_item_links")
    .select(
      "message_id, item_id, kind, created_at, created_by, messages!inner(conversation_id, deleted_at)",
    )
    .is("messages.deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) return [];
  const out: RecentItemLink[] = [];
  for (const row of (data as Row[]) ?? []) {
    const msg = row.messages as Row | Row[] | null;
    const msgRow = Array.isArray(msg) ? msg[0] : msg;
    if (!msgRow?.conversation_id) continue;
    out.push({
      messageId: row.message_id as string,
      itemId: row.item_id as string,
      kind: (row.kind as ChatItemLink["kind"]) ?? "reference",
      conversationId: msgRow.conversation_id as string,
      createdAt: (row.created_at as string) ?? new Date().toISOString(),
      createdBy: (row.created_by as string) ?? "",
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

/** Podgląd linku przez funkcję Edge (OG scraping po stronie serwera). */
export async function fetchLinkPreview(url: string): Promise<LinkPreview | null> {
  if (!supabase) return null;
  try {
    const { data, error } = await supabase.functions.invoke("link-preview", {
      body: { url },
    });
    if (error || !data) return null;
    const d = data as Row;
    if (!d.title && !d.description && !d.imageUrl) return null;
    return {
      url,
      title: (d.title as string | null) ?? null,
      description: (d.description as string | null) ?? null,
      imageUrl: (d.imageUrl as string | null) ?? null,
      siteName: (d.siteName as string | null) ?? null,
    };
  } catch {
    return null;
  }
}
