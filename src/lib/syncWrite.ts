/**
 * Most lokalnych zapisów → kolejka syncu (tylko Sync v2).
 * Po cutoverze Sync v3 notify jest zablokowane — nie wolno używać jako durability.
 */

type LocalWriteHandler = (itemId: string) => void;

let handler: LocalWriteHandler | null = null;
let v3BlocksNotify = false;

export function registerLocalItemWriteHandler(next: LocalWriteHandler | null) {
  handler = next;
}

/** Ustawiane przez bootstrap gdy migrationState === active. */
export function setSyncV3BlocksNotify(blocked: boolean) {
  v3BlocksNotify = blocked;
}

export function isSyncV3BlockingNotify(): boolean {
  return v3BlocksNotify;
}

/**
 * Sync v2 only. Po active Sync v3: no-op (+ DEV error).
 * Nie tworzy operacji v3.
 */
export function notifyLocalItemWrite(itemId: string) {
  if (!itemId) return;
  if (v3BlocksNotify) {
    if (import.meta.env.DEV) {
      console.error(
        "[syncv3] notifyLocalItemWrite forbidden after cutover — mutation must use commitLocalMutation",
        itemId,
      );
    }
    return;
  }
  handler?.(itemId);
}
