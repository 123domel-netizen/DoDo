import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  ImagePlus,
  Loader2,
  RotateCw,
  X,
} from "lucide-react";
import {
  addGalleryItems,
  fetchGallery,
  fetchGalleryItemUrl,
  galleryFileDims,
  prepareGalleryImages,
  uploadGalleryItem,
  type Gallery,
  type GalleryItem,
} from "@/lib/chat/galleryApi";

interface GalleryViewerProps {
  galleryId: string;
  open: boolean;
  onClose: () => void;
}

function GridTile({
  item,
  onOpen,
  onRetry,
}: {
  item: GalleryItem;
  onOpen: () => void;
  onRetry: (file: File) => void;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const retryRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (item.status !== "ready") return;
    let cancelled = false;
    void fetchGalleryItemUrl(item.galleryId, item.id).then((res) => {
      if (!cancelled) setUrl(res.data?.url ?? null);
    });
    return () => {
      cancelled = true;
    };
  }, [item.galleryId, item.id, item.status]);

  if (item.status === "failed") {
    return (
      <div className="relative flex aspect-square flex-col items-center justify-center gap-1.5 rounded-lg border border-red-500/30 bg-red-500/5 p-2 text-center">
        <AlertTriangle size={16} className="text-red-400" />
        <span className="line-clamp-2 text-[10px] text-ink-faint">{item.fileName}</span>
        <input
          ref={retryRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            if (f) onRetry(f);
          }}
        />
        <button
          type="button"
          onClick={() => retryRef.current?.click()}
          className="flex items-center gap-1 rounded-full bg-red-500/15 px-2 py-0.5 text-[10px] font-medium text-red-300 transition hover:bg-red-500/25"
        >
          <RotateCw size={10} /> Ponów
        </button>
      </div>
    );
  }

  if (item.status !== "ready") {
    return (
      <div className="flex aspect-square items-center justify-center rounded-lg border border-line bg-surface-raised">
        <Loader2 size={16} className="animate-spin text-ink-faint" />
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={onOpen}
      className="aspect-square overflow-hidden rounded-lg border border-line bg-surface-raised"
      aria-label={`Otwórz ${item.fileName}`}
    >
      {url ? (
        <img src={url} alt={item.fileName} loading="lazy" className="h-full w-full object-cover" />
      ) : (
        <div className="flex h-full w-full items-center justify-center text-ink-faint">
          <Loader2 size={14} className="animate-spin" />
        </div>
      )}
    </button>
  );
}

function Lightbox({
  items,
  index,
  onClose,
  onNavigate,
}: {
  items: GalleryItem[];
  index: number;
  onClose: () => void;
  onNavigate: (next: number) => void;
}) {
  const item = items[index];
  const [url, setUrl] = useState<string | null>(null);
  const touchStartX = useRef<number | null>(null);

  useEffect(() => {
    setUrl(null);
    if (!item) return;
    let cancelled = false;
    void fetchGalleryItemUrl(item.galleryId, item.id).then((res) => {
      if (!cancelled) setUrl(res.data?.url ?? null);
    });
    return () => {
      cancelled = true;
    };
  }, [item]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowLeft" && index > 0) onNavigate(index - 1);
      if (e.key === "ArrowRight" && index < items.length - 1) onNavigate(index + 1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [index, items.length, onClose, onNavigate]);

  if (!item) return null;

  return (
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center bg-black/90"
      onClick={onClose}
      onTouchStart={(e) => {
        touchStartX.current = e.touches[0]?.clientX ?? null;
      }}
      onTouchEnd={(e) => {
        const start = touchStartX.current;
        touchStartX.current = null;
        if (start == null) return;
        const dx = (e.changedTouches[0]?.clientX ?? start) - start;
        if (dx > 60 && index > 0) onNavigate(index - 1);
        else if (dx < -60 && index < items.length - 1) onNavigate(index + 1);
      }}
    >
      <button
        type="button"
        onClick={onClose}
        aria-label="Zamknij"
        className="absolute right-4 top-4 rounded-full bg-black/40 p-2 text-white transition hover:bg-black/60"
      >
        <X size={18} />
      </button>

      {index > 0 && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onNavigate(index - 1);
          }}
          aria-label="Poprzednie"
          className="absolute left-2 top-1/2 -translate-y-1/2 rounded-full bg-black/40 p-2 text-white transition hover:bg-black/60 sm:left-4"
        >
          <ChevronLeft size={20} />
        </button>
      )}
      {index < items.length - 1 && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onNavigate(index + 1);
          }}
          aria-label="Następne"
          className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full bg-black/40 p-2 text-white transition hover:bg-black/60 sm:right-4"
        >
          <ChevronRight size={20} />
        </button>
      )}

      <div className="max-h-[85vh] max-w-[92vw]" onClick={(e) => e.stopPropagation()}>
        {url ? (
          <img
            src={url}
            alt={item.fileName}
            className="max-h-[85vh] max-w-[92vw] rounded-lg object-contain"
          />
        ) : (
          <div className="flex h-64 w-64 items-center justify-center text-white/60">
            <Loader2 size={22} className="animate-spin" />
          </div>
        )}
      </div>

      <div className="absolute bottom-4 left-1/2 -translate-x-1/2 rounded-full bg-black/50 px-3 py-1 text-[11px] text-white/80">
        {index + 1} / {items.length}
      </div>
    </div>
  );
}

