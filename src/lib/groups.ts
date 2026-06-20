import type { Group, Item } from "@/types";
import { uid } from "@/lib/factory";
import { useStore } from "@/state/store";

export const ARCHIVE_GROUP_NAME = "ARCH";
export const ARCHIVE_GROUP_COLOR = "#737881";
/** Poprzednia nazwa — rozpoznawana przy migracji i filtrowaniu. */
export const LEGACY_ARCHIVE_GROUP_NAME = "Archiwum";

export function isArchiveGroup(group: Pick<Group, "name" | "system">): boolean {
  return (
    group.system === "archive" ||
    group.name === ARCHIVE_GROUP_NAME ||
    group.name === LEGACY_ARCHIVE_GROUP_NAME
  );
}

export function findArchiveGroup(groups: Group[]): Group | undefined {
  return groups.find(isArchiveGroup);
}

export function ensureArchiveGroup(groups: Group[]): Group[] {
  if (findArchiveGroup(groups)) return groups;
  return [
    ...groups,
    {
      id: uid(),
      name: ARCHIVE_GROUP_NAME,
      color: ARCHIVE_GROUP_COLOR,
      sortOrder: 9999,
      system: "archive",
    },
  ];
}

/** Zakres filtra: w ToDo widok ALL ukrywa ARCH; kalendarz pokazuje wszystko. */
export type GroupFilterScope = "calendar" | "todo";

/** null = ALL; inaczej tylko elementy z danej grupy. */
export function itemMatchesGroupFilter(
  item: Item,
  filterGroupId: string | null,
  scope: GroupFilterScope = "calendar",
): boolean {
  const archiveId = findArchiveGroup(useStore.getState().groups)?.id ?? null;

  if (!filterGroupId) {
    if (scope === "todo" && archiveId && item.groupId === archiveId) return false;
    return true;
  }
  return item.groupId === filterGroupId;
}

/** Przypisz aktywny filtr grupy do nowego elementu (gdy wybrana konkretna grupa). */
export function groupIdForNewItem(explicit?: string | null): string | null {
  if (explicit !== undefined) return explicit;
  const { activeGroupFilter, groups } = useStore.getState();
  const archiveId = findArchiveGroup(groups)?.id ?? null;
  if (activeGroupFilter && activeGroupFilter === archiveId) return null;
  return activeGroupFilter;
}

export function patchForTaskDone(item: Item, done: boolean, archiveGroupId: string): Partial<Item> {
  if (done) {
    const wasArchived = item.groupId === archiveGroupId;
    return {
      done: true,
      groupId: archiveGroupId,
      preArchiveGroupId: wasArchived
        ? (item.preArchiveGroupId ?? null)
        : item.groupId,
    };
  }
  return {
    done: false,
    groupId: item.preArchiveGroupId ?? null,
    preArchiveGroupId: null,
  };
}

export function sortGroupsForRail(groups: Group[]): Group[] {
  return groups
    .filter((g) => !isArchiveGroup(g))
    .sort((a, b) => a.sortOrder - b.sortOrder);
}
