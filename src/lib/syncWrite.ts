/**
 * Sync v2 notify bridge — permanently removed.
 * Local durability is commitLocalMutation / commitDomainMutation only.
 */

/** @deprecated Always no-op. Kept only so accidental imports fail loudly in DEV. */
export function notifyLocalItemWrite(itemId: string): void {
  if (import.meta.env.DEV && itemId) {
    console.error("[syncv3] notifyLocalItemWrite removed — use commitLocalMutation");
  }
}
