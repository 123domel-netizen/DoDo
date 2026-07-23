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
 * Ścieżka uploadu po `gallery_create` — wyłącznie wg `gallery.pipeline`.
 * NIGDY nie degraduj r2_sp → legacy Graph (brak folderu SP → fałszywe `no_storage`).
 * NIGDY nie fallbackuj brak/nieznany pipeline → legacy_sp.
 */
export type ClientGalleryUploadDecision =
  | { ok: true; pipeline: MediaPipeline; uploadRoute: UploadRouteLabel }
  | { ok: false; error: string };

export const R2_CLIENT_REQUIRED_MESSAGE =
  "Ta wersja aplikacji nie obsługuje nowego przesyłania galerii. Odśwież aplikację albo otwórz wersję testową ponownie.";

export const GALLERY_PIPELINE_PROTOCOL_ERROR =
  "Niezgodność klienta i serwera: brak lub nieprawidłowy pipeline galerii. Rekord zachowany do diagnostyki — odśwież aplikację.";

export type BuildPipelineLabel = "r2" | "legacy";
export type UploadRouteLabel = "R2" | "Legacy SharePoint";

export function uploadRouteLabel(pipeline: MediaPipeline): UploadRouteLabel {
  return pipeline === "r2_sp" ? "R2" : "Legacy SharePoint";
}

/** Dopuszczalne wartości protokołu — wszystko inne to błąd. */
export function parseGalleryPipeline(
  value: string | null | undefined,
): MediaPipeline | null {
  const raw = (value ?? "").trim();
  if (raw === "legacy_sp" || raw === "r2_sp") return raw;
  return null;
}

/**
 * Brama przed createGallery: org r2_sp + build bez R2 → przerwij BEZ zapisu.
 */
export function resolveCreateGalleryGate(input: {
  organizationPipeline: string | null | undefined;
  viteMediaPipeline: string | null | undefined;
}):
  | {
      ok: true;
      buildPipeline: BuildPipelineLabel;
      organizationPipeline: MediaPipeline;
      effectivePipeline: MediaPipeline;
    }
  | {
      ok: false;
      error: string;
      buildPipeline: BuildPipelineLabel;
      organizationPipeline: MediaPipeline;
    } {
  const buildPipeline: BuildPipelineLabel = clientBuildAllowsR2(input.viteMediaPipeline)
    ? "r2"
    : "legacy";
  const organizationPipeline: MediaPipeline =
    (input.organizationPipeline ?? "").trim() === "r2_sp" ? "r2_sp" : GLOBAL_DEFAULT_PIPELINE;
  if (organizationPipeline === "r2_sp" && buildPipeline !== "r2") {
    return {
      ok: false,
      error: R2_CLIENT_REQUIRED_MESSAGE,
      buildPipeline,
      organizationPipeline,
    };
  }
  return {
    ok: true,
    buildPipeline,
    organizationPipeline,
    effectivePipeline: organizationPipeline,
  };
}

/**
 * Routing uploadu po create / retry / viewer — wyłącznie `gallery.pipeline`.
 * `viteMediaPipeline` NIE wybiera ścieżki; tylko blokuje R2, gdy build nie obsługuje R2
 * (błąd, nie fallback do legacy).
 *
 * Ignoruj wszelkie lokalne usedPipeline / org / formularz — nie przekazuj ich tutaj.
 */
export function resolveClientGalleryUploadPipeline(input: {
  galleryPipeline: string | null | undefined;
  /** Kill switch build — tylko przy gallery.pipeline=r2_sp. */
  viteMediaPipeline?: string | null | undefined;
}): ClientGalleryUploadDecision {
  const parsed = parseGalleryPipeline(input.galleryPipeline);
  if (!parsed) {
    return { ok: false, error: GALLERY_PIPELINE_PROTOCOL_ERROR };
  }
  if (parsed === "r2_sp" && !clientBuildAllowsR2(input.viteMediaPipeline)) {
    return { ok: false, error: R2_CLIENT_REQUIRED_MESSAGE };
  }
  return {
    ok: true,
    pipeline: parsed,
    uploadRoute: uploadRouteLabel(parsed),
  };
}

/** Czy klient powinien iść ścieżką R2 (presign → PUT → confirm), nie multipart SP. */
export function clientGalleryUploadUsesR2(pipeline: MediaPipeline): boolean {
  return pipeline === "r2_sp";
}

/**
 * Edge: soft-reject legacy `gallery_upload_item` dla galerii r2_sp.
 * HTTP 409 — bez markFailed (stary klient ≠ trwała awaria pliku).
 */
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

/** Elementy talii karty: ready + pending/uploading/failed z lokalnym Blob URL. */
export function selectGalleryDeckItems<T extends { id: string; status: string }>(input: {
  items: T[];
  maxSlots: number;
  hasLocalThumb: (itemId: string) => boolean;
}): T[] {
  const eligible = input.items.filter(
    (it) => it.status === "ready" || input.hasLocalThumb(it.id),
  );
  eligible.sort((a, b) => {
    const ar = a.status === "ready" ? 1 : 0;
    const br = b.status === "ready" ? 1 : 0;
    return br - ar;
  });
  return eligible.slice(0, input.maxSlots);
}

/**
 * UI karty: brak zdalnego thumb URL nie zmienia statusu galerii.
 * Lokalny Blob URL ma pierwszeństwo nad failed remote fetch.
 */
export function preferLocalThumbOverRemoteMiss(input: {
  localThumbUrl: string | null | undefined;
  remoteThumbUrl: string | null | undefined;
}): { url: string | null; remoteMissOnly: boolean } {
  if (input.localThumbUrl) {
    return { url: input.localThumbUrl, remoteMissOnly: false };
  }
  if (input.remoteThumbUrl) {
    return { url: input.remoteThumbUrl, remoteMissOnly: false };
  }
  return { url: null, remoteMissOnly: true };
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

/** Job ledger states (DB CHECK). `running` ≈ processing; `dead` ≈ permanent_failure. */
export type MediaSyncJobState = "pending" | "running" | "done" | "failed" | "dead";

/**
 * Item already verified + job not done → reconcile job to done WITHOUT SharePoint re-upload.
 */
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

/**
 * Allowed job state transitions (no done→pending without admin).
 * `running` is the processing state.
 */
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

/** After successful SP verify — target job state is always done. */
export function jobStateAfterSuccessfulSync(
  current: string | null | undefined,
): "done" | null {
  if ((current ?? "").trim() === "done") return null;
  return "done";
}

/** Permanent failure → dead (schema); otherwise failed for retry. */
export function jobStateAfterSyncError(input: {
  permanent: boolean;
  attempts: number;
  maxAttempts?: number;
}): "failed" | "dead" {
  const max = input.maxAttempts ?? 8;
  if (input.permanent || input.attempts >= max) return "dead";
  return "failed";
}

/** Permanent failure must never delete R2 objects. */
export function shouldDeleteR2OnPermanentFailure(): boolean {
  return false;
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
