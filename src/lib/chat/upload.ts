import { supabase } from "@/lib/supabase";
import { uid } from "@/lib/factory";
import type { ChatAttachment } from "@/lib/chat/types";
import {
  galleryPerfMark,
  galleryPerfNow,
} from "@/lib/chat/galleryUploadPerf";

function preferredAttachmentPipeline(): "legacy_supabase" | "r2_sp" {
  // Pierwszy rollout: wyłącznie legacy Storage (R2 tylko galerie).
  return "legacy_supabase";
}

/**
 * CHAT3-FILES: załączniki czatu w Supabase Storage.
 * Ścieżka: {conversationId}/{messageId}/{uuid}-{nazwa}. Obrazy kompresowane
 * po stronie klienta (obrona przed limitem egress) + miniatura do feedu.
 *
 * Galerie SharePoint: prepareGalleryPhoto — główne ≤2560 JPEG + miniatura ~480 WebP.
 */

export const CHAT_BUCKET = "chat-attachments";
export const MAX_CHAT_FILE_BYTES = 25 * 1024 * 1024;
const IMAGE_MAX_DIM = 1600;
const THUMB_MAX_DIM = 320;

/** Galeria: dłuższy bok zdjęcia głównego (bez upscale). */
export const GALLERY_MAIN_MAX_DIM = 2560;
/** Galeria: dłuższy bok miniatury podglądowej. */
export const GALLERY_THUMB_MAX_DIM = 480;

function isRasterImageMime(type: string): boolean {
  return /^image\/(jpeg|jpg|png|webp|heic|heif|gif|bmp)$/i.test(type);
}

function sanitizeFileName(name: string): string {
  return name.replace(/[^\w.\-ąćęłńóśźżĄĆĘŁŃÓŚŹŻ ]+/g, "_").slice(0, 80) || "plik";
}

function fileStem(name: string): string {
  const clean = sanitizeFileName(name);
  return clean.replace(/\.[^.]+$/, "") || "zdjecie";
}

function extensionForMime(mime: string): string {
  if (/webp/i.test(mime)) return "webp";
  if (/png/i.test(mime)) return "png";
  return "jpg";
}

interface ImageVariant {
  blob: Blob;
  width: number;
  height: number;
}

type Drawable = HTMLImageElement | ImageBitmap;

function drawableSize(src: Drawable): { w: number; h: number } {
  if (src instanceof HTMLImageElement) {
    return { w: src.naturalWidth || src.width, h: src.naturalHeight || src.height };
  }
  return { w: src.width, h: src.height };
}

/**
 * Dekodowanie z uwzględnieniem EXIF Orientation (createImageBitmap)
 * — krytyczne dla zdjęć z telefonu. Fallback: HTMLImageElement.
 */
async function decodeDrawable(file: Blob): Promise<{ src: Drawable; release: () => void }> {
  if (typeof createImageBitmap === "function") {
    try {
      const bitmap = await createImageBitmap(file, {
        // Chromium / Safari — respektuje Orientation z EXIF
        imageOrientation: "from-image",
      } as ImageBitmapOptions);
      return { src: bitmap, release: () => bitmap.close() };
    } catch {
      // HEIC / uszkodzony plik — spróbuj <img>
    }
  }

  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.decoding = "async";
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error("image load failed"));
      img.src = url;
    });
    return {
      src: img,
      release: () => {
        URL.revokeObjectURL(url);
      },
    };
  } catch (e) {
    URL.revokeObjectURL(url);
    throw e;
  }
}

async function canvasToBlob(
  canvas: HTMLCanvasElement,
  mime: "image/webp" | "image/jpeg",
  quality: number,
): Promise<Blob | null> {
  return new Promise((resolve) => {
    canvas.toBlob((b) => resolve(b), mime, quality);
  });
}