/** Pełnoekranowa galeria: siatka + lightbox, dodawanie zdjęć i retry nieudanych. */
export function GalleryViewer({ galleryId, open, onClose }: GalleryViewerProps) {
  const [gallery, setGallery] = useState<Gallery | null>(null);
  const [items, setItems] = useState<GalleryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const addFileRef = useRef<HTMLInputElement>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const refresh = useCallback(() => {
    setLoading(true);
    void fetchGallery(galleryId).then((res) => {
      if (!mountedRef.current) return;
      setGallery(res.data?.gallery ?? null);
      setItems(res.data?.items ?? []);
      setLoading(false);
    });
  }, [galleryId]);

  useEffect(() => {
    if (!open) return;
    setLightboxIndex(null);
    setError(null);
    refresh();
  }, [open, refresh]);

  const patchItem = (itemId: string, patch: Partial<GalleryItem>) => {
    if (!mountedRef.current) return;
    setItems((list) => list.map((x) => (x.id === itemId ? { ...x, ...patch } : x)));
  };

  const uploadAndTrack = async (gId: string, item: GalleryItem, file: File) => {
    patchItem(item.id, { status: "uploading", errorMessage: null });
    const res = await uploadGalleryItem(gId, item.id, file);
    if (!mountedRef.current) return;
    if (res.error) {
      patchItem(item.id, { status: "failed", errorMessage: res.error });
    } else {
      patchItem(item.id, { status: "ready", errorMessage: null });
      if (res.data?.gallery) setGallery(res.data.gallery);
    }
  };

  const addFiles = async (list: FileList | null) => {
    if (!list || !gallery) return;
    const picked = Array.from(list).filter((f) => /^image\//i.test(f.type));
    if (!picked.length) return;
    setError(null);
    const prepared = await prepareGalleryImages(picked);
    const res = await addGalleryItems(
      gallery.id,
      prepared.map((f) => ({
        fileName: f.name,
        mimeType: f.type || "image/jpeg",
        sizeBytes: f.size,
        ...galleryFileDims(f),
      })),
    );
    if (res.error || !res.data) {
      setError(res.error || "Nie udało się dodać zdjęć.");
      return;
    }
    if (!mountedRef.current) return;
    const newItems = res.data.items;
    setGallery(res.data.gallery);
    setItems((prev) => [...prev, ...newItems]);
    for (let i = 0; i < newItems.length; i++) {
      const item = newItems[i]!;
      const file = prepared[i]!;
      // eslint-disable-next-line no-await-in-loop
      await uploadAndTrack(gallery.id, item, file);
    }
  };

  if (!open) return null;

  const readyItems = items.filter((i) => i.status === "ready");

  const openLightboxFor = (itemId: string) => {
    const idx = readyItems.findIndex((i) => i.id === itemId);
    if (idx >= 0) setLightboxIndex(idx);
  };

  return createPortal(
    <div className="fixed inset-0 z-[75] flex flex-col bg-surface">
      <div className="flex items-center gap-2 border-b border-line px-3 py-2.5">
        <button
          type="button"
          onClick={onClose}
          className="rounded-lg p-1.5 text-ink-light transition hover:bg-surface-overlay hover:text-ink"
          aria-label="Zamknij"
        >
          <X size={18} />
        </button>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold text-ink">
            {gallery?.title || "Galeria"}
          </div>
          {gallery && (
            <div className="truncate text-[11px] text-ink-faint">
              {gallery.itemCount} {gallery.itemCount === 1 ? "zdjęcie" : "zdjęć"}
              {gallery.failedCount > 0 ? ` · ${gallery.failedCount} nieudanych` : ""}
            </div>
          )}
        </div>
        <input
          ref={addFileRef}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={(e) => {
            void addFiles(e.target.files);
            e.target.value = "";
          }}
        />
        <button
          type="button"
          onClick={() => addFileRef.current?.click()}
          className="flex shrink-0 items-center gap-1.5 rounded-lg border border-line px-2.5 py-1.5 text-xs font-medium text-ink transition hover:border-accent/50"
        >
          <ImagePlus size={14} /> Dodaj zdjęcia
        </button>
      </div>

      {gallery?.description && (
        <div className="border-b border-line px-3 py-2 text-xs text-ink-light">
          {gallery.description}
        </div>
      )}

      {error && (
        <div className="border-b border-line bg-red-500/10 px-3 py-1.5 text-xs text-red-400">
          {error}
        </div>
      )}

      <div className="thin-scrollbar min-h-0 flex-1 overflow-y-auto p-3">
        {loading ? (
          <div className="flex h-full items-center justify-center text-ink-faint">
            <Loader2 size={20} className="animate-spin" />
          </div>
        ) : items.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-1 text-center text-sm text-ink-faint">
            Brak zdjęć w tej galerii.
          </div>
        ) : (
          <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-4 md:grid-cols-5">
            {items.map((item) => (
              <GridTile
                key={item.id}
                item={item}
                onOpen={() => openLightboxFor(item.id)}
                onRetry={(file) => void uploadAndTrack(gallery!.id, item, file)}
              />
            ))}
          </div>
        )}
      </div>

      {lightboxIndex !== null && (
        <Lightbox
          items={readyItems}
          index={lightboxIndex}
          onClose={() => setLightboxIndex(null)}
          onNavigate={setLightboxIndex}
        />
      )}
    </div>,
    document.body,
  );
}
