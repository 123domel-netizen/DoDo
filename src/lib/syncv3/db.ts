import { uid } from "@/lib/factory";
import {
  DEFAULT_META,
  dbNameForUser,
  type EntityRecord,
  type EntityType,
  type SyncOperation,
  type SyncV3Backup,
  type SyncV3Meta,
} from "@/lib/syncv3/types";

const DB_VERSION = 1;

export type SyncV3Db = IDBDatabase;

function reqToPromise<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("idb request failed"));
  });
}

function txDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(tx.error ?? new Error("idb transaction aborted"));
    tx.onerror = () => reject(tx.error ?? new Error("idb transaction error"));
  });
}

export async function openSyncV3Db(userId: string): Promise<SyncV3Db> {
  const name = dbNameForUser(userId);
  return new Promise((resolve, reject) => {
    const open = indexedDB.open(name, DB_VERSION);
    open.onupgradeneeded = () => {
      const db = open.result;
      if (!db.objectStoreNames.contains("entities")) {
        const entities = db.createObjectStore("entities", { keyPath: "entityId" });
        entities.createIndex("byUserType", ["userId", "entityType"], { unique: false });
      }
      if (!db.objectStoreNames.contains("operations")) {
        const ops = db.createObjectStore("operations", { keyPath: "operationId" });
        ops.createIndex("byEntity", ["userId", "entityType", "entityId"], { unique: false });
        ops.createIndex("byStatusNext", ["userId", "status", "nextAttemptAt"], {
          unique: false,
        });
      }
      if (!db.objectStoreNames.contains("meta")) {
        db.createObjectStore("meta", { keyPath: "key" });
      }
      if (!db.objectStoreNames.contains("backups")) {
        db.createObjectStore("backups", { keyPath: "backupId" });
      }
    };
    open.onsuccess = () => resolve(open.result);
    open.onerror = () => reject(open.error ?? new Error("failed to open sync v3 db"));
  });
}

export async function deleteSyncV3Db(userId: string): Promise<void> {
  const name = dbNameForUser(userId);
  await new Promise<void>((resolve, reject) => {
    const req = indexedDB.deleteDatabase(name);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error ?? new Error("deleteDatabase failed"));
    // fake-indexeddb may leave connections; don't hang forever
    req.onblocked = () => resolve();
    setTimeout(() => resolve(), 100);
  });
}

const META_KEY = "sync";

export async function getMeta(db: SyncV3Db): Promise<SyncV3Meta> {
  const tx = db.transaction("meta", "readonly");
  const row = await reqToPromise(
    tx.objectStore("meta").get(META_KEY) as IDBRequest<{ key: string; value: SyncV3Meta } | undefined>,
  );
  await txDone(tx);
  return row?.value ?? { ...DEFAULT_META };
}

export async function putMeta(db: SyncV3Db, meta: SyncV3Meta): Promise<void> {
  const tx = db.transaction("meta", "readwrite");
  tx.objectStore("meta").put({ key: META_KEY, value: meta });
  await txDone(tx);
}

export async function getEntity(
  db: SyncV3Db,
  entityId: string,
): Promise<EntityRecord | undefined> {
  const tx = db.transaction("entities", "readonly");
  const row = await reqToPromise(
    tx.objectStore("entities").get(entityId) as IDBRequest<EntityRecord | undefined>,
  );
  await txDone(tx);
  return row;
}

export async function listEntities(db: SyncV3Db, userId: string): Promise<EntityRecord[]> {
  const tx = db.transaction("entities", "readonly");
  const all = await reqToPromise(
    tx.objectStore("entities").getAll() as IDBRequest<EntityRecord[]>,
  );
  await txDone(tx);
  return all.filter((e) => e.userId === userId);
}

export async function getOperationsForEntity(
  db: SyncV3Db,
  userId: string,
  entityType: EntityType,
  entityId: string,
): Promise<SyncOperation[]> {
  const tx = db.transaction("operations", "readonly");
  const idx = tx.objectStore("operations").index("byEntity");
  const rows = await reqToPromise(
    idx.getAll([userId, entityType, entityId]) as IDBRequest<SyncOperation[]>,
  );
  await txDone(tx);
  return rows;
}

export async function getActiveOperationsForEntity(
  db: SyncV3Db,
  userId: string,
  entityType: EntityType,
  entityId: string,
): Promise<SyncOperation[]> {
  const rows = await getOperationsForEntity(db, userId, entityType, entityId);
  return rows.filter((o) => o.status === "pending" || o.status === "in_flight");
}

