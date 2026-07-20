/**
 * Awatary: własny upload w storage `avatars/`, wybrany ludzik DiceBear,
 * albo deterministyczny default z userId. Zdjęcia Google są pomijane w UI.
 */

export const AVATARS_BUCKET = "avatars";

const DICEBEAR_HOST = "api.dicebear.com";
const DICEBEAR_STYLE = "fun-emoji";

export interface AvatarPreset {
  id: string;
  label: string;
  seed: string;
}

/** Stała galeria ludzików do wyboru (poza unikalnym defaultem z userId). */
export const AVATAR_PRESETS: AvatarPreset[] = [
  { id: "felix", label: "Felix", seed: "Felix" },
  { id: "luna", label: "Luna", seed: "Luna" },
  { id: "milo", label: "Milo", seed: "Milo" },
  { id: "nova", label: "Nova", seed: "Nova" },
  { id: "oreo", label: "Oreo", seed: "Oreo" },
  { id: "pixel", label: "Pixel", seed: "Pixel" },
  { id: "quinn", label: "Quinn", seed: "Quinn" },
  { id: "rio", label: "Rio", seed: "Rio" },
  { id: "sage", label: "Sage", seed: "Sage" },
  { id: "toby", label: "Toby", seed: "Toby" },
  { id: "uma", label: "Uma", seed: "Uma" },
  { id: "vince", label: "Vince", seed: "Vince" },
  { id: "wren", label: "Wren", seed: "Wren" },
  { id: "yael", label: "Yael", seed: "Yael" },
  { id: "zane", label: "Zane", seed: "Zane" },
  { id: "bubbles", label: "Bubbles", seed: "Bubbles" },
];

export function diceBearAvatarUrl(seed: string): string {
  return `https://${DICEBEAR_HOST}/9.x/${DICEBEAR_STYLE}/svg?seed=${encodeURIComponent(seed)}`;
}

export function defaultAvatarUrl(userId: string): string {
  return diceBearAvatarUrl(userId || "anon");
}

export function avatarPresetUrl(presetId: string): string | null {
  const p = AVATAR_PRESETS.find((x) => x.id === presetId);
  return p ? diceBearAvatarUrl(p.seed) : null;
}

/** Publiczny URL DiceBear fun-emoji (wybrany ludzik). */
export function isDiceBearAvatarUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  try {
    const u = new URL(url);
    return (
      u.hostname === DICEBEAR_HOST &&
      u.pathname.includes(`/${DICEBEAR_STYLE}/`)
    );
  } catch {
    return false;
  }
}

export function diceBearSeedFromUrl(url: string | null | undefined): string | null {
  if (!isDiceBearAvatarUrl(url)) return null;
  try {
    return new URL(url!).searchParams.get("seed");
  } catch {
    return null;
  }
}

export function activeAvatarPresetId(
  avatarUrl: string | null | undefined,
): string | null {
  const seed = diceBearSeedFromUrl(avatarUrl);
  if (!seed) return null;
  return AVATAR_PRESETS.find((p) => p.seed === seed)?.id ?? null;
}

/** Tylko pliki z naszego bucketa — nie Google / obce CDN. */
export function isCustomAvatarUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  try {
    const u = new URL(url, "https://local.invalid");
    return (
      u.pathname.includes(`/object/public/${AVATARS_BUCKET}/`) ||
      u.pathname.includes(`/object/sign/${AVATARS_BUCKET}/`)
    );
  } catch {
    return url.includes(`/${AVATARS_BUCKET}/`);
  }
}

/** Upload lub wybrany ludzik z galerii (nie default z userId). */
export function isChosenAvatarUrl(url: string | null | undefined): boolean {
  return isCustomAvatarUrl(url) || isDiceBearAvatarUrl(url);
}

export function resolveAvatarUrl(
  userId: string,
  avatarUrl: string | null | undefined,
): string {
  if (isCustomAvatarUrl(avatarUrl) || isDiceBearAvatarUrl(avatarUrl)) {
    return avatarUrl!;
  }
  return defaultAvatarUrl(userId);
}

/** Druga osoba w DM 1:1 (null dla grupowych DM / nie-DM). */
export function dmPeerMember<T extends { userId: string }>(
  members: T[],
  myUserId: string | null | undefined,
  kind?: string,
): T | null {
  if (kind && kind !== "dm") return null;
  if (members.length === 0 || members.length > 2) return null;
  return members.find((m) => m.userId !== myUserId) ?? members[0] ?? null;
}
