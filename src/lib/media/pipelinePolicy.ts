/**
 * Polityka R2 / SharePoint — czysta logika (bez I/O).
 * Używana przez testy i jako kontrakt dla Edge / Workera.
 */

export type MediaPipeline = "legacy_sp" | "r2_sp";

export const GLOBAL_DEFAULT_PIPELINE: MediaPipeline = "legacy_sp";

/** Build-time kill switch: VITE=legacy wymusza legacy po stronie klienta. Nie włącza R2. */
export function clientBuildAllowsR2(viteMediaPipeline: string | undefined | null): boolean {
  const v = (viteMediaPipeline ?? "").toLowerCase().trim();
  return v === "r2" || v === "r2_sp";
}

/**
 * Ostateczna decyzja pipeline'u galerii (backend).
 * - brak/błąd odczytu org → legacy_sp
 * - klient NIE może samodzielnie włączyć r2_sp
 * - r2 wymaga org.media_pipeline=r2_sp ORAZ r2Configured
 */
export function resolveOrgGalleryPipeline(input: {
  orgMediaPipeline: string | null | undefined;
  orgReadFailed?: boolean;
  r2Configured: boolean;
  /** Ignorowane przy włączaniu — tylko dokumentacja / logi */
  clientRequestedPipeline?: string | null;
}): MediaPipeline {
  if (input.orgReadFailed) return GLOBAL_DEFAULT_PIPELINE;
  const org = (input.orgMediaPipeline ?? "").trim();
  if (org !== "r2_sp") return GLOBAL_DEFAULT_PIPELINE;
  if (!input.r2Configured) return GLOBAL_DEFAULT_PIPELINE;
  return "r2_sp";
}

/** Pierwszy rollout: załączniki / voice zawsze legacy niezależnie od org. */
export function resolveAttachmentPipeline(_orgMediaPipeline?: string | null): "legacy_supabase" {
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

export function attachmentKey(
  orgId: string,
  conversationId: string,
  messageId: string,
  attId: string,
  fileName: string,
): string {
  assertUuidLike(orgId, "orgId");
  assertUuidLike(conversationId, "conversationId");
  assertUuidLike(messageId, "messageId");
  assertUuidLike(attId, "attId");
  const safe = fileName.replace(/[^a-zA-Z0-9._\-ąćęłńóśźżĄĆĘŁŃÓŚŹŻ]+/g, "_").slice(0, 80);
  return `hot/teams/${orgId}/attachments/${conversationId}/${messageId}/${attId}-${safe}`;
}

function assertUuidLike(value: string, label: string): void {
  if (!/^[0-9a-fA-F-]{8,}$/.test(value) || value.includes("/") || value.includes("..")) {
    throw new Error(`Nieprawidłowy ${label}`);
  }
}

/** Klucz full musi należeć do org + gallery (+ item). */
export function assertGalleryFullKeyScope(
  key: string,
  expected: { orgId: string; galleryId: string; itemId: string },
): void {
  const want = galleryFullKey(expected.orgId, expected.galleryId, expected.itemId);
  if (key !== want) {
    throw new Error("Klucz R2 poza zakresem galerii / zespołu.");
  }
}

export function assertGalleryThumbKeyScope(
  key: string,
  expected: { orgId: string; galleryId: string; itemId: string },
): void {
  const want = galleryThumbKey(expected.orgId, expected.galleryId, expected.itemId);
  if (key !== want) {
    throw new Error("Klucz miniatury R2 poza zakresem galerii / zespołu.");
  }
}

export type ConfirmSizeResult =
  | { ok: true }
  | { ok: false; reason: "missing_object" | "size_mismatch" | "bad_key" };

export function validateConfirmHead(input: {
  objectExists: boolean;
  actualSize: number | null | undefined;
  expectedSize: number | null | undefined;
  sizeTolerance?: number;
}): ConfirmSizeResult {
  if (!input.objectExists) return { ok: false, reason: "missing_object" };
  if (input.expectedSize == null) return { ok: true };
  if (input.actualSize == null) return { ok: true };
  const tol = input.sizeTolerance ?? 64;
  if (Math.abs(input.actualSize - input.expectedSize) > tol) {
    return { ok: false, reason: "size_mismatch" };
  }
  return { ok: true };
}

export type ThumbConfirmStatus = "ready" | "failed" | "skipped";

/** Miniatura niezależna od full — awaria thumb nie cofa ready full. */
export function resolveThumbStatusAfterConfirm(input: {
  thumbKey: string | null | undefined;
  thumbExists: boolean;
}): ThumbConfirmStatus {
  if (!input.thumbKey) return "skipped";
  return input.thumbExists ? "ready" : "failed";
}

export type DualReadSource = "r2" | "sharepoint" | "none";

export function resolveDualReadSource(input: {
  pipeline: string | null | undefined;
  r2Status: string | null | undefined;
  r2Deleted?: boolean;
  r2Key: string | null | undefined;
  providerItemId: string | null | undefined;
  variant: "full" | "thumb";
  r2KeyThumb?: string | null;
}): DualReadSource {
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
  /** full | thumb — thumbs galerii nigdy auto-delete */
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

/**
 * Czy utworzyć nowy media_sync_jobs przy confirm.
 * Wielokrotne confirm tego samego itemu z tym samym opId → bez duplikatu.
 */
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

/** Consumer: pomiń jeśli już verified lub stale opId. */
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

/**
 * Normalizacja wiadomości Queue.
 * R2 Event Notifications NIE są głównym źródłem — traktuj jako nieznane (ack/ignore),
 * dopóki nie włączymy rekoncyliacji.
 */
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
  // R2 event shape → przyszła rekoncyliacja, nie równorzędne źródło zadania
  if (body.object && typeof body.object === "object") {
    return { kind: null, refId: null, ignoreAsFutureReconciliation: true };
  }
  return { kind: null, refId: null };
}

export function normalizeOrgMediaPipeline(
  value: string | null | undefined,
): MediaPipeline {
  if (value === "r2_sp") return "r2_sp";
  return GLOBAL_DEFAULT_PIPELINE;
}

/** Presign / confirm: membership + zgodność org klucza z galerią. */
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
