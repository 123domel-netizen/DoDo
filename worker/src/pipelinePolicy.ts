/**
 * Worker copy of queue/sync policy (keep in sync with src/lib/media/pipelinePolicy.ts).
 */

export function shouldProcessArchiveJob(input: {
  spStatus: string | null | undefined;
  spDriveItemId: string | null | undefined;
  r2Status: string | null | undefined;
  jobOpId?: string | null;
  rowOpId?: string | null;
}): { process: boolean; reason?: string } {
  if (input.spStatus === "verified" && input.spDriveItemId) {
    return { process: false, reason: "already_verified" };
  }
  if (input.r2Status !== "ready") {
    return { process: false, reason: "not_r2_ready" };
  }
  if (input.jobOpId && input.rowOpId && input.jobOpId !== input.rowOpId) {
    return { process: false, reason: "stale_op" };
  }
  return { process: true };
}

export function normalizeQueueMessage(body: Record<string, unknown>): {
  kind: "gallery_full" | "attachment" | "cleanup_r2" | null;
  refId: string | null;
  ignoreAsFutureReconciliation?: boolean;
} {
  const kind = body.kind;
  if (kind === "gallery_full" || kind === "attachment" || kind === "cleanup_r2") {
    return {
      kind,
      refId: typeof body.refId === "string" ? body.refId : null,
    };
  }
  if (body.object && typeof body.object === "object") {
    return { kind: null, refId: null, ignoreAsFutureReconciliation: true };
  }
  return { kind: null, refId: null };
}

export function shouldCleanupR2Object(input: {
  spStatus: string | null | undefined;
  r2Status: string | null | undefined;
  r2DeletedAt: string | null | undefined;
  r2DeleteAfter: string | null | undefined;
  retentionHold: boolean;
  nowIso: string;
  objectKind: "gallery_full" | "gallery_thumb" | "attachment";
}): boolean {
  if (input.objectKind === "gallery_thumb") return false;
  if (input.retentionHold) return false;
  if (input.spStatus !== "verified") return false;
  if (input.r2Status !== "ready") return false;
  if (input.r2DeletedAt) return false;
  if (!input.r2DeleteAfter) return false;
  return input.r2DeleteAfter < input.nowIso;
}

/** Job ledger: `running` ≈ processing; `dead` ≈ permanent_failure. */
export type MediaSyncJobState = "pending" | "running" | "done" | "failed" | "dead";

export function shouldReconcileJobWithoutUpload(input: {
  itemSpStatus: string | null | undefined;
  itemHasSpDriveItem: boolean;
  jobState: string | null | undefined;
}): boolean {
  if ((input.itemSpStatus ?? "").trim() !== "verified") return false;
  if (!input.itemHasSpDriveItem) return false;
  const st = (input.jobState ?? "").trim();
  return st !== "done" && st !== "";
}

/** Cron must never re-enqueue items that are already verified. */
export function shouldCronEnqueueGalleryItem(spStatus: string | null | undefined): boolean {
  const s = (spStatus ?? "").trim();
  return s === "queued" || s === "failed" || s === "retry_scheduled";
}

export function canTransitionJobState(
  from: string | null | undefined,
  to: string,
): boolean {
  const f = (from ?? "pending").trim();
  const allowed: Record<string, readonly string[]> = {
    pending: ["running", "done", "failed"],
    running: ["done", "failed", "dead"],
    failed: ["pending", "running", "dead", "done"],
    done: [],
    dead: ["done"],
  };
  return (allowed[f] ?? []).includes(to);
}

export function jobStateAfterSuccessfulSync(
  current: string | null | undefined,
): "done" | null {
  if ((current ?? "").trim() === "done") return null;
  return "done";
}

export function jobStateAfterSyncError(input: {
  permanent: boolean;
  attempts: number;
  maxAttempts?: number;
}): "failed" | "dead" {
  const max = input.maxAttempts ?? 8;
  if (input.permanent || input.attempts >= max) return "dead";
  return "failed";
}

/** Permanent failure must never trigger R2 delete. */
export function shouldDeleteR2OnPermanentFailure(): boolean {
  return false;
}
