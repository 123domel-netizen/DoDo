import { supabase, cloudEnabled } from "@/lib/supabase";
import { prepareGalleryPhoto, type PreparedGalleryPhoto } from "@/lib/chat/upload";
import {
  galleryPerfMark,
  galleryPerfNow,
  galleryPerfReset,
  galleryPerfSummary,
} from "@/lib/chat/galleryUploadPerf";
import { prepareThenUploadPool } from "@/lib/chat/galleryUploadPool";
import { setGalleryLocalThumb } from "@/lib/chat/galleryLocalThumbs";

import {
  clientBuildAllowsR2,
  clientGalleryUploadUsesR2,
  resolveClientGalleryUploadPipeline,
  type MediaPipeline,
} from "@/lib/media/pipelinePolicy";
import {
  clientBuildPipelineLabel,
  isR2PreviewSurface,
  logMediaPipelineDiag,
} from "@/lib/media/previewSurface";
import {
  nextActionForGalleryPipeline,
  patchMediaUploadDiag,
  recordLastMediaAction,
} from "@/lib/media/mediaUploadDiag";

/**
 * CHAT: galerie zdjęć w czacie (SharePoint V1) — klient Edge Function
 * `gallery-api`. Router jednej funkcji przez `{ action, ... }`; tokeny
 * Microsoft Graph pozostają na serwerze, klient dostaje tylko wyniki
 * (adresy pobrania, statusy, dane galerii/itemów).
 *
 * Pipeline R2: po create wyłącznie `gallery.pipeline` z serwera.
 * `VITE_MEDIA_PIPELINE` to tylko build-time kill switch (nie wybiera uploadu).
 */

export const MAX_GALLERY_UPLOAD_BYTES = 12 * 1024 * 1024; // ~12 MB
export const MAX_GALLERY_ITEMS_PER_CALL = 60;
/** Max równoległych uploadów do gallery-api / Graph. */
export const GALLERY_UPLOAD_CONCURRENCY = 3;

export type GalleryStatus =
  | "draft"
  | "uploading"
  | "ready"
  | "partial"
  | "failed"
  | "unavailable";
export type GalleryItemStatus = "pending" | "uploading" | "ready" | "failed";
export type GalleryThumbStatus = "pending" | "ready" | "failed" | "skipped";

export interface Gallery {
  id: string;
  orgId: string;
  conversationId: string;
  messageId: string | null;
  createdBy: string;
  title: string;
  description: string | null;
  provider: string;
  providerFolderId: string | null;
  providerFolderPath: string | null;
  status: GalleryStatus;
  itemCount: number;
  failedCount: number;
  createdAt: string;
  pipeline?: "legacy_sp" | "r2_sp";
}

export interface GalleryItem {
  id: string;
  galleryId: string;
  sortOrder: number;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  width: number | null;
  height: number | null;
  providerItemId: string | null;
  /** Graph item id miniatury w `_thumbnails/` (powiązanie z głównym plikiem). */
  providerThumbItemId: string | null;
  status: GalleryItemStatus;
  thumbStatus: GalleryThumbStatus;
  errorMessage: string | null;
  r2Status?: string;
  spStatus?: string;
  r2KeyFull?: string | null;
  r2KeyThumb?: string | null;
}

export interface StorageStatus {
  connected: boolean;
  status: "active" | "disconnected" | null;
  provider: string | null;
  siteId: string | null;
  driveId: string | null;
  baseFolderId: string | null;
  baseFolderName: string | null;
  connectedAt: string | null;
  updatedAt: string | null;
  graphConfigured: boolean;
}

export interface StorageConnection {
  id: string;
  orgId: string;
  status: "active" | "disconnected";
  siteId: string | null;
  driveId: string | null;
  baseFolderId: string | null;
  baseFolderName: string | null;
}

export interface StorageOrgOption {
  orgId: string;
  orgName: string;
  baseFolderName: string | null;
  /** Serwerowa flaga zespołu — klient nie może samodzielnie włączyć R2. */
  mediaPipeline?: "legacy_sp" | "r2_sp";
}

