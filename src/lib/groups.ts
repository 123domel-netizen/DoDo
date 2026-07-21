import type { Group, Item } from "@/types";
import { uid } from "@/lib/factory";
import { useStore } from "@/state/store";
import {
  SHARE_GROUP_NAME,
  SHARE_GROUP_COLOR,
  SHARE_GROUP_SORT_ORDER,
  isShareGroup,
  isSharedItem,
} from "@/lib/share";
import { isItemDeleted } from "@/lib/items";

export const ARCHIVE_GROUP_NAME = "ARCH";
export const ARCHIVE_GROUP_COLOR = "#6A7280";
/** Poprzednia nazwa — rozpoznawana przy migracji i filtrowaniu. */
export const LEGACY_ARCHIVE_GROUP_NAME = "Archiwum";

export const GOOGLE_GROUP_NAME = "GOOGLE";
export const GOOGLE_GROUP_COLOR = "#4285F4";
/** sortOrder grupy GOOGLE — tuż pod grupami użytkownika, nad ARCH (9999). */
export const GOOGLE_GROUP_SORT_ORDER = 9000;

export function isArchiveGroup(group: Pick<Group, "name" | "system">): boolean {
  return (
    group.system === "archive" ||
    group.name === ARCHIVE_GROUP_NAME ||
    group.name === LEGACY_ARCHIVE_GROUP_NAME
  );
}

export function isGoogleGroup(group: Pick<Group, "name" | "system">): boolean {
  return group.system === "google" || group.name === GOOGLE_GROUP_NAME;
}

export function isSystemGroup(group: Pick<Group, "name" | "system">): boolean {
  return isArchiveGroup(group) || isShareGroup(group);
}

/** Nazwa / kolejność / usuwanie zablokowane (ARCH + SHARE). */
export function isGroupStructureLocked(group: Pick<Group, "name" | "system">): boolean {
  return isSystemGroup(group);
}

/** Kolor edytowalny tylko dla grup użytkownika (ARCH ma stały kolor). */
export function isGroupColorLocked(group: Pick<Group, "name" | "system">): boolean {
  return isArchiveGroup(group);
}

export function findArchiveGroup(groups: Group[]): Group | undefined {
  return groups.find(isArchiveGroup);
}

export function findGoogleGroup(groups: Group[]): Group | undefined {
  return groups.find(isGoogleGroup);
}

export function findShareGroup(groups: Group[]): Group | undefined {
  return groups.find(isShareGroup);
}

export function ensureShareGroup(groups: Group[]): Group[] {
  if (findShareGroup(groups)) return groups;
  return [
    ...groups,
    {
      id: uid(),
      name: SHARE_GROUP_NAME,
      color: SHARE_GROUP_COLOR,
      sortOrder: SHARE_GROUP_SORT_ORDER,
      system: "share",
    },
  ];
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

/** Usuwa legacy grupę GOOGLE (integracja Google została wyłączona). */
export function stripGoogleGroups(groups: Group[]): Group[] {
  return groups.filter((g) => !isGoogleGroup(g));
}

/** Zakres filtra widoczności grupy przy filtrze ALL. */
export type GroupFilterScope = "calendar" | "todo" | "tasks" | "events" | "dashboard";

export interface ResolvedGroupVisibility {
  showInSidebar: boolean;
  showInTasks: boolean;
  showInEvents: boolean;
  showInDashboard: boolean;
  showInAll: boolean;
}

export function defaultGroupVisibility(): ResolvedGroupVisibility {
  return {
    showInSidebar: true,
    showInTasks: true,
    showInEvents: true,
    showInDashboard: true,
    showInAll: true,
  };
}

export function resolveGroupVisibility(group: Group): ResolvedGroupVisibility {
  const showInAll =
    group.hideFromAll === true ? false : group.showInAll !== false;
  return {
    showInSidebar: group.showInSidebar !== false,
    showInTasks: group.showInTasks !== false,
    showInEvents: group.showInEvents !== false,
    showInDashboard: group.showInDashboard !== false,
    showInAll,
  };
}

export function isGroupVisibleInSidebar(group: Group): boolean {
  if (isSystemGroup(group)) return true;
  return resolveGroupVisibility(group).showInSidebar;
}

function visibilityForScope(
  visibility: ResolvedGroupVisibility,
  scope: GroupFilterScope,
): boolean {
  switch (scope) {
    case "todo":
    case "tasks":
      return visibility.showInTasks;
    case "calendar":
    case "events":
      return visibility.showInEvents;
    case "dashboard":
      return visibility.showInDashboard;
    default:
      return true;
  }
}

function groupById(groupId: string | null | undefined): Group | undefined {
  if (!groupId) return undefined;
  return useStore.getState().groups.find((g) => g.id === groupId);
}

/** null = ALL; inaczej tylko elementy z danej grupy. */
export function itemMatchesGroupFilter(
  item: Item,
  filterGroupId: string | null,
  scope: GroupFilterScope = "calendar",
): boolean {
  if (isItemDeleted(item)) return false;

  const groups = useStore.getState().groups;
  const archiveId = findArchiveGroup(groups)?.id ?? null;
  const shareId = findShareGroup(groups)?.id ?? null;

  if (shareId && filterGroupId === shareId) {
    return isSharedItem(item);
  }

  if (filterGroupId) {
    if (isSharedItem(item)) return false;
    return item.groupId === filterGroupId;
  }

  // ALL: moje itemy + SHARE; ARCH tylko w zakładce ARCH (nie w liście zadań / dashboard).
  if (isSharedItem(item)) return true;

  if (
    (scope === "todo" || scope === "tasks" || scope === "dashboard") &&
    archiveId &&
    item.groupId === archiveId
  ) {
    return false;
  }

  const group = groupById(item.groupId);
  if (group && !isShareGroup(group)) {
    const visibility = resolveGroupVisibility(group);
    if (!visibility.showInAll) return false;
    if (!visibilityForScope(visibility, scope)) return false;
  }

  return true;
}

/** Przypisz aktywny filtr grupy do nowego elementu (gdy wybrana konkretna grupa). */
export function groupIdForNewItem(explicit?: string | null): string | null {
  if (explicit !== undefined) return explicit;
  const { activeGroupFilter, groups } = useStore.getState();
  const archiveId = findArchiveGroup(groups)?.id ?? null;
  const shareId = findShareGroup(groups)?.id ?? null;
  if (activeGroupFilter && (activeGroupFilter === archiveId || activeGroupFilter === shareId)) {
    return null;
  }
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
    .filter((g) => !isSystemGroup(g))
    .sort((a, b) => a.sortOrder - b.sortOrder);
}
