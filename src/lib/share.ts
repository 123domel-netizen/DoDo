import type { Attachment, ChecklistItem, Item, Reminder } from "@/types";
import { cloudEnabled, supabase } from "@/lib/supabase";

export const SHARE_GROUP_NAME = "SHARE";
export const SHARE_GROUP_COLOR = "#8b8d94";
/** Nad ARCH (9999), pod grupami użytkownika. */
export const SHARE_GROUP_SORT_ORDER = 9500;

export function isShareGroup(group: { name: string; system?: string }): boolean {
  return group.system === "share" || group.name === SHARE_GROUP_NAME;
}

export function isSharedItem(item: Item): boolean {
  return item.shareRole === "participant";
}

export function isItemOwner(item: Item, userId: string | null | undefined): boolean {
  if (!userId) return item.shareRole !== "participant";
  if (item.shareRole === "participant") return false;
  if (item.ownerUserId) return item.ownerUserId === userId;
  return true;
}

/** Szary styl dla wpisów SHARE w kalendarzu. */
export const SHARE_CALENDAR_COLOR = "#6A7280";
export const SHARE_CALENDAR_OPACITY = 0.58;

/** Zapis treści współdzielonej uczestnika — wyłącznie przez RPC. */
export async function updateSharedItemContent(
  itemId: string,
  content: {
    description?: string;
    checklist?: ChecklistItem[];
    attachments?: Attachment[];
  },
): Promise<{ error?: string }> {
  if (!cloudEnabled || !supabase) return {};
  const { error } = await supabase.rpc("update_shared_item_content", {
    p_item_id: itemId,
    p_description: content.description ?? null,
    p_checklist: content.checklist ?? null,
    p_attachments: content.attachments ?? null,
  });
  return error ? { error: error.message } : {};
}

export async function updateOwnParticipationReminders(
  itemId: string,
  reminders: Reminder[],
): Promise<{ error?: string }> {
  if (!cloudEnabled || !supabase) return {};
  const { error } = await supabase.rpc("update_own_participation_reminders", {
    p_item_id: itemId,
    p_reminders: reminders,
  });
  return error ? { error: error.message } : {};
}