export interface NewGalleryItemInput {
  /** Klient może podać id z góry — pozwala dopasować gallery_upload_item. */
  id?: string;
  fileName: string;
  mimeType?: string;
  sizeBytes?: number;
  width?: number;
  height?: number;
}

export type ApiResult<T> = { data?: T; error?: string };

// ---------------------------------------------------------------------------
// Wywołanie Edge Function + wyciąganie komunikatu błędu
// ---------------------------------------------------------------------------

/** supabase-js przy statusie != 2xx nie parsuje body — doczytujemy je z context. */
async function extractErrorMessage(error: unknown): Promise<string> {
  const withContext = error as { context?: Response; message?: string };
  const ctx = withContext?.context;
  if (ctx && typeof ctx.json === "function") {
    try {
      const cloned = typeof ctx.clone === "function" ? ctx.clone() : ctx;
      const body = (await cloned.json()) as { error?: string } | null;
      if (body && typeof body.error === "string") return body.error;
    } catch {
      // treść odpowiedzi mogła nie być JSON-em — użyj komunikatu ogólnego
    }
  }
  return withContext?.message ?? "Błąd komunikacji z serwerem.";
}

async function callGalleryApi<T = Record<string, unknown>>(
  action: string,
  body: Record<string, unknown> = {},
): Promise<ApiResult<T>> {
  if (!supabase) return { error: "Brak chmury." };
  try {
    const { data, error } = await supabase.functions.invoke("gallery-api", {
      body: { action, ...body },
    });
    if (error) {
      return { error: await extractErrorMessage(error) };
    }
    const row = (data ?? {}) as Record<string, unknown>;
    if (typeof row.error === "string") {
      return { error: row.error };
    }
    return { data: row as T };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Błąd komunikacji z serwerem." };
  }
}

// ---------------------------------------------------------------------------
// Magazyn (org_storage_connections) — Ustawienia → Zespół → Magazyn plików
// ---------------------------------------------------------------------------

type StorageRow = {
  status: string;
  provider: string;
  site_id: string | null;
  drive_id: string | null;
  base_folder_id: string | null;
  base_folder_name: string | null;
  connected_at: string | null;
  updated_at: string | null;
};

function rowToStorageStatus(r: StorageRow | null, graphConfigured: boolean): StorageStatus {
  if (!r) {
    return {
      connected: false,
      status: null,
      provider: null,
      siteId: null,
      driveId: null,
      baseFolderId: null,
      baseFolderName: null,
      connectedAt: null,
      updatedAt: null,
      graphConfigured,
    };
  }
  const status = r.status === "disconnected" ? "disconnected" : "active";
  return {
    connected: status === "active" && Boolean(r.base_folder_id),
    status,
    provider: r.provider,
    siteId: r.site_id,
    driveId: r.drive_id,
    baseFolderId: r.base_folder_id,
    baseFolderName: r.base_folder_name,
    connectedAt: r.connected_at,
    updatedAt: r.updated_at,
    graphConfigured,
  };
}

/**
 * Status magazynu: bezpośredni odczyt tabeli (RLS), nie Edge.
 * Edge bywa niedostępny — wcześniej UI wtedy pokazywał „Brak magazynu”
 * mimo aktywnego połączenia w bazie.
 */
export async function fetchStorageStatus(orgId: string): Promise<ApiResult<StorageStatus>> {
  if (!supabase) return { error: "Brak chmury." };

  const { data, error } = await supabase
    .from("org_storage_connections")
    .select(
      "status, provider, site_id, drive_id, base_folder_id, base_folder_name, connected_at, updated_at",
    )
    .eq("org_id", orgId)
    .eq("provider", "sharepoint")
    .maybeSingle();

  if (error) {
    // Fallback: Edge (service role) — gdy SELECT przez RLS zawiedzie.
    const edge = await callGalleryApi<StorageStatus>("storage_status", { orgId });
    if (edge.data) return edge;
    return { error: error.message || edge.error || "Nie udało się odczytać magazynu." };
  }

  return {
    data: rowToStorageStatus((data as StorageRow | null) ?? null, /* graphConfigured */ true),
  };
}

/** Czy serwer ma sekrety Graph — tylko przy edycji formularza. */
export async function fetchGraphConfigured(orgId: string): Promise<boolean> {
  const edge = await callGalleryApi<StorageStatus>("storage_status", { orgId });
  return edge.data?.graphConfigured ?? true;
}

