import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Loader2, Minus, Plus, RotateCcw, X } from "lucide-react";
import { signedUrlFor } from "@/lib/chat/upload";

const MIN_ZOOM = 1;
const MAX_ZOOM = 5;
const ZOOM_STEP = 0.35;

type Pt = { x: number; y: number };

function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n));
}

function pinchDistance(a: Touch, b: Touch) {
  const dx = a.clientX - b.clientX;
  const dy = a.clientY - b.clientY;
  return Math.hypot(dx, dy);
}

function pinchCenter(a: Touch, b: Touch): Pt {
  return {
    x: (a.clientX + b.clientX) / 2,
    y: (a.clientY + b.clientY) / 2,
  };
}

/** Pełnoekranowy podgląd zdjęcia z czatu (zoom + pan, bez nowej karty). */
export function ChatImageLightbox({
  bucketPath,
  fileName,
  onClose,
}: {
  bucketPath: string;
  fileName?: string;
  onClose: () => void;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState<Pt>({ x: 0, y: 0 });
  const stageRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{
    pointerId: number;
    start: Pt;
    origin: Pt;
  } | null>(null);
  const pinchRef = useRef<{
    startDist: number;
    startZoom: number;
    startOffset: Pt;
    startCenter: Pt;
  } | null>(null);
  const lastTapRef = useRef(0);

  useEffect(() => {
    let cancelled = false;
    setUrl(null);
    setZoom(1);
    setOffset({ x: 0, y: 0 });
    void signedUrlFor(bucketPath).then((u) => {
      if (!cancelled) setUrl(u);
    });
    return () => {
      cancelled = true;
    };
  }, [bucketPath]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "+" || e.key === "=") {
        e.preventDefault();
        setZoom((z) => clamp(z + ZOOM_STEP, MIN_ZOOM, MAX_ZOOM));
      }
      if (e.key === "-" || e.key === "_") {
        e.preventDefault();
        setZoom((z) => {
          const next = clamp(z - ZOOM_STEP, MIN_ZOOM, MAX_ZOOM);
          if (next <= MIN_ZOOM) setOffset({ x: 0, y: 0 });
          return next;
        });
      }
      if (e.key === "0") {
        setZoom(1);
        setOffset({ x: 0, y: 0 });
      }
    };
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      const delta = e.deltaY > 0 ? -ZOOM_STEP : ZOOM_STEP;
      setZoom((z) => {
        const next = clamp(z + delta, MIN_ZOOM, MAX_ZOOM);
        if (next <= MIN_ZOOM) setOffset({ x: 0, y: 0 });
        return next;
      });
    };
    const touchMove = (e: TouchEvent) => {
      if (e.touches.length >= 2 || (e.touches.length === 1 && zoom > MIN_ZOOM)) {
        e.preventDefault();
      }
    };
    el.addEventListener("wheel", wheel, { passive: false });
    el.addEventListener("touchmove", touchMove, { passive: false });
    return () => {
      el.removeEventListener("wheel", wheel);
      el.removeEventListener("touchmove", touchMove);
    };
  }, [zoom]);

  const resetView = useCallback(() => {
    setZoom(1);
    setOffset({ x: 0, y: 0 });
  }, []);

  const zoomBy = useCallback((delta: number) => {
    setZoom((z) => {
      const next = clamp(z + delta, MIN_ZOOM, MAX_ZOOM);
      if (next <= MIN_ZOOM) setOffset({ x: 0, y: 0 });
      return next;
    });
  }, []);

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.pointerType === "touch") return;
    if (zoom <= MIN_ZOOM) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = {
      pointerId: e.pointerId,
      start: { x: e.clientX, y: e.clientY },
      origin: offset,
    };
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== e.pointerId) return;
    setOffset({
      x: drag.origin.x + (e.clientX - drag.start.x),
      y: drag.origin.y + (e.clientY - drag.start.y),
    });
  };

  const onPointerUp = (e: React.PointerEvent) => {
    if (dragRef.current?.pointerId === e.pointerId) dragRef.current = null;
  };

  const onDoubleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (zoom > MIN_ZOOM) {
      resetView();
    } else {
      setZoom(2.5);
    }
  };

  const onTouchStart = (e: React.TouchEvent) => {
    if (e.touches.length === 2) {
      const a = e.touches[0];
      const b = e.touches[1];
      pinchRef.current = {
        startDist: pinchDistance(a, b),
        startZoom: zoom,
        startOffset: offset,
        startCenter: pinchCenter(a, b),
      };
      dragRef.current = null;
      return;
    }
    if (e.touches.length === 1 && zoom > MIN_ZOOM) {
      const t = e.touches[0];
      dragRef.current = {
        pointerId: -1,
        start: { x: t.clientX, y: t.clientY },
        origin: offset,
      };
    }
  };

  const onTouchMove = (e: React.TouchEvent) => {
    if (e.touches.length === 2 && pinchRef.current) {
      e.preventDefault();
      const a = e.touches[0];
      const b = e.touches[1];
      const dist = pinchDistance(a, b);
      const center = pinchCenter(a, b);
      const { startDist, startZoom, startOffset, startCenter } = pinchRef.current;
      const nextZoom = clamp(
        startZoom * (dist / Math.max(startDist, 1)),
        MIN_ZOOM,
        MAX_ZOOM,
      );
      setZoom(nextZoom);
      if (nextZoom <= MIN_ZOOM) {
        setOffset({ x: 0, y: 0 });
      } else {
        setOffset({
          x: startOffset.x + (center.x - startCenter.x),
          y: startOffset.y + (center.y - startCenter.y),
        });
      }
      return;
    }
    if (e.touches.length === 1 && dragRef.current && zoom > MIN_ZOOM) {
      const t = e.touches[0];
      setOffset({
        x: dragRef.current.origin.x + (t.clientX - dragRef.current.start.x),
        y: dragRef.current.origin.y + (t.clientY - dragRef.current.start.y),
      });
    }
  };

  const onTouchEnd = (e: React.TouchEvent) => {
    if (e.touches.length < 2) pinchRef.current = null;
    if (e.touches.length === 0) {
      dragRef.current = null;
      // Double-tap zoom toggle
      const now = Date.now();
      if (now - lastTapRef.current < 280) {
        if (zoom > MIN_ZOOM) resetView();
        else setZoom(2.5);
        lastTapRef.current = 0;
      } else {
        lastTapRef.current = now;
      }
    }
  };

  const backdropClick = () => {
    if (zoom > MIN_ZOOM) {
      resetView();
      return;
    }
    onClose();
  };

  return createPortal(
    <div
      className="fixed inset-0 z-[80] flex flex-col bg-black/90"
      onClick={backdropClick}
      role="dialog"
      aria-modal="true"
      aria-label={fileName ? `Podgląd: ${fileName}` : "Podgląd zdjęcia"}
    >
      <div className="absolute right-3 top-3 z-10 flex items-center gap-1.5">
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            zoomBy(-ZOOM_STEP);
          }}
          disabled={zoom <= MIN_ZOOM}
          aria-label="Oddal"
          className="rounded-full bg-black/45 p-2 text-white transition hover:bg-black/65 disabled:opacity-35"
        >
          <Minus size={18} />
        </button>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            zoomBy(ZOOM_STEP);
          }}
          disabled={zoom >= MAX_ZOOM}
          aria-label="Przybliż"
          className="rounded-full bg-black/45 p-2 text-white transition hover:bg-black/65 disabled:opacity-35"
        >
          <Plus size={18} />
        </button>
        {zoom > MIN_ZOOM && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              resetView();
            }}
            aria-label="Resetuj zoom"
            className="rounded-full bg-black/45 p-2 text-white transition hover:bg-black/65"
          >
            <RotateCcw size={16} />
          </button>
        )}
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onClose();
          }}
          aria-label="Zamknij"
          className="rounded-full bg-black/45 p-2 text-white transition hover:bg-black/65"
        >
          <X size={18} />
        </button>
      </div>

      <div
        ref={stageRef}
        className="relative flex min-h-0 flex-1 touch-none items-center justify-center overflow-hidden"
        onClick={(e) => e.stopPropagation()}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onDoubleClick={onDoubleClick}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        style={{ cursor: zoom > MIN_ZOOM ? "grab" : "default" }}
      >
        {url ? (
          <img
            src={url}
            alt={fileName || "Zdjęcie"}
            draggable={false}
            className="max-h-[90vh] max-w-[94vw] select-none rounded-lg object-contain"
            style={{
              transform: `translate(${offset.x}px, ${offset.y}px) scale(${zoom})`,
              transformOrigin: "center center",
              transition: dragRef.current || pinchRef.current ? "none" : undefined,
            }}
          />
        ) : (
          <div className="flex h-48 w-48 items-center justify-center text-white/60">
            <Loader2 size={22} className="animate-spin" />
          </div>
        )}
      </div>

      <div className="pointer-events-none absolute bottom-4 left-1/2 flex max-w-[90vw] -translate-x-1/2 flex-col items-center gap-1">
        {zoom > MIN_ZOOM && (
          <span className="rounded-full bg-black/50 px-2.5 py-0.5 text-[11px] text-white/85">
            {Math.round(zoom * 100)}%
          </span>
        )}
        {fileName && (
          <span className="truncate rounded-full bg-black/50 px-3 py-1 text-[11px] text-white/80">
            {fileName}
          </span>
        )}
      </div>
    </div>,
    document.body,
  );
}
