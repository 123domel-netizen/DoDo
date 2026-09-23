import { getMeta, openSyncV3Db, type SyncV3Db } from "@/lib/syncv3/db";
import type { MigrationState } from "@/lib/syncv3/types";

/**
 * Writer modes (cloud user):
 * - v3: write + worker push (migrationState === active)
 * - v3_local: write entity+op, worker NIE wysyła (stany migracji)
 * - blocked: failed — brak mutacji sync
 * - local_only: brak userId / brak cloud
 *
 * v2 item writer: USUNIĘTY z runtime.
 */
export type WriterMode = "v3" | "v3_local" | "blocked" | "local_only";

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

export function resolveWriterMode(migrationState: MigrationState): WriterMode {
  if (migrationState === "active") return "v3";
  if (migrationState === "failed") return "blocked";
  if (migrationState === "not_started") return "v3_local"; // bootstrap zaraz startuje migrację; mutacje → v3
  // backing_up | migrating | verifying | awaiting_remote | cutover_ready
  return "v3_local";
}

/** Mutacje sync dozwolone (IDB entity+op). */
export async function canAcceptV3Mutations(
  userId: string,
  db?: SyncV3Db,
): Promise<boolean> {
  const mode = resolveWriterMode(await getMigrationState(userId, db));
  return mode === "v3" || mode === "v3_local";
}

/** Worker push tylko przy active. */
export async function canRunV3Worker(
  userId: string,
  db?: SyncV3Db,
): Promise<boolean> {
  return isSyncV3Active(userId, db);
}

/** @deprecated v2 writer usunięty — zawsze false dla cloud user. */
export async function canRunV2Writer(
  _userId: string | null,
  _db?: SyncV3Db,
): Promise<boolean> {
  return false;
}

export function migrationStateAllowsV3Writes(state: MigrationState): boolean {
  return resolveWriterMode(state) !== "blocked";
}

export function migrationStateAllowsWorker(state: MigrationState): boolean {
  return state === "active";
}
