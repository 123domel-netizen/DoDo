/**
 * Most lokalnych zapisów itemów → kolejka syncu.
 * Wydzielony plik, żeby `store` nie importował `cloud`/`syncState` cyklicznie.
 */

type LocalWriteHandler = (itemId: string) => void;

let handler: LocalWriteHandler | null = null;

export function registerLocalItemWriteHandler(next: LocalWriteHandler | null) {
  handler = next;
}

/** Wołane z mutacji store (commitDraft, addItem, …) — zawsze, także w trakcie bootu. */
export function notifyLocalItemWrite(itemId: string) {
  if (!itemId) return;
  handler?.(itemId);
}
