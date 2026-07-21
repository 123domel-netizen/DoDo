import { supabase } from "@/lib/supabase";
import { prepareUpload } from "@/lib/chat/upload";

/**
 * CHAT: galerie zdjęć w czacie (SharePoint V1) — klient Edge Function
 * `gallery-api`. Router jednej funkcji przez `{ action, ... }`; tokeny
 * Microsoft Graph pozostają na serwerze, klient dostaje tylko wyniki
 * (adresy pobrania, statusy, dane galerii/itemów).
 */

export const MAX_GALLERY_UPLOAD_BYTES = 12 * 1024 * 1024; // ~12 MB (base64 JSON)
export const MAX_GALLERY_ITEMS_PER_CALL = 60;

export type GalleryStatus =
  | "draft"
  | "uploading"
  | "ready"
  | "partial"
  | "failed"
  | "unavailable";
export type GalleryItemStatus = "pending" | "uploading" | "ready" | "failed";

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
  status: GalleryItemStatus;
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

export async function fetchStorageStatus(orgId: string): Promise<ApiResult<StorageStatus>> {
  return callGalleryApi<StorageStatus>("storage_status", { orgId });
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
  return callGalleryApi<CreateGalleryResult>("gallery_create", { ...input });
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

export async function fetchGalleryItemUrl(
  galleryId: string,
  itemId: string,
): Promise<ApiResult<{ url: string }>> {
  return callGalleryApi("gallery_item_url", { galleryId, itemId });
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
// Upload bajtów (JSON + base64 — prościej w Deno niż multipart)
// ---------------------------------------------------------------------------

async function blobToBase64(blob: Blob): Promise<string> {
  const buf = await blob.arrayBuffer();
  const bytes = new Uint8Array(buf);
  const chunkSize = 0x8000;
  let binary = "";
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

export interface UploadGalleryItemResult {
  item: GalleryItem;
  gallery: Gallery;
}

/** Wysyła bajty pliku do istniejącego (pending) itemu galerii. */
export async function uploadGalleryItem(
  galleryId: string,
  itemId: string,
  file: Blob,
): Promise<ApiResult<UploadGalleryItemResult>> {
  if (file.size > MAX_GALLERY_UPLOAD_BYTES) {
    return {
      error: `Plik przekracza limit ${Math.round(MAX_GALLERY_UPLOAD_BYTES / (1024 * 1024))} MB.`,
    };
  }
  const contentBase64 = await blobToBase64(file);
  return callGalleryApi<UploadGalleryItemResult>("gallery_upload_item", {
    galleryId,
    itemId,
    contentBase64,
  });
}

// ---------------------------------------------------------------------------
// Przygotowanie zdjęć (kompresja + wymiary) przed wysyłką do galerii
// ---------------------------------------------------------------------------

const dimsByFile = new WeakMap<Blob, { width: number; height: number }>();

/** Kompresuje zdjęcia (jak załączniki czatu) i zapamiętuje ich wymiary. */
export async function prepareGalleryImages(files: File[]): Promise<File[]> {
  const out: File[] = [];
  for (const file of files) {
    try {
      const prepared = await prepareUpload(file);
      const outFile = new File([prepared.data], prepared.fileName, {
        type: prepared.mimeType,
        lastModified: file.lastModified,
      });
      if (prepared.width != null && prepared.height != null) {
        dimsByFile.set(outFile, { width: prepared.width, height: prepared.height });
      }
      out.push(outFile);
    } catch {
      out.push(file);
    }
  }
  return out;
}

/** Wymiary (jeśli znane z prepareGalleryImages) — do metadanych itemu. */
export function galleryFileDims(file: Blob): { width?: number; height?: number } {
  const d = dimsByFile.get(file);
  return d ? { width: d.width, height: d.height } : {};
}
