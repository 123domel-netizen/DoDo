import { resolveGroupIcon } from "@/lib/groupIcons";

export function GroupIcon({
  name,
  color,
  size = 14,
  className = "",
}: {
  name?: string | null;
  color: string;
  size?: number;
  className?: string;
}) {
  const Icon = resolveGroupIcon(name);
  return (
    <Icon
      size={size}
      className={`shrink-0 ${className}`}
      style={{ color }}
      aria-hidden
    />
  );
}
