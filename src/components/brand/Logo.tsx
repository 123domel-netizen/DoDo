interface LogoProps {
  size?: number;
  /** Obraz zawiera już napis „DoDo” — domyślnie bez dodatkowego tekstu. */
  showName?: boolean;
  className?: string;
}

const LOGO_ASPECT = 220 / 87;

export function Logo({ size = 28, showName = false, className = "" }: LogoProps) {
  const height = size;
  const width = Math.round(size * LOGO_ASPECT);

  return (
    <div className={`flex items-center gap-2 ${className}`}>
      <img
        src="/logo.png"
        alt="DoDo"
        width={width}
        height={height}
        className="shrink-0 object-contain"
        draggable={false}
      />
      {showName && (
        <span className="text-[15px] font-semibold tracking-tight text-ink">DoDo</span>
      )}
    </div>
  );
}
