import { cloudEnabled, supabase } from "@/lib/supabase";
import type {
  Board,
  BoardField,
  BoardFieldKind,
  BoardFieldOption,
  BoardFieldVisibility,
  BoardMember,
  BoardRole,
  BoardTopic,
  LinkedItemType,
  TopicComment,
  TopicFieldValue,
  TopicItemLink,
} from "@/lib/boards/types";

type Row = Record<string, unknown>;

export function boardsBackendAvailable(): boolean {
  return cloudEnabled && Boolean(supabase);
}

/** Komunikaty błędów RPC → czytelny polski tekst. */
export function mapBoardError(message: string | undefined | null): string {
  const m = (message ?? "").toLowerCase();
  if (!m) return "Nieznany błąd.";
  if (m.includes("not authenticated")) return "Zaloguj się ponownie.";
  if (m.includes("not a board owner")) return "Tylko właściciel tablicy może to zrobić.";
  if (m.includes("not a board member") || m.includes("row-level security")) {
    return "Brak dostępu do tej tablicy.";
  }
  if (m.includes("not allowed")) return "Brak uprawnień do tej operacji.";
  if (m.includes("topic has comments")) {
    return "Temat ma komentarze — zamknij go zamiast usuwać.";
  }
  if (m.includes("board is archived")) return "Tablica jest zarchiwizowana.";
  if (m.includes("last owner")) return "Nie można usunąć ostatniego właściciela tablicy.";
  if (m.includes("members must belong")) {
    return "Wszyscy uczestnicy muszą należeć do tej organizacji.";
  }
  if (m.includes("too many board members")) return "Za dużo uczestników tablicy (max 50).";
  if (m.includes("invalid topic code")) return "Niepoprawny kod tematu.";
  if (m.includes("invalid topic order")) return "Nie udało się zmienić kolejności tematów.";
  if (m.includes("duplicate key") || m.includes("board_topics_board_code")) {
    return "Ten kod jest już użyty na tej tablicy.";
  }
  if (m.includes("too many board fields")) return "Za dużo pól na tablicy (max 20).";
  if (m.includes("invalid field name")) return "Niepoprawna nazwa pola.";
  if (m.includes("invalid field options") || m.includes("invalid option label")) {
    return "Niepoprawne opcje pola.";
  }
  if (m.includes("invalid field value")) return "Niepoprawna wartość pola.";
  if (m.includes("field kind or visibility immutable")) {
    return "Typu pola nie można zmienić — usuń i dodaj nowe.";
  }
  if (m.includes("viewers must be board members")) {
    return "Osoby z dostępem do ukrytego pola muszą być na tablicy.";
  }
  if (m.includes("invalid")) return "Niepoprawna nazwa lub tytuł.";
  if (m.includes("failed to fetch") || m.includes("network")) {
    return "Brak połączenia z internetem.";
  }
  return message ?? "Nieznany błąd.";
}

function asRole(v: unknown): BoardRole {
  return v === "owner" ? "owner" : "member";
}

export function rowToBoard(row: Row): Board {
  const members = (row.members as Row[] | null) ?? [];
  return {
    id: row.id as string,
    orgId: row.org_id as string,
    name: (row.name as string) ?? "",
    createdBy: (row.created_by as string | null) ?? null,
    createdAt: row.created_at as string,
    updatedAt: (row.updated_at as string) ?? (row.created_at as string),
    myRole: asRole(row.my_role),
    unreadCount: Number(row.unread_count ?? 0),
    members: members.map(
      (m): BoardMember => ({
        userId: m.userId as string,
        role: asRole(m.role),
        displayName: (m.displayName as string) ?? "",
        avatarUrl: (m.avatarUrl as string | null) ?? null,
      }),
    ),
  };
}

function rowToComment(raw: unknown): TopicComment | null {
  if (!raw || typeof raw !== "object") return null;
  const c = raw as Row;
  if (!c.id) return null;
  return {
    id: c.id as string,
    kind: (c.kind as string) ?? "text",
    body: (c.body as string) ?? "",
    authorUserId: c.authorUserId as string,
    createdAt: c.createdAt as string,
  };
}

function asFieldKind(v: unknown): BoardFieldKind {
  if (v === "single" || v === "multi" || v === "text") return v;
  return "text";
}

function asFieldVisibility(v: unknown): BoardFieldVisibility {
  return v === "restricted" ? "restricted" : "all";
}

function parseFieldValues(raw: unknown): Record<string, TopicFieldValue> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: Record<string, TopicFieldValue> = {};
  for (const [fieldId, val] of Object.entries(raw as Record<string, unknown>)) {
    if (!val || typeof val !== "object") continue;
    const v = val as Row;
    const optionIds = Array.isArray(v.optionIds)
      ? (v.optionIds as unknown[]).filter((x): x is string => typeof x === "string")
      : [];
    out[fieldId] = {
      text: typeof v.text === "string" ? v.text : null,
      optionIds,
    };
  }
  return out;
}

