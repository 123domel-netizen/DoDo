/** Lokalne Blob URL miniatur podczas uploadu — zanim SharePoint zwróci URL. */

const urls = new Map<string, string>();
const listeners = new Set<() => void>();

function key(galleryId: string, itemId: string): string {
  return `${galleryId}:${itemId}`;
}

function notify(): void {
  listeners.forEach((fn) => fn());
}

export function setGalleryLocalThumb(
  galleryId: string,
  itemId: string,
  blob: Blob | null,
): void {
  const k = key(galleryId, itemId);
  const prev = urls.get(k);
  if (prev) URL.revokeObjectURL(prev);
  if (blob) urls.set(k, URL.createObjectURL(blob));
  else urls.delete(k);
  notify();
}

export function getGalleryLocalThumb(galleryId: string, itemId: string): string | null {
  return urls.get(key(galleryId, itemId)) ?? null;
}

/** Subskrypcja zmian (GalleryCard / Thumb). */
export function subscribeGalleryLocalThumbs(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export function clearGalleryLocalThumbs(galleryId: string): void {
  for (const [k, url] of urls) {
    if (k.startsWith(`${galleryId}:`)) {
      URL.revokeObjectURL(url);
      urls.delete(k);
    }
  }
  notify();
}