export async function saveStorageConnection(input: {
  orgId: string;
  siteId: string;
  driveId: string;
  baseFolderId: string;
  baseFolderName: string;
}): Promise<ApiResult<{ connection: StorageConnection }>> {
  return callGalleryApi("storage_save", input);
}

export async function disconnectStorage(orgId: string): Promise<ApiResult<{ ok: true }>> {
  return callGalleryApi("storage_disconnect", { orgId });
}

/** Test odczytu/zapisu SharePoint (admin). */
export async function probeStorage(orgId: string): Promise<
  ApiResult<{ ok: boolean; read: boolean; write: boolean }>
> {
  return callGalleryApi("storage_probe", { orgId });
}

export async function fetchMediaPipelineInfo(): Promise<
  ApiResult<{
    r2Configured: boolean;
    graphConfigured: boolean;
    attachmentsR2Enabled: boolean;
  }>
> {
  return callGalleryApi("media_pipeline_info", {});
}

/** Zespoły z aktywnym magazynem, dostępne dla galerii tej rozmowy (picker). */
export async function listStorageOrgsForConversation(
  conversationId: string,
): Promise<ApiResult<{ orgs: StorageOrgOption[] }>> {
  return callGalleryApi("storage_list_orgs_for_conversation", { conversationId });
}

// ---------------------------------------------------------------------------
// Galerie
// ---------------------------------------------------------------------------

export interface CreateGalleryInput {
  conversationId: string;
  orgId: string;
  title: string;
  description?: string;
  items: NewGalleryItemInput[];
  /** r2_sp gdy VITE_MEDIA_PIPELINE=r2 i serwer ma R2. */
  pipeline?: "legacy_sp" | "r2_sp";
}

export interface CreateGalleryResult {
  galleryId: string;
  messageId: string;
  gallery: Gallery;
  items: GalleryItem[];
  pipeline?: "legacy_sp" | "r2_sp";
}

/**
 * Build-time kill switch only.
 * `true` = klient *może* użyć ścieżki R2 gdy serwer zwróci pipeline=r2_sp.
 * Sam Vite flag NIGDY nie włącza R2.
 */
export function clientR2BuildEnabled(): boolean {
  return clientBuildAllowsR2(
    import.meta.env.VITE_MEDIA_PIPELINE as string | undefined,
  );
}

/** @deprecated Użyj clientR2BuildEnabled + gallery.pipeline z serwera. */
export function preferredMediaPipeline(): "legacy_sp" | "r2_sp" {
  // Nigdy nie zwracaj r2_sp tylko z Vite — bezpieczny default legacy.
  return "legacy_sp";
}

export async function fetchOrgMediaPipeline(
  orgId: string,
): Promise<ApiResult<{ mediaPipeline: "legacy_sp" | "r2_sp" }>> {
  return callGalleryApi("org_media_pipeline_get", { orgId });
}

export async function setOrgMediaPipeline(
  orgId: string,
  mediaPipeline: "legacy_sp" | "r2_sp",
): Promise<ApiResult<{ mediaPipeline: "legacy_sp" | "r2_sp" }>> {
  return callGalleryApi("org_media_pipeline_set", { orgId, mediaPipeline });
}

export async function createGallery(
  input: CreateGalleryInput,
): Promise<ApiResult<CreateGalleryResult>> {
  const t0 = galleryPerfNow();
  // Nie wysyłaj pipeline jako włączenia R2 — serwer czyta orgs.media_pipeline.
  const { pipeline: _ignored, ...rest } = input;
  const res = await callGalleryApi<CreateGalleryResult>("gallery_create", rest);
  galleryPerfMark("gallery_create", t0);
  return res;
}

export async function addGalleryItems(
  galleryId: string,
  items: NewGalleryItemInput[],
): Promise<ApiResult<{ items: GalleryItem[]; gallery: Gallery }>> {
  return callGalleryApi("gallery_add_items", { galleryId, items });
}

export async function fetchGallery(
  galleryId: string,
): Promise<ApiResult<{ gallery: Gallery; items: GalleryItem[] }>> {
  return callGalleryApi("gallery_get", { galleryId });
}