export function rowToField(row: Row): BoardField {
  const optionsRaw = (row.options as Row[] | null) ?? [];
  const viewerIds = (row.viewer_ids as string[] | null) ?? [];
  return {
    id: row.id as string,
    boardId: row.board_id as string,
    name: (row.name as string) ?? "",
    kind: asFieldKind(row.kind),
    visibility: asFieldVisibility(row.visibility),
    position: Number(row.sort_order ?? row.position ?? 0),
    options: optionsRaw.map(
      (o): BoardFieldOption => ({
        id: o.id as string,
        label: (o.label as string) ?? "",
        position: Number(o.sort_order ?? o.position ?? 0),
      }),
    ),
    viewerIds: viewerIds.filter((id) => typeof id === "string"),
  };
}

export function rowToTopic(row: Row): BoardTopic {
  const items = (row.items as Row[] | null) ?? [];
  const codeRaw = row.code;
  const localityRaw = row.locality;
  return {
    id: row.id as string,
    boardId: row.board_id as string,
    title: (row.title as string) ?? "",
    description: (row.description as string) ?? "",
    code: typeof codeRaw === "string" && codeRaw.length > 0 ? codeRaw : null,
    locality: typeof localityRaw === "string" && localityRaw.length > 0 ? localityRaw : null,
    position: Number(row.sort_order ?? row.position ?? 0),
    createdBy: (row.created_by as string | null) ?? null,
    pinnedAt: (row.pinned_at as string | null) ?? null,
    snoozedUntil: (row.snoozed_until as string | null) ?? null,
    closedAt: (row.closed_at as string | null) ?? null,
    closedBy: (row.closed_by as string | null) ?? null,
    createdAt: row.created_at as string,
    updatedAt: (row.updated_at as string) ?? (row.created_at as string),
    conversationId: row.conversation_id as string,
    lastActivityAt: (row.last_activity_at as string) ?? (row.created_at as string),
    commentCount: Number(row.comment_count ?? 0),
    unreadCount: Number(row.unread_count ?? 0),
    lastComment: rowToComment(row.last_comment),
    items: items.map(
      (i): TopicItemLink => ({
        itemId: i.itemId as string,
        itemType: i.itemType === "event" ? "event" : "task",
      }),
    ),
    fieldValues: parseFieldValues(row.field_values),
  };
}

export async function fetchBoards(
  orgId: string,
): Promise<{ boards: Board[]; error?: string }> {
  if (!supabase) return { boards: [] };
  const { data, error } = await supabase.rpc("get_my_boards", { p_org_id: orgId });
  if (error) return { boards: [], error: mapBoardError(error.message) };
  return { boards: ((data as Row[]) ?? []).map(rowToBoard) };
}

export async function fetchTopics(
  boardId: string,
): Promise<{ topics: BoardTopic[]; error?: string }> {
  if (!supabase) return { topics: [] };
  const { data, error } = await supabase.rpc("get_board_topics", { p_board_id: boardId });
  if (error) return { topics: [], error: mapBoardError(error.message) };
  return { topics: ((data as Row[]) ?? []).map(rowToTopic) };
}

export async function createBoard(input: {
  id: string;
  orgId: string;
  name: string;
  memberIds: string[];
}): Promise<{ error?: string }> {
  if (!supabase) return { error: "Brak chmury." };
  const { error } = await supabase.rpc("board_create", {
    p_id: input.id,
    p_org_id: input.orgId,
    p_name: input.name,
    p_member_ids: input.memberIds,
  });
  return error ? { error: mapBoardError(error.message) } : {};
}

export async function renameBoard(boardId: string, name: string): Promise<{ error?: string }> {
  if (!supabase) return { error: "Brak chmury." };
  const { error } = await supabase.rpc("board_rename", { p_board_id: boardId, p_name: name });
  return error ? { error: mapBoardError(error.message) } : {};
}

export async function setBoardArchived(
  boardId: string,
  archived: boolean,
): Promise<{ error?: string }> {
  if (!supabase) return { error: "Brak chmury." };
  const { error } = await supabase.rpc("board_set_archived", {
    p_board_id: boardId,
    p_archived: archived,
  });
  return error ? { error: mapBoardError(error.message) } : {};
}

export async function addBoardMembers(
  boardId: string,
  userIds: string[],
): Promise<{ error?: string }> {
  if (!supabase) return { error: "Brak chmury." };
  const { error } = await supabase.rpc("board_add_members", {
    p_board_id: boardId,
    p_user_ids: userIds,
  });
  return error ? { error: mapBoardError(error.message) } : {};
}

export async function removeBoardMember(
  boardId: string,
  userId: string,
): Promise<{ error?: string }> {
  if (!supabase) return { error: "Brak chmury." };
  const { error } = await supabase.rpc("board_remove_member", {
    p_board_id: boardId,
    p_user_id: userId,
  });
  return error ? { error: mapBoardError(error.message) } : {};
}

