/**
 * Awatary: własny upload w storage `avatars/` albo deterministyczny ludzik (DiceBear).
 * Zdjęcia Google w profiles.avatar_url są celowo pomijane w UI czatu.
 */

export const AVATARS_BUCKET = "avatars";

export function defaultAvatarUrl(userId: string): string {
  const seed = encodeURIComponent(userId || "anon");
  return `https://api.dicebear.com/9.x/fun-emoji/svg?seed=${seed}`;
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

export function resolveAvatarUrl(
  userId: string,
  avatarUrl: string | null | undefined,
): string {
  if (isCustomAvatarUrl(avatarUrl)) return avatarUrl!;
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
