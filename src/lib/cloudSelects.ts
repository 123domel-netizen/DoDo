/**
 * Jawne listy kolumn snapshotu kalendarza (zamiast select("*")).
 * Scope własności w tym schemacie to `user_id` (brak kolumny workspace_id).
 *
 * Załączniki: w `items.payload.attachments` trzymamy tylko metadane (URL/ścieżka).
 * Treści plików (Storage/R2) NIE są pobierane w pullu snapshotu.
 */

/** Kolumny potrzebne do `rowToItem` + soft-delete. */
export const ITEMS_SELECT =
  "id,user_id,type,title,description,start_at,end_at,all_day,group_id,show_in_calendar,show_in_todo,done,payload,deleted_at,deleted_by,created_at,updated_at";

/**
 * Join w pullSharedItems — jawne kolumny itemu (NIGDY items(*)).
 * Filtr SQL: owner_user_id ≠ ja eliminuje podwójne pobranie własnych itemów.
 */
export const SHARED_ITEMS_EMBED_SELECT = `status,personal_reminders,items(${ITEMS_SELECT})`;

/** Kolumny potrzebne do `rowToGroup`. */
export const GROUPS_SELECT =
  "id,user_id,name,color,sort_order,system,icon,hide_from_all,show_in_sidebar,show_in_tasks,show_in_events,show_in_dashboard,show_in_all,created_at,updated_at";

/** Kolumny potrzebne do `rowToTag`. */
export const USER_TAGS_SELECT = "id,user_id,name,color,created_at,updated_at";

/** Kolumny uczestników właściciela (mergeParticipantsWithDb). */
export const OWNER_PARTICIPANTS_SELECT =
  "id,item_id,owner_user_id,participant_user_id,participant_email,participant_display_name,status,personal_reminders,created_at,updated_at";

export const TAG_ASSIGNMENTS_SELECT = "item_id,tag_ids";

/** Filtr własności — odpowiednik „workspace” w modelu DoDo (per-user). */
export function assertUserScopedFilter(userId: string | null | undefined): string {
  if (!userId) throw new Error("cloud select requires user_id filter");
  return userId;
}
