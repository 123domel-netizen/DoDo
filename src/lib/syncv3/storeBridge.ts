import { commitLocalMutation, type OperationType } from "@/lib/syncv3";
import { isSyncV3ActiveCached, wakeSyncV3Worker } from "@/lib/syncv3/bootstrap";
import { useStore } from "@/state/store";
import type { Item } from "@/types";

/**
 * Trwała mutacja v3: IDB najpierw, potem Zustand.
 * Wywoływać zamiast setState+notify gdy isSyncV3ActiveCached().
 */
export async function persistItemViaSyncV3(
  draft: Partial<Item> & { id?: string },
  operationType: OperationType = "upsert",
): Promise<Item | null> {
  const userId = useStore.getState().authUserId;
  if (!userId || !isSyncV3ActiveCached()) return null;

  const result = await commitLocalMutation({
    userId,
    draft,
    operationType,
    applyToUi: (item) => {
      useStore.setState((s) => ({
        items: { ...s.items, [item.id]: item },
      }));
    },
    wakeWorker: () => wakeSyncV3Worker(),
  });
  return result.item;
}

export function shouldUseSyncV3Mutations(): boolean {
  return Boolean(useStore.getState().authUserId) && isSyncV3ActiveCached();
}