export type GalleryUrlVariant = "thumb" | "full";

/** `thumb` — podgląd (~480); `full` — zdjęcie główne (≤2560). */
export async function fetchGalleryItemUrl(
  galleryId: string,
  itemId: string,
  variant: GalleryUrlVariant = "thumb",
): Promise<ApiResult<{ url: string | null; variant: GalleryUrlVariant }>> {
  return callGalleryApi("gallery_item_url", { galleryId, itemId, variant });
}

export async function softDeleteGallery(galleryId: string): Promise<ApiResult<{ ok: true }>> {
  return callGalleryApi("gallery_soft_delete", { galleryId });
}

export async function deleteGalleryStorage(
  galleryId: string,
): Promise<ApiResult<{ ok: true; warning?: string }>> {
  return callGalleryApi("gallery_delete_storage", { galleryId });
}

// ---------------------------------------------------------------------------
// Upload bajtów (multipart/form-data — bez Base64)
// ---------------------------------------------------------------------------

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

async function extractFetchError(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { error?: string } | null;
    if (body && typeof body.error === "string") return body.error;
  } catch {
    // ignore
  }
  return `Błąd uploadu (${res.status}).`;
}

export interface UploadGalleryItemResult {
  item: GalleryItem;
  gallery: Gallery;
}

export interface UploadGalleryItemOptions {
  /** Nadpisz nazwę/mime po prepare (create mógł dostać oryginał HEIC). */
  fileName?: string;
  mimeType?: string;
  width?: number | null;
  height?: number | null;
  /** Domyślnie true — przy pipeline ustaw false i wywołaj recompute na końcu. */
  recompute?: boolean;
  /**
   * Pipeline galerii z serwera — wymagane.
   * Przy `r2_sp` request HTTP jest blokowany (nigdy nie wysyłaj gallery_upload_item).
   */
  galleryPipeline: string | null | undefined;
}

/**
 * Legacy SharePoint multipart (`gallery_upload_item`).
 * Wyłącznie dla `legacy_sp` — wywołuj tylko z `runGalleryUploadPipeline` /
 * `retryGalleryItemUpload` po decyzji pipeline. Nie używaj bezpośrednio z UI.
 * Awaria miniatury nie zwraca błędu — item i tak jest `ready` z `thumbStatus=failed`.
 */
