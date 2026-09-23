/** Legacy sync debug removed — no-op stubs for remaining cloud.ts call sites. */

export type SyncPushSkipReason = string;
export type SyncPushTraceStage = string;

export function isSyncDebugEnabled(): boolean {
  return false;
}

export function setSyncDebugHooks(_hooks: unknown): void {}

export function beginSyncDebugCorrelation(): string {
  return "noop";
}

export function getActiveSyncDebugCorrelation(): string | null {
  return null;
}

export function getWatchedItemId(): string | null {
  return null;
}

export function syncDebugTrace(_partial: unknown): void {}

export function isWatchedItem(_itemId: string | null | undefined): boolean {
  return false;
}

export function installSyncDebugApi(): void {}
