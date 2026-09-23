import { commitLocalMutation } from "@/lib/syncv3/mutation";
import type { OperationType } from "@/lib/syncv3/types";
import {
  isMigrationGateBlocked,
  isSyncV3WritesEnabledCached,
} from "@/lib/syncv3/activeFlag";
import { wakeSyncV3Worker } from "@/lib/syncv3/wake";
import { useStore } from "@/state/store";
import type { Item } from "@/types";

export function shouldUseSyncV3Mutations(): boolean {
  return (
    Boolean(useStore.getState().authUserId) &&
    isSyncV3WritesEnabledCached() &&
    !isMigrationGateBlocked()
  );
}

/**
 * Jedyna dozwolona granica trwałego zapisu itemu (cloud user).
 * IDB entity+operation → dopiero applyToUi → wakeWorker (wake no-op przed active).
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
