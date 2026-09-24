import { isSharedItem } from "@/lib/share";
import { commitLocalMutation } from "@/lib/syncv3/mutation";
import type { OperationType } from "@/lib/syncv3/types";
import {
  isMigrationGateBlocked,
  isSyncV3WritesEnabledCached,
} from "@/lib/syncv3/activeFlag";
import { wakeSyncV3Worker } from "@/lib/syncv3/wake";
import { commitDomainMutation } from "@/lib/syncv3/domains";
import { useStore } from "@/state/store";
import type { Item } from "@/types";

export function shouldUseSyncV3Mutations(): boolean {
  return (
    Boolean(useStore.getState().authUserId) &&
    isSyncV3WritesEnabledCached() &&
    !isMigrationGateBlocked()
  );
}

function participantEntityId(itemId: string): string {
  return `pp:${itemId}`;
}

/**
 * Jedyna dozwolona granica trwałego zapisu itemu (cloud user).
 * SHARE participant → entityType participant (RPC), nie items upsert.
 */
export async function persistItemViaSyncV3(
  draft: Partial<Item> & { id?: string },
  operationType: OperationType = "upsert",
  uiExtras?: (item: Item) => void,
): Promise<Item | null> {
  const userId = useStore.getState().authUserId;
  if (!userId || !isSyncV3WritesEnabledCached() || isMigrationGateBlocked()) {
    return null;
  }

  const existing = draft.id ? useStore.getState().items[draft.id] : undefined;
  const asParticipant =
    draft.shareRole === "participant" ||
    (existing != null && isSharedItem(existing));

  if (asParticipant && draft.id) {
    const itemId = draft.id;
    await commitDomainMutation({
      userId,
      entityType: "participant",
      entityId: participantEntityId(itemId),
      operationType: "upsert",
      snapshot: {
        id: participantEntityId(itemId),
        itemId,
        description: draft.description ?? existing?.description,
        checklist: draft.checklist ?? existing?.checklist,
        attachments: draft.attachments ?? existing?.attachments,
        personalReminders: draft.personalReminders ?? existing?.personalReminders,
        parentItemId: itemId,
      },
      applyToUi: () => {
        const cur = useStore.getState().items[itemId];
        if (!cur) return;
        const next = {
          ...cur,
          ...draft,
          id: itemId,
          updatedAt: new Date().toISOString(),
        } as Item;
        useStore.setState((s) => ({ items: { ...s.items, [itemId]: next } }));
        uiExtras?.(next);
      },
    });
    return useStore.getState().items[itemId] ?? null;
  }

  const result = await commitLocalMutation({
    userId,
    draft,
    operationType,
    applyToUi: (item) => {
      useStore.setState((s) => ({
        items: { ...s.items, [item.id]: item },
      }));
      uiExtras?.(item);
    },
    wakeWorker: () => wakeSyncV3Worker(),
  });
  return result.item;
}

export async function persistItemsViaSyncV3(
  drafts: Array<{ draft: Partial<Item> & { id: string }; operationType?: OperationType }>,
): Promise<void> {
  for (const row of drafts) {
    await persistItemViaSyncV3(row.draft, row.operationType ?? "upsert");
  }
}
