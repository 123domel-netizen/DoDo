import { supabase } from "@/lib/supabase";
import { uid } from "@/lib/factory";
import type { ChatAttachment } from "@/lib/chat/types";

/**
 * CHAT3-FILES: załączniki czatu w Supabase Storage.
 * Ścieżka: {conversationId}/{messageId}/{uuid}-{nazwa}. Obrazy kompresowane
 * po stronie klienta (obrona przed limitem egress) + miniatura do feedu.
 */

export const CHAT_BUCKET = "chat-attachments";
export const MAX_CHAT_FILE_BYTES = 25 * 1024 * 1024;
const IMAGE_MAX_DIM = 1600;
const THUMB_MAX_DIM = 320;

function isCompressibleImage(file: File): boolean {
  return /^image\/(jpeg|png|webp)$/i.test(file.type);
}

function sanitizeFileName(name: string): string {
  return name.replace(/[^\w.\-ąćęłńóśźżĄĆĘŁŃÓŚŹŻ ]+/g, "_").slice(0, 80) || "plik";
}

interface ImageVariant {
  blob: Blob;
  width: number;
  height: number;
}

async function loadImage(file: File): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error("image load failed"));
      img.src = url;
    });
    return img;
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function scaleImage(
  img: HTMLImageElement,
  maxDim: number,
): Promise<ImageVariant | null> {
  const scale = Math.min(1, maxDim / Math.max(img.naturalWidth, img.naturalHeight));
  const width = Math.max(1, Math.round(img.naturalWidth * scale));
  const height = Math.max(1, Math.round(img.naturalHeight * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.drawImage(img, 0, 0, width, height);

  // WebP z fallbackiem do JPEG (starsze Safari).
  const blob = await new Promise<Blob | null>((resolve) => {
    canvas.toBlob(
      (webp) => {
        if (webp && webp.type === "image/webp") resolve(webp);
        else canvas.toBlob((jpeg) => resolve(jpeg), "image/jpeg", 0.82);
      },
      "image/webp",
      0.8,
    );
  });
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

export async function prepareUpload(file: File): Promise<PreparedUpload> {
  if (isCompressibleImage(file)) {
    try {
      const img = await loadImage(file);
      const main = await scaleImage(img, IMAGE_MAX_DIM);
      const thumb = await scaleImage(img, THUMB_MAX_DIM);
      if (main) {
        return {
          data: main.blob,
          thumb: thumb?.blob ?? null,
          fileName: sanitizeFileName(file.name),
          mimeType: main.blob.type || "image/jpeg",
          width: main.width,
          height: main.height,
        };
      }
    } catch {
      // kompresja się nie powiodła — wyślij oryginał
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

export async function uploadAttachmentsForMessage(
  conversationId: string,
  messageId: string,
  files: File[],
): Promise<{ attachments: ChatAttachment[]; errors: string[] }> {
  const attachments: ChatAttachment[] = [];
  const errors: string[] = [];
  if (!supabase) return { attachments, errors: ["Brak chmury."] };

  for (const file of files) {
    if (file.size > MAX_CHAT_FILE_BYTES) {
      errors.push(`${file.name}: plik przekracza 25 MB.`);
      continue;
    }
    const prepared = await prepareUpload(file);
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

// Signed URLs (bucket prywatny) z cache w pamięci.
const urlCache = new Map<string, { url: string; expiresAt: number }>();
const SIGNED_URL_TTL_S = 3600;

export async function signedUrlFor(path: string): Promise<string | null> {
  const cached = urlCache.get(path);
  if (cached && cached.expiresAt > Date.now() + 60_000) return cached.url;
  if (!supabase) return null;
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
