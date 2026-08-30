import type { Group, Item } from "@/types";
import { isSharedItem, SHARE_CALENDAR_COLOR, SHARE_CALENDAR_OPACITY } from "@/lib/share";

export function itemVisual(item: Item, groups: Record<string, Group>) {
  if (isSharedItem(item)) {
    return { color: SHARE_CALENDAR_COLOR, opacity: SHARE_CALENDAR_OPACITY, shared: true };
  }
  const g = item.groupId ? groups[item.groupId] : undefined;
  return {
    color: g?.color ?? "#0b6e99",
    opacity: item.done ? 0.5 : 1,
    shared: false,
  };
}
