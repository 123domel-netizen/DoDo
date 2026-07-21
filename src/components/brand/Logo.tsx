interface LogoProps {
  size?: number;
  /** Zostawione dla kompatybilności — napis jest zawsze w komponencie. */
  showName?: boolean;
  className?: string;
}

/**
 * Znak z brand-logo-source (PNG), napis „DoDo” w CSS (text-ink) —
 * kolor zawsze zgodny z motywem, bez pomyłek light/dark w plikach.
 */
export function Logo({ size = 28, className = "" }: LogoProps) {
  const mark = Math.round(size * 1.05);
  const fontSize = Math.round(size * 0.72);

  return (
    <div className={`flex items-center gap-2 ${className}`} role="img" aria-label="DoDo">
      <img
        src="/logo-mark.png?v=3"
        alt=""
        width={mark}
        height={mark}
        className="shrink-0 object-contain"
        draggable={false}
      />
      <span
        className="font-bold tracking-tight text-ink"
        style={{ fontSize, lineHeight: 1, letterSpacing: "-0.03em" }}
      >
        DoDo
      </span>
    </div>
  );
}