export async function uploadGalleryItem(
  galleryId: string,
  itemId: string,
  file: Blob,
  thumb: Blob | null | undefined,
  options: UploadGalleryItemOptions,
): Promise<ApiResult<UploadGalleryItemResult>> {
  const pipe = (options.galleryPipeline ?? "").trim();
  if (pipe === "r2_sp") {
    recordLastMediaAction("BLOCKED_gallery_upload_item (gallery.pipeline=r2_sp)");
    patchMediaUploadDiag({
      nextAction: "blocked — use r2_presign_gallery_items",
      lastMediaAction: "BLOCKED_gallery_upload_item (gallery.pipeline=r2_sp)",
    });
    return {
      error:
        "Galeria R2 — zablokowano gallery_upload_item przed HTTP. Użyj ścieżki presign/PUT/confirm.",
    };
  }
  if (pipe && pipe !== "legacy_sp") {
    recordLastMediaAction(`BLOCKED_gallery_upload_item (invalid pipeline=${pipe})`);
    return { error: "Nieprawidłowy pipeline galerii — przerwano gallery_upload_item." };
  }

  if (!cloudEnabled || !supabase || !supabaseUrl || !supabaseAnonKey) {
    return { error: "Brak chmury." };
  }
  if (file.size > MAX_GALLERY_UPLOAD_BYTES) {
    return {
      error: `Plik przekracza limit ${Math.round(MAX_GALLERY_UPLOAD_BYTES / (1024 * 1024))} MB.`,
    };
  }
  if (thumb && thumb.size > MAX_GALLERY_UPLOAD_BYTES) {
    thumb = null;
  }

  const tTotal = galleryPerfNow();
  try {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session?.access_token) return { error: "Brak sesji — zaloguj się ponownie." };

    recordLastMediaAction("gallery_upload_item");
    patchMediaUploadDiag({ nextAction: "gallery_upload_item", lastMediaAction: "gallery_upload_item" });

    const form = new FormData();
    form.append("action", "gallery_upload_item");
    form.append("galleryId", galleryId);
    form.append("itemId", itemId);
    form.append("recompute", options.recompute === false ? "0" : "1");
    if (options.fileName) form.append("fileName", options.fileName);
    if (options.mimeType) form.append("mimeType", options.mimeType);
    if (options.width != null) form.append("width", String(options.width));
    if (options.height != null) form.append("height", String(options.height));

    const mainName = options.fileName || "photo.jpg";
    form.append("file", file, mainName);
    if (thumb) {
      form.append("thumb", thumb, "thumb.webp");
      form.append("thumbMimeType", thumb.type || "image/webp");
    } else {
      form.append("skipThumb", "1");
    }

    const tHttp = galleryPerfNow();
    const res = await fetch(`${supabaseUrl}/functions/v1/gallery-api`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${session.access_token}`,
        apikey: supabaseAnonKey,
      },
      body: form,
    });
    galleryPerfMark("upload_http", tHttp, itemId);

    if (!res.ok) {
      recordLastMediaAction(`gallery_upload_item HTTP ${res.status}`);
      return { error: await extractFetchError(res) };
    }
    const row = (await res.json()) as Record<string, unknown>;
    if (typeof row.error === "string") return { error: row.error };
    galleryPerfMark("upload_item_total", tTotal, itemId);
    recordLastMediaAction("gallery_upload_item ok");
    return { data: row as unknown as UploadGalleryItemResult };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Błąd komunikacji z serwerem." };
  }
}

/** Ponowna wysyłka samej miniatury (np. po awarii). */
export async function uploadGalleryThumb(
  galleryId: string,
  itemId: string,
  thumb: Blob,
): Promise<ApiResult<UploadGalleryItemResult>> {
  if (!cloudEnabled || !supabase || !supabaseUrl || !supabaseAnonKey) {
    return { error: "Brak chmury." };
  }
  if (thumb.size > MAX_GALLERY_UPLOAD_BYTES) {
    return { error: "Miniatura przekracza limit rozmiaru." };
  }
  try {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session?.access_token) return { error: "Brak sesji — zaloguj się ponownie." };

    const form = new FormData();
    form.append("action", "gallery_upload_thumb");
    form.append("galleryId", galleryId);
    form.append("itemId", itemId);
    form.append("thumb", thumb, "thumb.webp");
    form.append("thumbMimeType", thumb.type || "image/webp");

    const res = await fetch(`${supabaseUrl}/functions/v1/gallery-api`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${session.access_token}`,
        apikey: supabaseAnonKey,
      },
      body: form,
    });
    if (!res.ok) return { error: await extractFetchError(res) };
    const row = (await res.json()) as Record<string, unknown>;
    if (typeof row.error === "string") return { error: row.error };
    return { data: row as unknown as UploadGalleryItemResult };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Błąd komunikacji z serwerem." };
  }
}

export async function recomputeGalleryCounts(
  galleryId: string,
): Promise<ApiResult<{ gallery: Gallery }>> {
  return callGalleryApi("gallery_recompute", { galleryId });
}

/**
 * Regeneruje miniaturę z pełnego zdjęcia (pobranie full → prepare → upload thumb).
 * Używane gdy `thumbStatus === "failed"` / brak miniatury.
 */
export async function retryGalleryThumb(
  galleryId: string,
  itemId: string,
): Promise<ApiResult<UploadGalleryItemResult>> {
  const urlRes = await fetchGalleryItemUrl(galleryId, itemId, "full");
  if (urlRes.error || !urlRes.data?.url) {
    return { error: urlRes.error || "Brak adresu pełnego zdjęcia." };
  }
  try {
    const res = await fetch(urlRes.data.url);
    if (!res.ok) return { error: "Nie udało się pobrać zdjęcia do miniatury." };
    const blob = await res.blob();
    const file = new File([blob], "retry.jpg", { type: blob.type || "image/jpeg" });
    const prepared = await prepareGalleryPhoto(file);
    if (!prepared.thumb) {
      return { error: "Nie udało się wygenerować miniatury na tym urządzeniu." };
    }
    return uploadGalleryThumb(galleryId, itemId, prepared.thumb);
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Ponowienie miniatury nie powiodło się." };
  }
}

