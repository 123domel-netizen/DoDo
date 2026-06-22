import type { Item } from "@/types";

export function isItemDeleted(item: Pick<Item, "deletedAt">): boolean {
  return item.deletedAt != null && item.deletedAt !== "";
}

export function filterVisibleItems(items: Iterable<Item>): Item[] {
  return [...items].filter((it) => !isItemDeleted(it));
}

/** Merge przy pull/realtime — last-write-wins z poprawnym rozstrzyganiem tombstone. */
export function mergeItemOnSync(local: Item | undefined, remote: Item): Item {
  if (!local) return remote;

  const lDeleted = isItemDeleted(local);
  const rDeleted = isItemDeleted(remote);
  const lTs = new Date(local.updatedAt).getTime();
  const rTs = new Date(remote.updatedAt).getTime();
  const lDeleteTs = local.deletedAt ? new Date(local.deletedAt).getTime() : lTs;

  if (rDeleted && lDeleted) return rTs >= lTs ? remote : local;
  if (rDeleted) return remote;
  if (lDeleted) {
    // Lokalny tombstone vs aktywny remote — nowsza wersja wygrywa.
    if (rTs > lDeleteTs) return remote;
    return local;
  }

  return rTs >= lTs ? remote : local;
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
