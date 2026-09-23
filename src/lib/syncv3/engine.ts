import { getMeta, openSyncV3Db, type SyncV3Db } from "@/lib/syncv3/db";
import type { MigrationState } from "@/lib/syncv3/types";

/**
 * Jedyny przełącznik writera.
 * v3 aktywny ⇔ migrationState === 'active'
 * v2 wyłączony gdy active — bez auto-rollbacku do v2.
 */
export async function isSyncV3Active(
  userId: string,
  db?: SyncV3Db,
): Promise<boolean> {
  const database = db ?? (await openSyncV3Db(userId));
  const meta = await getMeta(database);
  return meta.migrationState === "active";
}

export async function getMigrationState(
  userId: string,
  db?: SyncV3Db,
): Promise<MigrationState> {
  const database = db ?? (await openSyncV3Db(userId));
  return (await getMeta(database)).migrationState;
}

/** Czy wolno przyjąć mutacje v3 (active). Przed active — tylko migrator. */
export async function canAcceptV3Mutations(
  userId: string,
  db?: SyncV3Db,
): Promise<boolean> {
  return isSyncV3Active(userId, db);
}

/** Czy writer v2 może enqueue/push. */
export async function canRunV2Writer(
  userId: string | null,
  db?: SyncV3Db,
): Promise<boolean> {
  if (!userId) return true; // brak konta — lokalnie v2 cache
  const active = await isSyncV3Active(userId, db);
  return !active;
}

/**
 * Po rollbacku binarki: jeśli meta.active i brak wsparcia v3 — tryb bezpieczny
 * (brak writera v2 nad pending v3). Testowane w engine.test.ts.
 */
export function resolveWriterMode(migrationState: MigrationState): "v2" | "v3" | "safe_readonly" {
  if (migrationState === "active") return "v3";
  if (
    migrationState === "not_started" ||
    migrationState === "failed"
  ) {
    return "v2";
  }
  // backing_up … cutover_ready: nie włączaj v2 (mogą istnieć parcialne entity)
  return "safe_readonly";
}
