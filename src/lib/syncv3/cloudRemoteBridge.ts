import {
  applyRemoteEntities,
  remoteGroupInput,
  remoteItemInput,
  remoteTagAssignmentInput,
  remoteTagInput,
  type ApplyRemoteResult,
} from "@/lib/syncv3/remoteApply";
import { useStore } from "@/state/store";
import type { Group, Item, UserTag } from "@/types";

/** Po udanym IDB commit — scal wynik remote apply do Zustand. */
export function applyRemoteResultToZustand(result: ApplyRemoteResult) {
  if (!result.ok) return;
  useStore.setState((s) => {
    const items = { ...s.items };
    for (const [id, item] of Object.entries(result.items)) {
      items[id] = item;
    }
    let groups = s.groups;
    if (result.groups.length) {
      const byId = new Map(groups.map((g) => [g.id, g]));
      for (const g of result.groups) byId.set(g.id, g);
      groups = [...byId.values()];
    }
    const tags = { ...s.tags, ...result.tags };
    const myTagIdsByItem = { ...s.myTagIdsByItem, ...result.myTagIdsByItem };
    return { items, groups, tags, myTagIdsByItem };
  });
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