// ---------------------------------------------------------------------------
// Przygotowanie zdjęć (≤2560 + miniatura ~480) przed wysyłką do galerii
// ---------------------------------------------------------------------------

export type { PreparedGalleryPhoto };
export { prepareGalleryPhoto };

export async function prepareGalleryImages(
  files: File[],
  onProgress?: (done: number, total: number) => void,
): Promise<PreparedGalleryPhoto[]> {
  const out: PreparedGalleryPhoto[] = [];
  const total = files.length;
  for (let i = 0; i < files.length; i++) {
    const file = files[i]!;
    try {
      out.push(await prepareGalleryPhoto(file));
    } catch {
      out.push({
        main: file,
        thumb: null,
        width: null,
        height: null,
        thumbFailed: true,
      });
    }
    onProgress?.(i + 1, total);
  }
  return out;
}

export interface PipelineUploadCallbacks {
  onItemStart?: (itemId: string, index: number) => void;
  onItemDone?: (
    itemId: string,
    index: number,
    result: { ok: true } | { ok: false; error: string },
  ) => void;
  onPrepareProgress?: (done: number, total: number) => void;
}

/**
 * Jedyna funkcja startu uploadu po create / add items.
 * Ścieżka wyłącznie z `gallery.pipeline` — bez usedPipeline / org / Vite jako wyboru.
 */
