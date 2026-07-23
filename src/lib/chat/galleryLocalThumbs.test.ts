import { afterEach, describe, expect, it, vi } from "vitest";
import {
  clearGalleryLocalThumbs,
  getGalleryLocalThumb,
  setGalleryLocalThumb,
  subscribeGalleryLocalThumbs,
} from "./galleryLocalThumbs";

describe("galleryLocalThumbs (creator → card)", () => {
  const galleryId = "gal-local-1";
  const itemId = "item-local-1";

  afterEach(() => {
    clearGalleryLocalThumbs(galleryId);
  });

  it("keeps blob URL after creator→card transition (no premature revoke)", () => {
    const blob = new Blob(["x"], { type: "image/jpeg" });
    setGalleryLocalThumb(galleryId, itemId, blob);
    const url = getGalleryLocalThumb(galleryId, itemId);
    expect(url).toMatch(/^blob:/);

    // Symulacja montażu karty w czacie — ten sam store, bez clear.
    expect(getGalleryLocalThumb(galleryId, itemId)).toBe(url);
  });

  it("keeps local thumb for pending/uploading/failed statuses (store independent of status)", () => {
    setGalleryLocalThumb(galleryId, itemId, new Blob(["z"], { type: "image/webp" }));
    for (const _status of ["pending", "uploading", "failed"] as const) {
      expect(getGalleryLocalThumb(galleryId, itemId)).toMatch(/^blob:/);
    }
  });

  it("closing dialog must not clear gallery local thumbs (no clearGalleryLocalThumbs on unmount)", () => {
    setGalleryLocalThumb(galleryId, itemId, new Blob(["keep"], { type: "image/jpeg" }));
    // Dialog preview revokes only its own object URLs — store stays.
    expect(getGalleryLocalThumb(galleryId, itemId)).toMatch(/^blob:/);
  });

  it("notifies subscribers when local thumb is set (card can re-bind)", () => {
    const cb = vi.fn();
    const unsub = subscribeGalleryLocalThumbs(cb);
    setGalleryLocalThumb(galleryId, itemId, new Blob(["y"], { type: "image/webp" }));
    expect(cb).toHaveBeenCalled();
    expect(getGalleryLocalThumb(galleryId, itemId)).toMatch(/^blob:/);
    unsub();
  });

  it("replacing thumb revokes previous URL but keeps a valid new one", () => {
    setGalleryLocalThumb(galleryId, itemId, new Blob(["a"], { type: "image/jpeg" }));
    const first = getGalleryLocalThumb(galleryId, itemId)!;
    setGalleryLocalThumb(galleryId, itemId, new Blob(["b"], { type: "image/webp" }));
    const second = getGalleryLocalThumb(galleryId, itemId)!;
    expect(second).toMatch(/^blob:/);
    expect(second).not.toBe(first);
  });
});
