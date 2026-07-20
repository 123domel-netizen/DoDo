import { resolveAvatarUrl } from "@/lib/avatar";

/** Okrągły awatar osoby (ludzik albo własny upload). */
export function PersonAvatar({
  userId,
  avatarUrl,
  size = 28,
  className = "",
}: {
  userId: string;
  avatarUrl?: string | null;
  size?: number;
  className?: string;
}) {
  const src = resolveAvatarUrl(userId, avatarUrl);
  return (
    <img
      src={src}
      alt=""
      width={size}
      height={size}
      className={`shrink-0 rounded-full border border-line bg-surface-raised object-cover ${className}`}
      style={{ width: size, height: size }}
      referrerPolicy="no-referrer"
    />
  );
}