async function scaleDrawable(
  src: Drawable,
  maxDim: number,
  opts: { preferWebp: boolean; quality: number },
): Promise<ImageVariant | null> {
  const { w, h } = drawableSize(src);
  if (!w || !h) return null;
  const scale = Math.min(1, maxDim / Math.max(w, h));
  const width = Math.max(1, Math.round(w * scale));
  const height = Math.max(1, Math.round(h * scale));

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.drawImage(src, 0, 0, width, height);

  let blob: Blob | null = null;
  if (opts.preferWebp) {
    blob = await canvasToBlob(canvas, "image/webp", opts.quality);
    if (!blob || blob.type !== "image/webp") {
      blob = await canvasToBlob(canvas, "image/jpeg", opts.quality);
    }
  } else {
    blob = await canvasToBlob(canvas, "image/jpeg", opts.quality);
  }

  // Zwolnij pamięć canvas (ważne na telefonach).
  canvas.width = 0;
  canvas.height = 0;

  return blob ? { blob, width, height } : null;
}

export interface PreparedUpload {
  data: Blob;
  thumb: Blob | null;
  fileName: string;
  mimeType: string;
  width: number | null;
  height: number | null;
}

export interface PrepareImageOptions {
  maxDim?: number;
  thumbMaxDim?: number;
  mainQuality?: number;
  thumbQuality?: number;
  /** Główne jako WebP (chat) lub JPEG (galeria — lepsza kompatybilność / SharePoint). */
  preferWebpMain?: boolean;
  /** Loguj etapy prepare do [gallery-perf]. */
  trackGalleryPerf?: boolean;
}

export async function prepareUpload(
  file: File,
  options: PrepareImageOptions = {},
): Promise<PreparedUpload> {
  const maxDim = options.maxDim ?? IMAGE_MAX_DIM;
  const thumbMaxDim = options.thumbMaxDim ?? THUMB_MAX_DIM;
  const mainQuality = options.mainQuality ?? 0.82;
  const thumbQuality = options.thumbQuality ?? 0.8;
  const preferWebpMain = options.preferWebpMain ?? true;
  const trackPerf = options.trackGalleryPerf === true;

  const mimeOk = isRasterImageMime(file.type) || /^image\//i.test(file.type);
  if (mimeOk) {
    let release: (() => void) | null = null;
    try {
      const tRead = galleryPerfNow();
      // File/Blob jest już w pamięci przeglądarki — „odczyt” = start decode
      if (trackPerf) galleryPerfMark("read_file", tRead, file.name);

      const tDecode = galleryPerfNow();
      const decoded = await decodeDrawable(file);
      if (trackPerf) galleryPerfMark("decode", tDecode, file.name);
      release = decoded.release;

      const tMain = galleryPerfNow();
      const main = await scaleDrawable(decoded.src, maxDim, {
        preferWebp: preferWebpMain,
        quality: mainQuality,
      });
      if (trackPerf) galleryPerfMark("scale_main", tMain, file.name);

      const tThumb = galleryPerfNow();
      const thumb = await scaleDrawable(decoded.src, thumbMaxDim, {
        preferWebp: true,
        quality: thumbQuality,
      });
      if (trackPerf) galleryPerfMark("scale_thumb", tThumb, file.name);

      if (main) {
        const mimeType = main.blob.type || "image/jpeg";
        const stem = fileStem(file.name);
        return {
          data: main.blob,
          thumb: thumb?.blob ?? null,
          fileName: `${stem}.${extensionForMime(mimeType)}`,
          mimeType,
          width: main.width,
          height: main.height,
        };
      }
    } catch {
      // kompresja / HEIC nieobsługiwane — wyślij oryginał
    } finally {
      release?.();
    }
  }
  return {
    data: file,
    thumb: null,
    fileName: sanitizeFileName(file.name),
    mimeType: file.type || "application/octet-stream",
    width: null,
    height: null,
  };
}

/** Wynik przygotowania zdjęcia galerii (główne + opcjonalna miniatura). */
export interface PreparedGalleryPhoto {
  main: File;
  thumb: Blob | null;
  width: number | null;
  height: number | null;
  /** Miniatura nie powstała (HEIC, pamięć, canvas) — nie blokuje uploadu głównego. */
  thumbFailed: boolean;
}

/**
 * Galeria: ≤2560 px główne (lekki JPEG) + ~480 px WebP miniatura.
 * Bez upscale, z EXIF Orientation. Awaria miniatury nie rzuca.
 */