export async function runGalleryUploadPipeline(input: {
  gallery: Pick<Gallery, "id"> & { pipeline?: string | null };
  files: File[];
  itemIds: string[];
  callbacks?: PipelineUploadCallbacks;
}): Promise<void> {
  const { gallery, files, itemIds, callbacks = {} } = input;
  const galleryId = gallery.id;
  galleryPerfReset();
  const tPipe = galleryPerfNow();
  const n = Math.min(files.length, itemIds.length);
  let prepareDone = 0;

  const decision = resolveClientGalleryUploadPipeline({
    galleryPipeline: gallery.pipeline,
    viteMediaPipeline: import.meta.env.VITE_MEDIA_PIPELINE as string | undefined,
  });
  if (!decision.ok) {
    for (let i = 0; i < n; i++) {
      callbacks.onItemDone?.(itemIds[i]!, i, { ok: false, error: decision.error });
    }
    throw new Error(decision.error);
  }

  if (isR2PreviewSurface()) {
    logMediaPipelineDiag({
      galleryId,
      buildPipeline: clientBuildPipelineLabel(),
      galleryPipeline: decision.pipeline,
      selectedUploadRoute: decision.uploadRoute,
    });
  }

  patchMediaUploadDiag({
    galleryId,
    serverGalleryPipeline: decision.pipeline,
    selectedUploadRoute: decision.uploadRoute,
    nextAction: nextActionForGalleryPipeline(decision.pipeline),
    lastMediaAction: "runGalleryUploadPipeline start",
  });

  const useR2 = clientGalleryUploadUsesR2(decision.pipeline);

  let presignById: Map<
    string,
    { putUrlFull: string; putUrlThumb: string; headers: { full: Record<string, string>; thumb: Record<string, string> } }
  > | null = null;

  if (useR2) {
    recordLastMediaAction("r2_presign_gallery_items");
    patchMediaUploadDiag({ nextAction: "r2_presign_gallery_items" });
    const presign = await callGalleryApi<{
      items: Array<{
        itemId: string;
        putUrlFull: string;
        putUrlThumb: string;
        headers: { full: Record<string, string>; thumb: Record<string, string> };
      }>;
    }>("r2_presign_gallery_items", { galleryId, itemIds: itemIds.slice(0, n) });
    if (presign.error || !presign.data?.items?.length) {
      recordLastMediaAction(`r2_presign_gallery_items failed`);
      throw new Error(presign.error || "Nie udało się uzyskać adresów R2.");
    }
    recordLastMediaAction(`r2_presign_gallery_items ok (${presign.data.items.length})`);
    patchMediaUploadDiag({ nextAction: "PUT full (R2)" });
    presignById = new Map(
      presign.data.items.map((p) => [
        p.itemId,
        { putUrlFull: p.putUrlFull, putUrlThumb: p.putUrlThumb, headers: p.headers },
      ]),
    );
  }

  await prepareThenUploadPool(files.slice(0, n), {
    uploadConcurrency: GALLERY_UPLOAD_CONCURRENCY,
    prepare: async (file, index) => {
      try {
        const photo = await prepareGalleryPhoto(file);
        const itemId = itemIds[index]!;
        if (photo.thumb) setGalleryLocalThumb(galleryId, itemId, photo.thumb);
        else setGalleryLocalThumb(galleryId, itemId, file);
        prepareDone++;
        callbacks.onPrepareProgress?.(prepareDone, n);
        return photo;
      } catch {
        prepareDone++;
        callbacks.onPrepareProgress?.(prepareDone, n);
        const itemId = itemIds[index]!;
        setGalleryLocalThumb(galleryId, itemId, file);
        return {
          main: file,
          thumb: null,
          width: null,
          height: null,
          thumbFailed: true,
        } satisfies PreparedGalleryPhoto;
      }
    },
    upload: async (photo, index) => {
      const itemId = itemIds[index]!;
      callbacks.onItemStart?.(itemId, index);
      const isLast = index === n - 1;

      // gallery.pipeline=r2_sp → wyłącznie R2; nigdy gallery_upload_item.
      if (useR2 && presignById) {
        const urls = presignById.get(itemId);
        if (!urls) {
          callbacks.onItemDone?.(itemId, index, {
            ok: false,
            error: "Brak URL R2 dla pozycji.",
          });
          return;
        }
        try {
          recordLastMediaAction("PUT full (R2)");
          patchMediaUploadDiag({ nextAction: "PUT full (R2)" });
          const putFull = await fetch(urls.putUrlFull, {
            method: "PUT",
            headers: urls.headers.full,
            body: photo.main,
          });
          if (!putFull.ok) {
            recordLastMediaAction(`PUT full HTTP ${putFull.status}`);
            throw new Error(`Upload R2 full failed (${putFull.status}).`);
          }
          recordLastMediaAction(`PUT full ok (${putFull.status})`);
          if (photo.thumb) {
            recordLastMediaAction("PUT thumb (R2)");
            patchMediaUploadDiag({ nextAction: "PUT thumb (R2)" });
            const putThumb = await fetch(urls.putUrlThumb, {
              method: "PUT",
              headers: urls.headers.thumb,
              body: photo.thumb,
            });
            if (!putThumb.ok) {
              console.warn("[gallery] R2 thumb upload failed", putThumb.status);
              recordLastMediaAction(`PUT thumb HTTP ${putThumb.status}`);
            } else {
              recordLastMediaAction(`PUT thumb ok (${putThumb.status})`);
            }
          }
          recordLastMediaAction("r2_confirm_gallery_item");
          patchMediaUploadDiag({ nextAction: "r2_confirm_gallery_item" });
          const confirm = await callGalleryApi("r2_confirm_gallery_item", {
            galleryId,
            itemId,
            sizeBytes: photo.main.size,
            fileName: photo.main.name,
            mimeType: photo.main.type || "image/jpeg",
            width: photo.width,
            height: photo.height,
            recompute: isLast,
          });
          if (confirm.error) {
            recordLastMediaAction("r2_confirm_gallery_item failed");
            callbacks.onItemDone?.(itemId, index, { ok: false, error: confirm.error });
          } else {
            recordLastMediaAction("r2_confirm_gallery_item ok");
            patchMediaUploadDiag({ nextAction: "done (await media_sync_job)" });
            callbacks.onItemDone?.(itemId, index, { ok: true });
          }
        } catch (e) {
          callbacks.onItemDone?.(itemId, index, {
            ok: false,
            error: e instanceof Error ? e.message : "Upload R2 nie powiódł się.",
          });
        }
        return;
      }

      const res = await uploadGalleryItem(galleryId, itemId, photo.main, photo.thumb, {
        fileName: photo.main.name,
        mimeType: photo.main.type || "image/jpeg",
        width: photo.width,
        height: photo.height,
        recompute: isLast,
        galleryPipeline: decision.pipeline,
      });
      if (res.error) {
        callbacks.onItemDone?.(itemId, index, { ok: false, error: res.error });
      } else {
        callbacks.onItemDone?.(itemId, index, { ok: true });
      }
    },
  });

  await recomputeGalleryCounts(galleryId);
  galleryPerfMark("pipeline_total", tPipe, `${n} photos`);
  galleryPerfSummary(`gallery ${galleryId} · ${n} zdjęć`);
}

