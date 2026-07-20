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
      {/* Ciemny motyw: biały napis; jasny: ciemny napis */}
      <span className="contents" role="img" aria-label="DoDo">
        <img
          src="/logo.png"
          alt=""
          width={width}
          height={height}
          className="hidden shrink-0 object-contain dark:block"
          draggable={false}
        />
        <img
          src="/logo-light.png"
          alt=""
          width={width}
          height={height}
          className="block shrink-0 object-contain dark:hidden"
          draggable={false}
        />
      </span>
      {showName && (
        <span className="text-[15px] font-semibold tracking-tight text-ink">DoDo</span>
      )}
    </div>
  );
}
