/**
 * Polityka R2 / SharePoint — kopia kontraktu z src/lib/media/pipelinePolicy.ts
 * (Edge Deno nie importuje z src/). Trzymaj w sync przy zmianach polityki.
 */

export type MediaPipeline = "legacy_sp" | "r2_sp";

export const GLOBAL_DEFAULT_PIPELINE: MediaPipeline = "legacy_sp";

export function resolveOrgGalleryPipeline(input: {
  orgMediaPipeline: string | null | undefined;
  orgReadFailed?: boolean;
  r2Configured: boolean;
  clientRequestedPipeline?: string | null;
}): MediaPipeline {
  if (input.orgReadFailed) return GLOBAL_DEFAULT_PIPELINE;
  const org = (input.orgMediaPipeline ?? "").trim();
  if (org !== "r2_sp") return GLOBAL_DEFAULT_PIPELINE;
  if (!input.r2Configured) return GLOBAL_DEFAULT_PIPELINE;
  return "r2_sp";
}

/** Edge: soft-reject legacy gallery_upload_item dla r2_sp — HTTP 409, bez markFailed. */
export function legacyUploadItemRejectionForPipeline(
  galleryPipeline: string | null | undefined,
): { errorCode: "wrong_pipeline"; errorMessage: string; httpStatus: 409 } | null {
  if ((galleryPipeline ?? "").trim() === "r2_sp") {
    return {
      errorCode: "wrong_pipeline",
      errorMessage:
        "Galeria R2 — użyj bezpośredniego uploadu (presign/confirm), nie SharePoint.",
      httpStatus: 409,
    };
  }
  return null;
}

export function resolveAttachmentPipeline(
  _orgMediaPipeline?: string | null,
): "legacy_supabase" {
  return "legacy_supabase";
}

export function galleryFullKey(orgId: string, galleryId: string, itemId: string): string {
  assertUuidLike(orgId, "orgId");
  assertUuidLike(galleryId, "galleryId");
  assertUuidLike(itemId, "itemId");
  return `hot/teams/${orgId}/galleries/${galleryId}/full/${itemId}.jpg`;
}

export function galleryThumbKey(orgId: string, galleryId: string, itemId: string): string {
  assertUuidLike(orgId, "orgId");
  assertUuidLike(galleryId, "galleryId");
  assertUuidLike(itemId, "itemId");
  return `hot/teams/${orgId}/galleries/${galleryId}/thumb/${itemId}.webp`;
}

function assertUuidLike(value: string, label: string): void {
  if (!/^[0-9a-fA-F-]{8,}$/.test(value) || value.includes("/") || value.includes("..")) {
    throw new Error(`Nieprawidłowy ${label}`);
  }
}

export function assertGalleryFullKeyScope(
  key: string,
  expected: { orgId: string; galleryId: string; itemId: string },
): void {
  const want = galleryFullKey(expected.orgId, expected.galleryId, expected.itemId);
  if (key !== want) {
    throw new Error("Klucz R2 poza zakresem galerii / zespołu.");
  }
}

export function validateConfirmHead(input: {
  objectExists: boolean;
  actualSize: number | null | undefined;
  expectedSize: number | null | undefined;
  sizeTolerance?: number;
}):
  | { ok: true }
  | { ok: false; reason: "missing_object" | "size_mismatch" | "bad_key" } {
  if (!input.objectExists) return { ok: false, reason: "missing_object" };
  if (input.expectedSize == null) return { ok: true };
  if (input.actualSize == null) return { ok: true };
  const tol = input.sizeTolerance ?? 64;
  if (Math.abs(input.actualSize - input.expectedSize) > tol) {
    return { ok: false, reason: "size_mismatch" };
  }
  return { ok: true };
}

export function resolveThumbStatusAfterConfirm(input: {
  thumbKey: string | null | undefined;
  thumbExists: boolean;
}): "ready" | "failed" | "skipped" {
  if (!input.thumbKey) return "skipped";
  return input.thumbExists ? "ready" : "failed";
}

export function resolveDualReadSource(input: {
  pipeline: string | null | undefined;
  r2Status: string | null | undefined;
  r2Deleted?: boolean;
  r2Key: string | null | undefined;
  providerItemId: string | null | undefined;
  variant: "full" | "thumb";
  r2KeyThumb?: string | null;
}): "r2" | "sharepoint" | "none" {
  const r2Ready = input.r2Status === "ready" && !input.r2Deleted;
  if (input.variant === "thumb") {
    if (r2Ready && input.r2KeyThumb) return "r2";
    if (input.providerItemId) return "sharepoint";
    return "none";
  }
  if (r2Ready && input.r2Key) return "r2";
  if (input.providerItemId) return "sharepoint";
  return "none";
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

export function shouldCreateSyncJob(input: {
  existingJobs: Array<{ kind: string; refId: string; opId?: string | null; state: string }>;
  kind: string;
  refId: string;
  opId: string;
}): boolean {
  const active = new Set(["pending", "running", "done"]);
  return !input.existingJobs.some(
    (j) =>
      j.kind === input.kind &&
      j.refId === input.refId &&
      (j.opId === input.opId || j.state === "done") &&
      active.has(j.state),
  );
}

export function normalizeOrgMediaPipeline(
  value: string | null | undefined,
): MediaPipeline {
  if (value === "r2_sp") return "r2_sp";
  return GLOBAL_DEFAULT_PIPELINE;
}

export function authorizeGalleryMediaAccess(input: {
  isConversationMember: boolean;
  galleryOrgId: string;
  keyOrgIdFromPath: string;
}): { ok: true } | { ok: false; reason: "forbidden" | "org_mismatch" } {
  if (!input.isConversationMember) return { ok: false, reason: "forbidden" };
  if (input.galleryOrgId !== input.keyOrgIdFromPath) {
    return { ok: false, reason: "org_mismatch" };
  }
  return { ok: true };
}

export function orgIdFromHotKey(key: string): string | null {
  const m = key.match(/^hot\/teams\/([^/]+)\//);
  return m?.[1] ?? null;
}
