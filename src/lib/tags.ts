import type { Item, UserTag } from "@/types";
import { isSharedItem } from "@/lib/share";

export const TAG_COLORS = [
  "#7A6CB8",
  "#4A8FC4",
  "#4F9E7A",
  "#C08F52",
  "#8F6AA8",
  "#4599AD",
  "#A67D4A",
  "#6A7280",
] as const;

export function defaultTagColor(index = 0): string {
  return TAG_COLORS[index % TAG_COLORS.length]!;
}

/** Tagi przypisane do itemu dla bieżącego użytkownika. */
export function effectiveTagIds(
  item: Item,
  myTagIdsByItem: Record<string, string[]>,
): string[] {
  if (isSharedItem(item)) return myTagIdsByItem[item.id] ?? [];
  return item.tagIds ?? myTagIdsByItem[item.id] ?? [];
}

export function resolveItemTags(
  tagIds: string[],
  tags: Record<string, UserTag>,
): UserTag[] {
  return tagIds
    .map((id) => tags[id])
    .filter((t): t is UserTag => Boolean(t));
}

export function scrubTagIdFromMap(
  map: Record<string, string[]>,
  tagId: string,
): Record<string, string[]> {
  let changed = false;
  const next: Record<string, string[]> = {};
  for (const [itemId, ids] of Object.entries(map)) {
    const filtered = ids.filter((id) => id !== tagId);
    if (filtered.length !== ids.length) changed = true;
    if (filtered.length) next[itemId] = filtered;
    else if (ids.length) changed = true;
  }
  return changed ? next : map;
}

export function scrubTagIdFromItems(
  items: Record<string, Item>,
  tagId: string,
): Record<string, Item> {
  let changed = false;
  const next: Record<string, Item> = { ...items };
  for (const [id, item] of Object.entries(items)) {
    if (!item.tagIds?.includes(tagId)) continue;
    changed = true;
    const tagIds = item.tagIds.filter((x) => x !== tagId);
    next[id] = {
      ...item,
      tagIds,
      updatedAt: new Date().toISOString(),
    };
  }
  return changed ? next : items;
}