/** Idempotentne po `id` (retry po błędzie sieci nie tworzy duplikatu). */
export async function createTopic(input: {
  id: string;
  boardId: string;
  title: string;
}): Promise<{ conversationId?: string; error?: string }> {
  if (!supabase) return { error: "Brak chmury." };
  const { data, error } = await supabase.rpc("board_create_topic", {
    p_id: input.id,
    p_board_id: input.boardId,
    p_title: input.title,
  });
  if (error) return { error: mapBoardError(error.message) };
  return { conversationId: data as string };
}

export interface TopicPatch {
  title?: string;
  description?: string;
  code?: string | null;
  locality?: string | null;
  pinned_at?: string | null;
  snoozed_until?: string | null;
  closed_at?: string | null;
}

export async function reorderTopics(
  boardId: string,
  topicIds: string[],
): Promise<{ error?: string }> {
  if (!supabase) return { error: "Brak chmury." };
  const { error } = await supabase.rpc("board_reorder_topics", {
    p_board_id: boardId,
    p_topic_ids: topicIds,
  });
  return error ? { error: mapBoardError(error.message) } : {};
}

export async function updateTopic(
  topicId: string,
  patch: TopicPatch,
): Promise<{ error?: string }> {
  if (!supabase) return { error: "Brak chmury." };
  const { data, error } = await supabase
    .from("board_topics")
    .update(patch)
    .eq("id", topicId)
    .select("id");
  if (error) return { error: mapBoardError(error.message) };
  // RLS: brak dostępu = 0 zaktualizowanych wierszy, bez błędu.
  if (!data || data.length === 0) return { error: "Brak dostępu do tego tematu." };
  return {};
}

export async function deleteTopic(topicId: string): Promise<{ error?: string }> {
  if (!supabase) return { error: "Brak chmury." };
  const { error } = await supabase.rpc("board_delete_topic", { p_topic_id: topicId });
  return error ? { error: mapBoardError(error.message) } : {};
}

/** Powiązanie tematu z istniejącym zadaniem/wydarzeniem; PK chroni przed duplikatem. */
export async function linkTopicItem(input: {
  topicId: string;
  itemId: string;
  itemType: LinkedItemType;
  userId: string;
}): Promise<{ error?: string }> {
  if (!supabase) return { error: "Brak chmury." };
  const { error } = await supabase.from("board_topic_items").upsert(
    {
      topic_id: input.topicId,
      item_id: input.itemId,
      item_type: input.itemType,
      created_by: input.userId,
    },
    { onConflict: "topic_id,item_id", ignoreDuplicates: true },
  );
  return error ? { error: mapBoardError(error.message) } : {};
}

export async function unlinkTopicItem(
  topicId: string,
  itemId: string,
): Promise<{ error?: string }> {
  if (!supabase) return { error: "Brak chmury." };
  const { error } = await supabase
    .from("board_topic_items")
    .delete()
    .eq("topic_id", topicId)
    .eq("item_id", itemId);
  return error ? { error: mapBoardError(error.message) } : {};
}

export async function fetchBoardFields(
  boardId: string,
): Promise<{ fields: BoardField[]; error?: string }> {
  if (!supabase) return { fields: [] };
  const { data, error } = await supabase.rpc("get_board_fields", { p_board_id: boardId });
  if (error) return { fields: [], error: mapBoardError(error.message) };
  return { fields: ((data as Row[]) ?? []).map(rowToField) };
}

export async function upsertBoardField(input: {
  id?: string | null;
  boardId: string;
  name: string;
  kind: BoardFieldKind;
  visibility: BoardFieldVisibility;
  position?: number | null;
  options: { id?: string; label: string }[];
  viewerIds: string[];
}): Promise<{ id?: string; error?: string }> {
  if (!supabase) return { error: "Brak chmury." };
  const { data, error } = await supabase.rpc("board_upsert_field", {
    p_id: input.id ?? null,
    p_board_id: input.boardId,
    p_name: input.name,
    p_kind: input.kind,
    p_visibility: input.visibility,
    p_sort_order: input.position ?? null,
    p_options: input.options.map((o) =>
      o.id ? { id: o.id, label: o.label } : { label: o.label },
    ),
    p_viewer_ids: input.viewerIds,
  });
  if (error) return { error: mapBoardError(error.message) };
  return { id: data as string };
}

export async function deleteBoardField(fieldId: string): Promise<{ error?: string }> {
  if (!supabase) return { error: "Brak chmury." };
  const { error } = await supabase.rpc("board_delete_field", { p_field_id: fieldId });
  return error ? { error: mapBoardError(error.message) } : {};
}

export async function setTopicFieldValue(input: {
  topicId: string;
  fieldId: string;
  textValue?: string | null;
  optionIds?: string[];
}): Promise<{ error?: string }> {
  if (!supabase) return { error: "Brak chmury." };
  const { error } = await supabase.rpc("board_set_topic_field_value", {
    p_topic_id: input.topicId,
    p_field_id: input.fieldId,
    p_text_value: input.textValue ?? null,
    p_option_ids: input.optionIds ?? [],
  });
  return error ? { error: mapBoardError(error.message) } : {};
}