export async function listReadyOperations(
  db: SyncV3Db,
  userId: string,
  nowIso = new Date().toISOString(),
): Promise<SyncOperation[]> {
  const tx = db.transaction("operations", "readonly");
  const all = await reqToPromise(
    tx.objectStore("operations").getAll() as IDBRequest<SyncOperation[]>,
  );
  await txDone(tx);
  return all
    .filter(
      (o) =>
        o.userId === userId &&
        o.status === "pending" &&
        o.nextAttemptAt <= nowIso,
    )
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export async function getOperation(
  db: SyncV3Db,
  operationId: string,
): Promise<SyncOperation | undefined> {
  const tx = db.transaction("operations", "readonly");
  const row = await reqToPromise(
    tx.objectStore("operations").get(operationId) as IDBRequest<SyncOperation | undefined>,
  );
  await txDone(tx);
  return row;
}

export async function putBackup(db: SyncV3Db, backup: SyncV3Backup): Promise<void> {
  const tx = db.transaction("backups", "readwrite");
  tx.objectStore("backups").put(backup);
  await txDone(tx);
}

export async function getBackup(
  db: SyncV3Db,
  backupId: string,
): Promise<SyncV3Backup | undefined> {
  const tx = db.transaction("backups", "readonly");
  const row = await reqToPromise(
    tx.objectStore("backups").get(backupId) as IDBRequest<SyncV3Backup | undefined>,
  );
  await txDone(tx);
  return row;
}

export interface AtomicMutationWrite {
  entity: EntityRecord;
  /** Operacje do put (nowe lub zaktualizowane). */
  upsertOps: SyncOperation[];
  /** Operacje do usunięcia (np. zastąpione przez delete coalesce). */
  deleteOpIds: string[];
}

/**
 * Jedyna ścieżka trwałego zapisu entity + operations (mutacje lokalne).
 * Sukces ⇒ commit; błąd ⇒ abort — UI nie wolno aktualizować.
 */
export async function commitEntityAndOperations(
  db: SyncV3Db,
  write: AtomicMutationWrite,
): Promise<void> {
  const tx = db.transaction(["entities", "operations"], "readwrite");
  const entities = tx.objectStore("entities");
  const operations = tx.objectStore("operations");
  entities.put(write.entity);
  for (const id of write.deleteOpIds) operations.delete(id);
  for (const op of write.upsertOps) operations.put(op);
  await txDone(tx);
}

/** Zapis samej encji (merge remote / hydrate) — bez tworzenia lokalnej operacji. */
export async function putEntityRecord(db: SyncV3Db, entity: EntityRecord): Promise<void> {
  const tx = db.transaction("entities", "readwrite");
  tx.objectStore("entities").put(entity);
  await txDone(tx);
}

/** Atomowy batch remote apply — wszystkie encje w jednej transakcji. */
export async function putEntitiesBatch(db: SyncV3Db, entities: EntityRecord[]): Promise<void> {
  if (!entities.length) return;
  const tx = db.transaction("entities", "readwrite");
  const store = tx.objectStore("entities");
  for (const entity of entities) store.put(entity);
  await txDone(tx);
}

/** Usuń encje po id (np. flood wirtualnych SHARE) — jedna transakcja. */
export async function deleteEntitiesBatch(db: SyncV3Db, entityIds: string[]): Promise<number> {
  if (!entityIds.length) return 0;
  const tx = db.transaction("entities", "readwrite");
  const store = tx.objectStore("entities");
  for (const id of entityIds) store.delete(id);
  await txDone(tx);
  return entityIds.length;
}

export async function updateOperation(
  db: SyncV3Db,
  op: SyncOperation,
): Promise<void> {
  const tx = db.transaction("operations", "readwrite");
  tx.objectStore("operations").put(op);
  await txDone(tx);
}

export async function deleteOperation(db: SyncV3Db, operationId: string): Promise<void> {
  const tx = db.transaction("operations", "readwrite");
  tx.objectStore("operations").delete(operationId);
  await txDone(tx);
}

/**
 * ACK: usuń wyłącznie tę operację. Nowsza pending dla tego samego entity zostaje.
 */
export async function ackOperation(
  db: SyncV3Db,
  operationId: string,
  expectedRevision?: number,
): Promise<{ removed: boolean; reason?: string }> {
  const existing = await getOperation(db, operationId);
  if (!existing) return { removed: false, reason: "missing" };
  if (expectedRevision != null && existing.localRevision !== expectedRevision) {
    return { removed: false, reason: "revision_mismatch" };
  }
  await deleteOperation(db, operationId);
  return { removed: true };
}

export function newOperationId(): string {
  return uid();
}
