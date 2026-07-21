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

/**
 * CHAT: galerie zdjęć w czacie (SharePoint V1) — klient Edge Function
 * `gallery-api`. Router jednej funkcji przez `{ action, ... }`; tokeny
 * Microsoft Graph pozostają na serwerze, klient dostaje tylko wyniki
 * (adresy pobrania, statusy, dane galerii/itemów).
 *
 * Miniatury: własne, w `{folder-galerii}/_thumbnails/` — nie Graph thumbs
 * (przewidywalne i przenośne na OneDrive / Google Drive).
 *
 * Upload: multipart/form-data (binarnie), bez Base64. Współbieżność max 3.
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
}

export interface CreateGalleryResult {
  galleryId: string;
  messageId: string;
  gallery: Gallery;
  items: GalleryItem[];
}

export async function createGallery(
  input: CreateGalleryInput,
): Promise<ApiResult<CreateGalleryResult>> {
  const t0 = galleryPerfNow();
  const res = await callGalleryApi<CreateGalleryResult>("gallery_create", { ...input });
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
}

/**
 * Wysyła zdjęcie główne (+ opcjonalną miniaturę) binarnie (multipart).
 * Awaria miniatury nie zwraca błędu — item i tak jest `ready` z `thumbStatus=failed`.
 */
export async function uploadGalleryItem(
  galleryId: string,
  itemId: string,
  file: Blob,
  thumb?: Blob | null,
  options: UploadGalleryItemOptions = {},
): Promise<ApiResult<UploadGalleryItemResult>> {
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
      return { error: await extractFetchError(res) };
    }
    const row = (await res.json()) as Record<string, unknown>;
    if (typeof row.error === "string") return { error: row.error };
    galleryPerfMark("upload_item_total", tTotal, itemId);
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
 * Pipeline: create już zrobione — prepare sekwencyjnie + upload max 3 równolegle.
 * Lokalne miniatury ustawiane zaraz po prepare.
 */
export async function runGalleryUploadPipeline(
  galleryId: string,
  files: File[],
  itemIds: string[],
  callbacks: PipelineUploadCallbacks = {},
): Promise<void> {
  galleryPerfReset();
  const tPipe = galleryPerfNow();
  const n = Math.min(files.length, itemIds.length);
  let prepareDone = 0;

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
      const res = await uploadGalleryItem(galleryId, itemId, photo.main, photo.thumb, {
        fileName: photo.main.name,
        mimeType: photo.main.type || "image/jpeg",
        width: photo.width,
        height: photo.height,
        // Ostatni upload przelicza status; przy race i tak wołamy recompute na końcu.
        recompute: isLast,
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