export async function prepareGalleryPhoto(file: File): Promise<PreparedGalleryPhoto> {
  const t0 = galleryPerfNow();
  const prepared = await prepareUpload(file, {
    maxDim: GALLERY_MAIN_MAX_DIM,
    thumbMaxDim: GALLERY_THUMB_MAX_DIM,
    mainQuality: 0.84,
    thumbQuality: 0.72,
    preferWebpMain: false,
    trackGalleryPerf: true,
  });
  galleryPerfMark("prepare_total", t0, file.name);
  const main = new File([prepared.data], prepared.fileName, {
    type: prepared.mimeType,
    lastModified: file.lastModified,
  });
  return {
    main,
    thumb: prepared.thumb,
    width: prepared.width,
    height: prepared.height,
    thumbFailed: !prepared.thumb,
  };
}

export async function uploadAttachmentsForMessage(
  conversationId: string,
  messageId: string,
  files: File[],
  options: { orgId?: string | null } = {},
): Promise<{ attachments: ChatAttachment[]; errors: string[] }> {
  const attachments: ChatAttachment[] = [];
  const errors: string[] = [];
  if (!supabase) return { attachments, errors: ["Brak chmury."] };

  const useR2 =
    preferredAttachmentPipeline() === "r2_sp" && Boolean(options.orgId);

  for (const file of files) {
    if (file.size > MAX_CHAT_FILE_BYTES) {
      errors.push(`${file.name}: plik przekracza 25 MB.`);
      continue;
    }

    if (useR2 && options.orgId) {
      try {
        const att = await uploadOneAttachmentViaR2(
          conversationId,
          messageId,
          options.orgId,
          file,
        );
        attachments.push(att);
      } catch (e) {
        errors.push(
          `${file.name}: ${e instanceof Error ? e.message : "Upload R2 nie powiódł się."}`,
        );
      }
      continue;
    }

    const prepared = await prepareUpload(file, { preferWebpMain: true });
    const attId = uid();
    const base = `${conversationId}/${messageId}/${attId}-${prepared.fileName}`;

    const { error: upErr } = await supabase.storage
      .from(CHAT_BUCKET)
      .upload(base, prepared.data, { contentType: prepared.mimeType, upsert: true });
    if (upErr) {
      errors.push(`${file.name}: ${upErr.message}`);
      continue;
    }

    let thumbPath: string | null = null;
    if (prepared.thumb) {
      thumbPath = `${conversationId}/${messageId}/${attId}-thumb`;
      const { error: thumbErr } = await supabase.storage
        .from(CHAT_BUCKET)
        .upload(thumbPath, prepared.thumb, {
          contentType: prepared.thumb.type || "image/jpeg",
          upsert: true,
        });
      if (thumbErr) thumbPath = null;
    }

    const { data, error: insErr } = await supabase
      .from("message_attachments")
      .insert({
        id: attId,
        message_id: messageId,
        bucket_path: base,
        thumb_path: thumbPath,
        file_name: prepared.fileName,
        mime_type: prepared.mimeType,
        size_bytes: prepared.data.size,
        width: prepared.width,
        height: prepared.height,
        pipeline: "legacy_supabase",
      })
      .select()
      .single();
    if (insErr) {
      errors.push(`${file.name}: ${insErr.message}`);
      continue;
    }

    attachments.push({
      id: (data.id as string) ?? attId,
      messageId,
      bucketPath: base,
      thumbPath,
      fileName: prepared.fileName,
      mimeType: prepared.mimeType,
      sizeBytes: prepared.data.size,
      width: prepared.width,
      height: prepared.height,
    });
  }

  return { attachments, errors };
}