export async function retryGalleryItemUpload(input: {
  gallery: Pick<Gallery, "id"> & { pipeline?: string | null };
  itemId: string;
  file: File;
}): Promise<ApiResult<{ ok: true }>> {
  const { gallery, itemId, file } = input;
  const galleryId = gallery.id;
  const photo = await prepareGalleryPhoto(file);
  if (photo.thumb) setGalleryLocalThumb(galleryId, itemId, photo.thumb);

  const decision = resolveClientGalleryUploadPipeline({
    galleryPipeline: gallery.pipeline,
    viteMediaPipeline: import.meta.env.VITE_MEDIA_PIPELINE as string | undefined,
  });
  if (!decision.ok) return { error: decision.error };

  if (isR2PreviewSurface()) {
    logMediaPipelineDiag({
      galleryId,
      buildPipeline: clientBuildPipelineLabel(),
      galleryPipeline: decision.pipeline,
      selectedUploadRoute: decision.uploadRoute,
    });
  }

  const useR2 = clientGalleryUploadUsesR2(decision.pipeline);
  if (!useR2) {
    const res = await uploadGalleryItem(galleryId, itemId, photo.main, photo.thumb, {
      fileName: photo.main.name,
      mimeType: photo.main.type || "image/jpeg",
      width: photo.width,
      height: photo.height,
      recompute: true,
      galleryPipeline: decision.pipeline,
    });
    return res.error ? { error: res.error } : { data: { ok: true } };
  }

  recordLastMediaAction("r2_presign_gallery_items (retry)");
  patchMediaUploadDiag({
    galleryId,
    serverGalleryPipeline: decision.pipeline,
    selectedUploadRoute: decision.uploadRoute,
    nextAction: "r2_presign_gallery_items",
  });
  const presign = await callGalleryApi<{
    items: Array<{
      itemId: string;
      putUrlFull: string;
      putUrlThumb: string;
      headers: { full: Record<string, string>; thumb: Record<string, string> };
    }>;
  }>("r2_presign_gallery_items", { galleryId, itemIds: [itemId] });
  const urls = presign.data?.items?.[0];
  if (presign.error || !urls) return { error: presign.error || "Brak URL R2." };

  recordLastMediaAction("PUT full (R2 retry)");
  const putFull = await fetch(urls.putUrlFull, {
    method: "PUT",
    headers: urls.headers.full,
    body: photo.main,
  });
  if (!putFull.ok) {
    recordLastMediaAction(`PUT full HTTP ${putFull.status}`);
    return { error: `Upload R2 failed (${putFull.status}).` };
  }
  if (photo.thumb) {
    recordLastMediaAction("PUT thumb (R2 retry)");
    await fetch(urls.putUrlThumb, {
      method: "PUT",
      headers: urls.headers.thumb,
      body: photo.thumb,
    });
  }
  recordLastMediaAction("r2_confirm_gallery_item (retry)");
  const confirm = await callGalleryApi("r2_confirm_gallery_item", {
    galleryId,
    itemId,
    sizeBytes: photo.main.size,
    fileName: photo.main.name,
    mimeType: photo.main.type || "image/jpeg",
    width: photo.width,
    height: photo.height,
    recompute: true,
  });
  if (confirm.error) {
    recordLastMediaAction("r2_confirm_gallery_item failed");
    return { error: confirm.error };
  }
  recordLastMediaAction("r2_confirm_gallery_item ok");
  return { data: { ok: true } };
}

/** @deprecated Prefer runGalleryUploadPipeline({ gallery, ... }) — pipeline z galerii. */
export type GalleryUploadPipeline = MediaPipeline;
