import {
  canonicalToSupabaseRow,
  isStaleAgainstRemote,
  validateCanonicalForPush,
} from "@/lib/syncv3/canonical";
import {
  ackOperation,
  getMeta,
  listReadyOperations,
  openSyncV3Db,
  updateOperation,
  type SyncV3Db,
} from "@/lib/syncv3/db";
import type { SyncOperation } from "@/lib/syncv3/types";

export interface PushTransport {
  upsertItem(
    row: Record<string, unknown>,
  ): Promise<{ error: { code?: string; message: string } | null; remoteUpdatedAt?: string | null }>;
  deleteItem?(
    id: string,
    row: Record<string, unknown>,
  ): Promise<{ error: { code?: string; message: string } | null }>;
  fetchRemoteUpdatedAt?(id: string): Promise<string | null>;
}

const BACKOFF_BASE_MS = 5_000;
const BACKOFF_CAP_MS = 5 * 60_000;

function nextAttemptIso(attemptCount: number, now = Date.now()): string {
  const delay = Math.min(BACKOFF_BASE_MS * 2 ** Math.min(attemptCount, 6), BACKOFF_CAP_MS);
  return new Date(now + delay).toISOString();
}

function isPermanent(code?: string, message?: string): boolean {
  const m = `${code ?? ""} ${message ?? ""}`.toLowerCase();
  return (
    m.includes("23502") || // not null
    m.includes("23503") || // fk
    m.includes("42501") || // insufficient privilege / rls-ish
    m.includes("not-null") ||
    m.includes("foreign key") ||
    m.includes("row-level security")
  );
}

/**
 * Przetwarza gotowe operacje pojedynczo.
 * Jeden błąd nie blokuje pozostałych.
 */
export async function runSyncV3WorkerPass(opts: {
  userId: string;
  transport: PushTransport;
  db?: SyncV3Db;
  authUserId: string;
}): Promise<{ processed: number; acked: number; failed: number }> {
  const db = opts.db ?? (await openSyncV3Db(opts.userId));
  const meta = await getMeta(db);
  if (meta.migrationState !== "active") {
    return { processed: 0, acked: 0, failed: 0 };
  }
  if (opts.authUserId !== opts.userId) {
    return { processed: 0, acked: 0, failed: 0 };
  }

  const ready = await listReadyOperations(db, opts.userId);
  let acked = 0;
  let failed = 0;

  for (const op of ready) {
    await processOne(db, op, opts);
    const after = await import("@/lib/syncv3/db").then((m) => m.getOperation(db, op.operationId));
    if (!after) acked += 1;
    else if (after.status === "quarantined" || after.status === "failed" || after.status === "pending") {
      if (after.status !== "pending" || after.attemptCount > op.attemptCount) failed += 1;
    }
  }

  return { processed: ready.length, acked, failed };
}

async function processOne(
  db: SyncV3Db,
  op: SyncOperation,
  opts: { transport: PushTransport; authUserId: string },
): Promise<void> {
  const now = new Date().toISOString();
  const inFlight: SyncOperation = {
    ...op,
    status: "in_flight",
    updatedAt: now,
  };
  await updateOperation(db, inFlight);

  const validated = validateCanonicalForPush(op.payload);
  if (!validated.ok) {
    await updateOperation(db, {
      ...inFlight,
      status: "quarantined",
      attemptCount: op.attemptCount + 1,
      lastErrorCode: validated.code,
      lastErrorMessage: validated.message,
      nextAttemptAt: nextAttemptIso(op.attemptCount + 1),
    });
    return;
  }

  // Stale guard: nie nadpisuj nowszego remote starszym snapshotem przy retry
  if (opts.transport.fetchRemoteUpdatedAt) {
    const remoteAt = await opts.transport.fetchRemoteUpdatedAt(op.entityId);
    if (isStaleAgainstRemote(op.payload.updatedAt, remoteAt)) {
      // Lokalna op jest starsza niż remote — ACK jako zbędna (nie cofaj chmury)
      await ackOperation(db, op.operationId, op.localRevision);
      return;
    }
  }

  const row = canonicalToSupabaseRow(op.payload, opts.authUserId);
  const result =
    op.operationType === "delete" && opts.transport.deleteItem
      ? await opts.transport.deleteItem(op.entityId, row)
      : await opts.transport.upsertItem(row);

  if (!result.error) {
    await ackOperation(db, op.operationId, op.localRevision);
    return;
  }

  const permanent = isPermanent(result.error.code, result.error.message);
  await updateOperation(db, {
    ...op,
    status: permanent ? "quarantined" : "pending",
    attemptCount: op.attemptCount + 1,
    lastErrorCode: result.error.code ?? "push_error",
    lastErrorMessage: result.error.message,
    nextAttemptAt: nextAttemptIso(op.attemptCount + 1),
    updatedAt: new Date().toISOString(),
  });
}

let wakeTimer: ReturnType<typeof setTimeout> | null = null;

export function scheduleWakeWorker(run: () => void, delayMs = 50): void {
  if (wakeTimer) clearTimeout(wakeTimer);
  wakeTimer = setTimeout(() => {
    wakeTimer = null;
    run();
  }, delayMs);
}