async function uploadOneAttachmentViaR2(
  conversationId: string,
  messageId: string,
  orgId: string,
  file: File,
): Promise<ChatAttachment> {
  const { supabase: sb } = await import("@/lib/supabase");
  if (!sb) throw new Error("Brak chmury.");
  const prepared = await prepareUpload(file, { preferWebpMain: true });
  const attId = uid();

  const { data: sessionData } = await sb.auth.getSession();
  const token = sessionData.session?.access_token;
  if (!token) throw new Error("Brak sesji.");

  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
  const anon = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

  const presignRes = await fetch(`${supabaseUrl}/functions/v1/gallery-api`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      apikey: anon,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      action: "r2_presign_attachment",
      conversationId,
      messageId,
      orgId,
      attachmentId: attId,
      fileName: prepared.fileName,
      mimeType: prepared.mimeType,
    }),
  });
  const presignJson = (await presignRes.json()) as {
    error?: string;
    putUrl?: string;
    r2Key?: string;
    headers?: Record<string, string>;
  };
  if (!presignRes.ok || presignJson.error || !presignJson.putUrl || !presignJson.r2Key) {
    throw new Error(presignJson.error || "Presign R2 nie powiódł się.");
  }

  const put = await fetch(presignJson.putUrl, {
    method: "PUT",
    headers: presignJson.headers ?? { "content-type": prepared.mimeType },
    body: prepared.data,
  });
  if (!put.ok) throw new Error(`Upload R2 failed (${put.status}).`);

  const confirmRes = await fetch(`${supabaseUrl}/functions/v1/gallery-api`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      apikey: anon,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      action: "r2_confirm_attachment",
      conversationId,
      messageId,
      attachmentId: attId,
      orgId,
      r2Key: presignJson.r2Key,
      fileName: prepared.fileName,
      mimeType: prepared.mimeType,
    }),
  });
  const confirmJson = (await confirmRes.json()) as { error?: string };
  if (!confirmRes.ok || confirmJson.error) {
    throw new Error(confirmJson.error || "Confirm R2 nie powiódł się.");
  }

  return {
    id: attId,
    messageId,
    bucketPath: presignJson.r2Key,
    thumbPath: null,
    fileName: prepared.fileName,
    mimeType: prepared.mimeType,
    sizeBytes: prepared.data.size,
    width: prepared.width,
    height: prepared.height,
  };
}

// Signed URLs (bucket prywatny) z cache w pamięci.
const urlCache = new Map<string, { url: string; expiresAt: number }>();
const SIGNED_URL_TTL_S = 3600;

export async function signedUrlFor(path: string): Promise<string | null> {
  const cached = urlCache.get(path);
  if (cached && cached.expiresAt > Date.now() + 60_000) return cached.url;
  if (!supabase) return null;

  // R2 hot keys — short-lived GET via Edge (membership check).
  if (path.startsWith("hot/teams/")) {
    const { data: sessionData } = await supabase.auth.getSession();
    const token = sessionData.session?.access_token;
    if (!token) return null;
    const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
    const anon = import.meta.env.VITE_SUPABASE_ANON_KEY as string;
    try {
      const res = await fetch(`${supabaseUrl}/functions/v1/gallery-api`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          apikey: anon,
          "content-type": "application/json",
        },
        body: JSON.stringify({ action: "r2_signed_get", key: path }),
      });
      const json = (await res.json()) as { url?: string; error?: string };
      if (!res.ok || !json.url) return null;
      urlCache.set(path, {
        url: json.url,
        expiresAt: Date.now() + Math.min(SIGNED_URL_TTL_S, 900) * 1000,
      });
      return json.url;
    } catch {
      return null;
    }
  }

  const { data, error } = await supabase.storage
    .from(CHAT_BUCKET)
    .createSignedUrl(path, SIGNED_URL_TTL_S);
  if (error || !data?.signedUrl) return null;
  urlCache.set(path, {
    url: data.signedUrl,
    expiresAt: Date.now() + SIGNED_URL_TTL_S * 1000,
  });
  return data.signedUrl;
}

/** Ikona kanału: `{conversationId}/_icon/{uuid}.webp` */
export async function uploadChannelIcon(
  conversationId: string,
  file: File,
): Promise<{ path?: string; error?: string }> {
  if (!supabase) return { error: "Brak chmury." };
  if (!/^image\//i.test(file.type)) return { error: "Wybierz plik obrazu." };
  if (file.size > MAX_CHAT_FILE_BYTES) return { error: "Plik przekracza 25 MB." };

  const prepared = await prepareUpload(file);
  const path = `${conversationId}/_icon/${uid()}`;
  const { error } = await supabase.storage
    .from(CHAT_BUCKET)
    .upload(path, prepared.data, {
      contentType: prepared.mimeType,
      upsert: true,
    });
  if (error) return { error: error.message };
  urlCache.delete(path);
  return { path };
}

export function invalidateSignedUrl(path: string) {
  urlCache.delete(path);
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
