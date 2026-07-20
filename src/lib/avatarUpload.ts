import { supabase } from "@/lib/supabase";
import { AVATARS_BUCKET, isCustomAvatarUrl } from "@/lib/avatar";
import { prepareUpload } from "@/lib/chat/upload";
import { useChatStore } from "@/lib/chat/store";

const AVATAR_MAX_BYTES = 5 * 1024 * 1024;

function avatarObjectPath(userId: string, ext: string): string {
  return `${userId}/avatar.${ext}`;
}

function extFromMime(mime: string): string {
  if (mime.includes("webp")) return "webp";
  if (mime.includes("png")) return "png";
  return "jpg";
}

/** Upload własnego awatara → profiles.avatar_url + store. */
export async function uploadMyAvatar(
  userId: string,
  file: File,
): Promise<{ url: string | null; error: string | null }> {
  if (!supabase) return { url: null, error: "Brak chmury." };
  if (!file.type.startsWith("image/")) {
    return { url: null, error: "Wybierz plik obrazu." };
  }
  if (file.size > AVATAR_MAX_BYTES) {
    return { url: null, error: "Obraz może mieć max 5 MB." };
  }

  const prepared = await prepareUpload(file);
  const ext = extFromMime(prepared.mimeType);
  const path = avatarObjectPath(userId, ext);

  // Usuń stare warianty (jpg/webp/png), żeby nie zostawały śmieci.
  await supabase.storage
    .from(AVATARS_BUCKET)
    .remove([
      avatarObjectPath(userId, "jpg"),
      avatarObjectPath(userId, "webp"),
      avatarObjectPath(userId, "png"),
    ]);

  const { error: upErr } = await supabase.storage
    .from(AVATARS_BUCKET)
    .upload(path, prepared.data, {
      contentType: prepared.mimeType,
      upsert: true,
      cacheControl: "3600",
    });
  if (upErr) return { url: null, error: upErr.message };

  const { data: pub } = supabase.storage.from(AVATARS_BUCKET).getPublicUrl(path);
  const url = `${pub.publicUrl}?v=${Date.now()}`;

  const { error: dbErr } = await supabase
    .from("profiles")
    .update({ avatar_url: url })
    .eq("user_id", userId);
  if (dbErr) return { url: null, error: dbErr.message };

  patchLocalProfileAvatar(userId, url);
  return { url, error: null };
}

/** Przywróć ludzika (null w DB + skasuj pliki). */
export async function clearMyAvatar(
  userId: string,
): Promise<{ error: string | null }> {
  if (!supabase) return { error: "Brak chmury." };

  await supabase.storage
    .from(AVATARS_BUCKET)
    .remove([
      avatarObjectPath(userId, "jpg"),
      avatarObjectPath(userId, "webp"),
      avatarObjectPath(userId, "png"),
    ]);

  const { error } = await supabase
    .from("profiles")
    .update({ avatar_url: null })
    .eq("user_id", userId);
  if (error) return { error: error.message };

  patchLocalProfileAvatar(userId, null);
  return { error: null };
}

function patchLocalProfileAvatar(userId: string, avatarUrl: string | null) {
  const st = useChatStore.getState();
  const prev = st.profiles[userId];
  st.setProfiles({
    ...st.profiles,
    [userId]: {
      userId,
      displayName: prev?.displayName ?? "",
      avatarUrl,
      lastSeenAt: prev?.lastSeenAt ?? null,
    },
  });
}

export function profileHasCustomAvatar(
  avatarUrl: string | null | undefined,
): boolean {
  return isCustomAvatarUrl(avatarUrl);
}
