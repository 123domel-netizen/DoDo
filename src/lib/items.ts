import type { Item } from "@/types";

export function isItemDeleted(item: Pick<Item, "deletedAt">): boolean {
  return item.deletedAt != null && item.deletedAt !== "";
}

export function filterVisibleItems(items: Iterable<Item>): Item[] {
  return [...items].filter((it) => !isItemDeleted(it));
}

/** Zadania oraz wydarzenia widoczne na liście ToDo można oznaczać jako wykonane. */
export function itemSupportsTodoDone(item: Pick<Item, "type" | "showInTodo">): boolean {
  return item.type === "task" || (item.type === "event" && item.showInTodo);
}

/** Merge przy pull/realtime — last-write-wins z poprawnym rozstrzyganiem tombstone. */
export function mergeItemOnSync(local: Item | undefined, remote: Item): Item {
  if (!local) return remote;

  const lDeleted = isItemDeleted(local);
  const rDeleted = isItemDeleted(remote);
  const lTs = Date.parse(local.updatedAt);
  const rTs = Date.parse(remote.updatedAt);
  const lFinite = Number.isFinite(lTs) ? lTs : 0;
  const rFinite = Number.isFinite(rTs) ? rTs : 0;
  const lDeleteTs = local.deletedAt
    ? (Number.isFinite(Date.parse(local.deletedAt)) ? Date.parse(local.deletedAt) : lFinite)
    : lFinite;

  if (rDeleted && lDeleted) return rFinite >= lFinite ? remote : local;
  if (rDeleted) return remote;
  if (lDeleted) {
    // Lokalny tombstone vs aktywny remote — nowsza wersja wygrywa.
    if (rFinite > lDeleteTs) return remote;
    return local;
  }

  return rFinite >= lFinite ? remote : local;
}

export function tombstoneItem(item: Item, deletedBy: string | null): Item {
  const now = new Date().toISOString();
  return {
    ...item,
    deletedAt: now,
    deletedBy,
    updatedAt: now,
  };
}
