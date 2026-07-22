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
