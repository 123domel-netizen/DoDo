import { useEffect, useState } from "react";
import { AlertTriangle, Images, Loader2 } from "lucide-react";
import { fetchGallery, fetchGalleryItemUrl, type Gallery, type GalleryItem } from "@/lib/chat/galleryApi";

const PREVIEW_LIMIT = 8;

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
    default:
      return { text: `${gallery.itemCount} ${gallery.itemCount === 1 ? "zdjęcie" : "zdjęć"}`, tone: "muted" };
  }
}

function Thumb({ galleryId, itemId }: { galleryId: string; itemId: string }) {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
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
    <div className="h-full w-full bg-surface">
      {url ? (
        <img src={url} alt="" loading="lazy" className="h-full w-full object-cover" />
      ) : failed ? (
        <div className="flex h-full w-full items-center justify-center text-ink-faint">
          <Images size={14} />
        </div>
      ) : (
        <div className="flex h-full w-full items-center justify-center text-ink-faint">
          <Loader2 size={14} className="animate-spin" />
        </div>
      )}
    </div>
  );
}

interface GalleryCardProps {
  galleryId: string;
  title: string;
  gallery?: Gallery | null;
  items?: GalleryItem[];
  onOpen?: (galleryId: string) => void;
}

/** Karta galerii w bąbelku — pozioma karuzela miniaturek; klik otwiera viewer. */
export function GalleryCard({ galleryId, title, gallery: galleryProp, items: itemsProp, onOpen }: GalleryCardProps) {
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

  const readyItems = items.filter((i) => i.status === "ready");
  const thumbs = readyItems.slice(0, PREVIEW_LIMIT);
  const extra = Math.max(0, (gallery?.itemCount ?? readyItems.length) - PREVIEW_LIMIT);
  const status = gallery ? statusLabel(gallery) : null;

  return (
    <button
      type="button"
      onClick={() => onOpen?.(galleryId)}
      className="block w-full min-w-[14rem] max-w-[18rem] overflow-hidden rounded-xl border border-line bg-surface-overlay/60 text-left transition hover:border-accent/40"
    >
      <div className="bg-line/40">
        {loading ? (
          <div className="flex h-28 items-center justify-center text-ink-faint">
            <Loader2 size={16} className="animate-spin" />
          </div>
        ) : thumbs.length > 0 ? (
          <div className="thin-scrollbar flex gap-0.5 overflow-x-auto p-0.5">
            {thumbs.map((it, i) => (
              <div
                key={it.id}
                className="relative h-28 w-24 shrink-0 overflow-hidden rounded-md first:rounded-l-lg last:rounded-r-lg"
              >
                <Thumb galleryId={galleryId} itemId={it.id} />
                {i === thumbs.length - 1 && extra > 0 && (
                  <div className="absolute inset-0 flex items-center justify-center bg-black/55 text-sm font-semibold text-white">
                    +{extra}
                  </div>
                )}
              </div>
            ))}
          </div>
        ) : (
          <div className="flex h-28 flex-col items-center justify-center gap-1 text-ink-faint">
            {gallery?.status === "unavailable" || gallery?.status === "failed" ? (
              <AlertTriangle size={18} />
            ) : (
              <Images size={18} />
            )}
          </div>
        )}
      </div>
      <div className="px-2.5 py-2">
        <div className="flex items-center gap-1.5 truncate text-xs font-medium text-ink">
          <Images size={12} className="shrink-0 text-accent" />
          <span className="truncate">{title || "Galeria"}</span>
        </div>
        {status && (
          <div
            className={`mt-0.5 truncate text-[11px] ${
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
