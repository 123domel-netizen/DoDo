import { useEffect, useState, type CSSProperties } from "react";
import { AlertTriangle, Images, Loader2 } from "lucide-react";
import { fetchGallery, fetchGalleryItemUrl, type Gallery, type GalleryItem } from "@/lib/chat/galleryApi";
import {
  getGalleryLocalThumb,
  subscribeGalleryLocalThumbs,
} from "@/lib/chat/galleryLocalThumbs";

/** Ile kart w talii w bańce czatu (reszta jako +N). */
const DECK_SLOTS = 3;
const CARD_W = "7.5rem";
const CARD_H = "10rem";
/** Miniatury w zwartym wierszu (hub / panel Media). */
const ROW_THUMB_SLOTS = 3;

function statusLabel(gallery: Gallery): { text: string; tone: "muted" | "accent" | "warn" } {
  switch (gallery.status) {
    case "draft":
    case "uploading":
      return { text: "Przesyłanie zdjęć…", tone: "accent" };
    case "partial":
      return {
        text: `Wysłano częściowo (${gallery.failedCount} nieudanych)`,
        tone: "warn",
      };
    case "failed":
      return { text: "Przesyłanie nie powiodło się", tone: "warn" };
    case "unavailable":
      return { text: "Magazyn niedostępny", tone: "warn" };
    default: {
      const n = gallery.itemCount;
      const noun = n === 1 ? "zdjęcie" : n >= 2 && n <= 4 ? "zdjęcia" : "zdjęć";
      return { text: `${n} ${noun}`, tone: "muted" };
    }
  }
}

function countLabel(n: number): string {
  const noun = n === 1 ? "zdjęcie" : n >= 2 && n <= 4 ? "zdjęcia" : "zdjęć";
  return `${n} ${noun}`;
}

function Thumb({ galleryId, itemId }: { galleryId: string; itemId: string }) {
  const [url, setUrl] = useState<string | null>(() => getGalleryLocalThumb(galleryId, itemId));
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    return subscribeGalleryLocalThumbs(() => {
      const local = getGalleryLocalThumb(galleryId, itemId);
      if (local) setUrl(local);
    });
  }, [galleryId, itemId]);

  useEffect(() => {
    const local = getGalleryLocalThumb(galleryId, itemId);
    if (local) {
      setUrl(local);
      setFailed(false);
      return;
    }
    let cancelled = false;
    void fetchGalleryItemUrl(galleryId, itemId, "thumb").then((res) => {
      if (cancelled) return;
      if (res.data?.url) setUrl(res.data.url);
      else setFailed(true);
    });
    return () => {
      cancelled = true;
    };
  }, [galleryId, itemId]);

  return (
    <div className="h-full w-full bg-surface-raised">
      {url ? (
        <img
          src={url}
          alt=""
          loading="lazy"
          referrerPolicy="no-referrer"
          className="h-full w-full object-cover"
        />
      ) : failed ? (
        <div className="flex h-full w-full items-center justify-center text-ink-faint">
          <Images size={16} />
        </div>
      ) : (
        <div className="flex h-full w-full items-center justify-center text-ink-faint">
          <Loader2 size={14} className="animate-spin" />
        </div>
      )}
    </div>
  );
}

/**
 * Płaska talia w bańce: równy krok, lekka skala tył→przód.
 * index 0 = tył / lewo.
 */
function deckCardStyle(index: number, count: number): CSSProperties {
  if (count <= 1) {
    return {
      left: "50%",
      top: "50%",
      transform: "translate(-50%, -50%)",
      zIndex: 1,
    };
  }

  const step = 78;
  const x = index * step;
  const originX = ((count - 1) * step) / 2;
  const t = index / (count - 1);
  const scale = 0.94 + t * 0.06;
  const y = index * 3;

  return {
    left: "50%",
    top: "50%",
    transform: `translate(calc(-50% + ${x - originX}px), calc(-50% + ${y}px)) scale(${scale})`,
    zIndex: index + 1,
  };
}

