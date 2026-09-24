import {
  applyRemoteEntities,
  remoteGroupInput,
  remoteItemInput,
  remoteTagAssignmentInput,
  remoteTagInput,
  type ApplyRemoteResult,
} from "@/lib/syncv3/remoteApply";
import {
  hydrateConsistentSnapshot,
  mergeRemotePartialIntoZustand,
} from "@/lib/syncv3/consistentSnapshot";
import type { Group, Item, UserTag } from "@/types";

/**
 * Po udanym IDB commit dla wąskiego (realtime) apply —
 * merge cząstkowy, bez replace całej listy groups.
 */
export function applyRemoteResultToZustand(result: ApplyRemoteResult) {
  if (!result.ok) return;
  mergeRemotePartialIntoZustand({
    items: result.items,
    groups: result.groups,
    tags: result.tags,
    myTagIdsByItem: result.myTagIdsByItem,
  });
}

/**
 * Po pełnym multi-domain pull: IDB jest kompletne → atomowa hydratacja
 * całego snapshotu (groups+items+tags+assignments razem).
 */
export async function applyRemoteSnapshotAtomically(
  userId: string,
  result: ApplyRemoteResult,
): Promise<void> {
  if (!result.ok) return;
  await hydrateConsistentSnapshot(userId);
}

export async function applyRemoteItemsToStore(
  userId: string,
  items: Item[],
): Promise<ApplyRemoteResult> {
  return applyRemoteEntities({
    userId,
    remotes: items.map(remoteItemInput),
    applyToUi: applyRemoteResultToZustand,
  });
}

export async function applyRemoteGroupsToStore(
  userId: string,
  groups: Group[],
): Promise<ApplyRemoteResult> {
  return applyRemoteEntities({
    userId,
    remotes: groups.map((g) => remoteGroupInput(g)),
    applyToUi: applyRemoteResultToZustand,
  });
}

export async function applyRemoteTagsToStore(
  userId: string,
  tags: UserTag[],
): Promise<ApplyRemoteResult> {
  return applyRemoteEntities({
    userId,
    remotes: tags.map(remoteTagInput),
    applyToUi: applyRemoteResultToZustand,
  });
}

export async function applyRemoteTagAssignmentsToStore(
  userId: string,
  map: Record<string, string[]>,
): Promise<ApplyRemoteResult> {
  return applyRemoteEntities({
    userId,
    remotes: Object.entries(map).map(([itemId, tagIds]) =>
      remoteTagAssignmentInput(itemId, tagIds),
    ),
    applyToUi: applyRemoteResultToZustand,
  });
}
