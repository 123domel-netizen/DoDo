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
  upsertGroup?(
    row: Record<string, unknown>,
  ): Promise<{ error: { code?: string; message: string } | null }>;
  deleteGroup?(id: string): Promise<{ error: { code?: string; message: string } | null }>;
  upsertUserTag?(
    row: Record<string, unknown>,
  ): Promise<{ error: { code?: string; message: string } | null }>;
  deleteUserTag?(id: string): Promise<{ error: { code?: string; message: string } | null }>;
  upsertTagAssignment?(
    row: Record<string, unknown>,
  ): Promise<{ error: { code?: string; message: string } | null }>;
  /** SHARE participant-role content + personal reminders RPC. */
  patchParticipant?(payload: {
    itemId: string;
    description?: string;
    checklist?: unknown;
    attachments?: unknown;
    personalReminders?: unknown;
  }): Promise<{ error: { code?: string; message: string } | null }>;
  /** After owner item upsert — sync item_participants rows. */
  syncOwnerParticipants?(itemId: string, participants: unknown): Promise<{ error: { code?: string; message: string } | null }>;
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
    m.includes("23502") ||
    m.includes("23503") ||
    m.includes("42501") ||
    m.includes("not-null") ||
    m.includes("foreign key") ||
    m.includes("row-level security")
  );
}

export async function runSyncV3WorkerPass(opts: {
  userId: string;
  transport: PushTransport;
  db?: SyncV3Db;
  authUserId: string;
  sortOps?: (ops: SyncOperation[]) => SyncOperation[];
}): Promise<{ processed: number; acked: number; failed: number }> {
  const db = opts.db ?? (await openSyncV3Db(opts.userId));
  const meta = await getMeta(db);
  if (meta.migrationState !== "active") {
    return { processed: 0, acked: 0, failed: 0 };
  }
  if (opts.authUserId !== opts.userId) {
    return { processed: 0, acked: 0, failed: 0 };
  }

  let ready = await listReadyOperations(db, opts.userId);
  if (opts.sortOps) ready = opts.sortOps(ready);
  let acked = 0;
  let failed = 0;

  for (const op of ready) {
    await processOne(db, op, opts);
    const after = await import("@/lib/syncv3/db").then((m) => m.getOperation(db, op.operationId));
    if (!after) acked += 1;
    else if (
      after.status === "quarantined" ||
      after.status === "failed" ||
      after.status === "pending"
    ) {
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
  const inFlight: SyncOperation = { ...op, status: "in_flight", updatedAt: now };
  await updateOperation(db, inFlight);

  let result: { error: { code?: string; message: string } | null };

  if (op.entityType === "item") {
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
    if (opts.transport.fetchRemoteUpdatedAt) {
      const remoteAt = await opts.transport.fetchRemoteUpdatedAt(op.entityId);
      if (isStaleAgainstRemote(op.payload.updatedAt, remoteAt)) {
        await ackOperation(db, op.operationId, op.localRevision);
        return;
      }
    }
    const row = canonicalToSupabaseRow(op.payload, opts.authUserId);
    result =
      op.operationType === "delete" && opts.transport.deleteItem
        ? await opts.transport.deleteItem(op.entityId, row)
        : await opts.transport.upsertItem(row);
    if (
      !result.error &&
      op.operationType !== "delete" &&
      op.payload.shareRole !== "participant" &&
      opts.transport.syncOwnerParticipants
    ) {
      const syncR = await opts.transport.syncOwnerParticipants(
        op.entityId,
        op.payload.participants,
      );
      if (syncR.error) result = syncR;
    }
  } else if (op.entityType === "participant" || op.entityType === "personal_reminder") {
    const snap = op.payload as unknown as {
      itemId?: string;
      id?: string;
      description?: string;
      checklist?: unknown;
      attachments?: unknown;
      personalReminders?: unknown;
    };
    const itemId =
      op.parentItemId ?? snap.itemId ?? snap.id ?? op.entityId.replace(/^pp:|^pr:/, "");
    if (!itemId) {
      await updateOperation(db, {
        ...inFlight,
        status: "quarantined",
        attemptCount: op.attemptCount + 1,
        lastErrorCode: "missing_parent",
        lastErrorMessage: "participant op missing parentItemId",
        nextAttemptAt: nextAttemptIso(op.attemptCount + 1),
      });
      return;
    }
    result = opts.transport.patchParticipant
      ? await opts.transport.patchParticipant({
          itemId,
          description: snap.description,
          checklist: snap.checklist,
          attachments: snap.attachments,
          personalReminders: snap.personalReminders,
        })
      : { error: { message: "patchParticipant unsupported" } };
  } else if (op.entityType === "group") {
    const snap = op.payload as unknown as Record<string, unknown>;
    if (op.operationType === "delete") {
      result = opts.transport.deleteGroup
        ? await opts.transport.deleteGroup(op.entityId)
        : { error: { message: "deleteGroup unsupported" } };
    } else {
      const row = {
        id: op.entityId,
        user_id: opts.authUserId,
        name: snap.name,
        color: snap.color,
        sort_order: snap.sortOrder ?? 0,
        icon: snap.icon ?? null,
        show_in_sidebar: snap.showInSidebar ?? true,
        show_in_tasks: snap.showInTasks ?? true,
        show_in_events: snap.showInEvents ?? true,
        show_in_dashboard: snap.showInDashboard ?? true,
        show_in_all: snap.showInAll ?? true,
      };
      result = opts.transport.upsertGroup
        ? await opts.transport.upsertGroup(row)
        : { error: { message: "upsertGroup unsupported" } };
    }
  } else if (op.entityType === "user_tag") {
    const snap = op.payload as unknown as Record<string, unknown>;
    if (op.operationType === "delete") {
      result = opts.transport.deleteUserTag
        ? await opts.transport.deleteUserTag(op.entityId)
        : { error: { message: "deleteUserTag unsupported" } };
    } else {
      result = opts.transport.upsertUserTag
        ? await opts.transport.upsertUserTag({
            id: op.entityId,
            user_id: opts.authUserId,
            name: snap.name,
            color: snap.color,
            created_at: snap.createdAt,
            updated_at: snap.updatedAt,
          })
        : { error: { message: "upsertUserTag unsupported" } };
    }
  } else if (op.entityType === "tag_assignment") {
    const snap = op.payload as unknown as { itemId: string; tagIds: string[] };
    const rows = (snap.tagIds ?? []).map((tagId) => ({
      user_id: opts.authUserId,
      item_id: snap.itemId ?? op.entityId,
      tag_id: tagId,
    }));
    // Upsert each; empty list = no rows (assignments cleared remotely by separate delete path later)
    result = { error: null };
    if (opts.transport.upsertTagAssignment) {
      for (const row of rows) {
        const r = await opts.transport.upsertTagAssignment(row);
        if (r.error) {
          result = r;
          break;
        }
      }
    } else {
      result = { error: { message: "upsertTagAssignment unsupported" } };
    }
  } else {
    result = { error: { message: `unsupported entityType ${op.entityType}` } };
  }

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