function deckStageClass(count: number): string {
  if (count <= 1) return "h-[11rem] w-[8.5rem]";
  if (count === 2) return "h-[11.25rem] w-[13.5rem]";
  return "h-[11.5rem] w-[17.25rem]";
}

function useGalleryData(
  galleryId: string,
  galleryProp?: Gallery | null,
  itemsProp?: GalleryItem[],
) {
  const [gallery, setGallery] = useState<Gallery | null>(galleryProp ?? null);
  const [items, setItems] = useState<GalleryItem[]>(itemsProp ?? []);
  const [loading, setLoading] = useState(!galleryProp);

  useEffect(() => {
    if (galleryProp) {
      setGallery(galleryProp);
      setItems(itemsProp ?? []);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    void fetchGallery(galleryId).then((res) => {
      if (cancelled) return;
      setGallery(res.data?.gallery ?? null);
      setItems(res.data?.items ?? []);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [galleryId, galleryProp, itemsProp]);

  return { gallery, items, loading };
}

/** Zwarty pasek 2–3 miniatur (wysokość jak MediaThumb w hubie). */
function MiniThumbStrip({
  galleryId,
  items,
  extra,
  loading,
}: {
  galleryId: string;
  items: GalleryItem[];
  extra: number;
  loading: boolean;
}) {
  const n = items.length;
  if (loading) {
    return (
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-line bg-surface-raised text-ink-faint">
        <Loader2 size={14} className="animate-spin" />
      </span>
    );
  }
  if (n === 0) {
    return (
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-line bg-surface-raised text-ink-faint">
        <Images size={14} />
      </span>
    );
  }

  const widthPx = 40 + Math.max(0, n - 1) * 14;
  return (
    <span
      className="relative h-10 shrink-0"
      style={{ width: widthPx }}
      aria-hidden
    >
      {items.map((it, i) => (
        <span
          key={it.id}
          className="absolute top-0 h-10 w-10 overflow-hidden rounded-md border border-line bg-surface-raised shadow-sm"
          style={{ left: i * 14, zIndex: i + 1 }}
        >
          <Thumb galleryId={galleryId} itemId={it.id} />
          {i === n - 1 && extra > 0 && (
            <span className="absolute inset-0 flex items-center justify-center bg-black/55 text-[10px] font-semibold text-white">
              +{extra}
            </span>
          )}
        </span>
      ))}
    </span>
  );
}

interface GalleryCardProps {
  galleryId: string;
  title: string;
  gallery?: Gallery | null;
  items?: GalleryItem[];
  onOpen?: (galleryId: string) => void;
  /**
   * `bubble` — talia w wiadomości czatu.
   * `row` / `panel` — zwarty wiersz hubu / Media (jak pliki i zdjęcia).
   */
  variant?: "bubble" | "panel" | "row";
  /** Podpis meta (np. „Zapiski · 17:41”) — tylko wariant row/panel. */
  meta?: string | null;
  /** Gdy brak świeżego fetchu — pokaż liczbę z listy huba. */
  itemCountHint?: number;
}

/** Galeria: talia w czacie albo zwarty wiersz w hubie. */
export function GalleryCard({
  galleryId,
  title,
  gallery: galleryProp,
  items: itemsProp,
  onOpen,
  variant = "bubble",
  meta,
  itemCountHint,
}: GalleryCardProps) {
  const { gallery, items, loading } = useGalleryData(galleryId, galleryProp, itemsProp);
  const readyItems = items.filter((i) => i.status === "ready");
  const total = gallery?.itemCount ?? itemCountHint ?? readyItems.length;
  const status = gallery ? statusLabel(gallery) : null;
  const isRow = variant === "panel" || variant === "row";

  if (isRow) {
    const thumbs = readyItems.slice(0, ROW_THUMB_SLOTS);
    const extra = Math.max(0, total - thumbs.length);
    const metaParts: string[] = [];
    if (meta?.trim()) metaParts.push(meta.trim());
    if (status && status.tone !== "muted") metaParts.push(status.text);
    else metaParts.push(countLabel(total));

    return (
      <button
        type="button"
        onClick={() => onOpen?.(galleryId)}
        className="flex w-full items-center gap-2.5 border-b border-line/50 px-3 py-1.5 text-left transition hover:bg-surface-raised"
        aria-label={`${title || "Galeria"}, ${metaParts.join(", ")}`}
      >
        <MiniThumbStrip
          galleryId={galleryId}
          items={thumbs}
          extra={extra}
          loading={loading}
        />
        <span className="min-w-0 flex-1 leading-tight">
          <span className="block truncate text-[13px] font-medium text-ink">
            {title || "Galeria"}
          </span>
          <span className="mt-px block truncate text-[11px] text-ink-faint">
            {metaParts.join(" · ")}
          </span>
        </span>
      </button>
    );
  }

  const thumbs = readyItems.slice(0, DECK_SLOTS);
  const extra = Math.max(0, total - thumbs.length);
  const n = thumbs.length;

  return (
    <button
      type="button"
      onClick={() => onOpen?.(galleryId)}
      className={`group/deck block text-left transition ${
        n <= 1
          ? "w-[8.75rem] px-0 pb-0 pt-0.5"
          : n === 2
            ? "w-[14rem] px-0 pb-0 pt-0.5"
            : "w-[17.75rem] px-0 pb-0 pt-0.5"
      }`}
      aria-label={`${title || "Galeria"}${status ? `, ${status.text}` : ""}`}
    >
      <div className={`relative mx-auto ${deckStageClass(n)}`}>
        {loading ? (
          <div className="absolute left-1/2 top-1/2 flex -translate-x-1/2 -translate-y-1/2 text-ink-faint">
            <Loader2 size={18} className="animate-spin" />
          </div>
        ) : n > 0 ? (
          thumbs.map((it, i) => (
            <div
              key={it.id}
              className="absolute left-1/2 top-1/2 origin-center overflow-hidden rounded-[0.85rem] bg-surface shadow-[0_6px_18px_-4px_rgba(0,0,0,0.55),0_1px_4px_rgba(0,0,0,0.3)] ring-1 ring-white/20 transition-shadow duration-300 ease-out group-hover/deck:shadow-[0_12px_28px_-4px_rgba(0,0,0,0.65)]"
              style={{
                width: CARD_W,
                height: CARD_H,
                ...deckCardStyle(i, n),
              }}
            >
              <Thumb galleryId={galleryId} itemId={it.id} />
              {i === n - 1 && extra > 0 && (
                <div className="absolute inset-0 flex items-center justify-center bg-gradient-to-t from-black/65 via-black/35 to-transparent">
                  <span className="rounded-full bg-black/55 px-2.5 py-1 text-[13px] font-semibold tracking-tight text-white backdrop-blur-[2px]">
                    +{extra}
                  </span>
                </div>
              )}
            </div>
          ))
        ) : (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-1.5 rounded-[0.85rem] border border-dashed border-line text-ink-faint">
            {gallery?.status === "unavailable" || gallery?.status === "failed" ? (
              <AlertTriangle size={20} />
            ) : (
              <Images size={20} />
            )}
            <span className="px-2 text-center text-[11px]">
              {status?.tone === "warn" || status?.tone === "accent"
                ? status.text
                : "Brak podglądu"}
            </span>
          </div>
        )}
      </div>

      <div className="relative z-[5] mt-2 px-0.5">
        <div className="truncate text-[12.5px] font-medium leading-tight text-ink">
          {title || "Galeria"}
        </div>
        {status && (
          <div
            className={`mt-0.5 truncate text-[11px] leading-tight ${
              status.tone === "warn"
                ? "text-amber-400"
                : status.tone === "accent"
                  ? "text-accent"
                  : "text-ink-faint"
            }`}
          >
            {status.text}
          </div>
        )}
      </div>
    </button>
  );
}
